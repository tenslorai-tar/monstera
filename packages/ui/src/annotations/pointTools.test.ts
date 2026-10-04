import type { DispatchableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { WRITE_NOTE_LABEL } from '../messages/en.js';
import type { WriteRequest } from '../pageWriting.js';
import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import {
  CARET_TOOL_ID,
  STICKY_NOTE_TOOL_ID,
  caretTool as buildCaret,
  pointTools,
  stickyNoteTool,
} from './pointTools.js';

/**
 * The caret, built with the style that chooses nothing.
 *
 * It became a factory on 2026-09-07 — `pointTools.ts` says why the note calling
 * it *a value, unlike every tool beside it* stopped being true. These cases are
 * about where it puts the mark, which the style does not touch.
 */
const caretTool = buildCaret({ style: PLAIN_STYLE });

/**
 * The point tools' controllers, driven without a DOM.
 *
 * `textTools.test.ts`' shape, and the differences are the subject: these tools
 * are driven by a CLICK, so the case that matters most is the one where the
 * pointer moved and the annotation did not follow it.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The sibling files' fixture and its reason: a non-zero origin and a zoom
  // that is not 1, so a controller passing pixels straight through fails rather
  // than coincides.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** Deps that ask nothing: a dialog refuses, and the page answers no words. */
const NOTHING_ASKED = {
  ask: (): Promise<unknown> => Promise.reject(new Error('a dialog was opened')),
  write: (): Promise<string | undefined> => Promise.resolve(undefined),
  style: PLAIN_STYLE,
};

/** A note tool whose page answers `answer`, and the record of what it was asked for. */
function noteAnswering(answer: string | undefined): {
  readonly tool: UiTool;
  readonly asked: WriteRequest[];
} {
  const asked: WriteRequest[] = [];
  const tool = stickyNoteTool({
    ...NOTHING_ASKED,
    write: (request) => {
      asked.push(request);
      return Promise.resolve(answer);
    },
  });
  return { tool, asked };
}

/**
 * Drives a gesture from `from` to `to` and returns whatever `commit` decided.
 *
 * `to` defaults to `from`, which is what an unmoved click is — and every case
 * that passes a different one is asserting that the tail is discarded.
 */
async function click(
  tool: UiTool,
  from: readonly [number, number],
  to: readonly [number, number] = from,
  page = 3,
): Promise<DispatchableCommand | undefined> {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, page, overlayTransform(PAGE));
}

describe('stickyNoteTool', () => {
  it('opens its box AT THE POINT CLICKED, named for a comment, then builds the command from the words', async () => {
    const { tool, asked } = noteAnswering('check this figure');

    const command = await click(tool, [20, 20]);

    // BOTH HALVES, and the label is the half that separates this tool from the
    // text box: the two ask the same question and say different words, so a
    // tool naming the wrong box would collect usable words under *Text box*.
    // NO STYLE: a comment is not drawn on the page, so it is typed on a card.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      page: 3,
      box: { x0: 60, y0: 390, x1: 60, y1: 390 },
      shape: 'block',
      label: WRITE_NOTE_LABEL,
    });
    expect(asked[0]?.style).toBeUndefined();
    expect(command).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'sticky-note',
        // THE POINT THE SHAPE TOOLS WOULD HAVE STARTED A DRAG AT, converted by
        // the one adapter: (20, 20) at zoom 2 on a page whose visible box
        // starts at (50, 400) is 10 across and 10 down, which is (60, 390).
        at: { x: 60, y: 390 },
        text: 'check this figure',
        colour: [1, 0.8, 0.2],
        opacity: 1,
      },
    });
  });

  it('TAKES WHERE THE POINTER WENT DOWN, not where it came up', async () => {
    // THE CLICK GESTURE'S WHOLE RULE, and the fixture is built so the two
    // points cannot be confused: a hundred pixels apart, which at zoom 2 is
    // fifty document units. A controller reading `endOf` — which is what every
    // other tool in this package reads — would answer (110, 360), and that is
    // the text box's own expected rectangle corner, so the mistake would look
    // familiar rather than wrong.
    //
    // It is also why there is no threshold here. This drag is far past every
    // other tool's minimum and is still a click: the person aimed at the point
    // they pressed on.
    const { tool } = noteAnswering('here');

    const command = await click(tool, [20, 20], [120, 80]);

    expect(command).toMatchObject({ annotation: { at: { x: 60, y: 390 } } });
  });

  it('ASKS EVEN WHEN THE POINTER DID NOT MOVE AT ALL', async () => {
    // ASSERT THE CALL THAT WAS MADE, and this is the inverse of the text box's
    // *does not ask for a drag too small to be meant*. For that tool an unmoved
    // pointer is a stray click and a box would be an intrusion; for this one
    // an unmoved pointer is the entire gesture, so refusing it would be a tool
    // that does nothing when used exactly as intended.
    //
    // A single command assertion would not separate the two: a tool with a
    // threshold and a tool without one both produce a command for the case
    // above, and only the unmoved one tells them apart.
    const { tool, asked } = noteAnswering('here');

    expect(await click(tool, [40, 40])).toBeDefined();
    expect(asked).toHaveLength(1);
  });

  it('sends NOTHING when no words are typed', async () => {
    // `undefined` from `write` is nothing typed, and the outcome is the
    // platform's: there is no value to build a command from, so nothing is sent.
    const { tool } = noteAnswering(undefined);
    expect(await click(tool, [20, 20])).toBeUndefined();
  });

  it('sends nothing for words that are only whitespace, which the rule trims to empty', async () => {
    // A `/Text` carrying three spaces is an icon a reader clicks to be shown
    // nothing — the display-only sin one interaction further on than a blank
    // text box. `settle` answers nothing for a blank box, and the schema is what
    // makes the refusal hold for any other caller.
    const { tool } = noteAnswering('   ');
    expect(await click(tool, [20, 20])).toBeUndefined();
  });

  it('previews nothing, at any point in the gesture', () => {
    // NOT ASYNC, and nothing here awaits: a preview is read from the gesture.
    //
    // The absence is asserted rather than left unexercised, because it is a
    // decision. A click's shape is settled at pointer-down, and the annotation's
    // SIZE is MuPDF's — clamped to ten points for a note — so an outline drawn
    // here would be the renderer stating a number the kernel owns. A case that
    // simply never called `preview` would leave a tool free to draw one.
    const { tool } = noteAnswering(undefined);
    const { controller } = tool;
    const started = controller.begin(viewportPoint(20, 20));
    expect(controller.preview(started)).toBeUndefined();
    expect(controller.preview(controller.update(started, viewportPoint(120, 80)))).toBeUndefined();
  });

  it('claims the id its command selects', () => {
    expect(stickyNoteTool(NOTHING_ASKED).id).toBe(STICKY_NOTE_TOOL_ID);
  });
});

