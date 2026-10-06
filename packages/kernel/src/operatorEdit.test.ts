import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  type OperatorEdit,
  type OperatorFaces,
  type PageRun,
  type PageRuns,
  checkOperatorEdit,
  editOperators,
} from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { type PageFont, pageFonts } from './pageFonts.js';
import { type ShowOperator, joinedContent, showOperators, textObjectCount } from './textOperators.js';

/** The Chromium print committed as Part B's starting material (`scripts/research/chromiumType3Fixture.mjs`). */
const CHROMIUM = fileURLToPath(new URL('../../testing/fixtures/text-edit/chromium-type3.pdf', import.meta.url));

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const latin1 = (data: Uint8Array): string => new TextDecoder('latin1').decode(data);

/** What an operator says, through its font's ToUnicode. */
function said(op: ShowOperator, fonts: ReadonlyMap<string, PageFont>): string {
  const font = fonts.get(op.state.font ?? '');
  if (font?.toUnicode === null || font === undefined) return '';
  let text = '';
  for (let at = 0; at + font.codeBytes <= op.codes.length; at += font.codeBytes) {
    const code = font.codeBytes === 2 ? ((op.codes[at] ?? 0) << 8) | (op.codes[at + 1] ?? 0) : (op.codes[at] ?? 0);
    text += font.toUnicode.text.get(code) ?? '?';
  }
  return text;
}

/**
 * PDFium's reading as these cases need it: each text object (`BT`) one run, its inkless spaces no member of it, as
 * `textRunJoin.ts` joins a line drawn a glyph per object. Its ink is left at the origin, so the block's right edge is the
 * operators' own advance, which is what a case that measures a wrap needs to know exactly.
 */
function runsOf(content: Uint8Array, fonts: ReadonlyMap<string, PageFont>, objectOf: (text: number) => number = (text) => text): PageRuns {
  const ops = showOperators(content);
  const runs: PageRun[] = [];
  for (const textObject of new Set(ops.map((op) => op.textObject))) {
    const line = ops.filter((op) => op.textObject === textObject && op.object !== null);
    const members = line.filter((op) => said(op, fonts).trim() !== '').map((op) => objectOf(op.object ?? -1));
    const first = members[0];
    if (first === undefined) continue;
    runs.push({ index: first, members, text: line.map((op) => said(op, fonts)).join(''), left: 0, right: 0, bottom: 0, top: 0 });
  }
  return { textObjects: Array.from({ length: textObjectCount(ops) }, (_, text) => objectOf(text)), runs };
}

/** A font built for a case: every code draws and is `width` em wide, and its ToUnicode is `characters` from code 97. */
function font(resource: string, characters: string, width: number | null = 0.5, face = 'Face'): PageFont {
  // ASCII LETTERS ONLY, one code each, so a code-point split is the split.
  const text = new Map(Array.from(characters, (character, at) => [97 + at, character]));
  text.set(32, ' ');
  return {
    resource,
    subtype: 'TrueType',
    toUnicode: { text, bytes: 1 },
    codeBytes: 1,
    width: (code) => (text.has(code) ? width : null),
    draws: (code) => text.has(code),
    face,
    weight: 400,
  };
}

/** The inserted text objects of an edit, as text. */
function inserted(edit: OperatorEdit): string[] {
  return edit.changes.filter((change) => change.inserted).map((change) => latin1(edit.content.subarray(change.after.start, change.after.end)));
}

