import { describe, expect, it } from 'vitest';

import { lookOfStyleString, normalisedRuns, richTextOf, runsOfRichText, styleStringOf } from './textBoxRichText.js';
import {
  type BoxLook,
  DEFAULT_LOOK,
  type Face,
  type Measure,
  appearanceContent,
  faceFor,
  faceNames,
  layoutBox,
  pdfString,
  writable,
} from './textBoxStyle.js';

/**
 * The text box's layout and its `/RC`, `/DS` and appearance, with no engine: every character is 6 points wide at size 12 in a
 * regular face and 7 in a bold one, so a line's break and a justified space are numbers a case can state.
 */
const measure: Measure = (face: Face, text: string, size: number) =>
  Array.from(text).length * (face.includes('Bold') ? 7 : 6) * (size / 12);

const look = (over: Partial<BoxLook> = {}): BoxLook => ({ ...DEFAULT_LOOK, ...over });
const linesOf = (box: ReturnType<typeof layoutBox>) => (box?.lines ?? []).map((line) => line.pieces.map((piece) => piece.text).join(''));

describe('layoutBox', () => {
  it('breaks greedily at spaces, drops the space that would start a line, and answers each line at the pitch asked', () => {
    const box = layoutBox(60, 200, look(), [{ text: 'aaaa bbbb cccc' }], measure);
    // 60 wide at 6 per character is ten characters: "aaaa bbbb" is nine, then "cccc".
    expect(linesOf(box)).toStrictEqual(['aaaa bbbb', 'cccc']);
    const [first, second] = box?.lines ?? [];
    expect((second?.baseline ?? 0) - (first?.baseline ?? 0)).toBeCloseTo(12 * 1.2, 5);
  });

  it('a word wider than the line is cut at the character that no longer fits, so it always advances', () => {
    expect(linesOf(layoutBox(30, 200, look(), [{ text: 'abcdefghijkl' }], measure))).toStrictEqual(['abcde', 'fghij', 'kl']);
  });

  it('a hard break starts a line, and an empty box still has its one line', () => {
    expect(linesOf(layoutBox(200, 200, look(), [{ text: 'one\ntwo' }], measure))).toStrictEqual(['one', 'two']);
    expect(layoutBox(200, 200, look(), [{ text: '' }], measure)?.lines).toHaveLength(1);
  });

  it('JUSTIFY widens the spaces of every line that WRAPPED to the full width, and leaves the last line and a broken one alone', () => {
    const box = layoutBox(60, 200, look({ align: 'justify' }), [{ text: 'aa bb cc dd ee' }], measure);
    // "aa bb cc" is eight characters (48) in sixty: the two spaces take the twelve points between them.
    const first = box?.lines[0];
    const last = first?.pieces.at(-1);
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeCloseTo(60, 5);
    const final = box?.lines.at(-1);
    expect(final?.pieces.at(-1)?.x).toBe(0);
    // CONTROL: the same words left-aligned end short of the width.
    const plain = layoutBox(60, 200, look({ align: 'left' }), [{ text: 'aa bb cc dd ee' }], measure);
    const plainLast = plain?.lines[0]?.pieces.at(-1);
    expect((plainLast?.x ?? 0) + (plainLast?.width ?? 0)).toBeLessThan(60);
  });

  it('centre and right put the slack where they say, and padding and a border narrow the line', () => {
    const centred = layoutBox(100, 50, look({ align: 'center' }), [{ text: 'abcde' }], measure)?.lines[0]?.pieces[0];
    expect(centred?.x).toBeCloseTo((100 - 30) / 2, 5);
    const right = layoutBox(100, 50, look({ align: 'right' }), [{ text: 'abcde' }], measure)?.lines[0]?.pieces[0];
    expect(right?.x).toBeCloseTo(100 - 30, 5);
    const padded = layoutBox(60, 200, look({ padding: 10 }), [{ text: 'aaaa bbbb' }], measure);
    // 60 - 20 = 40 wide is six characters and a bit: "aaaa" and then "bbbb".
    expect(linesOf(padded)).toStrictEqual(['aaaa', 'bbbb']);
    expect(padded?.lines[0]?.pieces[0]?.x).toBe(10);
  });

  it('a bold run is measured in the bold face, so it wraps where the bold width says', () => {
    const box = layoutBox(60, 200, look(), [{ text: 'aaaa ', bold: false }, { text: 'bbbb', bold: true }], measure);
    // "aaaa " is 30, "bbbb" bold is 28: 58 fits in 60 on one line.
    expect(linesOf(box)).toStrictEqual(['aaaa bbbb']);
    const wider = layoutBox(56, 200, look(), [{ text: 'aaaa ', bold: false }, { text: 'bbbb', bold: true }], measure);
    expect(linesOf(wider)).toStrictEqual(['aaaa', 'bbbb']);
    expect(box?.lines[0]?.pieces.map((piece) => piece.face)).toStrictEqual(['Helvetica', 'Helvetica-Bold']);
  });

  it('REFUSES a box that holds a character the base 14 cannot write, whole, rather than dropping the style on some of it', () => {
    expect(layoutBox(200, 100, look(), [{ text: 'plain ' }, { text: 'שלום', bold: true }], measure)).toBeUndefined();
    expect(writable('Café — “quoted” €5')).toBe(true);
    expect(writable('日本語')).toBe(false);
    // CONTROL: the same box without that run is drawn.
    expect(layoutBox(200, 100, look(), [{ text: 'plain ' }], measure)).toBeDefined();
  });
});