describe('caretTool', () => {
  it('COMMITS WITHOUT ASKING ANYTHING, which is what having no content means', async () => {
    // The caret is the only annotation this build writes whose whole intent is
    // the gesture, so its controller has no dependencies. There is nothing to
    // record and that is the assertion: a caret that asked for words would be a
    // sticky note in the wrong shape.
    expect(await click(caretTool, [20, 20])).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'caret',
        at: { x: 60, y: 390 },
        colour: [0.85, 0.15, 0.15],
        opacity: 1,
      },
    });
  });

  it('answers SYNCHRONOUSLY, unlike the other tool in this file', () => {
    // `commit` may answer now or later and the overlay does not care which — so
    // this pins the one tool for which *now* is the design rather than a
    // detail. Read WITHOUT awaiting: a promise fails this rather than resolving
    // past it, which is what an `await` here would have allowed.
    const answered = caretTool.controller.commit(
      caretTool.controller.begin(viewportPoint(20, 20)),
      3,
      overlayTransform(PAGE),
    );
    expect(answered).not.toBeInstanceOf(Promise);
    expect(answered).toMatchObject({ kind: 'addAnnotation' });
  });

  it('takes the point the pointer went down at', async () => {
    // The click gesture's rule again, on the tool that has no dialog in the way
    // of it. Same fixture, same fifty document units between the two points.
    expect(await click(caretTool, [20, 20], [120, 80])).toMatchObject({
      annotation: { at: { x: 60, y: 390 } },
    });
  });

  it('previews nothing, at any point in the gesture', () => {
    const started = caretTool.controller.begin(viewportPoint(20, 20));
    expect(caretTool.controller.preview(started)).toBeUndefined();
    expect(
      caretTool.controller.preview(caretTool.controller.update(started, viewportPoint(120, 80))),
    ).toBeUndefined();
  });

  it('claims the id its command selects', () => {
    expect(caretTool.id).toBe(CARET_TOOL_ID);
  });
});

describe('pointTools', () => {
  it('registers both click tools, so one left out of the list is red here', () => {
    // `App.tsx` spreads this list into the registry, so a tool written in this
    // file and missing from it is code nothing mounts. The command-side join
    // in `annotationCommands.test.ts` would catch that too — this catches it
    // one step earlier and names the list rather than the pair.
    const registered = pointTools(NOTHING_ASKED);
    expect(registered.map((tool) => tool.id)).toStrictEqual([
      STICKY_NOTE_TOOL_ID,
      CARET_TOOL_ID,
    ]);
  });
});
