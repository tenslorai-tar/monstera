import type { ButtonStep, CommandOfKind, ContractClient } from '@monstera/contract';
import { type DocVersion, type MessageKey, asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { BUTTON_PRESS_UNREAD } from '../messages/en.js';
import type { ZoomMode } from '../zoom.js';
import { pressButton } from './buttonPress.js';

/**
 * A press, carried out step by step (ADR-0259 Decision 3).
 *
 * What these read is what was SENT, and at which version: a step that names the wrong place or an old version is
 * refused by the kernel, and a renderer that sent nothing ends in the same document as one that sent and was refused.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000bb');
const READ_AT = asDocVersion(7);
const BUTTON = { page: 1, index: 4, name: 'go' };

function pressing(steps: readonly ButtonStep[] | null, lands: (sent: number) => boolean = () => true) {
  const sent: CommandOfKind<'resetForm'>[] = [];
  const said: MessageKey[] = [];
  /** Every route a step took, in the order it took it. */
  const routes: unknown[] = [];
  const deps = {
    client: {
      'document.buttonActions': () => Promise.resolve(ok({ version: READ_AT, steps })),
    } as Pick<ContractClient, 'document.buttonActions'>,
    apply: (command: CommandOfKind<'resetForm'>): Promise<DocVersion | undefined> => {
      sent.push(command);
      routes.push({ apply: command.step });
      return Promise.resolve(lands(sent.length) ? asDocVersion(command.version + 1) : undefined);
    },
    show: (page: number, zoom: ZoomMode | undefined) => {
      routes.push({ show: page, zoom });
    },
    toast: (_kind: 'done' | 'problem', message: MessageKey) => {
      said.push(message);
    },
  };
  return { deps, sent, said, routes };
}

const reset = (trigger: ButtonStep['trigger'], step: number, fields: readonly string[] | null = null): ButtonStep => ({
  trigger,
  step,
  action: { kind: 'reset', fields },
});

describe('pressing a push button', () => {
  it('runs the pressed trigger’s steps in order, each at the version the one before produced, and no other trigger’s', async () => {
    const { deps, sent, said } = pressing([reset('up', 0, ['a']), reset('up', 1), reset('down', 0), reset('up', 2)]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent).toStrictEqual([
      { kind: 'resetForm', ...BUTTON_PLACE, trigger: 'up', step: 0, version: READ_AT },
      { kind: 'resetForm', ...BUTTON_PLACE, trigger: 'up', step: 1, version: asDocVersion(8) },
      { kind: 'resetForm', ...BUTTON_PLACE, trigger: 'up', step: 2, version: asDocVersion(9) },
    ]);
    expect(said).toStrictEqual([]);
  });

  it('skips a step the document keeps, and runs a kept one that runs as a kind it knows, by its own place', async () => {
    const { deps, sent } = pressing([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'JavaScript', runsAs: null } },
      { trigger: 'up', step: 1, action: { kind: 'kept', subtype: 'ResetForm', runsAs: 'reset' } },
    ]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent.map((command) => command.step)).toStrictEqual([1]);
  });

  it('shows the page a go-to names, at its view, in its place among the other steps', async () => {
    const { deps, routes } = pressing([
      { trigger: 'up', step: 0, action: { kind: 'goTo', page: 3, view: 'fit', at: null } },
      reset('up', 1),
      { trigger: 'up', step: 2, action: { kind: 'goTo', page: 0, view: 'keep', at: { left: 10, top: 700, zoom: 9 } } },
      { trigger: 'up', step: 3, action: { kind: 'goTo', page: 1, view: 'keep', at: null } },
    ]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(routes).toStrictEqual([
      { show: 3, zoom: { kind: 'fit-page' } },
      { apply: 1 },
      // A ZOOM PAST THE LADDER is the ladder's end, as every other zoom is.
      { show: 0, zoom: { kind: 'scale', scale: 4 } },
      // NONE NAMED keeps the reader's.
      { show: 1, zoom: undefined },
    ]);
  });

  it('stops at a step that did not land, since what follows was written to follow it', async () => {
    const { deps, sent } = pressing([reset('up', 0), reset('up', 1)], () => false);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent).toHaveLength(1);
  });

  it('CONTROL: a button that no longer reads as one sends nothing and says so', async () => {
    const { deps, sent, said } = pressing(null);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent).toStrictEqual([]);
    expect(said).toStrictEqual([BUTTON_PRESS_UNREAD]);
  });
});

const BUTTON_PLACE = { page: BUTTON.page, index: BUTTON.index };