async function chromium<T>(read: (content: Uint8Array, fonts: ReadonlyMap<string, PageFont>) => T): Promise<T> {
  const session = await mupdfWriter.open(new Uint8Array(readFileSync(CHROMIUM)));
  try {
    return await withDocument(session, (document) => {
      const leaf = document.findPage(0);
      return read(joinedContent(pageContentStreams(leaf)), pageFonts(leaf));
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('editOperators on the Chromium print', () => {
  it('rewrites the edited line in its own Type 3 font and changes no other byte of the page', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const heading = page.runs[0];
      expect(heading?.text).toBe('Monstera fixture heading.');
      const result = editOperators(content, fonts, page, [{ lines: [[heading?.index ?? -1]], soft: [false], text: 'Monstera fixture reading.' }]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      const edit = result.value;
      expect(checkOperatorEdit(content, edit, fonts)).toStrictEqual({ ok: true, value: undefined });
      expect(edit.drawn).toStrictEqual(['Monstera fixture reading.']);
      const [object] = inserted(edit);
      // THE STATE AT THE LINE, replayed: its gs and colour from outside the BT, its own font and size.
      expect(object).toMatch(/^q BT\n0 0 0 RG\n0 0 0 rg\n\/G3 gs\n\/F4 28 Tf\n1 0 0 -1 72 97 Tm <30[0-9A-F]*> Tj\nET Q\n$/su);
      // INSIDE THE SAME MARKED CONTENT, immediately before the line's own BT.
      expect(latin1(edit.content)).toContain('/NonStruct <</MCID 0 >>BDC\nq BT');
      // EVERY GLYPH OF THE LINE emptied, its spaces with it; nothing of the other two lines.
      const ops = showOperators(content);
      expect(edit.emptied.map((at) => ops[at]?.textObject)).toStrictEqual(edit.emptied.map(() => ops[0]?.textObject));
      expect(edit.emptied).toHaveLength(ops.filter((op) => op.textObject === ops[0]?.textObject).length);
    });
  });

  it('sets a word its own font cannot carry in the sibling of the same face, and keeps the rest in its own', async () => {
    await chromium((content, fonts) => {
      // CONTROL: the Type 3 subset holds no `l`, the Type0 body font of the same face does, and states no weight.
      const holds = (name: string, character: string) => [...(fonts.get(name)?.toUnicode?.text.values() ?? [])].includes(character);
      expect([holds('F4', 'l'), holds('F5', 'l'), fonts.get('F5')?.weight, fonts.get('F4')?.weight]).toStrictEqual([false, true, null, 400]);
      const page = runsOf(content, fonts);
      const result = editOperators(content, fonts, page, [{ lines: [[page.runs[0]?.index ?? -1]], soft: [false], text: 'Monstera fixture really.' }]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
      const [object] = inserted(result.value);
      expect(object).toContain('/F5 28 Tf');
      expect(result.value.drawn).toStrictEqual(['Monstera fixture really.']);
    });
  });

  it('sets a word the page cannot carry in the fonts the caller adds, keeping the letters the page does carry in its own (ADR-0177)', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      // THE CALLER'S ADDED FONT, a two-byte font as `cidFont.ts` writes one: a code per letter it is asked for.
      const added = new Map<number, string>();
      const face: PageFont = {
        resource: 'MonsteraFace1',
        subtype: 'Type0',
        toUnicode: { text: added, bytes: 2 },
        codeBytes: 2,
        width: (code) => (added.has(code) ? 0.5 : null),
        draws: (code) => added.has(code),
        face: 'Resolver',
        weight: 400,
      };
      const codeFor = (character: string): number => {
        for (const [code, text] of added) if (text === character) return code;
        added.set(added.size + 1, character);
        return added.size;
      };
      const asked: string[] = [];
      const faces: OperatorFaces = {
        set: (word, _source, own) => {
          asked.push(word);
          return Array.from(word, (character) => own(character) ?? { font: face, codes: [codeFor(character)] });
        },
        drawn: () => undefined,
      };
      const result = editOperators(content, fonts, page, [{ lines: [[page.runs[0]?.index ?? -1]], soft: [false], text: 'Monstera fixture zap.' }], faces);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      // ONLY THE WORD THE PAGE CANNOT CARRY was asked for; the rest of the line stayed in the run's font.
      expect(asked).toStrictEqual(['zap.']);
      const [object] = inserted(result.value);
      expect(object).toContain('/MonsteraFace1 28 Tf');
      expect(object).toContain('/F4 28 Tf');
      expect(result.value.drawn).toStrictEqual(['Monstera fixture zap.']);
      // AND IT READS BACK, through the added font as the page will hold it.
      expect(checkOperatorEdit(content, result.value, new Map([...fonts, ['MonsteraFace1', face]])).ok).toBe(true);
    });
  });

  it('refuses a word no font of the page carries, naming its characters, and writes nothing', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const result = editOperators(content, fonts, page, [{ lines: [[page.runs[0]?.index ?? -1]], soft: [false], text: 'Monstera fixture zap.' }]);
      expect(result).toStrictEqual({ ok: false, error: { reason: 'needs-a-face', characters: ['z', 'p'] } });
    });
  });

  it('wraps a line typed past its block onto a new line a pitch below, in the same font', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const result = editOperators(content, fonts, page, [
        { lines: [[page.runs[0]?.index ?? -1]], soft: [false], text: 'Monstera fixture heading reads the same reading' },
      ]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
      const tms = [...(inserted(result.value)[0] ?? '').matchAll(/1 0 0 -1 \S+ (\S+) Tm/gu)].map((match) => Number(match[1]));
      // ONE LINE, NO LEADING: the pitch is 1.2 of 28 in text space, which the flipped CTM draws downward.
      expect(new Set(tms)).toStrictEqual(new Set([97, 97 + 1.2 * 28]));
      const baselines = result.value.baselines[0];
      expect(baselines === undefined ? null : Number((baselines.first - baselines.last).toFixed(4))).toBe(Number((1.2 * 28 * 0.75).toFixed(4)));
    });
  });
});

