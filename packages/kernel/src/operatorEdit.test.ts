import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { type OperatorEdit, type PageRun, type PageRuns, checkOperatorEdit, editOperators } from './operatorEdit.js';
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
      const result = editOperators(content, fonts, page, [{ lines: [[heading?.index ?? -1]], text: 'Monstera fixture reading.' }]);
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
      const result = editOperators(content, fonts, page, [{ lines: [[page.runs[0]?.index ?? -1]], text: 'Monstera fixture really.' }]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
      const [object] = inserted(result.value);
      expect(object).toContain('/F5 28 Tf');
      expect(result.value.drawn).toStrictEqual(['Monstera fixture really.']);
    });
  });

  it('refuses a word no font of the page carries, naming its characters, and writes nothing', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const result = editOperators(content, fonts, page, [{ lines: [[page.runs[0]?.index ?? -1]], text: 'Monstera fixture zap.' }]);
      expect(result).toStrictEqual({ ok: false, error: { reason: 'needs-a-face', characters: ['z', 'p'] } });
    });
  });

  it('wraps a line typed past its block onto a new line a pitch below, in the same font', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const result = editOperators(content, fonts, page, [
        { lines: [[page.runs[0]?.index ?? -1]], text: 'Monstera fixture heading reads the same reading' },
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
  const block = (text: string) => [{ lines: [[0], [1], [2]], text }];

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
    expect(result.value.emptied).toStrictEqual([0, 1, 2]);
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
    const tms = [...(inserted(result.value)[0] ?? '').matchAll(/ (\d+(?:\.\d+)?) Tm/gu)].map((match) => Number(match[1]));
    expect(tms).toStrictEqual([300, 330, 360, 390]);
    expect(result.value.drawn).toStrictEqual(['abc abcdefghi']);
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
    const result = editOperators(content, fonts, ruled, [{ lines: [[1], [3], [5]], text: 'abc\ndef\nghx' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    // THE THIRD LINE'S OPERATOR, text object 2, page object 5.
    expect(result.value.emptied).toStrictEqual([2]);
    // CONTROL: named by text ordinal instead, object 2 is a rule and no run begins there.
    expect(editOperators(content, fonts, ruled, [{ lines: [[0], [1], [2]], text: 'abc\ndef\nghx' }])).toMatchObject({
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
    const result = editOperators(content, fonts, page, [{ lines: [[0, 1]], text: 'abcx' }]);
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
    expect(editOperators(moved, new Map([['F1', noD]]), page, [{ lines: [[1]], text: 'cx' }])).toStrictEqual({
      ok: false,
      error: { reason: 'unknown-width', font: 'F1' },
    });
    // CONTROL: with `ef` given its own move too, nothing is placed by `cd`'s advance and the edit is made.
    const alone = bytes('BT /F1 10 Tf 0 0 Td (ab) Tj 20 0 Td (cd) Tj 20 0 Td (ef) Tj ET');
    expect(editOperators(alone, new Map([['F1', noD]]), page, [{ lines: [[1]], text: 'cx' }]).ok).toBe(true);
  });

  it('writes no spacing where nothing after it is placed by it (the control)', () => {
    const last = editOperators(content, fonts, page, [{ lines: [[2]], text: 'ex' }]);
    if (!last.ok) throw new Error(`refused: ${JSON.stringify(last.error)}`);
    expect(latin1(last.value.content)).toContain('(cd) Tj [] TJ ET');
  });
});

describe('checkOperatorEdit', () => {
  const content = bytes(THREE_LINES);
  const fonts = new Map([['F1', LETTERS]]);
  const made = editOperators(content, fonts, runsOf(content, fonts), [{ lines: [[0], [1], [2]], text: 'abc\ndef\nghx' }]);
  if (!made.ok) throw new Error('the case’s own edit was refused');
  const edit = made.value;

  it('refuses a byte changed outside the edit', () => {
    const changed = new Uint8Array(edit.content);
    changed[changed.indexOf(0x64)] = 0x65;
    expect(checkOperatorEdit(content, { ...edit, content: changed }, fonts)).toMatchObject({ ok: false });
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
