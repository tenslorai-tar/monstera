import { NO_FORMS_LEFT, blocksOfEdit, channels, createClient } from '@monstera/contract';
import { type TextFrame, asDocId, asDocVersion, fromTextFrame, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { DocumentCommandDeps } from './documentCommands.js';
import { replaceInDocument, replaceWordAt } from './replaceText.js';

/**
 * A replacement on a page that holds text set at an angle beside upright text (ADR-0273). The writer lays one command's
 * blocks out in one frame and refuses a command whose blocks are in two, so a replacement sends one command per stream
 * AND frame (`commandsOf`); and a point on the page is compared with a turned block's boxes only once it is in that
 * block's frame, where they are held.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f1');
const PLAIN = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
/** A quarter turn: the frame's x runs up the page. */
const TURNED: TextFrame = [0, 1, -1, 0];

/** One block of one run saying `text`, its box `box` in its own frame (the page's where it has none). */
function block(index: number, text: string, box: { x0: number; y0: number; x1: number; y1: number }, frame?: TextFrame) {
  return {
    box,
    lines: [{ runs: [{ index, text, style: PLAIN }], box, soft: false, baseline: box.y0 }],
    style: PLAIN,
    shape: { align: 'left' as const, firstIndent: 0 },
    ...(frame === undefined ? {} : { frame }),
  };
}

/** An upright `cat` near the top of the page and a turned `cat` whose frame box is 100..118 along and -305..-295 across. */
const UPRIGHT = block(0, 'cat', { x0: 10, y0: 700, x1: 28, y1: 712 });
const TURNED_BLOCK = block(1, 'cat', { x0: 100, y0: -305, x1: 118, y1: -295 }, TURNED);

function harness(): { readonly deps: DocumentCommandDeps; readonly sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  let version = 1;
  const client = createClient(channels, (id, raw) => {
    const params = raw as Record<string, unknown>;
    switch (id) {
      case 'document.textBlocks':
        return Promise.resolve(
          ok({ version: asDocVersion(version), blocks: [UPRIGHT, TURNED_BLOCK], next: null, truncated: false, formsLeft: NO_FORMS_LEFT, unaddressable: 0, rewrite: 'operators' }),
        );
      case 'document.execute': {
        sent.push(params['command'] as Record<string, unknown>);
        version += 1;
        return Promise.resolve(
          ok({ version: asDocVersion(version), byteLength: 1, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [], unsealedUndoCopies: 0 }),
        );
      }
      default:
        throw new Error(`unexpected channel ${id}`);
    }
  });
  const deps: DocumentCommandDeps = {
    client,
    onApplied: () => undefined,
    ask: () => Promise.resolve(undefined),
    stamp: () => ({ author: 'A. Tester', created: '2026-10-27T12:00:00.000Z' }),
    signatures: {
      warn: () => true,
      onOpened: () => {
        throw new Error('the case opened a copy');
      },
    },
  };
  return { deps, sent };
}

/** The run indices each sent command edits, by the one reading of an edit the writers take. */
const editedRuns = (sent: readonly Record<string, unknown>[]): number[][] =>
  sent.map((command) => blocksOfEdit(command as Parameters<typeof blocksOfEdit>[0]).flatMap((each) => each.lines.flat()));

describe('a replacement on a page with text set at an angle (ADR-0273)', () => {
  it('writes the upright block and the turned one by a command each, so neither is refused for the other', async () => {
    const { deps, sent } = harness();
    const outcome = await replaceInDocument(deps, DOC, 'cat', 'dog', { caseSensitive: true, wholeWord: true, regex: false }, [0]);
    expect(outcome).toStrictEqual({ kind: 'replaced', pages: 1 });
    // CONTROL, the bug's own shape: grouped by stream alone, both blocks went in ONE command, which the writer refuses
    // (`editFrame`, `not-upright`) and the whole page was left unchanged.
    expect(editedRuns(sent)).toStrictEqual([[0], [1]]);
  });

  it('finds a turned word at a point on the page, which is held in the block’s own frame', async () => {
    const { deps, sent } = harness();
    // THE MIDDLE OF THE TURNED `cat`, taken onto the page through its frame: (109, -300) in the frame is (300, 109).
    const point = fromTextFrame(TURNED, 109, -300);
    expect(point).toStrictEqual({ x: 300, y: 109 });
    const outcome = await replaceWordAt(deps, DOC, 0, 'cat', 'dog', point);
    expect(outcome).toStrictEqual({ kind: 'replaced', pages: 1 });
    expect(editedRuns(sent)).toStrictEqual([[1]]);
  });

  it('CONTROL: the same numbers as a page point find nothing, so the case above found the word by its frame', async () => {
    const { deps, sent } = harness();
    // (109, -300) read as a page point is inside the turned block's frame box and on no block of the page.
    const outcome = await replaceWordAt(deps, DOC, 0, 'cat', 'dog', { x: 109, y: -300 });
    expect(outcome).toStrictEqual({ kind: 'not-found' });
    expect(sent).toStrictEqual([]);
  });
});
