// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { formatRange, isFormatted, readEditor, spacingBoundOf, spacingOf, stateAt, toggled } from './textFormatting.js';

/**
 * The editor's formatting, kept in the DOM. What these assert is the one reading ({@link readEditor}) that sends the
 * words and the marks over them: every offset a mark names must land on the words it was made for.
 */

function editorOf(...lines: string[]): HTMLElement {
  const root = document.createElement('div');
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    root.append(row);
  }
  document.body.append(root);
  return root;
}

function firstText(root: HTMLElement, line = 0): Text {
  const node = root.children[line]?.firstChild;
  if (!(node instanceof Text)) throw new Error('no text on that line');
  return node;
}

function rangeOver(node: Text, from: number, to: number): Range {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  return range;
}

describe('readEditor', () => {
  it('reads words with no marks when nothing is formatted', () => {
    const root = editorOf('one two', 'three');
    expect(readEditor(root)).toEqual({ text: 'one two\nthree', formatting: {} });
  });

  it('names a mark by offsets into the same text it reads', () => {
    const root = editorOf('one two', 'three');
    formatRange(root, rangeOver(firstText(root, 1), 0, 5), { bold: true });
    const { text, formatting } = readEditor(root);
    const mark = formatting.marks?.[0];
    expect(mark).toEqual({ from: 8, to: 13, set: { bold: true } });
    // CONTROL: the offsets select the formatted words in the very text that is sent, not words a second reading would place.
    expect(text.slice(mark?.from, mark?.to)).toBe('three');
  });

  it('offsets a mark in the middle of a line past the words before it', () => {
    const root = editorOf('alpha beta gamma');
    formatRange(root, rangeOver(firstText(root), 6, 10), { italic: true });
    const { text, formatting } = readEditor(root);
    expect(text.slice(formatting.marks?.[0]?.from, formatting.marks?.[0]?.to)).toBe('beta');
  });

  it('joins adjacent words under one formatting into one mark', () => {
    const root = editorOf('abcdef');
    formatRange(root, rangeOver(firstText(root), 0, 3), { bold: true });
    const second = root.querySelector('div')?.lastChild;
    if (!(second instanceof Text)) throw new Error('no tail');
    formatRange(root, rangeOver(second, 0, 3), { bold: true });
    expect(readEditor(root).formatting.marks).toEqual([{ from: 0, to: 6, set: { bold: true } }]);
  });

  it('sends no mark for bold put on and taken off again over words that are not bold (VVVVVVV-16)', () => {
    // THE GESTURE AS THE TOOLBAR MAKES IT: on, then off, which leaves `{"bold":false}` on the span rather than no span.
    const root = editorOf('words');
    formatRange(root, rangeOver(firstText(root), 0, 5), { bold: true });
    const inner = root.querySelector('[data-fmt]')?.firstChild;
    if (!(inner instanceof Text)) throw new Error('no span text');
    formatRange(root, rangeOver(inner, 0, 5), { bold: false });
    expect(root.querySelector('[data-fmt]')?.getAttribute('data-fmt')).toBe('{"bold":false}');
    expect(readEditor(root).formatting).toEqual({});
    expect(isFormatted(readEditor(root).formatting)).toBe(false);
  });

  it('CONTROL: bold taken off words whose box IS bold is a mark, because it changes them', () => {
    const root = document.createElement('div');
    root.dataset['size'] = '12';
    root.style.fontWeight = '700';
    const row = document.createElement('div');
    row.textContent = 'words';
    root.append(row);
    document.body.append(root);
    const text = row.firstChild;
    if (!(text instanceof Text)) throw new Error('no box text');
    formatRange(root, rangeOver(text, 0, 5), { bold: false });
    expect(readEditor(root).formatting.marks).toEqual([{ from: 0, to: 5, set: { bold: false } }]);
  });

  it('keeps two different formattings as two marks', () => {
    const root = editorOf('abcdef');
    formatRange(root, rangeOver(firstText(root), 0, 3), { bold: true });
    const tail = root.querySelector('div')?.lastChild;
    if (!(tail instanceof Text)) throw new Error('no tail');
    formatRange(root, rangeOver(tail, 0, 3), { italic: true });
    expect(readEditor(root).formatting.marks).toEqual([
      { from: 0, to: 3, set: { bold: true } },
      { from: 3, to: 6, set: { italic: true } },
    ]);
  });
});

