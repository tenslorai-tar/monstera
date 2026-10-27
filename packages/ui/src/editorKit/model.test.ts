import { describe, expect, it } from 'vitest';

import {
  applyParagraph,
  applyStyle,
  caret,
  deleteFrom,
  formatState,
  insertText,
  modelText,
  normalised,
  paragraphAround,
  replaceRange,
  sameModel,
  selectedText,
  styleAt,
  wholeBlock,
  wordAt,
  wordStep,
  type Model,
  type Paragraph,
  type RunStyle,
} from './model.js';

const BODY: RunStyle = {
  face: 'Body',
  size: 10,
  colour: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  rise: 'none',
  lift: 0,
  spacing: 0,
  highlight: null,
};
const HEADING: RunStyle = { ...BODY, size: 14, bold: true };
const MARKER: RunStyle = { ...BODY, size: 7, rise: 'superscript' };

const SET = { align: 'left', lineSpacing: 1, spaceBefore: 0, spaceAfter: 0, firstIndent: 0, leftIndent: 0 } as const;
const paragraph = (...runs: [string, RunStyle][]): Paragraph => ({ ...SET, runs: runs.map(([text, style]) => ({ text, style })) });

/** A heading over a body paragraph that ends in a raised marker: two paragraphs, three sizes. */
const BLOCK: Model = { paragraphs: [paragraph(['Garden news', HEADING]), paragraph(['The club meets on Monday', BODY], ['[1]', MARKER])] };

