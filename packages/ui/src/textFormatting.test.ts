// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import {
  allWords,
  formatRange,
  indentParagraphs,
  INDENT_STEP,
  isFormatted,
  paragraphSettingAt,
  readEditor,
  replaceRange,
  setParagraphs,
  spacingBoundOf,
  spacingOf,
  stateAt,
  toggleList,
  wordAt,
} from './textFormatting.js';

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
  it('reports the run own weight until the person sets one', () => {
    const root = document.createElement('div');
    const row = document.createElement('div');
    const run = document.createElement('span');
    run.className = 'm-text-editor__run';
    run.dataset['size'] = '12';
    run.style.fontWeight = '700';
    run.textContent = 'strong';
    row.append(run);
    root.append(row);
    document.body.append(root);
    const node = run.firstChild;
    if (!(node instanceof Text)) throw new Error('no run text');
    expect(stateAt(node, root).bold).toBe(true);
    formatRange(root, rangeOver(node, 0, 6), { bold: false });
    const inner = root.querySelector('[data-fmt]')?.firstChild;
    if (!(inner instanceof Text)) throw new Error('no span text');
    // CONTROL: the person's "not bold" overrides the page's bold, so a toggle off is a real change and not a no-op.
    expect(stateAt(inner, root).bold).toBe(false);
  });

  it('asks every covered word, so a mixed selection is not already bold', () => {
    const root = editorOf('abcdef');
    formatRange(root, rangeOver(firstText(root), 0, 3), { bold: true });
    const whole = document.createRange();
    whole.selectNodeContents(root);
    expect(allWords(root, whole, (state) => state.bold)).toBe(false);
    const tail = root.querySelector('div')?.lastChild;
    if (!(tail instanceof Text)) throw new Error('no tail');
    formatRange(root, rangeOver(tail, 0, 3), { bold: true });
    expect(allWords(root, whole, (state) => state.bold)).toBe(true);
  });
});

describe('paragraph settings', () => {
  it('sends a setting against the paragraph it was set on', () => {
    const root = editorOf('first', 'second');
    const range = rangeOver(firstText(root, 1), 0, 3);
    setParagraphs(root, range, { align: 'center' });
    expect(readEditor(root).formatting.paragraphs).toEqual([{ paragraph: 1, align: 'center' }]);
    // CONTROL: the first paragraph, outside the range, carries nothing.
    expect(root.children[0]?.getAttribute('data-align')).toBeNull();
  });

  it('sends a justified paragraph and its space after, and reads them back for the panel (ADR-0228)', () => {
    const root = editorOf('first', 'second');
    const range = rangeOver(firstText(root, 0), 0, 3);
    setParagraphs(root, range, { align: 'justify', spaceAfter: 12 }, 2);
    expect(readEditor(root).formatting.paragraphs).toEqual([{ paragraph: 0, align: 'justify', spaceAfter: 12 }]);
    const first = root.children[0] as HTMLElement;
    expect(first.style.textAlign).toBe('justify');
    // AT ZOOM 2, so the gap drawn while typing is the gap the page will have at that zoom.
    expect(first.style.marginBottom).toBe('24px');
    expect(paragraphSettingAt(root, firstText(root, 0))).toEqual({ align: 'justify', spaceAfter: 12 });
    // CONTROL: the space after taken off is gone from what is sent, and the second paragraph never carried any.
    setParagraphs(root, range, { spaceAfter: null });
    expect(readEditor(root).formatting.paragraphs).toEqual([{ paragraph: 0, align: 'justify' }]);
    expect(paragraphSettingAt(root, firstText(root, 1))).toEqual({});
  });

  it('steps the indent and never below none', () => {
    const root = editorOf('line');
    const range = rangeOver(firstText(root), 0, 2);
    indentParagraphs(root, range, 2);
    expect(root.children[0]?.getAttribute('data-left')).toBe(String(2 * INDENT_STEP));
    indentParagraphs(root, range, -5);
    expect(root.children[0]?.getAttribute('data-left')).toBeNull();
  });
});

describe('toggleList', () => {
  it('makes bullets with a hanging indent and takes them off again', () => {
    const root = editorOf('one', 'two');
    const all = document.createRange();
    all.selectNodeContents(root);
    expect(toggleList(root, all, 'bullet')).toBe(2);
    expect(readEditor(root).text).toBe('• one\n• two');
    expect(root.children[0]?.getAttribute('data-first')).toBe(String(-INDENT_STEP));
    toggleList(root, all, 'bullet');
    expect(readEditor(root)).toEqual({ text: 'one\ntwo', formatting: {} });
  });

  it('replaces a bullet with a number instead of stacking them', () => {
    const root = editorOf('one', 'two');
    const all = document.createRange();
    all.selectNodeContents(root);
    toggleList(root, all, 'bullet');
    toggleList(root, all, 'number');
    expect(readEditor(root).text).toBe('1. one\n2. two');
  });
});

describe('wordAt and replaceRange', () => {
  it('finds the word a point is in, by the same segmenter every word here is cut by', () => {
    const root = editorOf('the quikc brown fox');
    const found = wordAt(root, firstText(root), 7);
    expect(found?.word).toBe('quikc');
    expect(found?.range.toString()).toBe('quikc');
    // CONTROL: a point in the space between words is in none, so a right-click there offers no spelling.
    expect(wordAt(root, firstText(root), 3 + 0)?.word).toBe('the');
    expect(wordAt(root, editorOf('a  b').firstElementChild?.firstChild as Text, 2)).toBeUndefined();
  });

  it('keeps a word one when a mark split it across nodes, and replaces it whole', () => {
    const root = editorOf('a quikc fox');
    // BOLD "ik" so the word is three text nodes.
    formatRange(root, rangeOver(firstText(root), 3, 5), { bold: true });
    const found = wordAt(root, firstText(root), 3);
    expect(found?.word).toBe('quikc');
    if (found === undefined) throw new Error('no word');
    replaceRange(root, found.range, 'quick');
    expect(readEditor(root).text).toBe('a quick fox');
  });

  it('replacing tells the editor it changed, as typing does', () => {
    const root = editorOf('teh cat');
    let heard = 0;
    root.addEventListener('input', () => {
      heard += 1;
    });
    const found = wordAt(root, firstText(root), 1);
    if (found === undefined) throw new Error('no word');
    replaceRange(root, found.range, 'the');
    expect(heard).toBe(1);
    expect(readEditor(root).text).toBe('the cat');
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
