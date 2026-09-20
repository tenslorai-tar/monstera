import type { RenderableCommand } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { styleFrom } from '../annotations/annotationStyle.js';
import type { CommandContext } from '../registries/commands.js';
import type { TextSelection } from '../TextLayer.js';
import {
  type TextSelectionDeps,
  copySelectionCommand,
  markupSelectionCommands,
  searchSelectionCommand,
} from './textSelectionCommands.js';

/**
 * The selected-text menu's commands (§7). Each acts on the selection the deps answer NOW, and the
 * markups send the drag tools' own command with the selection's two ends, so the page and points
 * reaching the engine are the selection's — not the page on show.
 */

const CONTEXT: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: true,
  dirty: false,
  // NOT THE SELECTION'S PAGE, so a command that used the context's page is red.
  page: 0,
  pageCount: 5,
  openDocuments: [],
};

const SELECTION: TextSelection = { page: 2, text: 'quarterly totals', from: { x: 72, y: 700 }, to: { x: 210, y: 700 } };

function recording(selection: TextSelection | undefined): { deps: TextSelectionDeps; placed: RenderableCommand[]; searched: string[]; copies: number[] } {
  const placed: RenderableCommand[] = [];
  const searched: string[] = [];
  const copies: number[] = [];
  return {
    placed,
    searched,
    copies,
    deps: {
      selection: () => selection,
      place: (command) => placed.push(command),
      style: () => styleFrom({ colour: 'auto', opacity: 1, lineWidth: 1, fontSize: 12 }),
      search: (text) => searched.push(text),
      copy: () => copies.push(1),
    },
  };
}

describe('the selected-text commands', () => {
  it('HIGHLIGHT, UNDERLINE and STRIKETHROUGH send the markup for the SELECTION’s page and two ends', () => {
    const { deps, placed } = recording(SELECTION);
    for (const command of markupSelectionCommands(deps)) void command.run(CONTEXT);

    expect(placed.map((command) => (command.kind === 'addAnnotation' ? [command.page, command.annotation.type] : []))).toStrictEqual([
      [2, 'highlight'],
      [2, 'underline'],
      [2, 'strikeout'],
    ]);
    const first = placed[0];
    expect(first?.kind === 'addAnnotation' && 'from' in first.annotation ? [first.annotation.from, first.annotation.to] : []).toStrictEqual([
      { x: 72, y: 700 },
      { x: 210, y: 700 },
    ]);
  });

  it('SEARCH asks for the selected text, and COPY copies', () => {
    const { deps, searched, copies } = recording(SELECTION);
    void searchSelectionCommand(deps).run(CONTEXT);
    void copySelectionCommand(deps).run(CONTEXT);
    expect(searched).toStrictEqual(['quarterly totals']);
    expect(copies).toStrictEqual([1]);
  });

  it('CONTROL: with NOTHING selected every item is hidden, and a run sends nothing', () => {
    const { deps, placed, searched } = recording(undefined);
    const all = [copySelectionCommand(deps), ...markupSelectionCommands(deps), searchSelectionCommand(deps)];
    expect(all.map((command) => command.when?.(CONTEXT))).toStrictEqual([false, false, false, false, false]);
    for (const command of all) void command.run(CONTEXT);
    expect(placed).toStrictEqual([]);
    expect(searched).toStrictEqual([]);
  });

  it('every item is placed in the SELECTION menu, in the owner’s order', () => {
    const { deps } = recording(SELECTION);
    const all = [copySelectionCommand(deps), ...markupSelectionCommands(deps), searchSelectionCommand(deps)];
    const placed = all.map((command) => {
      const placement = command.placements.find((each) => each.surface === 'context-menu');
      return placement?.surface === 'context-menu' ? [command.id, placement.context, placement.order] : [command.id];
    });
    expect(placed).toStrictEqual([
      ['text.copy', 'selection', 10],
      ['text.highlight', 'selection', 20],
      ['text.underline', 'selection', 30],
      ['text.strikeout', 'selection', 40],
      ['text.search', 'selection', 70],
    ]);
  });
});