describe('the editor kit model', () => {
  it('types at the caret in the style of the letter before it', () => {
    const { model, selection } = insertText(BLOCK, caret({ paragraph: 0, offset: 6 }), 'X');
    expect(modelText(model)).toBe('GardenX news\nThe club meets on Monday[1]');
    expect(styleAt(model, { paragraph: 0, offset: 7 })).toEqual(HEADING);
    expect(selection.focus).toEqual({ paragraph: 0, offset: 7 });
  });

  it('types in the pending style the person chose for the next letters', () => {
    const { model } = insertText(BLOCK, caret({ paragraph: 1, offset: 3 }), 'X', { ...BODY, italic: true });
    expect(model.paragraphs[1]?.runs.map((run) => [run.text, run.style.italic])).toEqual([
      ['The', false],
      ['X', true],
      [' club meets on Monday', false],
      ['[1]', false],
    ]);
  });

  it('parts a paragraph at a line feed, the new one set as the old, and the caret after it', () => {
    const centred = applyParagraph(BLOCK, caret({ paragraph: 1, offset: 0 }), { align: 'center' }).model;
    const { model, selection } = insertText(centred, caret({ paragraph: 1, offset: 8 }), '\n');
    expect(modelText(model)).toBe('Garden news\nThe club\n meets on Monday[1]');
    expect(model.paragraphs[2]?.align).toBe('center');
    expect(selection.focus).toEqual({ paragraph: 2, offset: 0 });
  });

  it('deletes a whole grapheme — an emoji of two UTF-16 units — and never half of one', () => {
    const typed = insertText(BLOCK, caret({ paragraph: 1, offset: 3 }), '🌱').model;
    const { model, selection } = deleteFrom(typed, caret({ paragraph: 1, offset: 5 }), -1);
    expect(modelText(model)).toBe(modelText(BLOCK));
    expect(selection.focus).toEqual({ paragraph: 1, offset: 3 });
  });

  it('joins two paragraphs with Backspace at the start of the second, and Delete at the end of the first', () => {
    const back = deleteFrom(BLOCK, caret({ paragraph: 1, offset: 0 }), -1);
    expect(modelText(back.model)).toBe('Garden newsThe club meets on Monday[1]');
    expect(back.selection.focus).toEqual({ paragraph: 0, offset: 11 });
    const forward = deleteFrom(BLOCK, caret({ paragraph: 0, offset: 11 }), 1);
    expect(sameModel(forward.model, back.model)).toBe(true);
  });

  it('deletes a selection across paragraphs, keeping the styles on either side', () => {
    const { model } = deleteFrom(BLOCK, { anchor: { paragraph: 1, offset: 4 }, focus: { paragraph: 0, offset: 7 } }, -1);
    expect(modelText(model)).toBe('Garden club meets on Monday[1]');
    expect(model.paragraphs[0]?.runs.map((run) => run.style.size)).toEqual([14, 10, 7]);
  });

  it('applies bold to the selection only, splitting and rejoining runs', () => {
    const { model } = applyStyle(BLOCK, { anchor: { paragraph: 1, offset: 4 }, focus: { paragraph: 1, offset: 8 } }, { bold: true });
    expect(model.paragraphs[1]?.runs.map((run) => [run.text, run.style.bold])).toEqual([
      ['The ', false],
      ['club', true],
      [' meets on Monday', false],
      ['[1]', false],
    ]);
    const undone = applyStyle(model, { anchor: { paragraph: 1, offset: 4 }, focus: { paragraph: 1, offset: 8 } }, { bold: false }).model;
    expect(sameModel(undone, BLOCK)).toBe(true);
  });

  it('gives an empty paragraph the style applied there, so a letter typed in it takes that style', () => {
    const emptied: Model = { paragraphs: [paragraph(['', BODY])] };
    const bold = applyStyle(emptied, caret({ paragraph: 0, offset: 0 }), { bold: true }).model;
    const typed = insertText(bold, caret({ paragraph: 0, offset: 0 }), 'A').model;
    expect(typed.paragraphs[0]?.runs[0]?.style.bold).toBe(true);
  });

  it('shows each toggle on, off or mixed over the selection', () => {
    const mixed = applyStyle(BLOCK, { anchor: { paragraph: 1, offset: 0 }, focus: { paragraph: 1, offset: 3 } }, { bold: true }).model;
    const state = formatState(mixed, { anchor: { paragraph: 1, offset: 0 }, focus: { paragraph: 1, offset: 8 } });
    expect(state.bold).toBe('mixed');
    expect(state.italic).toBe('off');
    expect(formatState(mixed, { anchor: { paragraph: 1, offset: 0 }, focus: { paragraph: 1, offset: 3 } }).bold).toBe('on');
  });

  it('shows at a caret the size most of THE CARET’S PARAGRAPH uses — not the marker beside it, not the block', () => {
    // THE CONTROL the editor this replaces failed: a block of a 14 pt heading and a 10 pt paragraph, the caret after a
    // 7 pt marker. The size field must say 10, which neither the letter before the caret (7) nor the block's most-used
    // size would say if the heading were longer; the heading here is shorter, so the block's count also says 10, and the
    // case below separates the two.
    expect(formatState(BLOCK, caret({ paragraph: 1, offset: 27 })).size.value).toBe(10);
    expect(formatState(BLOCK, caret({ paragraph: 0, offset: 3 })).size.value).toBe(14);
    const longHeading: Model = { paragraphs: [paragraph(['A heading much longer than the body under it', HEADING]), paragraph(['Short body', BODY])] };
    expect(formatState(longHeading, caret({ paragraph: 1, offset: 5 })).size.value).toBe(10);
  });

  it('shows the size of the selection most of its letters use, and says it is mixed', () => {
    const state = formatState(BLOCK, { anchor: { paragraph: 1, offset: 0 }, focus: { paragraph: 1, offset: 27 } });
    expect(state.size).toEqual({ value: 10, mixed: true });
  });

  it('selects a word by double-click and a paragraph by triple-click', () => {
    expect(selectedText(BLOCK, wordAt(BLOCK, { paragraph: 1, offset: 6 }))).toBe('club');
    expect(selectedText(BLOCK, paragraphAround(BLOCK, { paragraph: 1, offset: 6 }))).toBe('The club meets on Monday[1]');
    expect(selectedText(BLOCK, wholeBlock(BLOCK))).toBe(modelText(BLOCK));
  });

  it('moves by word with Ctrl+arrows, crossing a paragraph at its end', () => {
    expect(wordStep(BLOCK, { paragraph: 1, offset: 4 }, 1)).toEqual({ paragraph: 1, offset: 8 });
    expect(wordStep(BLOCK, { paragraph: 1, offset: 8 }, -1)).toEqual({ paragraph: 1, offset: 4 });
    expect(wordStep(BLOCK, { paragraph: 0, offset: 11 }, 1)).toEqual({ paragraph: 1, offset: 0 });
  });

  it('pastes several lines as several paragraphs, in the style at the caret', () => {
    const { model } = replaceRange(BLOCK, { paragraph: 1, offset: 3 }, { paragraph: 1, offset: 3 }, ' one\r\ntwo', BODY);
    expect(modelText(model)).toBe('Garden news\nThe one\ntwo club meets on Monday[1]');
  });

  it('keeps one empty run in an empty paragraph, and joins runs of one style', () => {
    expect(normalised(paragraph(['', BODY])).runs).toHaveLength(1);
    expect(normalised(paragraph(['a', BODY], ['b', BODY])).runs).toEqual([{ text: 'ab', style: BODY }]);
  });

  it('keeps each letter’s base through typing and formatting, and sees two bases as one style', () => {
    // A BOLD RUN THAT WAS REGULAR ON THE PAGE beside a run that IS bold on the page: alike to the eye, two to a writer.
    const made: Model = {
      paragraphs: [{ ...SET, runs: [{ text: 'made', style: HEADING, base: BODY }, { text: ' bold', style: HEADING, base: HEADING }] }],
    };
    expect(made.paragraphs[0] === undefined ? [] : normalised(made.paragraphs[0]).runs).toHaveLength(2);
    // TYPED INTO THE FIRST, a letter joins its base; formatted, the base stays.
    const typed = insertText(made, caret({ paragraph: 0, offset: 2 }), 'X').model;
    expect(typed.paragraphs[0]?.runs.map((run) => [run.text, run.base])).toEqual([
      ['maXde', BODY],
      [' bold', HEADING],
    ]);
    const italic = applyStyle(typed, { anchor: { paragraph: 0, offset: 0 }, focus: { paragraph: 0, offset: 10 } }, { italic: true }).model;
    expect(italic.paragraphs[0]?.runs.map((run) => run.base)).toEqual([BODY, HEADING]);
    // THE SAME TO THE EYE as one run in that style, whatever the bases say.
    expect(sameModel(made, { paragraphs: [{ ...SET, runs: [{ text: 'made bold', style: HEADING }] }] })).toBe(true);
  });
});
