import { type ContractClient, MAX_CHAT_TURNS, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { savedTurns, syncConversation } from './chatHistorySync.js';
import { type ConversationTurn, DocumentStores, createDocumentStore } from './documentStores.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000d1');
const SAVED = [
  { role: 'user' as const, text: 'Earlier question' },
  { role: 'assistant' as const, text: 'Earlier answer' },
];

function recording(saved: readonly { role: 'user' | 'assistant'; text: string }[]): {
  client: ContractClient;
  sent: { id: string; params: unknown }[];
} {
  const sent: { id: string; params: unknown }[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'ai.history.load') return Promise.resolve(ok({ turns: saved }));
    if (id === 'ai.history.save') return Promise.resolve(ok({ saved: true }));
    throw new Error(`unexpected ${id}`);
  });
  return { client, sent };
}

/** A scheduler the case runs by hand, so "settled" is a step and not a wait. */
function manual(): { schedule: (run: () => void) => () => void; flush: () => void; pending: () => number } {
  const queue = new Set<() => void>();
  return {
    schedule: (run) => {
      queue.add(run);
      return () => queue.delete(run);
    },
    flush: () => {
      for (const run of [...queue]) {
        queue.delete(run);
        run();
      }
    },
    pending: () => queue.size,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('keeping a conversation saved (ADR-0093)', () => {
  it('loads the saved conversation into an EMPTY one, and does not save it straight back', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording(SAVED);
    const clock = manual();
    syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    expect(store.getState().conversation.map((turn) => turn.text)).toStrictEqual(['Earlier question', 'Earlier answer']);
    clock.flush();
    expect(sent.filter((call) => call.id === 'ai.history.save')).toHaveLength(0);
  });

  it('CONTROL: a conversation already started is not replaced by the saved one', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    store.getState().converse([{ role: 'user', text: 'New question' }]);
    const { client } = recording(SAVED);
    syncConversation(client, DOC, store, () => true, manual().schedule);
    await settle();
    expect(store.getState().conversation.map((turn) => turn.text)).toStrictEqual(['New question']);
  });

  it('saves ONCE when the conversation settles, not once per change', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording([]);
    const clock = manual();
    syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    store.getState().converse([{ role: 'user', text: 'Q' }]);
    store.getState().converse([{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'A' }]);
    store.getState().converse([{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'A, whole' }]);
    expect(clock.pending()).toBe(1);
    clock.flush();
    const saves = sent.filter((call) => call.id === 'ai.history.save');
    expect(saves).toHaveLength(1);
    expect(saves[0]?.params).toStrictEqual({
      docId: DOC,
      turns: [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: 'A, whole' },
      ],
    });
  });

  it('STOPPING FLUSHES a save still settling — the close does not lose the last answer', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording([]);
    const clock = manual();
    const stop = syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    store.getState().converse([{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'A' }]);
    stop();
    expect(sent.filter((call) => call.id === 'ai.history.save')).toHaveLength(1);
    // CONTROL: nothing is left to run afterwards, so there is no second save after the close.
    clock.flush();
    expect(sent.filter((call) => call.id === 'ai.history.save')).toHaveLength(1);
  });

  it('DocumentStores announces a close BEFORE the store is dropped, so the flush can still read it', () => {
    const stores = new DocumentStores();
    const seen: string[] = [];
    stores.watch({
      opened: (docId) => seen.push(`opened ${docId}`),
      closed: (docId) => seen.push(`closed ${docId} held=${String(stores.get(docId) !== undefined)}`),
    });
    stores.open(DOC, asDocVersion(1));
    stores.close(DOC);
    expect(seen).toStrictEqual([`opened ${DOC}`, `closed ${DOC} held=true`]);
  });

  it('with the setting OFF, neither loads nor saves', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording(SAVED);
    const clock = manual();
    syncConversation(client, DOC, store, () => false, clock.schedule);
    await settle();
    store.getState().converse([{ role: 'user', text: 'Q' }]);
    clock.flush();
    expect(sent).toHaveLength(0);
  });

  it('saves the NEWEST turns within the contract bound, without session-only fields', () => {
    const many: ConversationTurn[] = Array.from({ length: MAX_CHAT_TURNS + 3 }, (_, at) => ({
      role: at % 2 === 0 ? 'user' : 'assistant',
      text: `t${String(at)}`,
      posted: true,
    }));
    const saved = savedTurns(many);
    expect(saved).toHaveLength(MAX_CHAT_TURNS);
    expect(saved[0]?.text).toBe('t3');
    expect(saved.some((turn) => 'posted' in turn)).toBe(false);
  });
});
