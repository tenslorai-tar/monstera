import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type MessageKey, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { RATE_US_DIALOG_ID, type RateUsAnswer } from '../dialogs/rateUs.js';
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
  /** What the dialog answers, `open` unless the case is about the dialog; `dismissed` settles it with nothing. */
  chose: RateUsAnswer | 'dismissed' = 'open',
): Promise<{
  readonly sent: { id: string; params: unknown }[];
  readonly said: { kind: ToastKind; message: MessageKey }[];
  readonly asked: string[];
}> {
  const sent: { id: string; params: unknown }[] = [];
  const said: { kind: ToastKind; message: MessageKey }[] = [];
  const asked: string[] = [];
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
    ask: (id) => {
      asked.push(id);
      return Promise.resolve(chose === 'dismissed' ? undefined : chose);
    },
  }).run(ANYWHERE);
  return { sent, said, asked };
}

describe('rateUsCommand', () => {
  it('opens a DIALOG first, and the Store only on its *Go to Microsoft Store*', async () => {
    const { sent, asked } = await run('opened');
    expect(asked).toStrictEqual([RATE_US_DIALOG_ID]);
    expect(sent).toStrictEqual([{ id: 'app.review', params: { action: 'rate' } }]);
  });

  it('*Not now* asks nothing of main, and so does DISMISSAL — the two are one answer', async () => {
    // THE CONTRAST WITH THE CASE ABOVE: a command that opened the Store unconditionally passes neither of these.
    expect((await run('opened', 'later')).sent).toStrictEqual([]);
    expect((await run('opened', 'dismissed')).sent).toStrictEqual([]);
    // CONTROL: the dialog was opened in both, so an empty `sent` is the answer honoured and not a command that
    // failed before it asked; and nothing is toasted for a Store that was never asked to open.
    const dismissed = await run('opened', 'dismissed');
    expect(dismissed.asked).toStrictEqual([RATE_US_DIALOG_ID]);
    expect(dismissed.said).toStrictEqual([]);
  });

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

  it('is the menu row’s second button, in violet beside Donate, and Help’s — and needs no document', () => {
    const command = rateUsCommand({
      client: createClient(channels, () => Promise.reject(new Error('unused'))),
      toast: () => undefined,
      ask: () => Promise.resolve(undefined),
    });

    expect(command.when).toBeUndefined();
    expect(command.placements).toStrictEqual([
      { surface: 'menu-bar-commands', tone: 'violet', order: 2 },
      { surface: 'menu-bar', menu: 'help', group: 1, order: 20 },
    ]);
  });
});
