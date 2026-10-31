import { type ContractClient, MAX_CHAT_TURNS, channels, createClient, savedTurnsSchema } from '@monstera/contract';
import { asDocId, asDocVersion, asFileHandle, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { savedTurns, syncConversation } from './chatHistorySync.js';
import { type ConversationTurn, DocumentStores, createDocumentStore } from './documentStores.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000d1');
const SAVED = [
  { role: 'user' as const, text: 'Earlier question' },
  { role: 'assistant' as const, text: 'Earlier answer' },
];

/** The key `main` gave the saved conversation a case loads, and the keys it gives new ones, in order. */
const LOADED_KEY = 'c'.repeat(64);
const newKey = (count: number): string => String(count % 10).repeat(64);

function recording(
  saved: readonly { role: 'user' | 'assistant'; text: string }[],
  /** `main`'s answer to a NEW conversation's save: a key, or `file-full` once the file keeps its twenty. */
  fresh: 'key' | 'file-full' = 'key',
): {
  client: ContractClient;
  sent: { id: string; params: unknown }[];
} {
  const sent: { id: string; params: unknown }[] = [];
  let minted = 0;
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'ai.history.load') return Promise.resolve(ok({ turns: saved, conversation: saved.length === 0 ? null : LOADED_KEY }));
    if (id === 'ai.history.save') {
      const { conversation: named, turns } = params as { conversation: string | null; turns: readonly unknown[] };
      if (named !== null) return Promise.resolve(ok({ saved: true, conversation: named }));
      // AN EMPTY NEW CONVERSATION stores nothing and is given no key, as `main` answers it.
      if (turns.length === 0) return Promise.resolve(ok({ saved: false, conversation: null }));
      if (fresh === 'file-full') return Promise.resolve({ ok: false, error: { code: 'file-full' } });
      minted += 1;
      return Promise.resolve(ok({ saved: true, conversation: newKey(minted) }));
    }
    throw new Error(`unexpected ${id}`);
  });
  return { client, sent };
}

