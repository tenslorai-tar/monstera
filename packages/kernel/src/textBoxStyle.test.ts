import { describe, expect, it } from 'vitest';

import { lookOfStyleString, normalisedRuns, richTextOf, runsOfRichText, styleStringOf } from './textBoxRichText.js';
import {
  type BoxLook,
  DEFAULT_LOOK,
  type Face,
  type Measure,
  appearanceContent,
  base14Typesetter,
  faceFor,
  firstOf,
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
const setter = base14Typesetter(measure);

const look = (over: Partial<BoxLook> = {}): BoxLook => ({ ...DEFAULT_LOOK, ...over });
const linesOf = (box: ReturnType<typeof layoutBox>) => (box?.lines ?? []).map((line) => line.pieces.map((piece) => piece.text).join(''));

describe('layoutBox', () => {
  it('breaks greedily at spaces, drops the space that would start a line, and answers each line at the pitch asked', () => {
    const box = layoutBox(60, 200, look(), [{ text: 'aaaa bbbb cccc' }], setter);
    // 60 wide at 6 per character is ten characters: "aaaa bbbb" is nine, then "cccc".
    expect(linesOf(box)).toStrictEqual(['aaaa bbbb', 'cccc']);
    const [first, second] = box?.lines ?? [];
    expect((second?.baseline ?? 0) - (first?.baseline ?? 0)).toBeCloseTo(12 * 1.2, 5);
  });

  it('a word wider than the line is cut at the character that no longer fits, so it always advances', () => {
    expect(linesOf(layoutBox(30, 200, look(), [{ text: 'abcdefghijkl' }], setter))).toStrictEqual(['abcde', 'fghij', 'kl']);
  });

  it('a hard break starts a line, and an empty box still has its one line', () => {
    expect(linesOf(layoutBox(200, 200, look(), [{ text: 'one\ntwo' }], setter))).toStrictEqual(['one', 'two']);
    expect(layoutBox(200, 200, look(), [{ text: '' }], setter)?.lines).toHaveLength(1);
  });

  it('JUSTIFY widens the spaces of every line that WRAPPED to the full width, and leaves the last line and a broken one alone', () => {
    const box = layoutBox(60, 200, look({ align: 'justify' }), [{ text: 'aa bb cc dd ee' }], setter);
    // "aa bb cc" is eight characters (48) in sixty: the two spaces take the twelve points between them.
    const first = box?.lines[0];
    const last = first?.pieces.at(-1);
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeCloseTo(60, 5);
    const final = box?.lines.at(-1);
    expect(final?.pieces.at(-1)?.x).toBe(0);
    // CONTROL: the same words left-aligned end short of the width.
    const plain = layoutBox(60, 200, look({ align: 'left' }), [{ text: 'aa bb cc dd ee' }], setter);
    const plainLast = plain?.lines[0]?.pieces.at(-1);
    expect((plainLast?.x ?? 0) + (plainLast?.width ?? 0)).toBeLessThan(60);
  });

  it('centre and right put the slack where they say, and padding and a border narrow the line', () => {
    const centred = layoutBox(100, 50, look({ align: 'center' }), [{ text: 'abcde' }], setter)?.lines[0]?.pieces[0];
    expect(centred?.x).toBeCloseTo((100 - 30) / 2, 5);
    const right = layoutBox(100, 50, look({ align: 'right' }), [{ text: 'abcde' }], setter)?.lines[0]?.pieces[0];
    expect(right?.x).toBeCloseTo(100 - 30, 5);
    const padded = layoutBox(60, 200, look({ padding: 10 }), [{ text: 'aaaa bbbb' }], setter);
    // 60 - 20 = 40 wide is six characters and a bit: "aaaa" and then "bbbb".
    expect(linesOf(padded)).toStrictEqual(['aaaa', 'bbbb']);
    expect(padded?.lines[0]?.pieces[0]?.x).toBe(10);
  });

  it('a bold run is measured in the bold face, so it wraps where the bold width says', () => {
    const box = layoutBox(60, 200, look(), [{ text: 'aaaa ', bold: false }, { text: 'bbbb', bold: true }], setter);
    // "aaaa " is 30, "bbbb" bold is 28: 58 fits in 60 on one line.
    expect(linesOf(box)).toStrictEqual(['aaaa bbbb']);
    const wider = layoutBox(56, 200, look(), [{ text: 'aaaa ', bold: false }, { text: 'bbbb', bold: true }], setter);
    expect(linesOf(wider)).toStrictEqual(['aaaa', 'bbbb']);
    expect(box?.lines[0]?.pieces.map((piece) => piece.face)).toStrictEqual(['Helvetica', 'Helvetica-Bold']);
  });

  it('REFUSES a box that holds a character the base 14 cannot write, whole, rather than dropping the style on some of it', () => {
    expect(layoutBox(200, 100, look(), [{ text: 'plain ' }, { text: 'שלום', bold: true }], setter)).toBeUndefined();
    expect(writable('Café — “quoted” €5')).toBe(true);
    expect(writable('日本語')).toBe(false);
    // CONTROL: the same box without that run is drawn.
    expect(layoutBox(200, 100, look(), [{ text: 'plain ' }], setter)).toBeDefined();
  });
});

describe('appearanceContent', () => {
  it('draws the fill first, the border, then the words clipped to the box, in the face each piece names', () => {
    const style = look({ fill: [1, 1, 0], borderWidth: 1 });
    const box = layoutBox(100, 40, style, [{ text: 'hi ' }, { text: 'bold', bold: true, colour: [1, 0, 0] }], setter);
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
    const decorated = layoutBox(200, 40, look({ underline: true, strike: true }), [{ text: 'abc' }], setter);
    const plain = layoutBox(200, 40, look(), [{ text: 'abc' }], setter);
    if (decorated === undefined || plain === undefined) throw new Error('no layout');
    const count = (text: string): number => text.split(' re f').length - 1;
    expect(count(appearanceContent(decorated, look({ underline: true, strike: true })))).toBe(2);
    expect(count(appearanceContent(plain, look()))).toBe(0);
  });

  it('a HIGHLIGHT is its colour behind the piece, drawn before any word of its line (ADR-0228)', () => {
    const style = look();
    const box = layoutBox(200, 40, style, [{ text: 'plain ' }, { text: 'lit', highlight: [1, 0.9, 0.4] }], setter);
    if (box === undefined) throw new Error('no layout');
    const content = appearanceContent(box, style);
    // 'plain ' is 36 wide, so the colour starts there and is as wide as 'lit', 18; from 0.24 under the baseline to 0.9 over.
    const rect = /1 0\.9 0\.4 rg\n36 [\d.]+ 18 13\.68 re f/u.exec(content);
    expect(rect).not.toBeNull();
    expect(content.indexOf(rect?.[0] ?? '')).toBeLessThan(content.indexOf('BT'));
    // CONTROL: the same words with no highlight draw no rectangle at all.
    const plain = layoutBox(200, 40, style, [{ text: 'plain lit' }], setter);
    if (plain === undefined) throw new Error('no layout');
    expect(appearanceContent(plain, style)).not.toContain('re f');
  });

  it('CHARACTER SPACING widens a run by the spacing after each character and is said as Tc, then taken off again', () => {
    const style = look();
    // 0.1 OF 12 POINTS is 1.2 points after each of three characters.
    const box = layoutBox(200, 40, style, [{ text: 'abc', spacing: 0.1 }, { text: ' def' }], setter);
    if (box === undefined) throw new Error('no layout');
    const [spaced, after] = box.lines[0]?.pieces ?? [];
    expect(spaced?.width).toBeCloseTo(18 + 3 * 1.2, 5);
    expect(after?.x).toBeCloseTo(18 + 3 * 1.2, 5);
    const content = appearanceContent(box, style);
    expect(content).toContain('1.2 Tc');
    expect(content.indexOf('0 Tc')).toBeGreaterThan(content.indexOf('1.2 Tc'));
    // THE WHOLE BOX's spacing is every run's, by the same rule.
    const whole = layoutBox(200, 40, look({ spacing: 0.1 }), [{ text: 'abc' }], setter);
    expect(whole?.lines[0]?.pieces[0]?.width).toBeCloseTo(18 + 3 * 1.2, 5);
    // CONTROL: no spacing anywhere, no Tc said, and the run its own width.
    const plain = layoutBox(200, 40, style, [{ text: 'abc def' }], setter);
    if (plain === undefined) throw new Error('no layout');
    expect(appearanceContent(plain, style)).not.toContain('Tc');
    expect(plain.lines[0]?.pieces[0]?.width).toBe(42);
  });

  it('a TAB moves the next words to the next stop, 36 points from the inner left, and draws nothing (ADR-0228)', () => {
    const box = layoutBox(200, 40, look(), [{ text: 'ab\tcd' }], setter);
    const pieces = box?.lines[0]?.pieces ?? [];
    expect(pieces.map((piece) => [piece.text, piece.x])).toStrictEqual([
      ['ab', 0],
      ['cd', 36],
    ]);
    // A TAB PAST A STOP goes to the one after it: 'abcdefg' is 42 wide, so the next stop is 72.
    expect(layoutBox(200, 40, look(), [{ text: 'abcdefg\tx' }], setter)?.lines[0]?.pieces.at(-1)?.x).toBe(72);
    // CONTROL: a space where the tab was puts the words one space on, not at the stop.
    expect(layoutBox(200, 40, look(), [{ text: 'ab cd' }], setter)?.lines[0]?.pieces.map((piece) => piece.text)).toStrictEqual(['ab cd']);
  });

  it('escapes a parenthesis and a backslash, and writes Latin-1 and the euro in their WinAnsi codes', () => {
    expect(pdfString('a(b)\\c')).toBe('(a\\(b\\)\\\\c)');
    expect(pdfString('é€')).toBe('(\\351\\200)');
  });

  it('picks the face by family, bold and italic', () => {
    expect(faceFor('Times', true, true)).toBe('Times-BoldItalic');
    expect(faceFor('Courier', false, true)).toBe('Courier-Oblique');
    expect(faceFor('Helvetica', false, false)).toBe('Helvetica');
  });
});

/**
 * A second typesetter that sets anything, in one face of its own, eight points a character: the shape the resolver's faces
 * take, without an engine. Its show names the text so a case can see which setter drew a piece.
 */
const anything = {
  set: (text: string, _style: unknown, size: number) => [{ face: 'Embedded', text, width: Array.from(text).length * 8 * (size / 12), show: `<${text}> Tj` }],
};

describe('a box in a real font, word by word (K2, ADR-0228 Decision 3)', () => {
  it('a word the base 14 write stays in them; one they cannot goes to the next setter; the line keeps both', () => {
    const box = layoutBox(400, 100, look(), [{ text: 'plain שלום plain' }], firstOf(setter, anything));
    expect(box).toBeDefined();
    const faces = (box?.lines[0]?.pieces ?? []).map((piece) => piece.face);
    expect(faces).toContain('Helvetica');
    expect(faces).toContain('Embedded');
    // CONTROL: the base 14 alone refuse the box whole, as before real fonts.
    expect(layoutBox(400, 100, look(), [{ text: 'plain שלום plain' }], setter)).toBeUndefined();
  });

  it('a family that is not base 14 is never set in the base 14, even for words they could write', () => {
    const box = layoutBox(400, 100, look({ family: 'Arial' }), [{ text: 'plain words' }], firstOf(setter, anything));
    expect(new Set((box?.lines[0]?.pieces ?? []).map((piece) => piece.face))).toStrictEqual(new Set(['Embedded']));
  });

  it('a right-to-left paragraph is drawn in the order the bidirectional algorithm gives', () => {
    const box = layoutBox(400, 100, look(), [{ text: 'אבג דהו' }], firstOf(setter, anything));
    // THE SECOND WORD IS DRAWN FIRST, at the left: a right-to-left paragraph reads from the right.
    const pieces = box?.lines[0]?.pieces ?? [];
    const words = pieces.map((piece) => piece.text).join('').split(' ').filter(Boolean);
    expect(words).toStrictEqual(['דהו', 'אבג']);
    // CONTROL: a left-to-right paragraph keeps its order.
    const latin = layoutBox(400, 100, look(), [{ text: 'abc def' }], firstOf(setter, anything));
    expect((latin?.lines[0]?.pieces ?? []).map((piece) => piece.text).join('')).toBe('abc def');
  });

  it('draws a piece with the operators its setter decided, and two pieces in one draw as two shows in order', () => {
    const box = layoutBox(400, 40, look({ family: 'Arial' }), [{ text: 'ab cd' }], firstOf(setter, anything));
    if (box === undefined) throw new Error('no layout');
    const content = appearanceContent(box, look());
    expect(content).toContain('<ab> Tj\n< > Tj\n<cd> Tj');
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

  it('/RC and /DS carry a run’s highlight and spacing and the box’s spacing, and read them back (ADR-0228)', () => {
    const runs = [{ text: 'lit', highlight: [1, 1, 0] as const, spacing: 0.05 }, { text: ' plain' }];
    const spaced = look({ spacing: -0.02 });
    const rich = richTextOf(runs, spaced);
    expect(rich).toContain('background-color:#ffff00');
    expect(rich).toContain('letter-spacing:0.05em');
    const back = runsOfRichText(rich);
    expect(back?.[0]).toStrictEqual({ text: 'lit', highlight: [1, 1, 0], spacing: 0.05 });
    expect(lookOfStyleString(styleStringOf(spaced)).spacing).toBe(-0.02);
    // A SPACING PAST THE BOUND, written by hand, is read at the bound rather than past it.
    expect(lookOfStyleString('letter-spacing: 0.5em').spacing).toBe(0.12);
    // CONTROL: a box with no spacing writes none, and two runs that differ only in highlight stay two.
    expect(styleStringOf(look())).not.toContain('letter-spacing');
    expect(normalisedRuns([{ text: 'a', highlight: [1, 1, 0] }, { text: 'b' }])).toHaveLength(2);
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
