import { type ContractClient, channels, createClient } from '@monstera/contract';
import { err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { COMPONENTS_DIALOG, COMPONENTS_DIALOG_ID, type ComponentsAnswer } from '../dialogs/components.js';
import { GROUP_APPLICATION } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { showComponentsCommand } from './showComponents.js';

/**
 * *Components*: the UI half of the pair (ADR-0122). What main answers is `componentStatus.test.ts`, against real
 * files and a real manifest; this file asserts **which calls are made** — that the first look does not hash, and that
 * only *Verify files* asks main to.
 */

const ANYWHERE = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
} as unknown as CommandContext;

const PDFIUM = { id: 'pdfium', name: 'PDFium', version: '155.0', missing: 0, altered: 0, extra: 0 } as const;

interface Sent {
  readonly id: string;
  readonly params: unknown;
}

function client(): { readonly client: ContractClient; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const built = createClient(channels, (id, params) => {
    sent.push({ id, params });
    if (id === 'app.components') {
      const { verify } = params as { verify: boolean };
      return Promise.resolve(ok({ components: [{ ...PDFIUM, state: verify ? 'verified' : 'present' }] }));
    }
    throw new Error(`this case does not answer ${id}`);
  });
  return { client: built, sent };
}

/** Runs the command with a dialog that gives each answer in turn, recording what it was opened with. */
async function run(
  answers: readonly (ComponentsAnswer | undefined)[],
): Promise<{ readonly sent: Sent[]; readonly opened: unknown[] }> {
  const { client: built, sent } = client();
  const opened: unknown[] = [];
  await showComponentsCommand({
    client: built,
    ask: (id, props) => {
      expect(id).toBe(COMPONENTS_DIALOG_ID);
      opened.push(props);
      return Promise.resolve(answers[opened.length - 1]);
    },
  }).run(ANYWHERE);
  return { sent, opened };
}

describe('showComponentsCommand', () => {
  it('opens with the cheap look — main is asked NOT to hash — and a dismissal asks nothing more', async () => {
    const { sent, opened } = await run([undefined]);

    expect(sent).toStrictEqual([{ id: 'app.components', params: { verify: false } }]);
    expect(opened).toStrictEqual([{ components: [{ ...PDFIUM, state: 'present' }], verified: false }]);
  });

  it('*Verify files* asks main to hash, and opens again with that answer marked verified', async () => {
    // CONTROL for the case above: the same command, one answer different — so `verify: false` there is the
    // first look being cheap, not a command that never passes anything else.
    const { sent, opened } = await run(['verify', undefined]);

    expect(sent.map((call) => call.params)).toStrictEqual([{ verify: false }, { verify: true }]);
    expect(opened[1]).toStrictEqual({ components: [{ ...PDFIUM, state: 'verified' }], verified: true });
  });

  it('opens nothing when main fails, rather than a dialog that looks like an answer', async () => {
    const opened: unknown[] = [];
    await showComponentsCommand({
      // THE CHANNEL'S OWN FAILURE SHAPE: `internal` is the one a channel with no declared failures can answer.
      client: createClient(channels, () => Promise.resolve(err({ code: 'internal' as const, incident: 'i-1' }))),
      ask: (_id, props) => {
        opened.push(props);
        return Promise.resolve(undefined);
      },
    }).run(ANYWHERE);
    expect(opened).toStrictEqual([]);
  });

  it('opens a dialog whose props schema is the channel’s own list, so every state main sends is accepted', () => {
    for (const state of ['present', 'verified', 'absent', 'changed'] as const) {
      expect(COMPONENTS_DIALOG.props.safeParse({ components: [{ ...PDFIUM, state }], verified: false }).success).toBe(
        true,
      );
    }
    // CONTROL: a state the channel does not declare is refused — so the loop above is the schema accepting, not a
    // schema that accepts anything.
    expect(
      COMPONENTS_DIALOG.props.safeParse({ components: [{ ...PDFIUM, state: 'downloading' }], verified: false }).success,
    ).toBe(false);
  });

  it('is offered in Tools › Application and in Help — and offers no download anywhere', () => {
    const command = showComponentsCommand({ client: client().client, ask: () => Promise.resolve(undefined) });
    expect(command.placements).toStrictEqual([
      { surface: 'ribbon', section: 'tools', group: GROUP_APPLICATION, order: 915, prominence: 'secondary' },
      { surface: 'menu-bar', menu: 'help', group: 2, order: 25 },
    ]);
  });
});