/** The conversation key each save named, in order. */
const named = (sent: readonly { id: string; params: unknown }[]): (string | null)[] =>
  sent.filter((call) => call.id === 'ai.history.save').map((call) => (call.params as { conversation: string | null }).conversation);

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
      conversation: null,
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

  it('saves a 20,000-character answer WHOLE, and the schema main saves with accepts it (ADR-0277)', () => {
    const long = Array.from({ length: 20_000 }, (_, at) => String.fromCharCode(97 + (at % 26))).join('');
    const saved = savedTurns([
      { role: 'user', text: 'Explain every clause.' },
      { role: 'assistant', text: long },
    ]);
    expect(saved[1]?.text).toBe(long);
    expect(channels['ai.history.save'].params.safeParse({ docId: DOC, conversation: null, turns: saved }).success).toBe(true);
  });

  it('NEW CHAT saves a NEW conversation and never names the old one again; the old one is not replaced (ADR-0277)', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording(SAVED);
    const clock = manual();
    syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    // CONTINUING the loaded conversation names its key.
    store.getState().converse([...store.getState().conversation, { role: 'user', text: 'More?' }]);
    clock.flush();
    await settle();
    store.getState().startConversation();
    clock.flush();
    store.getState().converse([{ role: 'user', text: 'A fresh question' }]);
    clock.flush();
    await settle();
    store.getState().converse([{ role: 'user', text: 'A fresh question' }, { role: 'assistant', text: 'A fresh answer' }]);
    clock.flush();
    await settle();
    // THE NEW ONE'S FIRST SAVE NAMES NONE, its next names the key it was given, and the loaded key is never named after.
    // (The empty conversation New chat left stores nothing, as main answers a save of no turns.)
    expect(named(sent)).toStrictEqual([LOADED_KEY, null, null, newKey(1)]);
  });

  it('NEW CHAT pressed while the last answer is still settling saves that answer in the OLD conversation first', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording(SAVED);
    const clock = manual();
    syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    // AN ANSWER LANDS and New chat is pressed before the settle time passes — as on *Start a new conversation*, which
    // appears with the answer that fills a conversation (the stage audit of f32c8c39..0d48e788).
    store.getState().converse([...SAVED, { role: 'user', text: 'Last question' }, { role: 'assistant', text: 'Last answer' }]);
    store.getState().startConversation();
    clock.flush();
    await settle();
    const saves = sent.filter((call) => call.id === 'ai.history.save').map((call) => call.params as { conversation: string | null; turns: readonly { text: string }[] });
    // THE CALL MADE: the old conversation, under its own key, with the answer. CONTROL: the one settle timer per store was
    // cancelled by New chat's change, so only the empty new conversation was saved and the answer was never kept.
    expect(saves[0]?.conversation).toBe(LOADED_KEY);
    expect(saves[0]?.turns.map((turn) => turn.text)).toStrictEqual(['Earlier question', 'Earlier answer', 'Last question', 'Last answer']);
    expect(saves).toHaveLength(2);
    expect(saves[1]?.conversation).toBeNull();
  });

  it('a new conversation’s waiting save is ITS OWN latest state, never the next conversation’s', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording([]);
    const clock = manual();
    syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    store.getState().converse([{ role: 'user', text: 'First' }]);
    clock.flush();
    // ITS FIRST SAVE IN FLIGHT, a second change waits for the key; then New chat and a question there.
    store.getState().converse([{ role: 'user', text: 'First' }, { role: 'assistant', text: 'First answer' }]);
    store.getState().startConversation();
    store.getState().converse([{ role: 'user', text: 'Second conversation' }]);
    clock.flush();
    await settle();
    await settle();
    const saves = sent.filter((call) => call.id === 'ai.history.save').map((call) => call.params as { conversation: string | null; turns: readonly { text: string }[] });
    // THE WAITING SAVE went under the first conversation's key with its own answer; the second began keyless.
    const underFirst = saves.filter((each) => each.conversation === newKey(1));
    expect(underFirst.map((each) => each.turns.map((turn) => turn.text))).toStrictEqual([['First', 'First answer']]);
    expect(saves.some((each) => each.conversation === newKey(1) && each.turns.some((turn) => turn.text === 'Second conversation'))).toBe(false);
  });

  it('CONTROL: without New chat, an emptied and refilled conversation is the SAME one', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording(SAVED);
    const clock = manual();
    syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    store.getState().converse([]);
    store.getState().converse([{ role: 'user', text: 'Edited' }]);
    clock.flush();
    await settle();
    expect(named(sent)).toStrictEqual([LOADED_KEY]);
  });

  it('a new conversation’s second save WAITS for the first one’s key, so it is never added twice', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client, sent } = recording([]);
    const clock = manual();
    const stop = syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    store.getState().converse([{ role: 'user', text: 'Q' }]);
    clock.flush();
    // A SECOND CHANGE before the first save's answer, flushed by the close.
    store.getState().converse([{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'A' }]);
    stop();
    await settle();
    await settle();
    expect(named(sent)).toStrictEqual([null, newKey(1)]);
  });

  it('a file at its twenty is SAID: the refusal lands on the store, and a later save that goes clears it', async () => {
    const store = createDocumentStore(DOC, asDocVersion(1));
    const { client } = recording([], 'file-full');
    const clock = manual();
    syncConversation(client, DOC, store, () => true, clock.schedule);
    await settle();
    store.getState().converse([{ role: 'user', text: 'Q' }]);
    clock.flush();
    await settle();
    expect(store.getState().historyRefused).toBe('file-full');
    // A NEW CONVERSATION starts afresh, unrefused until main says otherwise.
    store.getState().startConversation();
    expect(store.getState().historyRefused).toBeNull();
  });

  it('keeps an asked turn’s FILE NAMES and never its handles (ADR-0135), and the schema main saves with accepts it', () => {
    const turn: ConversationTurn = {
      role: 'user',
      text: 'What do these say?',
      attached: ['notes.txt', 'photo.jpg'],
      request: { about: undefined, attachments: [{ handle: asFileHandle('h-notes'), name: 'notes.txt', bytes: 3 }] },
    };
    const saved = savedTurns([turn]);
    expect(saved).toStrictEqual([{ role: 'user', text: 'What do these say?', attached: ['notes.txt', 'photo.jpg'] }]);
    expect(JSON.stringify(saved)).not.toContain('h-notes');
    expect(savedTurnsSchema.safeParse(saved).success).toBe(true);
  });
});
