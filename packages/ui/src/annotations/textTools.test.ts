import { type AnnotationWordsStyle, type DispatchableCommand, MAX_ANNOTATION_TEXT } from '@monstera/contract';
import { asDocVersion, viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { WRITE_TEXT_BOX_LABEL, WRITE_TOO_LONG, WRITE_TYPEWRITER_LABEL } from '../messages/en.js';
import type { WriteRequest } from '../pageWriting.js';
import { overlayTransform } from './annotationSpace.js';
import { type AnnotationStyle, PLAIN_STYLE } from './annotationStyle.js';
import type { ErasableAnnotation } from './eraserTool.js';
import type { WordsMark, WordsToEdit } from './markWords.js';
import { TEXT_BOX_TOOL_ID, annotationTextCheck, textBoxTool, typewriterTool } from './textTools.js';

/**
 * The text box's controller, driven without a DOM.
 *
 * `shapeTools.test.ts`' shape with one difference that is the whole subject:
 * this tool's `commit` answers a promise, because part of its intent comes from
 * a person. So every case here awaits, and the recording `write` is what makes
 * *did it ask the page, and for what* assertable (ADR-0154).
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  // The sibling file's fixture and its reason: a non-zero origin and a zoom
  // that is not 1, so a controller passing pixels straight through fails rather
  // than coincides.
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/**
 * A document with NO MARKS for a reopen to find, so a click places as it always did; the words read refuses by name,
 * since nothing here may reach it.
 */
const NOTHING_TO_REOPEN = {
  annotations: () => Promise.resolve({ version: asDocVersion(1), annotations: [] }),
  wordsOf: () => Promise.reject(new Error('this case reads no words')),
} as const;

/** A `write` that answers `answer`, and the record of what it was asked for. */
function writing(answer: string | undefined): {
  readonly write: (request: WriteRequest) => Promise<string | undefined>;
  readonly asked: WriteRequest[];
} {
  const asked: WriteRequest[] = [];
  return {
    write: (request) => {
      asked.push(request);
      return Promise.resolve(answer);
    },
    asked,
  };
}

/** A text box whose page answers `answer`, and the record of what it was asked for. */
function toolAnswering(
  answer: string | undefined,
  style: AnnotationStyle = PLAIN_STYLE,
): {
  readonly tool: ReturnType<typeof textBoxTool>;
  readonly asked: WriteRequest[];
} {
  const { write, asked } = writing(answer);
  // `ask` REFUSES: nothing here may open a dialog any more, so one that did would fail the case it ran in.
  const tool = textBoxTool({ ...NOTHING_TO_REOPEN, ask: () => Promise.reject(new Error('a dialog was opened')), write, style });
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
  it('asks the PAGE for the words, in the dragged box and the style they will be drawn in, then builds the command', async () => {
    const { tool, asked } = toolAnswering('see figure 3');

    const command = await drag(tool, [20, 20], [120, 80]);

    // BOTH HALVES. The request says it asked for a block in the box the drag made, on the page it was made on; the
    // command says the answer reached the payload. Either alone passes for an implementation that asked and ignored,
    // or built and never asked.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      page: 3,
      box: { x0: 60, y0: 390, x1: 110, y1: 360 },
      shape: 'block',
      initial: '',
      label: WRITE_TEXT_BOX_LABEL,
      style: { fontSize: 12, colour: [0.1, 0.1, 0.1], font: 'sans', direction: 'left-to-right' },
      grows: false,
    });
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

  it('sets the words in the reader’s chosen FACE (`editing.annotation-font`), on the page and in the command — the case above, on sans, is the control', async () => {
    const { tool, asked } = toolAnswering('see figure 3', { ...PLAIN_STYLE, font: 'serif' });
    const command = await drag(tool, [20, 20], [120, 80]);
    expect(asked[0]?.style?.font).toBe('serif');
    expect(command?.kind === 'addAnnotation' && command.annotation.type === 'text-box' ? command.annotation.font : undefined).toBe(
      'serif',
    );
  });

  it('and in the reader’s chosen DIRECTION (`editing.text-direction`) — the first case, left to right, is the control', async () => {
    const { tool, asked } = toolAnswering('see figure 3', { ...PLAIN_STYLE, direction: 'right-to-left' });
    const command = await drag(tool, [20, 20], [120, 80]);
    expect(asked[0]?.style?.direction).toBe('right-to-left');
    expect(
      command?.kind === 'addAnnotation' && command.annotation.type === 'text-box' ? command.annotation.direction : undefined,
    ).toBe('right-to-left');
  });

  it('sends NOTHING when the page answers no words', async () => {
    // `undefined` from `write` is nothing typed, and the outcome is the one a drag too small to see already produces:
    // no command. That is the gate — there is no value to build from — rather than a flag anybody checks.
    const { tool } = toolAnswering(undefined);
    expect(await drag(tool, [20, 20], [120, 80])).toBeUndefined();
  });

  it('TRIMS the words the page answered with, by the one rule every writer of an annotation’s words takes', async () => {
    const { tool } = toolAnswering('  see figure 3\n');
    const command = await drag(tool, [20, 20], [120, 80]);
    expect(command?.kind === 'addAnnotation' && command.annotation.type === 'text-box' ? command.annotation.text : undefined).toBe(
      'see figure 3',
    );
  });

  it('sends nothing for words that are only whitespace, which the rule trims to empty', async () => {
    // A `/FreeText` carrying three spaces is a rectangle with an invisible border: a text box the person typed into
    // and cannot see. `settle` answers nothing for a new block left blank, and this is the half that makes the
    // refusal hold for any other caller of the tool.
    const { tool } = toolAnswering('   ');
    expect(await drag(tool, [20, 20], [120, 80])).toBeUndefined();
  });

  it('carries the payload’s length rule to the page, where words too long keep the box open (`settle`)', async () => {
    const { tool, asked } = toolAnswering('see figure 3');
    await drag(tool, [20, 20], [120, 80]);
    const check = asked[0]?.check;
    // THE RULE ITSELF, at its boundary: the contract's limit passes, one more is refused with the message.
    expect(check?.('x'.repeat(MAX_ANNOTATION_TEXT))).toBeUndefined();
    expect(check?.('x'.repeat(MAX_ANNOTATION_TEXT + 1))).toBe(WRITE_TOO_LONG);
    // AFTER THE TRIM, as the result schema counts: spaces round the limit are not words.
    expect(annotationTextCheck(` ${'x'.repeat(MAX_ANNOTATION_TEXT)} `)).toBeUndefined();
  });

  it('DOES NOT ASK AT ALL for a drag too small to be meant', async () => {
    // ASSERT THE CALL THAT WAS NOT MADE. A stray click that fell through would take the keyboard from somebody who
    // did not ask for a box — which is worse than the stray rectangle the shape tools discard, and is why this tool's
    // threshold is larger than theirs. Asserting the absent command instead would pass for an implementation that
    // opened the box and then threw the answer away.
    const { tool, asked } = toolAnswering('see figure 3');

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
    expect(toolAnswering(undefined).tool.id).toBe(TEXT_BOX_TOOL_ID);
  });
});

