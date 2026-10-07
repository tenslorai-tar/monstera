import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { PlacedField } from '../forms/arrange.js';
import type { CommandContext } from '../registries/commands.js';
import { fieldArrangeCommands } from './fieldArrangeCommands.js';

/**
 * The nine arrange commands are registered with a `when` and a `run` that sends what the table's rule answers.
 *
 * The UI half of the wired pair: the rule itself is `arrange.test.ts`'s, and what a rendered Properties tab does with the
 * button is the Playwright case's. This asks that each command is present only for two or more fields and hands the new
 * places to the one `apply`, and nothing when the selection is already as asked.
 */
const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(4),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

const A: PlacedField = { field: { page: 0, index: 0, name: 'a' }, rect: { x0: 100, y0: 500, x1: 200, y1: 520 } };
const B: PlacedField = { field: { page: 0, index: 1, name: 'b' }, rect: { x0: 130, y0: 450, x1: 260, y1: 480 } };

function built(placed: readonly PlacedField[]): { readonly sent: (readonly PlacedField[])[]; readonly commands: ReturnType<typeof fieldArrangeCommands> } {
  const sent: (readonly PlacedField[])[] = [];
  const commands = fieldArrangeCommands({
    placed: () => placed,
    apply: (moved) => {
      sent.push(moved);
    },
  });
  return { sent, commands };
}

describe('the arrange commands', () => {
  it('registers nine, each at the Properties tab and each with a title', () => {
    const { commands } = built([A, B]);
    expect(commands.map((command) => command.id)).toStrictEqual([
      'forms.arrange.align-left',
      'forms.arrange.align-right',
      'forms.arrange.align-top',
      'forms.arrange.align-bottom',
      'forms.arrange.centre-horizontally',
      'forms.arrange.centre-vertically',
      'forms.arrange.same-width',
      'forms.arrange.same-height',
      'forms.arrange.same-size',
    ]);
    for (const command of commands) {
      expect(command.placements.map((placement) => placement.surface)).toStrictEqual(['properties']);
    }
  });

  it('is hidden for fewer than two fields, and present for two (control)', () => {
    for (const command of built([A]).commands) expect(command.when?.(CONTEXT)).toBe(false);
    for (const command of built([]).commands) expect(command.when?.(CONTEXT)).toBe(false);
    for (const command of built([A, B]).commands) expect(command.when?.(CONTEXT)).toBe(true);
  });

  it('hands the places of the fields that move to apply, in one call', () => {
    const { sent, commands } = built([A, B]);
    const left = commands.find((command) => command.id === 'forms.arrange.align-left');
    void left?.run(CONTEXT);
    expect(sent).toStrictEqual([[{ field: B.field, rect: { x0: 100, y0: 450, x1: 230, y1: 480 } }]]);
  });

  it('CONTROL: a selection already as asked sends nothing, so an aligned form costs no undo step', () => {
    const aligned: PlacedField = { field: B.field, rect: { x0: 100, y0: 450, x1: 230, y1: 480 } };
    const { sent, commands } = built([A, aligned]);
    void commands.find((command) => command.id === 'forms.arrange.align-left')?.run(CONTEXT);
    expect(sent).toStrictEqual([]);
  });
});
