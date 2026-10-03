import type { DispatchableCommand } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ANNOTATION_TEXT_DIALOG_ID } from '../dialogs/annotationText.js';
import { overlayTransform } from './annotationSpace.js';
import { type AnnotationStyle, PLAIN_STYLE } from './annotationStyle.js';
import { TYPEWRITER_DIALOG_ID } from '../dialogs/typewriter.js';
import { TEXT_BOX_TOOL_ID, textBoxTool, typewriterTool } from './textTools.js';

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
function toolAnswering(
  answer: unknown,
  style: AnnotationStyle = PLAIN_STYLE,
): {
  readonly tool: ReturnType<typeof textBoxTool>;
  readonly asked: { id: string; props: unknown }[];
} {
  const asked: { id: string; props: unknown }[] = [];
  const tool = textBoxTool({
    ask: (id, props) => {
      asked.push({ id, props });
      return Promise.resolve(answer);
    },
    style,
  });
  return { tool, asked };
}

/** Drives a whole drag and returns whatever `commit` decided. */
async function drag(
  tool: ReturnType<typeof textBoxTool>,
  from: readonly [number, number],
  to: readonly [number, number],
  page = 3,
): Promise<DispatchableCommand | undefined> {
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
        font: 'sans',
        direction: 'left-to-right',
      },
    });
  });

  it('sets the words in the reader’s chosen FACE (`editing.annotation-font`) — the case above, on sans, is the control', async () => {
    const { tool } = toolAnswering({ text: 'see figure 3' }, { ...PLAIN_STYLE, font: 'serif' });
    const command = await drag(tool, [20, 20], [120, 80]);
    expect(command?.kind === 'addAnnotation' && command.annotation.type === 'text-box' ? command.annotation.font : undefined).toBe(
      'serif',
    );
  });

  it('and in the reader’s chosen DIRECTION (`editing.text-direction`) — the first case, left to right, is the control', async () => {
    const { tool } = toolAnswering({ text: 'see figure 3' }, { ...PLAIN_STYLE, direction: 'right-to-left' });
    const command = await drag(tool, [20, 20], [120, 80]);
    expect(
      command?.kind === 'addAnnotation' && command.annotation.type === 'text-box' ? command.annotation.direction : undefined,
    ).toBe('right-to-left');
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

/**
 * The typewriter PLACES ON A CLICK as well as a drag (the owner's item 1e): a click asks for the words and makes the
 * box at the point clicked, sized for them. The text box's *does not ask at all for a drag too small to be meant*
 * above is the control — a stray click there is still nothing.
 */
describe('typewriterTool', () => {
  /** A typewriter whose dialog answers `text`, and the record of what it was asked. */
  function typewriterAnswering(text: string): {
    readonly tool: ReturnType<typeof typewriterTool>;
    readonly asked: string[];
  } {
    const asked: string[] = [];
    const tool = typewriterTool({
      ask: (id) => {
        asked.push(id);
        return Promise.resolve({ text });
      },
      style: PLAIN_STYLE,
    });
    return { tool, asked };
  }

  /** The rectangle of the command a gesture produced. */
  function rectOf(command: DispatchableCommand | undefined): unknown {
    if (command?.kind !== 'addAnnotation') throw new Error('no annotation was added');
    return command.annotation.type === 'typewriter' ? command.annotation.rect : undefined;
  }

  it('asks on a CLICK, and makes the box at the point clicked, as wide as the words and one line tall', async () => {
    const { tool, asked } = typewriterAnswering('see figure 3');
    // At (40, 40) on a page whose crop starts at (50, 100) and whose top is 400, at zoom 2: the click is at (70, 380)
    // in the page's points. Twelve characters at 12 points and 0.6 em, plus 3 either side, is 92.4 points wide; one
    // line at 1.2 spacing plus 3 above and below is 20.4 tall.
    const command = await drag(tool,[40, 40], [41, 41]);
    expect(asked).toStrictEqual([TYPEWRITER_DIALOG_ID]);
    const rect = rectOf(command) as { x0: number; y0: number; x1: number; y1: number };
    expect(rect.x0).toBeCloseTo(70, 6);
    expect(rect.y0).toBeCloseTo(380, 6);
    expect(rect.x1).toBeCloseTo(162.4, 6);
    expect(rect.y1).toBeCloseTo(359.6, 6);
  });

  it('keeps a click near the right edge on the page: the words wrap, and the box is taller by the lines that makes', async () => {
    const { tool } = typewriterAnswering('see figure 3');
    // At x = 360 of a 400-wide viewport there are 20 points to the right: 92.4 points of words wrap onto 5 lines.
    const rect = rectOf(await drag(tool,[360, 40], [361, 41])) as {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
    expect(rect.x1 - rect.x0).toBeCloseTo(20, 6);
    expect(rect.y0 - rect.y1).toBeCloseTo(5 * 12 * 1.2 + 6, 6);
  });

  it('CONTROL: a DRAG still makes the dragged box, whatever the words', async () => {
    const { tool } = typewriterAnswering('a line far longer than the box the person drew for it');
    const rect = rectOf(await drag(tool,[20, 20], [120, 80]));
    expect(rect).toStrictEqual({ x0: 60, y0: 390, x1: 110, y1: 360 });
  });
});
