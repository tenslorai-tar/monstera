import type { DispatchableCommand, ListedObject } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { EN } from '../messages/en.js';
import { type EditableObject, type ObjectFilter, type ObjectPick, arrangeCommand } from '../objectEditing.js';
import type { CommandContext } from '../registries/commands.js';
import { EDIT_OBJECTS_TOOL_ID, editObjectsCommands, objectArrangeCommands } from './objectCommands.js';

/**
 * Edit object's commands
 * ([ADR-0264](../../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)):
 * the UI half of the wired pairs for the four filters and the two arrange steps. The arrange steps' kernel half is the
 * `arrange` cases of `drawnObjectEdit.test.ts` and `editObjectText.test.ts`, and `proof:editobject`'s.
 */

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(5),
  hasSelection: false,
  dirty: false,
  page: 1,
  pageCount: 2,
  openDocuments: [],
};

describe('the four filters', () => {
  const built = (tool: string | undefined, filter: ObjectFilter) => {
    const entered: (ObjectFilter | undefined)[] = [];
    const commands = editObjectsCommands({ activeTool: () => tool, filter: () => filter, onEnter: (chosen) => entered.push(chosen) });
    return { commands, entered };
  };

  it('are ONE ribbon menu in the Edit section whose face runs the filter chosen last', () => {
    const { commands } = built(undefined, 'all');
    expect(commands.map((command) => command.id)).toStrictEqual(['edit.objects-all', 'edit.objects-text', 'edit.objects-images', 'edit.objects-shapes']);
    expect(commands.map((command) => EN[command.title])).toStrictEqual(['Edit all objects', 'Edit text objects', 'Edit images', 'Edit shapes']);
    for (const command of commands) {
      expect(command.placements).toStrictEqual([expect.objectContaining({ surface: 'ribbon', section: 'edit', menuRuns: 'last' })]);
    }
    // ONE MENU: every member names the same one.
    expect(new Set(commands.map((command) => (command.placements[0] as { menu?: unknown }).menu)).size).toBe(1);
  });

  it('turn the mode on with their filter, and off again when it is the one already on', async () => {
    const off = built(undefined, 'all');
    await off.commands[2]?.run(CONTEXT);
    expect(off.entered).toStrictEqual(['images']);
    const on = built(EDIT_OBJECTS_TOOL_ID, 'images');
    expect(on.commands.map((command) => command.checked?.(CONTEXT))).toStrictEqual([false, false, true, false]);
    await on.commands[2]?.run(CONTEXT);
    // CONTROL: another filter while the mode is on switches to it rather than leaving.
    await on.commands[3]?.run(CONTEXT);
    expect(on.entered).toStrictEqual([undefined, 'shapes']);
  });
});

describe('Bring forward and Send backward', () => {
  const SHAPE: EditableObject = {
    source: 'drawn',
    index: 2,
    kind: 'path',
    ordinal: 0,
    box: { x0: 0, y0: 0, x1: 10, y1: 10 },
    drawn: { x0: 0, y0: 0, x1: 10, y1: 10 },
    fill: null,
  };
  /** An image under the shape and nothing over it. */
  const LISTED: ListedObject[] = [
    { index: 1, kind: 'image', box: { left: 5, bottom: 5, right: 20, top: 20 } },
    { index: 2, kind: 'path', box: { left: 0, bottom: 0, right: 10, top: 10 } },
  ];
  const pick: ObjectPick = { page: 1, version: asDocVersion(5), object: SHAPE, listed: LISTED };
  const built = (picked: ObjectPick | undefined) => {
    const sent: DispatchableCommand[] = [];
    const [forward, backward] = objectArrangeCommands({ picked: () => picked, onArrange: (command) => sent.push(command) });
    if (forward === undefined || backward === undefined) throw new Error('expected two commands');
    return { forward, backward, sent };
  };

  it('sit in the Properties tab and the object’s menu, and dispatch exactly the step for the selected object', async () => {
    const { forward, backward, sent } = built(pick);
    expect(backward.placements.map((placement) => placement.surface)).toStrictEqual(['properties', 'context-menu']);
    expect(backward.when?.(CONTEXT)).toBe(true);
    await backward.run(CONTEXT);
    expect(sent).toStrictEqual([arrangeCommand(pick, 'backward')]);
    expect(sent[0]).toMatchObject({ kind: 'editDrawnObject', edit: { op: 'arrange', to: 'backward', past: { kind: 'image', ordinal: 0 } } });
    // CONTROL: nothing overlaps it in front, so Bring forward does not exist — never a button that does nothing.
    expect(forward.when?.(CONTEXT)).toBe(false);
  });

  it('CONTROL: hidden with nothing selected', () => {
    const { forward, backward } = built(undefined);
    expect([forward.when?.(CONTEXT), backward.when?.(CONTEXT)]).toStrictEqual([false, false]);
  });
});