/**
 * The typewriter PLACES ON A CLICK as well as a drag (the owner's item 1e): a click opens a box at the point clicked
 * that grows with the words, and the annotation's box is made for them. The text box's *does not ask at all for a drag
 * too small to be meant* above is the control — a stray click there is still nothing.
 */
describe('typewriterTool', () => {
  /** A typewriter whose page answers `text`, and the record of what it was asked for. */
  function typewriterAnswering(text: string): {
    readonly tool: ReturnType<typeof typewriterTool>;
    readonly asked: WriteRequest[];
  } {
    const { write, asked } = writing(text);
    const tool = typewriterTool({
      ...NOTHING_TO_REOPEN,
      ask: () => Promise.reject(new Error('a dialog was opened')),
      write,
      style: PLAIN_STYLE,
    });
    return { tool, asked };
  }

  /** The rectangle of the command a gesture produced. */
  function rectOf(command: DispatchableCommand | undefined): unknown {
    if (command?.kind !== 'addAnnotation') throw new Error('no annotation was added');
    return command.annotation.type === 'typewriter' ? command.annotation.rect : undefined;
  }

  it('asks on a CLICK for a GROWING box at the point clicked, one line tall, and makes the annotation as wide as the words', async () => {
    const { tool, asked } = typewriterAnswering('see figure 3');
    // At (40, 40) on a page whose crop starts at (50, 100) and whose top is 400, at zoom 2: the click is at (70, 380)
    // in the page's points. Twelve characters at 12 points and 0.6 em, plus 3 either side, is 92.4 points wide; one
    // line at 1.2 spacing plus 3 above and below is 20.4 tall.
    const command = await drag(tool, [40, 40], [41, 41]);

    // THE BOX TYPED INTO starts where the click was and is the one `clickedRect` makes for no words: 6 wide, 20.4 tall.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ shape: 'block', grows: true, label: WRITE_TYPEWRITER_LABEL });
    const box = asked[0]?.box;
    expect(box?.x0).toBeCloseTo(70, 6);
    expect(box?.y0).toBeCloseTo(380, 6);
    expect(box?.x1).toBeCloseTo(76, 6);
    expect(box?.y1).toBeCloseTo(359.6, 6);

    const rect = rectOf(command) as { x0: number; y0: number; x1: number; y1: number };
    expect(rect.x0).toBeCloseTo(70, 6);
    expect(rect.y0).toBeCloseTo(380, 6);
    expect(rect.x1).toBeCloseTo(162.4, 6);
    expect(rect.y1).toBeCloseTo(359.6, 6);
  });

  it('keeps a click near the right edge on the page: the words wrap, and the box is taller by the lines that makes', async () => {
    const { tool } = typewriterAnswering('see figure 3');
    // At x = 360 of a 400-wide viewport there are 20 points to the right: 92.4 points of words wrap onto 5 lines.
    const rect = rectOf(await drag(tool, [360, 40], [361, 41])) as {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
    expect(rect.x1 - rect.x0).toBeCloseTo(20, 6);
    expect(rect.y0 - rect.y1).toBeCloseTo(5 * 12 * 1.2 + 6, 6);
  });

  it('CONTROL: a DRAG still asks in the dragged box, which does not grow, and makes that box whatever the words', async () => {
    const { tool, asked } = typewriterAnswering('a line far longer than the box the person drew for it');
    const rect = rectOf(await drag(tool, [20, 20], [120, 80]));
    expect(asked[0]).toMatchObject({ box: { x0: 60, y0: 390, x1: 110, y1: 360 }, grows: false });
    expect(rect).toStrictEqual({ x0: 60, y0: 390, x1: 110, y1: 360 });
  });
});

/**
 * Words already on the page are edited where they are (ADR-0154 Decision 3): a click of Text box or Typewriter on a
 * text mark, and a double-click with no gesture (`reopen`), open its words — in its own box and style where the walk
 * read one, on a card beside it where it did not — and send `editAnnotationText` at the walk's version.
 */
describe('reopening words on the page', () => {
  const WALKED = asDocVersion(5);
  /** PDF x 60–160, y 300–360 — on screen (20,80) to (220,200) at the fixture's zoom 2 and crop origin. */
  const WORDS_RECT = { x0: 60, y0: 300, x1: 160, y1: 360 } as const;
  const TYPED: AnnotationWordsStyle = { fontSize: 14, colour: [0, 0, 0.6], font: 'serif', direction: 'left-to-right' };
  /** The mark with no style read: how a walk lists a text mark whose `/DA` this build cannot set back. */
  const UNTYPED: ErasableAnnotation = {
    page: 3,
    index: 2,
    rect: WORDS_RECT,
    style: { colour: [0, 0, 0], opacity: 1, borderWidth: null },
    kind: 'typewriter',
    contents: 'Paid in full',
    author: '',
    created: null,
    blend: 'normal',
  };
  const MARK: ErasableAnnotation = { ...UNTYPED, typed: TYPED };
  /** A point inside {@link WORDS_RECT} on screen. */
  const ON_MARK = [100, 150] as const;

  /** A tool over a walk holding `marks`, whose page answers `typed`, recording what was asked and read. */
  function reopening(
    make: typeof textBoxTool | typeof typewriterTool,
    marks: readonly ErasableAnnotation[],
    typed: string | undefined,
    words?: WordsToEdit,
  ) {
    const { write, asked } = writing(typed);
    const read: WordsMark[] = [];
    const problems: unknown[] = [];
    const tool = make({
      annotations: () => Promise.resolve({ version: WALKED, annotations: marks }),
      wordsOf: (mark) => {
        read.push(mark);
        return Promise.resolve(words ?? { kind: 'words', text: mark.contents });
      },
      ask: (_id, props) => {
        problems.push(props);
        return Promise.resolve(undefined);
      },
      write,
      style: PLAIN_STYLE,
    });
    const click = (at: readonly [number, number]): Promise<DispatchableCommand | undefined> =>
      Promise.resolve(tool.controller.commit(tool.controller.begin(viewportPoint(at[0], at[1])), 3, overlayTransform(PAGE)));
    const reopen = (at: readonly [number, number]): Promise<DispatchableCommand | undefined> =>
      Promise.resolve(tool.controller.reopen(viewportPoint(at[0], at[1]), 3, overlayTransform(PAGE)));
    return { asked, read, problems, click, reopen };
  }

  it('a typewriter CLICK on words opens them IN THEIR OWN BOX AND STYLE, and edits them rather than placing more', async () => {
    const { asked, click } = reopening(typewriterTool, [MARK], 'Paid in full, 4 October');
    const command = await click(ON_MARK);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      page: 3,
      box: WORDS_RECT,
      shape: 'block',
      initial: 'Paid in full',
      label: WRITE_TYPEWRITER_LABEL,
      style: TYPED,
      grows: false,
    });
    expect(command).toStrictEqual({
      kind: 'editAnnotationText',
      page: 3,
      index: 2,
      text: 'Paid in full, 4 October',
      version: WALKED,
    });
  });

  it('CONTROL: a typewriter click BESIDE the words places a new mark, as a click on blank paper always has', async () => {
    const { asked, click } = reopening(typewriterTool, [MARK], 'A new line');
    const command = await click([300, 300]);
    expect(asked[0]?.initial).toBe('');
    expect(command?.kind).toBe('addAnnotation');
  });

  it('words LEFT AS THEY WERE send nothing, and place nothing new on top', async () => {
    const { asked, click } = reopening(typewriterTool, [MARK], 'Paid in full');
    expect(await click(ON_MARK)).toBeUndefined();
    expect(asked).toHaveLength(1);
  });

  it('a click on a mark whose words are NOT DRAWN — a square — places a new typewriter, not an edit of its comment', async () => {
    const square: ErasableAnnotation = { ...UNTYPED, kind: 'square' };
    const { read, click } = reopening(typewriterTool, [square], 'Beside the square');
    expect((await click(ON_MARK))?.kind).toBe('addAnnotation');
    expect(read).toStrictEqual([]);
  });

  it('a text box whose style could NOT be read opens on a CARD beside it, never refused', async () => {
    const unread: ErasableAnnotation = { ...UNTYPED, kind: 'text-box' };
    const { asked, click } = reopening(textBoxTool, [unread], 'Revised');
    expect((await click(ON_MARK))?.kind).toBe('editAnnotationText');
    expect(asked[0]).toMatchObject({ box: WORDS_RECT, label: WRITE_TEXT_BOX_LABEL, initial: 'Paid in full' });
    expect(asked[0]?.style).toBeUndefined();
  });

  it('a CALLOUT opens on a card even with its style read: its words sit in an inner box the walk does not carry', async () => {
    const callout: ErasableAnnotation = { ...MARK, kind: 'callout' };
    const { asked, reopen } = reopening(textBoxTool, [callout], 'Revised');
    expect((await reopen(ON_MARK))?.kind).toBe('editAnnotationText');
    expect(asked[0]?.style).toBeUndefined();
  });

  it('a CUT comment is read whole at the walk’s version, and one too long to write back is said and not opened', async () => {
    const cut: ErasableAnnotation = { ...MARK, contents: 'a'.repeat(512), cut: true };
    const { asked, read, problems, reopen } = reopening(textBoxTool, [cut], 'typed', { kind: 'too-long' });
    expect(await reopen(ON_MARK)).toBeUndefined();
    expect(read).toStrictEqual([{ page: 3, version: WALKED, index: 2, contents: 'a'.repeat(512), cut: true }]);
    expect(asked).toStrictEqual([]);
    expect(problems).toStrictEqual([{ code: 'comment-too-long' }]);
  });

  it('a DOUBLE-CLICK on blank paper reopens nothing and asks nothing', async () => {
    const { asked, reopen } = reopening(textBoxTool, [MARK], 'typed');
    expect(await reopen([300, 300])).toBeUndefined();
    expect(asked).toStrictEqual([]);
  });
});
