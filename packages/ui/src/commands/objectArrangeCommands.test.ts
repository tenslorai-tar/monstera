import type { DispatchableCommand } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { EditableObject, ObjectPick } from '../objectEditing.js';
import type { CommandContext } from '../registries/commands.js';
import { objectArrangeCommands } from './objectArrangeCommands.js';

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

const PHOTO: EditableObject = {
  source: 'content',
  index: 2,
  ordinal: 0,
  kind: 'image',
  box: { x0: 0, y0: 0, x1: 10, y1: 10 },
  drawn: { x0: 0, y0: 0, x1: 10, y1: 10 },
  members: [2],
  fill: null,
};

/**
 * Bring forward and Send backward (ADR-0244), the UI half of the wired pair: each is shown only where its step exists and
 * dispatches exactly `arrangePageObject` for the selected object. The kernel half is `proof:pdfiumobject`'s Arrange cases.
 */
describe('Edit object’s Arrange commands', () => {
  const built = (pick: ObjectPick | undefined) => {
    const sent: DispatchableCommand[] = [];
    const [forward, backward] = objectArrangeCommands({ picked: () => pick, onArrange: (command) => sent.push(command) });
    if (forward === undefined || backward === undefined) throw new Error('expected two commands');
    return { forward, backward, sent };
  };

  it('sit in the Properties tab and the object’s menu, and dispatch the step for the selected object', async () => {
    const { forward, backward, sent } = built({ page: 1, version: asDocVersion(5), object: PHOTO, walked: 4 });
    expect(forward.placements.map((placement) => placement.surface)).toStrictEqual(['properties', 'context-menu']);
    expect([forward.when?.(CONTEXT), backward.when?.(CONTEXT)]).toStrictEqual([true, true]);
    await forward.run(CONTEXT);
    await backward.run(CONTEXT);
    expect(sent).toStrictEqual([
      { kind: 'arrangePageObject', page: 1, index: 2, toward: 'forward', version: asDocVersion(5) },
      { kind: 'arrangePageObject', page: 1, index: 2, toward: 'backward', version: asDocVersion(5) },
    ]);
  });

  it('CONTROL: hidden with nothing selected, and Bring forward hidden for the walk’s last object', () => {
    expect(built(undefined).forward.when?.(CONTEXT)).toBe(false);
    const last = built({ page: 1, version: asDocVersion(5), object: { ...PHOTO, index: 3, members: [3] }, walked: 4 });
    expect([last.forward.when?.(CONTEXT), last.backward.when?.(CONTEXT)]).toStrictEqual([false, true]);
  });
});
