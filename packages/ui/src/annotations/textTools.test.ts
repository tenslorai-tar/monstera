import type { RenderableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ANNOTATION_TEXT_DIALOG_ID } from '../dialogs/annotationText.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import { TEXT_BOX_TOOL_ID, textBoxTool } from './textTools.js';

/**
 * The text box's controller, driven without a DOM.
 *
 * `shapeTools.test.ts`' shape with one difference that is the whole subject:
 * this tool's `commit` answers a promise, because part of its intent comes from
 * a person. So every case here awaits, and the recording `ask` is what makes
 * *did it ask, and with what* assertable.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The sibling file's fixture and its reason: a non-zero origin and a zoom
  // that is not 1, so a controller passing pixels straight through fails rather
  // than coincides.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** A tool whose dialog answers `answer`, and the record of what it was asked. */
function toolAnswering(answer: unknown): {
  readonly tool: ReturnType<typeof textBoxTool>;
  readonly asked: { id: string; props: unknown }[];
} {
  const asked: { id: string; props: unknown }[] = [];
  const tool = textBoxTool({
    ask: (id, props) => {
      asked.push({ id, props });
      return Promise.resolve(answer);
    },
    style: PLAIN_STYLE,
  });
  return { tool, asked };
}

/** Drives a whole drag and returns whatever `commit` decided. */
async function drag(
  tool: ReturnType<typeof textBoxTool>,
  from: readonly [number, number],
  to: readonly [number, number],
  page = 3,
): Promise<RenderableCommand | undefined> {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, page, overlayTransform(PAGE));
}

describe('textBoxTool', () => {
  it('asks its own dialog, then builds the command from the answer', async () => {
    const { tool, asked } = toolAnswering({ text: 'see figure 3' });

    const command = await drag(tool, [20, 20], [120, 80]);

    // BOTH HALVES. The id says it opened its own dialog rather than any other;
    // the command says the answer reached the payload. Either alone passes for
    // an implementation that asked and ignored, or built and never asked.
    expect(asked).toStrictEqual([{ id: ANNOTATION_TEXT_DIALOG_ID, props: {} }]);
    expect(command).toStrictEqual({
      kind: 'addAnnotation',
      page: 3,
      annotation: {
        type: 'text-box',
        // THE SAME RECTANGLE THE SHAPE TOOLS PRODUCE for this drag on this
        // page, which is the point of it going through the one adapter: a text
        // box is placed by the same geometry as a rectangle, and a second
        // conversion here would be where the two start to disagree.
        rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
        text: 'see figure 3',
        colour: [0.1, 0.1, 0.1],
        opacity: 1,
        fontSize: 12,
      },
    });
  });

  it('sends NOTHING when the dialog is dismissed', async () => {
    // `undefined` from `ask` is a dismissal, and the outcome is the one a drag
    // too small to see already produces: no command. That is the gate — there
    // is no value to build from — rather than a flag anybody checks.
    const { tool } = toolAnswering(undefined);
    expect(await drag(tool, [20, 20], [120, 80])).toBeUndefined();
  });

  it('sends nothing when the answer is not the shape this dialog promises', async () => {
    // A REGISTRATION DEFECT, not a person's doing: the id resolved to something
    // answering another shape. Refused quietly for the dismissal's reason — the
    // page is unchanged either way — and asserted because the alternative is a
    // cast that would put whatever came back into a command payload.
    const { tool } = toolAnswering({ pages: [1] });
    expect(await drag(tool, [20, 20], [120, 80])).toBeUndefined();
  });

  it('sends nothing for a whitespace answer, which the schema trims to empty', async () => {
    // A `/FreeText` carrying three spaces is a rectangle with an invisible
    // border: a text box the person typed into and cannot see. The body
    // disables its control for this, and the schema is what makes the refusal
    // hold for any other caller — this case asserts the schema's half, since
    // the body's is a rendering decision.
    const { tool } = toolAnswering({ text: '   ' });
    expect(await drag(tool, [20, 20], [120, 80])).toBeUndefined();
  });

  it('DOES NOT ASK AT ALL for a drag too small to be meant', async () => {
    // ASSERT THE CALL THAT WAS NOT MADE. A stray click that fell through would
    // put a modal in front of somebody who did not ask for one — which is worse
    // than the stray rectangle the shape tools discard, and is why this tool's
    // threshold is larger than theirs. Asserting the absent command instead
    // would pass for an implementation that opened the dialog and then threw
    // the answer away.
    const { tool, asked } = toolAnswering({ text: 'see figure 3' });

    expect(await drag(tool, [40, 40], [44, 44])).toBeUndefined();
    expect(asked).toStrictEqual([]);
  });

  // NOT ASYNC, unlike every case above it. A preview is read from the gesture
  // and never asks anything, which is the one part of this tool that answers
  // the way a shape tool does.
  it('previews the box while the drag is in flight, and nothing while it is too small', () => {
    const { tool } = toolAnswering(undefined);
    const { controller } = tool;
    const started = controller.begin(viewportPoint(20, 20));

    expect(controller.preview(controller.update(started, viewportPoint(120, 80)))).toStrictEqual({
      shape: 'rect',
      x: 20,
      y: 20,
      width: 100,
      height: 60,
    });
    expect(controller.preview(controller.update(started, viewportPoint(24, 24)))).toBeUndefined();
  });

  it('claims the id its command selects', () => {
    // A tool's id is its command's, and the two are written in different files.
    expect(textBoxTool({ ask: () => Promise.resolve(undefined), style: PLAIN_STYLE }).id).toBe(TEXT_BOX_TOOL_ID);
  });
});