/** A synthetic page under a flipped CTM like Chromium's: three lines, one object each, in font F1. */
const THREE_LINES = [
  '0.75 0 0 -0.75 0 792 cm',
  'BT /F1 20 Tf 1 0 0 -1 72 300 Tm (abc) Tj ET',
  'BT /F1 20 Tf 1 0 0 -1 72 330 Tm (def) Tj ET',
  'BT /F1 20 Tf 1 0 0 -1 72 360 Tm (ghi) Tj ET',
].join('\n');
const LETTERS = font('F1', 'abcdefghijklmnopqrstuvwxyz');

describe('editOperators on a page of lines', () => {
  const content = bytes(THREE_LINES);
  const fonts = new Map([['F1', LETTERS]]);
  const page = runsOf(content, fonts);
  const block = (text: string) => [{ lines: [[0], [1], [2]], soft: [false, false, false], text }];

  it('leaves the lines an edit did not reach byte for byte, and empties only the line it did', () => {
    const result = editOperators(content, fonts, page, block('abc\ndef\nghx'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(result.value.emptied).toStrictEqual([2]);
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
    expect(latin1(result.value.content)).toContain('(abc) Tj ET\nBT /F1 20 Tf 1 0 0 -1 72 330 Tm (def) Tj');
    expect(latin1(result.value.content)).toContain('[] TJ');
  });

  it('moves every line below a wrap down by the block’s pitch, setting them again', () => {
    // 72 + 3 letters at 10: the block is 30 wide in text space, so a fourth word wraps.
    const result = editOperators(content, fonts, page, block('abc abc\ndef\nghi'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    // THE FIRST LINE STANDS: the plan keeps an old line the new words begin with exactly (ADR-0179), so its operator is
    // not emptied and the wrapped word and the two lines below it are the ones set.
    expect(result.value.emptied).toStrictEqual([1, 2]);
    expect(latin1(result.value.content)).toContain('1 0 0 -1 72 300 Tm (abc) Tj ET');
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
    const tms = [...(inserted(result.value)[0] ?? '').matchAll(/ (\d+(?:\.\d+)?) Tm/gu)].map((match) => Number(match[1]));
    expect(tms).toStrictEqual([330, 360, 390]);
    expect(result.value.drawn).toStrictEqual(['abcdefghi']);
    // CONTROL: a line the words DO change is set again, so the case above is the plan's keeping the first and not an
    // edit that never reaches the operators.
    const changed = editOperators(content, fonts, page, block('abx abc\ndef\nghi'));
    if (!changed.ok) throw new Error(`refused: ${JSON.stringify(changed.error)}`);
    expect(changed.value.emptied).toStrictEqual([0, 1, 2]);
  });

  it('empties a removed line and inserts nothing for it', () => {
    const result = editOperators(content, fonts, page, block('abc\ndef'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(result.value.emptied).toStrictEqual([2]);
    expect(inserted(result.value)).toStrictEqual([]);
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
  });

  it('sets a line typed below the block’s last a pitch below it, in its last run’s state', () => {
    const result = editOperators(content, fonts, page, block('abc\ndef\nghi\njkl'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(result.value.emptied).toStrictEqual([]);
    expect(inserted(result.value)[0]).toContain('1 0 0 -1 72 390 Tm <6A6B6C> Tj');
    // BEFORE THE LAST LINE'S BT: no operator was emptied to place it by.
    expect(latin1(result.value.content)).toContain('ET Q\nBT /F1 20 Tf 1 0 0 -1 72 360 Tm (ghi) Tj');
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
  });

  describe('a translation keeps the page’s layout: fit shrink (ADR-0181 Decision 10)', () => {
    const edit = (text: string, fit: 'reflow' | 'shrink') => {
      const result = editOperators(content, fonts, page, block(text), null, fit);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      const drawn = inserted(result.value)[0] ?? '';
      return {
        edit: result.value,
        sizes: [...drawn.matchAll(/ (\d+(?:\.\d+)?) Tf/gu)].map((match) => Number(match[1])),
        baselines: [...drawn.matchAll(/ (\d+(?:\.\d+)?) Tm/gu)].map((match) => Number(match[1])),
      };
    };
    // A FOURTH LINE where the page has three: at the page's own pitch it ends a line below the old last (390, where the
    // old last stands at 360), so a block that is to keep its box must be set smaller.
    const LONGER = 'abc abc\ndef\nghi';

    it('sets a block that would end below its old last line smaller, so it ends no lower, and no smaller than the floor', () => {
      const shrunk = edit(LONGER, 'shrink');
      const last = shrunk.baselines.at(-1) ?? Number.POSITIVE_INFINITY;
      expect(last).toBeLessThanOrEqual(360 + 0.01);
      // THE SMALLEST SIZE SET is the scale: the first `Tf` replays the source's own state before the scaled one.
      const smallest = Math.min(...shrunk.sizes);
      expect(smallest).toBeLessThan(20);
      expect(smallest).toBeGreaterThanOrEqual(0.6 * 20 - 0.01);
      expect(checkOperatorEdit(content, shrunk.edit, fonts).ok).toBe(true);
      // EVERY LINE IS SET AGAIN, the first included: a line at the old size would stand beside lines at the new one.
      expect(shrunk.edit.drawn).toStrictEqual(['abcabcdefghi']);
    });

    // THE CONTROL: the same words in the reflow mode end a line below the old last, which is what shrink exists to avoid.
    it('CONTROL: the same words reflowed end below the old last line, and at the page’s own size', () => {
      const reflowed = edit(LONGER, 'reflow');
      expect(reflowed.baselines.at(-1)).toBe(390);
      expect(reflowed.sizes.every((size) => size === 20)).toBe(true);
    });

    it('does not shrink what already fits, which is written exactly as a reflow writes it', () => {
      const same = edit('abc\ndef\nghx', 'shrink');
      const reflowed = edit('abc\ndef\nghx', 'reflow');
      expect(latin1(same.edit.content)).toBe(latin1(reflowed.edit.content));
    });

    it('stops at the floor where a block cannot fit even there, rather than writing it smaller', () => {
      const many = Array.from({ length: 9 }, () => 'abc').join('\n');
      const floored = edit(many, 'shrink');
      expect(Math.min(...floored.sizes)).toBeCloseTo(0.6 * 20, 5);
    });
  });

  it('refuses a content whose count of text objects is not PDFium’s, and edits with it', () => {
    expect(editOperators(content, fonts, { ...page, textObjects: [...page.textObjects, 9] }, block('abc\ndef\nghx'))).toMatchObject({
      ok: false,
      error: { reason: 'numbering' },
    });
    // CONTROL: PDFium's own count is accepted.
    expect(editOperators(content, fonts, page, block('abc\ndef\nghx')).ok).toBe(true);
  });

  it('finds a run by its PAGE object index where a rule between the lines is an object too', () => {
    // A RULE DRAWN BEFORE EACH LINE: PDFium's objects are rule 0, line 1, rule 2, line 3, rule 4, line 5.
    const ruled = runsOf(content, fonts, (text) => 2 * text + 1);
    const result = editOperators(content, fonts, ruled, [{ lines: [[1], [3], [5]], soft: [false, false, false], text: 'abc\ndef\nghx' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    // THE THIRD LINE'S OPERATOR, text object 2, page object 5.
    expect(result.value.emptied).toStrictEqual([2]);
    // CONTROL: named by text ordinal instead, object 2 is a rule and no run begins there.
    expect(editOperators(content, fonts, ruled, [{ lines: [[0], [1], [2]], soft: [false, false, false], text: 'abc\ndef\nghx' }])).toMatchObject({
      ok: false,
      error: { reason: 'numbering' },
    });
  });

  it('refuses a block whose lines draw under different CTMs, which one inserted object cannot', () => {
    const shifted = bytes(THREE_LINES.replace('BT /F1 20 Tf 1 0 0 -1 72 360', 'q 1 0 0 1 5 0 cm BT /F1 20 Tf 1 0 0 -1 72 360').concat(' Q'));
    expect(editOperators(shifted, fonts, runsOf(shifted, fonts), block('abc\ndef\nghx'))).toStrictEqual({
      ok: false,
      error: { reason: 'transformed' },
    });
  });

  it('answers unchanged for an edit that changes nothing', () => {
    expect(editOperators(content, fonts, page, block('abc\ndef\nghi'))).toStrictEqual({ ok: false, error: { reason: 'unchanged' } });
  });
});

describe('an emptied operator keeps its advance only where a later one is placed by it', () => {
  // ONE POSITIONING, THREE OPERATORS: `ef` is drawn where `cd`'s advance leaves it, and is another block's.
  const content = bytes('BT /F1 10 Tf 0 0 Td (ab) Tj (cd) Tj (ef) Tj ET');
  const fonts = new Map([['F1', LETTERS]]);
  const page: PageRuns = {
    textObjects: [0, 1, 2],
    runs: [0, 1, 2].map((index) => ({ index, members: [index], text: ['ab', 'cd', 'ef'][index] ?? '', left: 0, right: 0, bottom: 0, top: 0 })),
  };

  it('writes a TJ of spacing alone, the same advance as the glyphs it held', () => {
    const result = editOperators(content, fonts, page, [{ lines: [[0, 1]], soft: [false], text: 'abcx' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    // `cd` at 10 points, 0.5 em each: 10 units, which is -1000 thousandths of a 10-point em.
    expect(latin1(result.value.content)).toContain('(ab) Tj [-1000] TJ (ef) Tj');
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
  });

  it('refuses where that advance is one the font does not state, and only then', () => {
    // `cd` HAS ITS OWN MOVE, so nothing but its emptied advance needs the width of `d`, which this font lacks.
    const moved = bytes('BT /F1 10 Tf 0 0 Td (ab) Tj 20 0 Td (cd) Tj (ef) Tj ET');
    const letters = font('F1', 'abcdefghijklmnopqrstuvwxyz');
    const noD: PageFont = { ...letters, width: (code) => (code === 0x64 ? null : letters.width(code)) };
    expect(editOperators(moved, new Map([['F1', noD]]), page, [{ lines: [[1]], soft: [false], text: 'cx' }])).toStrictEqual({
      ok: false,
      error: { reason: 'unknown-width', font: 'F1' },
    });
    // CONTROL: with `ef` given its own move too, nothing is placed by `cd`'s advance and the edit is made.
    const alone = bytes('BT /F1 10 Tf 0 0 Td (ab) Tj 20 0 Td (cd) Tj 20 0 Td (ef) Tj ET');
    expect(editOperators(alone, new Map([['F1', noD]]), page, [{ lines: [[1]], soft: [false], text: 'cx' }]).ok).toBe(true);
  });

  it('writes no spacing where nothing after it is placed by it (the control)', () => {
    const last = editOperators(content, fonts, page, [{ lines: [[2]], soft: [false], text: 'ex' }]);
    if (!last.ok) throw new Error(`refused: ${JSON.stringify(last.error)}`);
    expect(latin1(last.value.content)).toContain('(cd) Tj [] TJ ET');
  });
});

/** A run PDFium would read as drawn, with its ink where it is drawn (`runsOf` leaves the ink at the origin). */
const inked = (index: number, text: string, left: number, right: number): PageRun => ({
  index,
  members: [index],
  text,
  left,
  right,
  bottom: 0,
  top: 0,
});

describe('editOperators on paragraphs (ADR-0179)', () => {
  const regular = font('F1', 'abcdefghijklmnopqrstuvwxyz');
  const strong = font('F2', 'abcdefghijklmnopqrstuvwxyz');
  const fonts = new Map([
    ['F1', regular],
    ['F2', strong],
  ]);

  it('keeps each word in the state it was drawn in when a longer line wraps it', () => {
    // `aaa ` and `bbb` on one line, the second in F2; `ccc` below it. Five letters at 5 units each.
    const content = bytes(
      [
        'BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa ) Tj ET',
        'BT /F2 10 Tf 1 0 0 1 92 100 Tm (bbb) Tj ET',
        'BT /F1 10 Tf 1 0 0 1 72 88 Tm (ccc) Tj ET',
      ].join('\n'),
    );
    const page: PageRuns = {
      textObjects: [0, 1, 2],
      runs: [inked(0, 'aaa ', 72, 92), inked(1, 'bbb', 92, 107), inked(2, 'ccc', 72, 87)],
    };
    const result = editOperators(content, fonts, page, [{ lines: [[0, 1], [2]], soft: [true, false], text: 'aaa xxxxx bbb ccc' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(checkOperatorEdit(content, result.value, new Map(fonts)).ok).toBe(true);
    const [object = ''] = inserted(result.value);
    /** The font in force where `hex` is shown: the last `Tf` before it. */
    const fontAt = (hex: string): string | undefined => {
      const before = object.slice(0, object.indexOf(hex));
      return [...before.matchAll(/\/(F\d) 10 Tf/gu)].at(-1)?.[1];
    };
    // `bbb` WRAPPED ONTO ANOTHER LINE AND IS STILL F2.
    expect(object).toContain('<626262');
    expect(fontAt('<626262')).toBe('F2');
    // CONTROL: `aaa` and `ccc`, drawn in F1, are F1 — the edit did not set every word in the last font it wrote.
    expect(fontAt('<616161>')).toBe('F1');
    expect(fontAt('<636363>')).toBe('F1');
  });

  describe('marks (ADR-0180)', () => {
    const content = bytes('BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa bbb ccc) Tj ET');
    const page: PageRuns = { textObjects: [0], runs: [inked(0, 'aaa bbb ccc', 72, 127)] };
    const marked = (set: object, faces: OperatorFaces | null = null) =>
      editOperators(content, fonts, page, [{ lines: [[0]], soft: [false], text: 'aaa bbb ccc', marks: [{ from: 4, to: 7, set }] }], faces);
    const object = (set: object): string => {
      const result = marked(set);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
      return inserted(result.value)[0] ?? '';
    };

    it('sets a marked colour and size on its words, and puts the words after them back as they were', () => {
      const written = object({ colour: { r: 255, g: 0, b: 0 }, size: 20 });
      expect(written).toContain('1 0 0 rg');
      expect(written).toContain('/F1 20 Tf');
      // THE WORDS AFTER: size 10 again and the default fill, since the page set none.
      expect(written.indexOf('0 g')).toBeGreaterThan(written.indexOf('1 0 0 rg'));
      expect(written.lastIndexOf('/F1 10 Tf')).toBeGreaterThan(written.indexOf('/F1 20 Tf'));
    });

    it('CONTROL: the same words with no mark change nothing, so the marked case wrote because of the mark', () => {
      const plain = editOperators(content, fonts, page, [{ lines: [[0]], soft: [false], text: 'aaa bbb ccc' }]);
      expect(plain).toStrictEqual({ ok: false, error: { reason: 'unchanged' } });
    });

    it('lifts a superscript to a smaller size above the baseline, and draws a rule under underlined words', () => {
      const raised = object({ rise: 'superscript' });
      expect(raised).toContain('/F1 6.5 Tf');
      expect(raised).toContain(' 103.3 Tm');
      // 'bbb' sits after 'aaa ' (20 units) and is three letters at 6.5: the rule starts there and is as wide as they are.
      const under = object({ underline: true });
      expect(under).toMatch(/q 0 0 0 rg 92 [\d.]+ 15 [\d.]+ re f Q/u);
    });

    it('asks the faces for the weight a bold mark names, and refuses by name where there are none', () => {
      const asked: unknown[] = [];
      const face: PageFont = { ...font('Face1', 'abcdefghijklmnopqrstuvwxyz'), face: 'Arimo', weight: 700 };
      const faces: OperatorFaces = {
        set: (word, _source, _own, restyle) => {
          asked.push(restyle);
          return Array.from(word, (character) => ({ font: face, codes: [character.charCodeAt(0)] }));
        },
        drawn: () => undefined,
      };
      const result = marked({ bold: true }, faces);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((restyle) => JSON.stringify(restyle) === '{"bold":true}')).toBe(true);
      expect(inserted(result.value)[0]).toContain('/Face1 10 Tf');
      // CONTROL: with no faces the page cannot set a word bold, and says which letters.
      expect(marked({ bold: true })).toStrictEqual({ ok: false, error: { reason: 'needs-a-face', characters: ['b'] } });
    });
  });

  it('keeps a centred line centred when its words change', () => {
    const content = bytes(
      [
        'BT /F1 10 Tf 1 0 0 1 92.5 100 Tm (abc) Tj ET',
        'BT /F1 10 Tf 1 0 0 1 87.5 88 Tm (abcde) Tj ET',
        'BT /F1 10 Tf 1 0 0 1 95 76 Tm (ab) Tj ET',
      ].join('\n'),
    );
    const page: PageRuns = {
      textObjects: [0, 1, 2],
      runs: [inked(0, 'abc', 92.5, 107.5), inked(1, 'abcde', 87.5, 112.5), inked(2, 'ab', 95, 105)],
    };
    const result = editOperators(content, fonts, page, [
      { lines: [[0], [1], [2]], soft: [false, false, false], text: 'abc\nabcde\nabcd' },
    ]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    // FOUR LETTERS, 20 units wide, about the centre the lines keep, 100.
    expect(inserted(result.value)[0]).toContain('1 0 0 1 90 76 Tm');
    // CONTROL: the same words in lines that share a left edge are set from that edge, so the case above is alignment
    // and not a line that always starts where the old one did.
    const flush = bytes(
      [
        'BT /F1 10 Tf 1 0 0 1 72 100 Tm (abc) Tj ET',
        'BT /F1 10 Tf 1 0 0 1 72 88 Tm (abcde) Tj ET',
        'BT /F1 10 Tf 1 0 0 1 72 76 Tm (ab) Tj ET',
      ].join('\n'),
    );
    const left: PageRuns = {
      textObjects: [0, 1, 2],
      runs: [inked(0, 'abc', 72, 87), inked(1, 'abcde', 72, 97), inked(2, 'ab', 72, 82)],
    };
    const control = editOperators(flush, fonts, left, [
      { lines: [[0], [1], [2]], soft: [false, false, false], text: 'abc\nabcde\nabcd' },
    ]);
    if (!control.ok) throw new Error(`refused: ${JSON.stringify(control.error)}`);
    expect(inserted(control.value)[0]).toContain('1 0 0 1 72 76 Tm');
  });
});

describe('checkOperatorEdit', () => {
  const content = bytes(THREE_LINES);
  const fonts = new Map([['F1', LETTERS]]);
  const made = editOperators(content, fonts, runsOf(content, fonts), [{ lines: [[0], [1], [2]], soft: [false, false, false], text: 'abc\ndef\nghx' }]);
  if (!made.ok) throw new Error('the case’s own edit was refused');
  const edit = made.value;

  it('refuses a byte changed outside the edit', () => {
    // A BYTE NO SHOW OPERATOR HOLDS, the page's `cm` (SSSSSSS-5): a byte inside `(def) Tj` would be refused by the
    // operator comparison too, so the check under test could be deleted and the case still pass.
    const changed = new Uint8Array(edit.content);
    changed[latin1(changed).indexOf('792') + 1] = 0x38;
    expect(checkOperatorEdit(content, { ...edit, content: changed }, fonts)).toStrictEqual({
      ok: false,
      error: 'a byte outside the edit changed',
    });
  });

  it('refuses an emptied operator that still shows its glyphs', () => {
    // THE EMPTIED OPERATOR'S GLYPHS PUT BACK, its change grown by the three bytes; the insertion before it is unmoved.
    const kept = latin1(edit.content).replace('[] TJ', '(ghi) Tj');
    const shift = kept.length - edit.content.length;
    const changes = edit.changes.map((change) =>
      change.inserted ? change : { ...change, after: { start: change.after.start, end: change.after.end + shift } },
    );
    expect(checkOperatorEdit(content, { ...edit, content: bytes(kept), changes }, fonts)).toStrictEqual({
      ok: false,
      error: 'emptied operator 2 still shows a code',
    });
  });

  it('refuses inserted text that does not read as the words drawn', () => {
    expect(checkOperatorEdit(content, { ...edit, drawn: ['ghy'] }, fonts)).toStrictEqual({
      ok: false,
      error: 'the inserted text does not read as the words drawn',
    });
    // CONTROL: the edit as made reads back.
    expect(checkOperatorEdit(content, edit, fonts)).toStrictEqual({ ok: true, value: undefined });
  });
});