describe('formatRange', () => {
  it('takes a formatting off with null, and leaves no mark behind', () => {
    const root = editorOf('words');
    formatRange(root, rangeOver(firstText(root), 0, 5), { bold: true });
    expect(readEditor(root).formatting.marks).toHaveLength(1);
    const span = root.querySelector('[data-fmt]');
    const inner = span?.firstChild;
    if (!(inner instanceof Text)) throw new Error('no span text');
    formatRange(root, rangeOver(inner, 0, 5), { bold: null });
    expect(readEditor(root).formatting).toEqual({});
  });

  it('merges a formatting into a part of an already formatted span, inner over outer', () => {
    const root = editorOf('abcdef');
    formatRange(root, rangeOver(firstText(root), 0, 6), { bold: true });
    const inner = root.querySelector('[data-fmt]')?.firstChild;
    if (!(inner instanceof Text)) throw new Error('no span text');
    formatRange(root, rangeOver(inner, 2, 4), { italic: true });
    expect(readEditor(root).formatting.marks).toEqual([
      { from: 0, to: 2, set: { bold: true } },
      { from: 2, to: 4, set: { bold: true, italic: true } },
      { from: 4, to: 6, set: { bold: true } },
    ]);
  });

  it('answers false when the range covers no word', () => {
    const root = editorOf('words');
    expect(formatRange(root, rangeOver(firstText(root), 2, 2), { bold: true })).toBe(false);
  });

  it('sends a strike, a highlight and character spacing as marks, and draws them as the writer will (ADR-0228)', () => {
    const root = editorOf('one two three');
    const node = firstText(root);
    formatRange(root, rangeOver(node, 4, 7), { strike: true, highlight: { r: 255, g: 241, b: 118 }, spacing: 0.05 });
    expect(readEditor(root).formatting.marks).toEqual([
      { from: 4, to: 7, set: { strike: true, highlight: { r: 255, g: 241, b: 118 }, spacing: 0.05 } },
    ]);
    const span = root.querySelector<HTMLElement>('[data-fmt]');
    expect(span?.style.textDecoration).toBe('line-through');
    expect(span?.style.backgroundColor).toBe('rgb(255, 241, 118)');
    // THE WIRE'S FRACTION IS CSS'S EM, so the typing box draws the spacing the page will have.
    expect(span?.style.letterSpacing).toBe('0.05em');
    const inner = span?.firstChild;
    if (!(inner instanceof Text)) throw new Error('no span text');
    expect(stateAt(inner, root)).toMatchObject({ strike: true, highlight: { r: 255, g: 241, b: 118 }, spacing: 0.05 });
    // CONTROL: the highlight taken off leaves the strike and the spacing, and nothing behind the words.
    formatRange(root, rangeOver(inner, 0, 3), { highlight: null });
    expect(readEditor(root).formatting.marks?.[0]?.set).toEqual({ strike: true, spacing: 0.05 });
    expect(root.querySelector<HTMLElement>('[data-fmt]')?.style.backgroundColor).toBe('');
  });

  it('draws an underline and a strike together on one span', () => {
    const root = editorOf('both');
    formatRange(root, rangeOver(firstText(root), 0, 4), { underline: true, strike: true });
    expect(root.querySelector<HTMLElement>('[data-fmt]')?.style.textDecoration).toBe('underline line-through');
  });

  it('draws the size at the editor zoom and a raised word smaller', () => {
    const root = editorOf('x2');
    formatRange(root, rangeOver(firstText(root), 1, 2), { size: 20, rise: 'superscript' }, 2);
    const span = root.querySelector<HTMLElement>('[data-fmt]');
    // 20 pt raised draws at 0.65 of its size, at zoom 2.
    expect(span?.style.fontSize).toBe('26px');
    expect(span?.style.verticalAlign).toBe('super');
  });
});

describe('stateAt and allWords', () => {
  it('reports the box’s own weight until the person sets one', () => {
    const root = document.createElement('div');
    root.dataset['size'] = '12';
    root.style.fontWeight = '700';
    const row = document.createElement('div');
    row.textContent = 'strong';
    root.append(row);
    document.body.append(root);
    const node = row.firstChild;
    if (!(node instanceof Text)) throw new Error('no box text');
    expect(stateAt(node, root).bold).toBe(true);
    formatRange(root, rangeOver(node, 0, 6), { bold: false });
    const inner = root.querySelector('[data-fmt]')?.firstChild;
    if (!(inner instanceof Text)) throw new Error('no span text');
    // CONTROL: the person's "not bold" overrides the page's bold, so a toggle off is a real change and not a no-op.
    expect(stateAt(inner, root).bold).toBe(false);
  });

  it('asks every covered word, so a mixed selection is not already bold and a toggle puts bold ON', () => {
    const root = editorOf('abcdef');
    formatRange(root, rangeOver(firstText(root), 0, 3), { bold: true });
    const whole = document.createRange();
    whole.selectNodeContents(root);
    expect(toggled(root, whole, 'bold')).toStrictEqual({ bold: true });
    const tail = root.querySelector('div')?.lastChild;
    if (!(tail instanceof Text)) throw new Error('no tail');
    formatRange(root, rangeOver(tail, 0, 3), { bold: true });
    // CONTROL: every word bold now, so the same toggle takes it OFF.
    expect(toggled(root, whole, 'bold')).toStrictEqual({ bold: false });
  });
});

describe('isFormatted', () => {
  it('is false for nothing and true for either kind', () => {
    expect(isFormatted({})).toBe(false);
    expect(isFormatted({ marks: [{ from: 0, to: 1, set: { bold: true } }] })).toBe(true);
    expect(isFormatted({ paragraphs: [{ paragraph: 0, align: 'right' }] })).toBe(true);
    // A BLOCK THAT WAS ONLY PUT SOMEWHERE is a write too: its words are the same and the page is not.
    expect(isFormatted({ place: { move: { x: 4, y: 0 } } })).toBe(true);
  });
});

describe('spacingBoundOf', () => {
  it('the field’s bound, held to by the field, reaches the wire’s widest spacing at every size (N13)', () => {
    // THE SIZES WHERE ROUNDING MATTERS: 12 points is 1.44 exactly, 10.3 is 1.236, which a bound rounded in would stop short of.
    for (const size of [12, 10.3, 7, 11.5, 400]) {
      expect([size, spacingOf(spacingBoundOf(size), size), spacingOf(-spacingBoundOf(size), size)]).toStrictEqual([size, 0.12, -0.12]);
    }
  });

  it('CONTROL: the bound the panels spelt before, rounded to the tenth, does not reach it', () => {
    expect(spacingOf(Math.round(0.12 * 12 * 10) / 10, 12)).toBeLessThan(0.12);
  });
});
