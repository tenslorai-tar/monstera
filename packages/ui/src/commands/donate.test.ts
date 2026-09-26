import { type ContractClient, channels, createClient } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DONATE_DIALOG_ID, type DonateAnswer } from '../dialogs/donate.js';
import type { CommandContext } from '../registries/commands.js';
import { donateCommand } from './donate.js';

/**
 * *Donate*: the UI half of the pair (ADR-0095). What `main` does with the place these cases watch
 * cross is `webPages.test.ts` — this file asserts **which calls are made**, because the end state of
 * a correct *Not now* and of a command that never asked is identical: nothing happened.
 *
 * So every case here reads the recorded calls rather than a result, which is CLAUDE.md's rule for a
 * decision: assert the call that was or was not made.
 */

const ANYWHERE = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
} as unknown as CommandContext;

interface Sent {
  readonly id: string;
  readonly params: unknown;
}

function client(): { readonly client: ContractClient; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'app.openWebPage') return Promise.resolve(ok({ opened: true }));
    throw new Error(`this case does not answer ${id}`);
  });
  return { client: built, sent };
}

/** Runs the command with a dialog that answers as the case says, recording what it was opened with. */
async function run(answer: DonateAnswer | undefined): Promise<{ readonly sent: Sent[]; readonly asked: string[] }> {
  const { client: built, sent } = client();
  const asked: string[] = [];
  await donateCommand({
    client: built,
    ask: (id) => {
      asked.push(id);
      return Promise.resolve(answer);
    },
  }).run(ANYWHERE);
  return { sent, asked };
}

describe('donateCommand', () => {
  it('opens the dialog first, and on *Open the donation page* names the PLACE — never an address', async () => {
    const { sent, asked } = await run('open');

    expect(asked).toStrictEqual([DONATE_DIALOG_ID]);
    // THE WHOLE PARAMETER, not just the channel: a command that could compose a URL would put one
    // here, and `page: 'donate'` is the property that makes an injected destination unrepresentable.
    expect(sent).toStrictEqual([{ id: 'app.openWebPage', params: { page: 'donate' } }]);
  });

  it('*Not now* asks nothing of main, and so does DISMISSAL — the two are one answer', async () => {
    // The contrast with the case above is what makes these non-vacuous: a command that opened the
    // page unconditionally passes neither, and one that never opened it passes only these.
    expect((await run('later')).sent).toStrictEqual([]);
    expect((await run(undefined)).sent).toStrictEqual([]);
    // CONTROL: the dialog was still opened in both, so an empty `sent` is the answer being honoured
    // rather than the command failing before it asked.
    expect((await run('later')).asked).toStrictEqual([DONATE_DIALOG_ID]);
    expect((await run(undefined)).asked).toStrictEqual([DONATE_DIALOG_ID]);
  });

  it('is offered through the title bar, which the start screen draws too, and Help — the two places the design draws it', () => {
    const command = donateCommand({ client: client().client, ask: () => Promise.resolve(undefined) });

    expect(command.when).toBeUndefined();
    // THE WHOLE LIST, so a third placement — a start-screen footer button the owner's exports do not draw — fails here
    // rather than appearing on a screen nobody compared against the design. Help › Donate is v5-14's (ADR-0107).
    expect(command.placements).toStrictEqual([
      { surface: 'title-bar', emphasis: 'primary', order: 1 },
      { surface: 'menu-bar', menu: 'help', group: 1, order: 10 },
    ]);
  });
});