describe('appearanceContent', () => {
  it('draws the fill first, the border, then the words clipped to the box, in the face each piece names', () => {
    const style = look({ fill: [1, 1, 0], borderWidth: 1 });
    const box = layoutBox(100, 40, style, [{ text: 'hi ' }, { text: 'bold', bold: true, colour: [1, 0, 0] }], measure);
    if (box === undefined) throw new Error('no layout');
    const content = appearanceContent(box, style);
    expect(content.indexOf('1 1 0 rg')).toBeGreaterThanOrEqual(0);
    expect(content.indexOf('1 1 0 rg')).toBeLessThan(content.indexOf('BT'));
    expect(content).toContain('re W n');
    expect(content).toContain('1 0 0 rg');
    expect(content).toContain('(bold) Tj');
    expect([...faceNames(box).entries()]).toStrictEqual([
      ['Helvetica', 'F1'],
      ['Helvetica-Bold', 'F2'],
    ]);
  });

  it('underline and strike are rectangles under and through the piece, and are absent for a plain one', () => {
    const decorated = layoutBox(200, 40, look({ underline: true, strike: true }), [{ text: 'abc' }], measure);
    const plain = layoutBox(200, 40, look(), [{ text: 'abc' }], measure);
    if (decorated === undefined || plain === undefined) throw new Error('no layout');
    const count = (text: string): number => text.split(' re f').length - 1;
    expect(count(appearanceContent(decorated, look({ underline: true, strike: true })))).toBe(2);
    expect(count(appearanceContent(plain, look()))).toBe(0);
  });

  it('escapes a parenthesis and a backslash, and writes Latin-1 and the euro in their WinAnsi codes', () => {
    expect(pdfString('a(b)\\c')).toBe('(a\\(b\\)\\\\c)');
    expect(pdfString('é€')).toBe('(\\351\\200)');
  });

  it('picks the face by family, bold and italic', () => {
    expect(faceFor('serif', true, true)).toBe('Times-BoldItalic');
    expect(faceFor('mono', false, true)).toBe('Courier-Oblique');
    expect(faceFor('sans', false, false)).toBe('Helvetica');
  });
});

describe('/RC and /DS', () => {
  const style = look({ size: 14, align: 'justify', lineHeight: 1.5, colour: [0, 0, 1], family: 'serif' });

  it('/DS round-trips the box’s look', () => {
    const back = lookOfStyleString(styleStringOf(style));
    expect(back).toMatchObject({ size: 14, align: 'justify', lineHeight: 1.5, family: 'serif', bold: false });
    expect(back.colour.map((channel) => Math.round(channel * 255))).toStrictEqual([0, 0, 255]);
    // CONTROL: a style string that names nothing leaves the base as it is.
    expect(lookOfStyleString('', style)).toStrictEqual(style);
  });

  it('/RC round-trips the runs, with only what each says over the box, escaped, and a paragraph for each hard break', () => {
    const runs = [
      { text: 'plain & ' },
      { text: 'bold<', bold: true },
      { text: ' and ' },
      { text: 'red', colour: [1, 0, 0] as const, underline: true, strike: false },
      { text: '\nsecond' },
    ];
    const rich = richTextOf(runs, style);
    expect(rich).toContain('&amp;');
    expect(rich).toContain('&lt;');
    expect(rich.match(/<p /gu)).toHaveLength(2);
    const back = runsOfRichText(rich);
    expect(normalisedRuns(back ?? []).map((run) => run.text).join('')).toBe('plain & bold< and red\nsecond');
    expect(back?.find((run) => run.text === 'bold<')?.bold).toBe(true);
    expect(back?.find((run) => run.text === 'red')?.underline).toBe(true);
    // CONTROL: a box with no styled run writes no span at all.
    expect(richTextOf([{ text: 'just words' }], style)).not.toContain('<span');
  });

  it('answers undefined for a shape it does not read', () => {
    expect(runsOfRichText('not xhtml')).toBeUndefined();
  });

  it('joins equal neighbours, so a restyle of a stretch that already matched does not split a word', () => {
    expect(normalisedRuns([{ text: 'ab', bold: true }, { text: 'cd', bold: true }, { text: 'ef' }]).map((run) => run.text)).toStrictEqual([
      'abcd',
      'ef',
    ]);
  });
});
