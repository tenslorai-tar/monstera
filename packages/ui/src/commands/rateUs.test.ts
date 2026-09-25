import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type MessageKey, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { REVIEW_STORE_NOT_OPENED } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import type { ToastKind } from '../primitives/Toast.js';
import { rateUsCommand } from './rateUs.js';

/**
 * *Rate Us*: the UI half of its pair. `engagement.test.ts` is main's half — that a `rate` records
 * `reviewedAt` only when the Store opened — and this file asserts the call that crosses and what the person
 * is told when nothing opened, because a press that opens nothing and says nothing looks exactly like a
 * press that was never wired.
 */

const ANYWHERE = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
} as unknown as CommandContext;

type Answer = 'opened' | 'not-opened' | 'refused' | 'rejected';

async function run(
  answer: Answer,
): Promise<{ readonly sent: { id: string; params: unknown }[]; readonly said: { kind: ToastKind; message: MessageKey }[] }> {
  const sent: { id: string; params: unknown }[] = [];
  const said: { kind: ToastKind; message: MessageKey }[] = [];
  const client: ContractClient = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id !== 'app.review') throw new Error(`this case does not answer ${id}`);
    if (answer === 'rejected') return Promise.reject(new Error('the transport is gone'));
    // WITH ITS INCIDENT, which `failureSchema` requires of `internal`: without one the envelope is malformed and
    // the client throws, which is the `rejected` case again rather than a refusal.
    if (answer === 'refused') return Promise.resolve(err({ code: 'internal' as const, incident: 'incident-1' }));
    return Promise.resolve(ok({ opened: answer === 'opened' }));
  });
  await rateUsCommand({
    client,
    toast: (kind, message) => {
      said.push({ kind, message });
    },
  }).run(ANYWHERE);
  return { sent, said };
}

describe('rateUsCommand', () => {
  it('asks main to RATE, through the prompt’s own channel, and says nothing when the Store opened', async () => {
    const { sent, said } = await run('opened');

    // THE WHOLE PARAMETER: `rate` is the answer that opens the Store and records `reviewedAt`, and a
    // command sending `reviewed` would record a rating nobody gave while opening nothing.
    expect(sent).toStrictEqual([{ id: 'app.review', params: { action: 'rate' } }]);
    expect(said).toStrictEqual([]);
  });

  it('says so when the page did not open — for each of the three ways it can fail to', async () => {
    // Each against the silent case above: a command that toasted unconditionally fails that one, and
    // one that never toasted fails these.
    for (const answer of ['not-opened', 'refused', 'rejected'] as const) {
      const { sent, said } = await run(answer);
      expect(sent).toStrictEqual([{ id: 'app.review', params: { action: 'rate' } }]);
      expect(said, answer).toStrictEqual([{ kind: 'problem', message: REVIEW_STORE_NOT_OPENED }]);
    }
  });

  it('is the title bar’s second button, beside Donate, and needs no document', () => {
    const command = rateUsCommand({ client: createClient(channels, () => Promise.reject(new Error('unused'))), toast: () => undefined });

    expect(command.when).toBeUndefined();
    expect(command.placements).toStrictEqual([{ surface: 'title-bar', emphasis: 'normal', order: 2 }]);
  });
});
