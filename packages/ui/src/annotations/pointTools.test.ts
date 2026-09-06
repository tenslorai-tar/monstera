import type { RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ANNOTATION_NOTE_DIALOG_ID } from '../dialogs/annotationNote.js';
import type { UiTool } from '../registries/tools.js';
import { overlayTransform } from './annotationSpace.js';
import {
  CARET_TOOL_ID,
  STICKY_NOTE_TOOL_ID,
  caretTool,
  pointTools,
  stickyNoteTool,
} from './pointTools.js';

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

/** A note tool whose dialog answers `answer`, and the record of what it asked. */
function noteAnswering(answer: unknown): {
  readonly tool: UiTool;
  readonly asked: { id: string; props: unknown }[];
} {
  const asked: { id: string; props: unknown }[] = [];
  const tool = stickyNoteTool({
    ask: (id, props) => {
      asked.push({ id, props });
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
): Promise<RenderableCommand | undefined> {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, page, overlayTransform(PAGE));
}

describe('stickyNoteTool', () => {
  it('asks its OWN dialog, then builds the command from the answer', async () => {
    const { tool, asked } = noteAnswering({ text: 'check this figure' });

    const command = await click(tool, [20, 20]);

    // BOTH HALVES, and the id is the half that separates this tool from the
    // text box: the two dialogs ask the same question and say different words,
    // so a tool opening the wrong one would collect a usable answer and put
    // *Add text box* in front of somebody placing a note.
    expect(asked).toStrictEqual([{ id: ANNOTATION_NOTE_DIALOG_ID, props: {} }]);
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
    const { tool } = noteAnswering({ text: 'here' });

    const command = await click(tool, [20, 20], [120, 80]);

    expect(command).toMatchObject({ annotation: { at: { x: 60, y: 390 } } });
  });

  it('ASKS EVEN WHEN THE POINTER DID NOT MOVE AT ALL', async () => {
    // ASSERT THE CALL THAT WAS MADE, and this is the inverse of the text box's
    // *does not ask for a drag too small to be meant*. For that tool an unmoved
    // pointer is a stray click and a modal would be an intrusion; for this one
    // an unmoved pointer is the entire gesture, so refusing it would be a tool
    // that does nothing when used exactly as intended.
    //
    // A single command assertion would not separate the two: a tool with a
    // threshold and a tool without one both produce a command for the case
    // above, and only the unmoved one tells them apart.
    const { tool, asked } = noteAnswering({ text: 'here' });

    expect(await click(tool, [40, 40])).toBeDefined();
    expect(asked).toHaveLength(1);
  });

  it('sends NOTHING when the dialog is dismissed', async () => {
    // `undefined` from `ask` is a dismissal, and the outcome is the platform's:
    // there is no value to build a command from, so nothing is sent.
    const { tool } = noteAnswering(undefined);
    expect(await click(tool, [20, 20])).toBeUndefined();
  });

  it('sends nothing when the answer is not the shape this dialog promises', async () => {
    // A REGISTRATION DEFECT, not a person's doing: the id resolved to something
    // answering another shape. Asserted because the alternative is a cast that
    // would put whatever came back into a command payload.
    const { tool } = noteAnswering({ pages: [1] });
    expect(await click(tool, [20, 20])).toBeUndefined();
  });

  it('sends nothing for a whitespace answer, which the schema trims to empty', async () => {
    // A `/Text` carrying three spaces is an icon a reader clicks to be shown
    // nothing — the display-only sin one interaction further on than a blank
    // text box. The body disables its control for this and the schema is what
    // makes the refusal hold for any other caller.
    const { tool } = noteAnswering({ text: '   ' });
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
    expect(stickyNoteTool({ ask: () => Promise.resolve(undefined) }).id).toBe(STICKY_NOTE_TOOL_ID);
  });
});

describe('caretTool', () => {
  it('COMMITS WITHOUT ASKING ANYTHING, which is what having no content means', async () => {
    // The caret is the only annotation this build writes whose whole intent is
    // the gesture, so its controller has no dependencies. There is no `ask` to
    // record and that is the assertion: a caret that opened a dialog would be a
    // sticky note in the wrong shape.
    expect(await click(caretTool, [20, 20])).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: { type: 'caret', at: { x: 60, y: 390 }, colour: [0.85, 0.15, 0.15] },
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
    const registered = pointTools({ ask: () => Promise.resolve(undefined) });
    expect(registered.map((tool) => tool.id)).toStrictEqual([
      STICKY_NOTE_TOOL_ID,
      CARET_TOOL_ID,
    ]);
  });
});
