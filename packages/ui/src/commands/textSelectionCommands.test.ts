import type { RenderableCommand } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { styleFrom } from '../annotations/annotationStyle.js';
import type { CommandContext } from '../registries/commands.js';
import type { TextSelection } from '../TextLayer.js';
import { STROKE } from '../annotations/shapeTools.js';
import {
  type TextSelectionDeps,
  commentSelectionCommand,
  copySelectionCommand,
  markupSelectionCommands,
  redactSelectionCommand,
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

  it('CONTROL: with NOTHING selected every item is hidden, and a run sends nothing', async () => {
    const { deps, placed, searched } = recording(undefined);
    const all = [
      copySelectionCommand(deps),
      ...markupSelectionCommands(deps),
      commentSelectionCommand({ ...deps, ask: () => Promise.resolve({ text: 'never asked for' }) }),
      redactSelectionCommand(deps),
      searchSelectionCommand(deps),
    ];
    // SEVEN FALSES, written out rather than derived from `all.length`: a count taken from the list
    // under test agrees with any item quietly leaving it.
    expect(all.map((command) => command.when?.(CONTEXT))).toStrictEqual([false, false, false, false, false, false, false]);
    // `comment` is the one that could place something ASYNCHRONOUSLY, and its stub answers a valid
    // note — so if it ran despite `when`, the await below is what lets the placement land before
    // the assertion rather than after the test has ended.
    // `Promise.resolve` because `run` answers `void | Promise<void>` — most of these are
    // synchronous, and handing that union straight to an aggregator is what the lint rule refuses.
    await Promise.all(all.map((command) => Promise.resolve(command.run(CONTEXT))));
    expect(placed).toStrictEqual([]);
    expect(searched).toStrictEqual([]);
  });

  it('REDACT marks the selection’s run, by its two ends and in the redact tool’s colour', () => {
    // The gesture is what differs from the drag tool, and the draft says so: `over: 'text'` with
    // the run's ends, which the kernel resolves into the line quads the burn-in acts on. A draft
    // carrying a rectangle here would be a different member of the union and would not compile.
    const { deps, placed } = recording(SELECTION);
    void redactSelectionCommand(deps).run(CONTEXT);

    const first = placed[0];
    expect(first?.kind === 'addAnnotation' ? first.annotation : undefined).toStrictEqual({
      type: 'redact',
      over: 'text',
      from: { x: 72, y: 700 },
      to: { x: 210, y: 700 },
      colour: STROKE,
      opacity: 1,
    });
    // THE SELECTION'S PAGE, not the context's — the context above holds a different one on purpose.
    expect(first?.kind === 'addAnnotation' ? first.page : undefined).toBe(2);
  });

  it('COMMENT asks for the note, then places it at the selection’s START', async () => {
    // The point is the whole question: a note is an icon at a point and the selection is a run, so
    // the command has to reduce one to the other. `from` is where the gesture began — the same
    // rule `stickyNoteTool` applies to a click that slid — and the selection above has two
    // different ends so a command that took `to` is red rather than indistinguishable.
    const { deps, placed } = recording(SELECTION);
    const asked: { id: string; props: unknown }[] = [];
    await commentSelectionCommand({
      ...deps,
      ask: (id, props) => {
        asked.push({ id, props });
        return Promise.resolve({ text: 'check this against Q3' });
      },
    }).run(CONTEXT);

    expect(asked).toStrictEqual([{ id: 'dialog.annotation-note', props: {} }]);
    const first = placed[0];
    expect(first?.kind === 'addAnnotation' ? first.annotation : undefined).toStrictEqual({
      type: 'sticky-note',
      at: { x: 72, y: 700 },
      text: 'check this against Q3',
      // THE NOTE'S OWN YELLOW, which is what says the menu and the tool share a builder: a copied
      // literal would most likely have carried the shape tools' STROKE, as every other item here
      // does.
      colour: [1, 0.8, 0.2],
      opacity: 1,
    });
    expect(first?.kind === 'addAnnotation' ? first.page : undefined).toBe(2);
  });

  it('CONTROL: a DISMISSED note dialog places nothing, and the dialog was still opened', async () => {
    // Without this, the case above passes for a command that places a note whatever the dialog
    // answers — and *dismissed* and *never asked* are the same observation unless the ask is
    // counted, so both are asserted here.
    const { deps, placed } = recording(SELECTION);
    let opened = 0;
    await commentSelectionCommand({
      ...deps,
      ask: () => {
        opened += 1;
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toBe(1);
    expect(placed).toStrictEqual([]);
  });

  it('every item is placed in the SELECTION menu, in the owner’s order', () => {
    const { deps } = recording(SELECTION);
    const all = [
      copySelectionCommand(deps),
      ...markupSelectionCommands(deps),
      commentSelectionCommand({ ...deps, ask: () => Promise.resolve(undefined) }),
      redactSelectionCommand(deps),
      searchSelectionCommand(deps),
    ];
    const placed = all.map((command) => {
      const placement = command.placements.find((each) => each.surface === 'context-menu');
      return placement?.surface === 'context-menu' ? [command.id, placement.context, placement.order] : [command.id];
    });
    expect(placed).toStrictEqual([
      ['text.copy', 'selection', 10],
      ['text.highlight', 'selection', 20],
      ['text.underline', 'selection', 30],
      ['text.strikeout', 'selection', 40],
      ['text.comment', 'selection', 50],
      ['text.redact', 'selection', 60],
      ['text.search', 'selection', 70],
    ]);
  });
});
