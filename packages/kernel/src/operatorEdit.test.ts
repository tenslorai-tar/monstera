import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { blocksReplaced } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  type OperatorEdit,
  type OperatorFaces,
  type PageRun,
  type PageRuns,
  checkOperatorEdit,
  editOperators,
  pageFontsAsRead,
  statedBold,
} from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { type PageFont, pageFonts } from './pageFonts.js';
import * as STANDARD from './standardFontTables.js';
import { type ShowOperator, joinedContent, multiply, operatorsAndDecorations, showOperators, textObjectCount } from './textOperators.js';

/** The marks of one edited block, as the contract carries them. */
type EditedMarks = NonNullable<Parameters<typeof editOperators>[3][number]['marks']>;

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
      return read(joinedContent(pageContentStreams(leaf)), pageFonts(leaf, STANDARD));
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The resolver as a caller adds it: a two-byte font as `cidFont.ts` writes one, a code per letter it is asked for, each
 * letter the page's own carrier gives taken from it first. Answers the faces and the words they were asked for.
 */
function resolverFaces(): { readonly faces: OperatorFaces; readonly face: PageFont; readonly asked: string[] } {
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
    isBold: statedBold,
  };
  return { faces, face, asked };
}

describe('editOperators on the Chromium print', () => {
  /**
   * THE OWNER'S FONT PRINCIPLE (ADR-0176's correction of 2026-10-25): a word the run did not already say is never set in
   * the page's drawn letters. The heading is a Type 3 subset (F4); its sibling of the same face (F5) is an ordinary Type0
   * font, and carries every letter of `reading.`.
   */
  it('keeps the line’s own words in its Type 3 font, sets a NEW word in an ordinary face, and changes no other byte', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const heading = page.runs[0];
      expect(heading?.text).toBe('Monstera fixture heading.');
      expect([fonts.get('F4')?.subtype, fonts.get('F5')?.subtype]).toStrictEqual(['Type3', 'Type0']);
      const result = editOperators(content, fonts, page, [{ lines: [[heading?.index ?? -1]], soft: [false], text: 'Monstera fixture reading.' }]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      const edit = result.value;
      expect(checkOperatorEdit(content, edit, fonts)).toStrictEqual({ ok: true, value: undefined });
      expect(edit.drawn).toStrictEqual(['Monstera fixture reading.']);
      const [object = ''] = inserted(edit);
      // THE STATE AT THE LINE, replayed: its gs and colour from outside the BT, its own font and size, for its own words.
      expect(object).toMatch(/^q BT\n0 0 0 RG\n0 0 0 rg\n\/G3 gs\n\/F4 28 Tf\n1 0 0 -1 72 97 Tm <30[0-9A-F]*> Tj\n/su);
      // THE NEW WORD in the ordinary sibling, after the line's own words in their drawn letters. CONTROL, the route before
      // the correction: every letter of `reading.` is in F4 too, so it was written there, and this line would not appear.
      expect(object.indexOf('/F5 28 Tf')).toBeGreaterThan(object.indexOf('/F4 28 Tf'));
      const holds = (name: string) => Array.from('reading.').every((character) => [...(fonts.get(name)?.toUnicode?.text.values() ?? [])].includes(character));
      expect([holds('F4'), holds('F5')]).toStrictEqual([true, true]);
      // INSIDE THE SAME MARKED CONTENT, immediately before the line's own BT.
      expect(latin1(edit.content)).toContain('/NonStruct <</MCID 0 >>BDC\nq BT');
      // EVERY GLYPH OF THE LINE emptied, its spaces with it; nothing of the other two lines.
      const ops = showOperators(content);
      expect(edit.emptied.map((at) => ops[at]?.textObject)).toStrictEqual(edit.emptied.map(() => ops[0]?.textObject));
      expect(edit.emptied).toHaveLength(ops.filter((op) => op.textObject === ops[0]?.textObject).length);
    });
  });

  it('keeps a JOIN’s moved words in their drawn letters where both blocks are drawn in one font (correction of 2026-10-25, later)', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const ops = showOperators(content);
      const fontOfRun = (run: (typeof page.runs)[number] | undefined) => ops.find((op) => op.object === run?.members[0])?.state.font;
      const heading = page.runs[0];
      const second = page.runs.find((run) => run.text === 'A second heading in the same face.');
      expect([fontOfRun(heading), fontOfRun(second)]).toStrictEqual(['F4', 'F4']);
      const result = editOperators(content, fonts, page, [
        { lines: [[heading?.index ?? -1]], soft: [false], text: `${heading?.text ?? ''} ${second?.text ?? ''}` },
        { lines: [[second?.index ?? -1]], soft: [false], text: '' },
      ]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      // EVERY WORD in the Type 3 font: none is new, so none went to the ordinary sibling. CONTROL, the per-run key: the
      // second heading's words were new to the first heading's run and were set in F5, which F5 carries.
      expect(inserted(result.value).join('\n')).not.toContain('/F5 28 Tf');
    });
  });

  it('CONTROL: words another font drew, joined into a Type 3 line, go to an ordinary face though its subset holds the letters', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const heading = page.runs[0];
      const body = page.runs.find((run) => run.text === 'Body text in the regular face.');
      // EVERY LETTER of the words joined is in the Type 3 subset, so a key blind to the font would draw them there.
      const joined = 'text in the face.';
      expect(Array.from(joined.replaceAll(' ', '')).every((character) => [...(fonts.get('F4')?.toUnicode?.text.values() ?? [])].includes(character))).toBe(true);
      const result = editOperators(content, fonts, page, [
        { lines: [[heading?.index ?? -1]], soft: [false], text: `${heading?.text ?? ''} ${joined}` },
        { lines: [[body?.index ?? -1]], soft: [false], text: '' },
      ]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(inserted(result.value)[0]).toContain('/F5 28 Tf');
    });
  });

  it('Find & replace and a spelling correction put the new word in an ordinary face too: one writer, every route', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      const heading = page.runs[0];
      const block = { lines: [{ runs: [{ index: heading?.index ?? -1, text: heading?.text ?? '' }], soft: false }] };
      const matchesIn = (words: string) => {
        const at = words.indexOf('heading');
        return at < 0 ? [] : [{ offset: at, length: 'heading'.length }];
      };
      // REPLACE ALL, and a SPELLING CORRECTION of the one occurrence: the routes' own builder of what the writer is sent.
      for (const only of [undefined, { block: 0, occurrence: 0 }]) {
        const edits = blocksReplaced([block], matchesIn, 'reading', only);
        expect(edits.map((each) => each.text)).toStrictEqual(['Monstera fixture reading.']);
        const result = editOperators(content, fonts, page, edits);
        if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
        const [object = ''] = inserted(result.value);
        expect(object.indexOf('/F5 28 Tf')).toBeGreaterThan(object.indexOf('/F4 28 Tf'));
      }
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

  it('passes over a font of another WEIGHT or another FACE, each sorted first and carrying the letter (SSSSSSS-16)', async () => {
    await chromium((content, fonts) => {
      // EVERY FIXTURE FONT WAS WEIGHT 400 NAMED `Face`, and the print's two agree, so either clause of the sibling rule
      // could be `true` and nothing failed. Two decoys that sort before the real sibling `F5` and draw every letter: one
      // of the run's face at 700, one of another face stating no weight.
      const own = fonts.get('F4');
      if (own?.face === null || own === undefined) throw new Error('the print names no face for its heading font');
      const letters = 'Monstera fixture really.';
      const with_ = (extra: readonly PageFont[]) => new Map([...fonts, ...extra.map((each) => [each.resource, each] as const)]);
      const firstSet = (all: ReadonlyMap<string, PageFont>) => {
        const page = runsOf(content, all);
        const result = editOperators(content, all, page, [{ lines: [[page.runs[0]?.index ?? -1]], soft: [false], text: letters }]);
        if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
        return inserted(result.value)[0] ?? '';
      };
      const heavier = { ...font('A0', letters, 0.5, own.face), weight: 700 };
      const otherFace = { ...font('A1', letters, 0.5, 'Another'), weight: null };
      expect(firstSet(with_([heavier, otherFace]))).toContain('/F5 28 Tf');
      // CONTROLS: the same decoys made acceptable — the run's weight, the run's face — are chosen, as they sort first. So
      // the sibling above is the clauses' doing and not the order's.
      expect(firstSet(with_([{ ...heavier, weight: 400 }]))).toContain('/A0 28 Tf');
      expect(firstSet(with_([{ ...otherFace, face: own.face }]))).toContain('/A1 28 Tf');
    });
  });

  it('sets a word the page cannot carry in the fonts the caller adds, keeping the letters the page does carry in its own (ADR-0177)', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      // THE CALLER'S ADDED FONT, a two-byte font as `cidFont.ts` writes one: a code per letter it is asked for.
      const { faces, face, asked } = resolverFaces();
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

  it('wraps a line typed past its block onto a new line a pitch below', async () => {
    await chromium((content, fonts) => {
      const page = runsOf(content, fonts);
      // THE NEW WORDS go to an ordinary face (ADR-0176's correction of 2026-10-25), so the resolver is given, as the app gives it.
      const { faces, face } = resolverFaces();
      const result = editOperators(
        content,
        fonts,
        page,
        [{ lines: [[page.runs[0]?.index ?? -1]], soft: [false], text: 'Monstera fixture heading reads the same reading' }],
        faces,
      );
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(checkOperatorEdit(content, result.value, new Map([...fonts, ['MonsteraFace1', face]])).ok).toBe(true);
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

  it('moves every line below a wrap down by the block’s pitch', () => {
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

  it('CARRIES a line a wrap moves down as its own operators, kerning and codes and all: only its position changes (ADR-0266)', () => {
    // THE SECOND LINE IS KERNED, which a re-setting of its words would lose: `def` set again is `(def) Tj`.
    const kerned = bytes(THREE_LINES.replace('(def) Tj', '[(d) -120 (ef)] TJ'));
    const runs = runsOf(kerned, fonts);
    const result = editOperators(kerned, fonts, runs, block('abc abc\ndef\nghi'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(checkOperatorEdit(kerned, result.value, fonts).ok).toBe(true);
    const object = inserted(result.value)[0] ?? '';
    expect(object).toContain('[<64> -120 <6566>] TJ');
    // ONLY THE WORDS THE EDIT SET are MuPDF's to read back: the wrapped `abc`, never the two lines carried as they were.
    expect(result.value.checked).toStrictEqual(['abc']);
    // CONTROL: a line whose words DO change is set, and is read back.
    const changed = editOperators(kerned, fonts, runs, block('abc abc\ndex\nghi'));
    if (!changed.ok) throw new Error(`refused: ${JSON.stringify(changed.error)}`);
    expect(changed.value.checked).toContain('dex');
    expect(changed.value.checked).not.toContain('ghi');
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
    // AFTER THE LAST LINE'S OBJECT, so a reader taking the page in content order reads the new line after the ones it
    // follows (ADR-0188): no operator was emptied to place it by, and the line is not before the one it comes below.
    const text = latin1(result.value.content);
    expect(text).toContain('(ghi) Tj ET\nq BT');
    // CONTROL: it is not in front of the last line, where it would be read before it.
    expect(text.indexOf('(ghi) Tj')).toBeLessThan(text.indexOf('<6A6B6C> Tj'));
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

  // A LINE SET IN ITS OWN `q 1 0 0 1 x y cm … Q`, as some producers write every line: the lines differ by a translation,
  // which one inserted object reproduces, each line written where the page drew it (measured 2026-10-23: 25 blocks of one
  // corpus document were refused every edit before).
  const firstShifted = bytes(THREE_LINES.replace('BT /F1 20 Tf 1 0 0 -1 72 300', 'q 1 0 0 1 5 0 cm BT /F1 20 Tf 1 0 0 -1 72 300').replace('(abc) Tj ET', '(abc) Tj ET Q'));

  it('edits a block whose lines differ by a translation, writing the line where the page drew it', () => {
    const result = editOperators(firstShifted, fonts, runsOf(firstShifted, fonts), block('abc\ndef\nghx'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(result.value.emptied).toStrictEqual([2]);
    expect(checkOperatorEdit(firstShifted, result.value, fonts).ok).toBe(true);
    // THE THIRD LINE STANDS UNDER THE PAGE'S OWN CTM, where its new object goes: at 72, as it was. Converted through the
    // shifted first line's CTM instead, it would be written at 67 and drawn 3.75 points to the left of where it was.
    expect(inserted(result.value)[0]).toContain('1 0 0 -1 72 360 Tm');
  });

  it('and writes a line of the shifted one under its own translation', () => {
    const result = editOperators(firstShifted, fonts, runsOf(firstShifted, fonts), block('abx\ndef\nghi'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    // THE FIRST LINE'S NEW OBJECT stands inside its `q … cm`, so its own text space is the one the line had.
    expect(inserted(result.value)[0]).toContain('1 0 0 -1 72 300 Tm');
    expect(checkOperatorEdit(firstShifted, result.value, fonts).ok).toBe(true);
  });

  it('writes a block whose lines differ in SCALE, the scaled line’s text matrix carrying the difference (2026-10-24)', () => {
    // The third line under its own `2 0 0 2 0 0 cm` on top of the page's 0.75: drawn at 1.5 times its text matrix. Edited
    // with the first, the new object stands where the first did, under 0.75, so the third line's text matrix must be
    // twice its own to draw at the same size: (1 0 0 -1) times 1.5 times the inverse of 0.75 is (2 0 0 -2).
    const scaled = bytes(THREE_LINES.replace('BT /F1 20 Tf 1 0 0 -1 72 360', 'q 2 0 0 2 0 0 cm BT /F1 20 Tf 1 0 0 -1 72 360').concat(' Q'));
    const result = editOperators(scaled, fonts, runsOf(scaled, fonts), block('abx\ndef\nghx'));
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(checkOperatorEdit(scaled, result.value, fonts).ok).toBe(true);
    const [object = ''] = inserted(result.value);
    // AT 144, 720 under 0.75: the page point 108, 252 its own 1.5 put it at.
    expect(object).toMatch(/^2 0 0 -2 144 720 Tm <676878>/mu);
    // CONTROL: the first line, drawn under the CTM the object stands in, keeps its own text matrix.
    expect(object).toMatch(/^1 0 0 -1 72 300 Tm <616278>/mu);
  });

  it('refuses a block whose shifted line is drawn through a clip the first line is not', () => {
    // THE SAME TRANSLATION AS ABOVE, and a clip inside it: the new object stands where the first line did, outside the clip.
    const clipped = bytes(
      THREE_LINES.replace('BT /F1 20 Tf 1 0 0 -1 72 360', 'q 1 0 0 1 5 0 cm 0 0 400 400 re W n BT /F1 20 Tf 1 0 0 -1 72 360').concat(' Q'),
    );
    expect(editOperators(clipped, fonts, runsOf(clipped, fonts), block('abc\ndef\nghx'))).toStrictEqual({
      ok: false,
      error: { reason: 'transformed', where: 'lines-under-different-ctms' },
    });
  });

  it('answers unchanged for an edit that changes nothing', () => {
    expect(editOperators(content, fonts, page, block('abc\ndef\nghi'))).toStrictEqual({ ok: false, error: { reason: 'unchanged' } });
  });
});

describe('a glyph the page draws with a code its font names no text for is the page’s own font’s (ADR-0270 Decision 3)', () => {
  // THE SHAPE MEASURED IN THE OWNER'S DOCUMENT 2 (2026-10-24): a Type 3 glyph PDFium reads as U+073C that no font on the
  // page maps, so typing beside it was refused as a character no face carries. Here code 0x41 draws and has a width, its
  // font's ToUnicode names `a` and `b` only, and PDFium reads the run as `abQ`.
  const own = font('F1', 'ab');
  const drawsA: PageFont = { ...own, width: (code) => (code === 0x41 ? 0.5 : own.width(code)), draws: (code) => code === 0x41 || own.draws(code) };
  const declared = new Map([['F1', drawsA]]);
  const content = bytes('BT /F1 10 Tf 1 0 0 1 72 100 Tm (abA) Tj ET');
  const page: PageRuns = { textObjects: [0], runs: [inked(0, 'abQ', 72, 87)] };
  // THE SAME WIDTH AS THE LINE, so nothing wraps and the line is set again where it stood.
  const edit = [{ lines: [[0]], soft: [false], text: 'baQ' }];

  it('learns the code from PDFium’s reading, and sets the character in the page’s own font with it', () => {
    const asRead = pageFontsAsRead(declared, content, page);
    expect(asRead.get('F1')?.toUnicode?.text.get(0x41)).toBe('Q');
    const result = editOperators(content, asRead, page, edit);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(inserted(result.value)[0]).toContain('<626141>');
    // AND THE CHECK READS IT AS THE WRITER SET IT, from the same fonts: no defect to note.
    expect(checkOperatorEdit(content, result.value, asRead)).toStrictEqual({ ok: true, value: undefined });
  });

  it('CONTROL: with the fonts as the page declares them the character has no carrier, which is the refusal it was', () => {
    expect(editOperators(content, declared, page, edit)).toStrictEqual({ ok: false, error: { reason: 'needs-a-face', characters: ['Q'] } });
  });

  it('learns a code PDFium reads as TWO characters, and sets those two with it — the document’s own glyph', () => {
    // The shape measured: one glyph read as `=` and U+073C. Here the last code is read as `QZ`.
    const twice: PageRuns = { textObjects: [0], runs: [inked(0, 'abQZ', 72, 87)] };
    const asRead = pageFontsAsRead(declared, content, twice);
    expect(asRead.get('F1')?.toUnicode?.text.get(0x41)).toBe('QZ');
    const result = editOperators(content, asRead, twice, [{ lines: [[0]], soft: [false], text: 'baQZ' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(inserted(result.value)[0]).toContain('<626141>');
  });

  it('CONTROL: two unnamed codes side by side teach nothing — how their characters split would be a guess', () => {
    const both = bytes('BT /F1 10 Tf 1 0 0 1 72 100 Tm (aAA) Tj ET');
    const read: PageRuns = { textObjects: [0], runs: [inked(0, 'aQZ', 72, 87)] };
    expect(pageFontsAsRead(declared, both, read)).toBe(declared);
  });

  it('CONTROL: a run whose named codes do not read as PDFium reads them teaches nothing', () => {
    // `b` is named `b` and PDFium reads `x` there: the run does not line up, so the unnamed code after it is not learned.
    const misread: PageRuns = { textObjects: [0], runs: [inked(0, 'axQ', 72, 87)] };
    expect(pageFontsAsRead(declared, content, misread)).toBe(declared);
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

describe('the new object goes where the block’s kept words before the edit end (ADR-0176, corrected 2026-10-19; R13)', () => {
  // A BULLETED LINE AS CHROMIUM DRAWS ONE: the bold lead-in in its own text object, then ` x ` (a dash) and the rest in
  // the next, each a run as PDFium joins them.
  const content = bytes('BT /F2 10 Tf 1 0 0 1 72 100 Tm (lead ) Tj ET\nBT /F1 10 Tf 1 0 0 1 100 100 Tm (x ) Tj 10 0 Td (rest of it) Tj ET');
  const fonts = new Map([
    ['F1', font('F1', 'abcdefghijklmnopqrstuvwxyz')],
    ['F2', font('F2', 'abcdefghijklmnopqrstuvwxyz')],
  ]);
  const page: PageRuns = {
    textObjects: [0, 1, 2],
    runs: [
      { index: 0, members: [0], text: 'lead ', left: 72, right: 92, bottom: 0, top: 0 },
      { index: 1, members: [1], text: 'x ', left: 100, right: 110, bottom: 0, top: 0 },
      { index: 2, members: [2], text: 'rest of it', left: 110, right: 400, bottom: 0, top: 0 },
    ],
  };

  it('an edit AFTER the dash puts the new words after the object that keeps the dash, so the line reads in order', () => {
    const result = editOperators(content, fonts, page, [{ lines: [[0, 1, 2]], soft: [false], text: 'lead x rest of them' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    const written = latin1(result.value.content);
    // THE DASH'S OBJECT ENDS, and then the new object begins: content order is reading order.
    expect(written.indexOf('(x ) Tj'), written).toBeGreaterThan(-1);
    expect(written.indexOf('q BT')).toBeGreaterThan(written.indexOf('(x ) Tj'));
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
  });

  it('a letter typed BEFORE a full stop drawn in a font of its own is written, not dropped (R13)', () => {
    // THE FULL STOP IN A SUBSET THAT HOLDS ONLY IT, as Chromium splits a line's punctuation into its own Type 3 font.
    const stop: PageFont = { ...font('F3', ''), toUnicode: { text: new Map([[46, '.']]), bytes: 1 }, width: (code) => (code === 46 ? 0.25 : null), draws: (code) => code === 46 };
    const withStop = bytes('BT /F2 10 Tf 1 0 0 1 72 100 Tm (lead ) Tj ET\nBT /F1 10 Tf 1 0 0 1 100 100 Tm (x ) Tj 10 0 Td (rest of it) Tj /F3 10 Tf 50 0 Td (.) Tj ET');
    const stopFonts = new Map([...fonts, ['F3', stop]]);
    const stopPage: PageRuns = {
      textObjects: [0, 1, 2, 3],
      runs: [...page.runs, { index: 3, members: [3], text: '.', left: 160, right: 163, bottom: 0, top: 0 }],
    };
    const result = editOperators(withStop, stopFonts, stopPage, [{ lines: [[0, 1, 2, 3]], soft: [false], text: 'lead x rest of its.' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(result.value.drawn.join(''), latin1(result.value.content)).toContain('s.');
    // THE FULL STOP STAYS IN ITS OWN FONT, the `s` in the sibling that carries it: the page's own setting, no face added.
    const object = latin1(result.value.content).slice(latin1(result.value.content).indexOf('q BT'));
    expect(object).toContain('/F3 10 Tf');
    expect(object).toContain('/F1 10 Tf');
    expect(checkOperatorEdit(withStop, result.value, stopFonts).ok).toBe(true);
  });

  it('CONTROL: an edit of the LEAD-IN, whose object holds nothing kept before it, still goes before its BT', () => {
    const result = editOperators(content, fonts, page, [{ lines: [[0, 1, 2]], soft: [false], text: 'load x rest of it' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    const written = latin1(result.value.content);
    expect(written.indexOf('q BT')).toBeLessThan(written.indexOf('BT /F2'));
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

    describe('an underlined word edited AGAIN keeps its one underline (the owner’s L2, 2026-10-25)', () => {
      const underlined = (): Uint8Array => {
        const result = marked({ underline: true });
        if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
        return result.value.content;
      };
      /** PDFium's reading of a page this writer wrote: each operator that shows codes one run, inked where it is drawn. */
      const reread = (written: Uint8Array): PageRuns => {
        const ops = showOperators(written).filter((op) => op.object !== null);
        return {
          textObjects: Array.from({ length: textObjectCount(showOperators(written)) }, (_, at) => at),
          runs: ops.map((op) => inked(op.object ?? 0, said(op, fonts), op.state.matrix[4], op.state.matrix[4] + 5 * op.codes.length)),
        };
      };
      const again = (written: Uint8Array, text: string, marks?: EditedMarks) => {
        const read = reread(written);
        const result = editOperators(written, fonts, read, [{ lines: [read.runs.map((run) => run.index)], soft: [false], text, ...(marks === undefined ? {} : { marks }) }]);
        if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
        expect(checkOperatorEdit(written, result.value, fonts).ok).toBe(true);
        return result.value.content;
      };
      const rules = (written: Uint8Array) => operatorsAndDecorations(written).decorations;

      it('writes the rule MARKED, so a read gives it back to the words it is under', () => {
        expect(rules(underlined())).toMatchObject([{ kind: 'under', left: 92, right: 107 }]);
      });

      it('takes the old rule away and draws the one rule where the word now stands, when words are typed before it', () => {
        const moved = again(underlined(), 'zz aaa bbb ccc');
        // `zz ` is three letters at 5: the word, and its one rule, 15 further on.
        expect(rules(moved)).toMatchObject([{ kind: 'under', left: 107, right: 122 }]);
        expect(latin1(moved).match(/ re f /gu)).toHaveLength(1);
      });

      it('takes it off where a mark says so, and leaves none behind', () => {
        const off = again(underlined(), 'aaa bbb ccc', [{ from: 4, to: 7, set: { underline: false } }]);
        expect(rules(off)).toStrictEqual([]);
        expect(latin1(off)).not.toContain(' re f ');
      });

      it('draws ONE rule under underlined words across a space their font cannot draw, as the editor draws it', () => {
        // A FONT WITH NO SPACE: the space between the words moves the pen and is no segment.
        const spaceless: PageFont = { ...regular, toUnicode: { text: new Map([...(regular.toUnicode?.text ?? [])].filter(([code]) => code !== 32)), bytes: 1 }, draws: (code) => code !== 32 && regular.draws(code) };
        const two = bytes('BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa) Tj ET\nBT /F1 10 Tf 1 0 0 1 92 100 Tm (bbb) Tj ET');
        const read: PageRuns = { textObjects: [0, 1], runs: [inked(0, 'aaa ', 72, 87), inked(1, 'bbb', 92, 107)] };
        const under = (marks: EditedMarks): Uint8Array => {
          const result = editOperators(two, new Map([['F1', spaceless]]), read, [{ lines: [[0, 1]], soft: [false], text: 'aaa bbb', marks }]);
          if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
          return result.value.content;
        };
        const one = rules(under([{ from: 0, to: 7, set: { underline: true } }]));
        expect(one).toHaveLength(1);
        expect(one[0]?.left).toBe(72);
        expect(one[0]?.right).toBeGreaterThan(100);
        // CONTROL: two words underlined in two colours are two rules, so the case above joined them for being one stretch.
        const twoColours = under([
          { from: 0, to: 3, set: { underline: true, colour: { r: 255, g: 0, b: 0 } } },
          { from: 4, to: 7, set: { underline: true, colour: { r: 0, g: 0, b: 255 } } },
        ]);
        expect(rules(twoColours)).toHaveLength(2);
      });

      it('CONTROL: a rectangle carrying no mark is a drawing — left where it is, and never drawn again with the words', () => {
        const unmarked = bytes(latin1(underlined()).replace(/\/Artifact <<\/MonsteraDecoration \(under\)>> BDC (q [^Q]* Q) EMC/u, '$1'));
        expect(rules(unmarked)).toStrictEqual([]);
        const moved = again(unmarked, 'zz aaa bbb ccc');
        expect(rules(moved)).toStrictEqual([]);
        expect(latin1(moved).match(/ re f /gu)).toHaveLength(1);
        expect(latin1(moved)).toMatch(/q 0 0 0 rg 92 [\d.]+ 15 [\d.]+ re f Q/u);
      });
    });

    it('draws a line THROUGH struck words at STRIKE_RISE, as wide as they are (ADR-0228)', () => {
      // `bbb` at 92, 15 wide; the line 2.6 above the baseline (0.26 of 10) and 0.6 thick.
      expect(object({ strike: true })).toMatch(/q 0 0 0 rg 92 102\.6 15 0\.6 re f Q/u);
      // CONTROL: an underline is the same rule under the baseline, so the case above is the strike's place.
      expect(object({ underline: true })).not.toMatch(/ 102\.6 15 /u);
    });

    it('draws a highlight in its colour BEHIND the words: before the BT, from under the descenders to over the capitals', () => {
      const written = object({ highlight: { r: 255, g: 255, b: 0 } });
      const rect = /q 1 1 0 rg 92 97\.6 15 11\.4 re f Q/u.exec(written);
      expect(rect).not.toBeNull();
      expect(written.indexOf(rect?.[0] ?? '')).toBeLessThan(written.indexOf('BT'));
      // CONTROL: the colour mark paints the words, not a rectangle behind them.
      expect(object({ colour: { r: 255, g: 255, b: 0 } })).not.toContain(' re f Q');
    });

    it('sets character spacing as Tc, and says the page’s own again for the words after (ADR-0228)', () => {
      // -0.1 of 10 points is a point closer, in a space where one text-space unit is one point. TIGHTER, so the line
      // keeps its words: a wider `bbb` no longer fits the measure and `ccc` wraps, which is the layout being right.
      const written = object({ spacing: -0.1 });
      expect(written).toContain('-1 Tc');
      expect(written.indexOf('0 Tc', written.indexOf('-1 Tc') + 5)).toBeGreaterThan(written.indexOf('-1 Tc'));
      // THE SPACE AFTER `bbb` STARTS 3 POINTS SOONER: its three letters each a point closer.
      expect(written).toContain('1 0 0 1 104 100 Tm');
      // CONTROL: no spacing asked, no Tc said, and the space where the letters' own advances put it.
      const plain = object({ colour: { r: 255, g: 0, b: 0 } });
      expect(plain).not.toContain('Tc');
      expect(plain).toContain('1 0 0 1 107 100 Tm');
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
        isBold: statedBold,
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

  it('does not wrap a line of code that grows past the block: it widens, one command one line (ADR-0096, corrected 2026-10-25)', () => {
    // TWO COMMANDS, hard-ended, in a fixed-pitch face: `aaa bbb` (35 wide) over `ccc` (15 wide). A word added to the first
    // makes it 60 wide, past the block's 35.
    const content = bytes(['BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa bbb) Tj ET', 'BT /F1 10 Tf 1 0 0 1 72 88 Tm (ccc) Tj ET'].join('\n'));
    const baselines = (fixed: boolean): string[] => {
      const run = (index: number, text: string, right: number): PageRun => ({ ...inked(index, text, 72, right), ...(fixed ? { fixedPitch: true as const } : {}) });
      const page: PageRuns = { textObjects: [0, 1], runs: [run(0, 'aaa bbb', 107), run(1, 'ccc', 87)] };
      const result = editOperators(content, fonts, page, [{ lines: [[0], [1]], soft: [false, false], text: 'aaa bbb ddddd\nccc' }]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
      // EACH LINE'S BASELINE, by the y of the matrices the new object sets.
      return [...new Set([...(inserted(result.value)[0] ?? '').matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/gu)].map((match) => match[1] ?? ''))];
    };
    // ONE LINE for the grown command, on its own baseline: `ccc` is not set again, so only the first line's is written.
    expect(baselines(true)).toStrictEqual(['100']);
    // CONTROL: the same runs not fixed pitch are prose, and the grown line wraps onto a second baseline.
    expect(baselines(false).length).toBeGreaterThan(1);
  });

  it('writes words past the page’s own clip where it would hide them (ADR-0266, corrected 2026-10-25)', () => {
    // A ONE-LETTER CELL just above its clip's bottom edge, as the corpus's table cell sat: words added wrap below the clip.
    const cell = (clip: string) => bytes(`q ${clip} re W n BT /F1 10 Tf 1 0 0 1 72 52 Tm (a) Tj ET Q\nBT /F1 10 Tf 1 0 0 1 300 400 Tm (z) Tj ET`);
    const read: PageRuns = { textObjects: [0, 1], runs: [inked(0, 'a', 72, 77), inked(1, 'z', 300, 305)] };
    const placedAt = (clip: string) => {
      const content = cell(clip);
      const result = editOperators(content, fonts, read, [{ lines: [[0]], soft: [false], text: 'a bbb ccc' }]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
      const written = latin1(result.value.content);
      // THE ADDED WORDS' FIRST LETTER: in a cell one letter wide each letter is a line of its own.
      return { object: written.indexOf('<62> Tj'), clipEnds: written.indexOf('Q\n') };
    };
    // THE CELL'S CLIP, its bottom at 50: the wrapped lines fall below it, so the object goes past its `Q`.
    const hidden = placedAt('0 50 200 30');
    expect(hidden.object).toBeGreaterThan(hidden.clipEnds);
    // CONTROL: a clip that holds every line — the letters run down to y = -20 — and the object stays inside it, before its
    // `Q`, as always.
    const held = placedAt('0 -100 612 892');
    expect(held.object).toBeLessThan(held.clipEnds);
  });

  it('JUSTIFIES a wrapped line by widening its spaces, capped, and leaves the paragraph’s last line alone (ADR-0228)', () => {
    // `aaa bbb` (35 wide) over `cccccccccccc` (60 wide), one paragraph: the measure is 60, so the first line has 25 to
    // spare over its one space, which the cap holds to 0.6 of the size, 6.
    const content = bytes(['BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa bbb) Tj ET', 'BT /F1 10 Tf 1 0 0 1 72 88 Tm (cccccccccccc) Tj ET'].join('\n'));
    const page: PageRuns = { textObjects: [0, 1], runs: [inked(0, 'aaa bbb', 72, 107), inked(1, 'cccccccccccc', 72, 132)] };
    const edit = (align: 'justify' | 'left') =>
      editOperators(content, fonts, page, [
        { lines: [[0], [1]], soft: [true, false], text: 'aaa bbb cccccccccccc', paragraphs: [{ paragraph: 0, align }] },
      ]);
    const justified = edit('justify');
    if (!justified.ok) throw new Error(`refused: ${JSON.stringify(justified.error)}`);
    const [object = ''] = inserted(justified.value);
    // `bbb` AT 98: 72, `aaa` 15, the space 5 and the 6 it gained.
    expect(object).toContain('1 0 0 1 98 100 Tm <626262>');
    // THE LAST LINE IS NOT STRETCHED: `cccccccccccc` from the left edge, one segment.
    expect(object).toContain('1 0 0 1 72 88 Tm <636363636363636363636363>');
    // CONTROL: the same edit set left puts `bbb` where the letters' own advances do, so the 6 is the justify's.
    const left = edit('left');
    expect(left.ok).toBe(false);
  });

  it('sets a TAB as a marked space and the next words at the next stop from the block’s left (ADR-0228)', () => {
    // A LINE WIDE ENOUGH for the tab at its widest, a whole stop, so the edit stays one line.
    const content = bytes('BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa bbb ccc ddd eee) Tj ET');
    const page: PageRuns = { textObjects: [0], runs: [inked(0, 'aaa bbb ccc ddd eee', 72, 167)] };
    const result = editOperators(content, fonts, page, [{ lines: [[0]], soft: [false], text: 'aaa\tbbb' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    const [object = ''] = inserted(result.value);
    // THE GAP: one space where `aaa` ends (72 + 15), said to be a tab.
    expect(object).toContain('/Span <</ActualText <FEFF0009>>> BDC 1 0 0 1 87 100 Tm <20> Tj EMC');
    // `bbb` AT THE FIRST STOP, 36 from the block's left edge.
    expect(object).toContain('1 0 0 1 108 100 Tm <626262>');
    // CONTROL: a space there sets `bbb` a space on, and nothing is marked.
    const spaced = editOperators(content, fonts, page, [{ lines: [[0]], soft: [false], text: 'aaa bbb' }]);
    if (!spaced.ok) throw new Error(`refused: ${JSON.stringify(spaced.error)}`);
    expect(inserted(spaced.value)[0]).not.toContain('ActualText');
  });

  it('sets a RUN OF TWO OR MORE SPACES as a segment of its own, marked as exactly those spaces (ADR-0228, 2026-10-16)', () => {
    const content = bytes('BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa bbb ccc ddd eee) Tj ET');
    const page: PageRuns = { textObjects: [0], runs: [inked(0, 'aaa bbb ccc ddd eee', 72, 167)] };
    const result = editOperators(content, fonts, page, [{ lines: [[0]], soft: [false], text: 'aaa  bbb   ccc' }]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    const [object = ''] = inserted(result.value);
    // THE TWO SPACES where `aaa` ends (72 + 15), and the three where `bbb` ends (87 + 10 + 15), each its own segment.
    expect(object).toContain('/Span <</ActualText <FEFF00200020>>> BDC 1 0 0 1 87 100 Tm <2020> Tj EMC');
    expect(object).toContain('/Span <</ActualText <FEFF002000200020>>> BDC 1 0 0 1 112 100 Tm <202020> Tj EMC');
    // THE WORDS stand alone, where the spaces' advances end, never joined to a marked run.
    expect(object).toContain('1 0 0 1 97 100 Tm <626262> Tj');
    expect(object).toContain('1 0 0 1 127 100 Tm <636363> Tj');
    // CONTROL: single spaces stay in the words' segment, and nothing is marked.
    const single = editOperators(content, fonts, page, [{ lines: [[0]], soft: [false], text: 'aaa bbb ccc' }]);
    if (!single.ok) throw new Error(`refused: ${JSON.stringify(single.error)}`);
    expect(inserted(single.value)[0]).not.toContain('ActualText');
    expect(inserted(single.value)[0]).toContain('<6161612062626220636363> Tj');
  });

  it('puts SPACE AFTER a paragraph above the next one’s first line, and nothing above a line within it (ADR-0228)', () => {
    const content = bytes(['BT /F1 10 Tf 1 0 0 1 72 100 Tm (aaa) Tj ET', 'BT /F1 10 Tf 1 0 0 1 72 88 Tm (bbb) Tj ET'].join('\n'));
    const page: PageRuns = { textObjects: [0, 1], runs: [inked(0, 'aaa', 72, 87), inked(1, 'bbb', 72, 87)] };
    const result = editOperators(content, fonts, page, [
      { lines: [[0], [1]], soft: [false, false], text: 'aaa\nbbb', paragraphs: [{ paragraph: 0, spaceAfter: 10 }] },
    ]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    // `bbb` 10 LOWER than the 12 the lines were apart: 100 - 22.
    expect(inserted(result.value)[0]).toContain('1 0 0 1 72 78 Tm <626262>');
    // CONTROL: the same paragraphs with nothing set are unchanged, so the 10 is the setting's.
    const plain = editOperators(content, fonts, page, [{ lines: [[0], [1]], soft: [false, false], text: 'aaa\nbbb' }]);
    expect(plain).toStrictEqual({ ok: false, error: { reason: 'unchanged' } });
  });

  describe('a line set afresh starts where the paragraph sets it, as the editor draws it', () => {
    // The shape measured in the owner's document 12 (2026-10-24): one paragraph whose lines after the first do not all
    // keep its left edge. `aaaaa` and `bbb` stand at 92, `cccccccccc` at 72 and reaches 122, the right edge; their centres
    // differ by more than a character, so it is left-aligned with a first-line indent of 20, as that page's was. Typing `a`
    // for `aaaaa` pulls `bbb` up into the first line (25 of the 30 its indent leaves), and nine `c` for ten makes the
    // second line new words, 45 wide — not the old third line carried up, which keeps its own place whatever this rule.
    const content = (second: number): Uint8Array =>
      bytes(
        [
          'BT /F1 10 Tf 1 0 0 1 92 100 Tm (aaaaa) Tj ET',
          `BT /F1 10 Tf 1 0 0 1 ${String(second)} 88 Tm (bbb) Tj ET`,
          'BT /F1 10 Tf 1 0 0 1 72 76 Tm (cccccccccc) Tj ET',
        ].join('\n'),
      );
    const page = (second: number): PageRuns => ({
      textObjects: [0, 1, 2],
      runs: [inked(0, 'aaaaa', 92, 117), inked(1, 'bbb', second, second + 15), inked(2, 'cccccccccc', 72, 122)],
    });
    const edited = (second: number): string => {
      const result = editOperators(content(second), fonts, page(second), [
        { lines: [[0], [1], [2]], soft: [true, true, false], text: 'a bbb ccccccccc' },
      ]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      return inserted(result.value).join('\n');
    };

    it('sets the refilled line from the left edge, never from its own start 20 to the right, so it ends at the right edge', () => {
      const written = edited(92);
      expect(written).toContain('1 0 0 1 72 88 Tm <636363636363636363>');
      // From its own start it would have ended at 137, fifteen past the block's right.
      expect(written).not.toContain('1 0 0 1 92 88 Tm');
    });

    it('CONTROL: a line whose start differs from the edge by a side bearing keeps its own start', () => {
      // 72.3 is within one character (5) of the edge: the line stands at the edge, and is written where it was.
      expect(edited(72.3)).toContain('1 0 0 1 72.3 88 Tm <636363636363636363>');
    });
  });

  it('sets each paragraph from its OWN left edge: a bulleted item at 92 beside a plain paragraph at 72 (ADR-0179, 2026-10-24)', () => {
    // The shape measured in the owner's document 8: one block, an item whose lines stand at 92 and a paragraph at 72 that
    // reaches the right edge, 132. A word typed at the end of the item's FIRST line refills it within the 40 its own edge
    // leaves: `aaa bbb`, then `eee ccc` from 92. Measured from the block's leftmost line, 72, the first line takes
    // `aaa bbb eee` (55) and, drawn from 92, ends at 147, fifteen past the right.
    const content = bytes(
      [
        'BT /F1 10 Tf 1 0 0 1 92 100 Tm (aaa bbb) Tj ET',
        'BT /F1 10 Tf 1 0 0 1 92 88 Tm (ccc) Tj ET',
        'BT /F1 10 Tf 1 0 0 1 72 76 Tm (dddddddddddd) Tj ET',
      ].join('\n'),
    );
    const page: PageRuns = {
      textObjects: [0, 1, 2],
      runs: [inked(0, 'aaa bbb', 92, 127), inked(1, 'ccc', 92, 107), inked(2, 'dddddddddddd', 72, 132)],
    };
    const result = editOperators(content, fonts, page, [
      { lines: [[0], [1], [2]], soft: [true, false, false], text: 'aaa bbb eee ccc\ndddddddddddd' },
    ]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    const written = inserted(result.value).join('\n');
    // `eee` OPENS THE SECOND LINE, from the item's own edge.
    expect(written).toMatch(/^1 0 0 1 92 88 Tm <656565/mu);
    expect(written).not.toMatch(/^1 0 0 1 72 88 Tm/mu);
    // CONTROL: the plain paragraph, untouched, is not written at all; and nothing of the item reaches past 132.
    expect(written).not.toContain('<646464');
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

  describe('an edit of several blocks, each inserted object read against its own words (2026-10-24)', () => {
    // THE BLOCKS EDITED IN THE OPPOSITE ORDER TO THE ONE THEY SIT IN: a replace of every match edits in the order it is
    // given, and each new object goes where its own lines are. Read as one
    // concatenation in the edit's order, `dexabx` against the `abxdex` the content draws, every such edit was refused.
    const two = bytes(['BT /F1 10 Tf 1 0 0 1 72 300 Tm (abc) Tj ET', 'BT /F1 10 Tf 1 0 0 1 72 100 Tm (def) Tj ET'].join('\n'));
    const both = editOperators(two, fonts, runsOf(two, fonts), [
      { lines: [[1]], soft: [false], text: 'dex' },
      { lines: [[0]], soft: [false], text: 'abx' },
    ]);

    it('makes the edit, and it reads back', () => {
      if (!both.ok) throw new Error(`refused: ${JSON.stringify(both.error)}`);
      expect(both.value.drawn).toStrictEqual(['abx', 'dex']);
      expect(checkOperatorEdit(two, both.value, fonts)).toStrictEqual({ ok: true, value: undefined });
    });

    it('a block that GROWS onto a second line leaves the block below it byte for byte where it was (ADR-0271 section 11.1)', () => {
      // THE FIRST BLOCK ONE LINE AT 300, wrapped onto a second by a newline typed in it; the block below at 290, one line
      // under it, which the grown block now overlaps.
      const page = bytes(['BT /F1 10 Tf 1 0 0 1 72 300 Tm (abc) Tj ET', 'BT /F1 10 Tf 1 0 0 1 72 290 Tm (def) Tj ET'].join('\n'));
      const grown = editOperators(page, fonts, runsOf(page, fonts), [{ lines: [[0]], soft: [false], text: 'abc\nabx' }]);
      if (!grown.ok) throw new Error(`refused: ${JSON.stringify(grown.error)}`);
      expect(grown.value.baselines[0]?.last).toBeLessThan(300);
      const written = new TextDecoder('latin1').decode(grown.value.content);
      // THE BLOCK BELOW'S OWN INSTRUCTIONS, unchanged, and emptied by nothing.
      expect(written).toContain('BT /F1 10 Tf 1 0 0 1 72 290 Tm (def) Tj ET');
      expect(grown.value.emptied).not.toContain(1);
      expect(checkOperatorEdit(page, grown.value, fonts)).toStrictEqual({ ok: true, value: undefined });
    });

    it('CONTROL: words that read right only joined together are refused, object by object', () => {
      // `abxd` and `ex` join to `abxdex`, which a concatenation accepts; neither object draws its own entry.
      if (!both.ok) throw new Error(`refused: ${JSON.stringify(both.error)}`);
      expect(checkOperatorEdit(two, { ...both.value, drawn: ['abxd', 'ex'] }, fonts)).toStrictEqual({
        ok: false,
        error: 'the inserted text does not read as the words drawn',
      });
    });
  });
});

/**
 * A PLACEMENT AND AN ADDED BOX (ADR-0188), checked in USER SPACE: where the output's operators draw, through the CTM they
 * are under, which is what a reader sees and what neither the bytes nor the engine's reading state on their own.
 */
describe('a placement and an added box (ADR-0188)', () => {
  const content = bytes(THREE_LINES);
  const fonts = new Map([['F1', LETTERS]]);
  /** The page as PDFium would read it, with the INK stated: the first line's box in user space (0.75 of the text space). */
  const stated = (): PageRuns => {
    const read = runsOf(content, fonts);
    // THE FIRST LINE: origin (54, 567) in user space, 22.5 across (three letters of 10), reaching 12 above its baseline and 3 below.
    return {
      ...read,
      runs: read.runs.map((run, at) => {
        const baseline = 792 - 0.75 * (300 + 30 * at);
        return { ...run, left: 54, right: 76.5, bottom: baseline - 3, top: baseline + 12 };
      }),
    };
  };
  const placedBlock = (place: NonNullable<EditedBlockOf['place']>): EditedBlockOf => ({ lines: [[0]], soft: [false], text: 'abc', place });
  type EditedBlockOf = Parameters<typeof editOperators>[3][number];

  /** The origin each operator of `edit` inside an inserted object draws from, in user space. */
  const origins = (edit: OperatorEdit): { readonly x: number; readonly y: number; readonly a: number; readonly b: number }[] => {
    const spans = edit.changes.filter((change) => change.inserted).map((change) => change.after);
    return showOperators(edit.content)
      .filter((op) => spans.some((span) => op.start >= span.start && op.end <= span.end))
      .map((op) => {
        const m = multiplyMatrices(op.state.matrix, op.state.ctm);
        return { x: m[4] ?? 0, y: m[5] ?? 0, a: m[0] ?? 0, b: m[1] ?? 0 };
      });
  };
  const multiplyMatrices = (left: readonly number[], right: readonly number[]): readonly number[] => {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = left;
    const [A = 0, B = 0, C = 0, D = 0, E = 0, F = 0] = right;
    return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
  };
  const made = (blocks: Parameters<typeof editOperators>[3], faces?: OperatorFaces, inserts: Parameters<typeof editOperators>[6] = []) => {
    const result = editOperators(content, fonts, stated(), blocks, faces ?? null, 'reflow', inserts);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    expect(checkOperatorEdit(content, result.value, fonts).ok).toBe(true);
    return result.value;
  };

  it('moves a line by the points asked, in user space, whatever scale and flip the page is drawn under', () => {
    const [carried] = origins(made([placedBlock({ move: { x: 10, y: 5 } })]));
    // (54, 567) before; the page is drawn at 0.75 and flipped, and ten points across and five up are ten and five in user space.
    expect(carried?.x).toBeCloseTo(64, 3);
    expect(carried?.y).toBeCloseTo(572, 3);
  });

  it('scales a line about the block’s top left: its size changes, its top left does not, and its baseline comes up to it', () => {
    const [carried] = origins(made([placedBlock({ scale: 0.5 })]));
    // THE TOP LEFT IS (54, 579); the baseline at 567 is twelve below it and is six below it after.
    expect(carried?.x).toBeCloseTo(54, 3);
    expect(carried?.y).toBeCloseTo(573, 3);
    // AND THE GLYPHS ARE HALF AS WIDE: the line's own 0.75 is 0.375.
    expect(carried?.a).toBeCloseTo(0.375, 5);
  });

  it('turns a line about the centre of its extent', () => {
    const [carried] = origins(made([placedBlock({ rotate: 90 })]));
    // THE CENTRE is (65.25, 571.5): the extent is 54 to 76.5 across and 564 to 579 up. A quarter turn counter-clockwise
    // takes the origin (54, 567), which is (-11.25, -4.5) from it, to (-(-4.5), -11.25) from it.
    expect(carried?.x).toBeCloseTo(65.25 + 4.5, 3);
    expect(carried?.y).toBeCloseTo(571.5 - 11.25, 3);
    // AND THE GLYPHS RUN UP THE PAGE: the x axis of the line is the page's y axis.
    expect(carried?.a).toBeCloseTo(0, 5);
    expect(carried?.b).toBeCloseTo(0.75, 5);
  });

  // THE CONTROL for all three: the same words with no placement carry no cm, so the numbers above are the placement's.
  it('writes no cm and carries nothing for an edit that places nothing', () => {
    const edit = made([{ lines: [[0], [1], [2]], soft: [false, false, false], text: 'abc\ndef\nghx' }]);
    expect(inserted(edit)).toHaveLength(1);
    expect(inserted(edit).every((object) => !object.includes(' cm\nBT'))).toBe(true);
    // CONTROL: and a placement writes one, so the absence above is the edit's and not the way this reads.
    expect(inserted(made([placedBlock({ move: { x: 1, y: 0 } })])).every((object) => object.includes(' cm\nBT'))).toBe(true);
  });

  it('carries a line’s operators as they were: its own codes and kerning, not its words set again', () => {
    const kerned = bytes('0.75 0 0 -0.75 0 792 cm\nBT /F1 20 Tf 1 0 0 -1 72 300 Tm [(a) -120 (bc)] TJ ET');
    const page = runsOf(kerned, fonts);
    const edit = editOperators(kerned, fonts, { ...page, runs: page.runs.map((run) => ({ ...run, left: 54, right: 76.5, bottom: 564, top: 579 })) }, [
      { lines: [[0]], soft: [false], text: 'abc', place: { move: { x: 10, y: 0 } } },
    ]);
    if (!edit.ok) throw new Error(`refused: ${JSON.stringify(edit.error)}`);
    // THE KERNING IS IN IT, as hexadecimal: the run is its page's, not a re-setting of three letters.
    expect(latin1(edit.value.content)).toContain('[<61> -120 <6263>] TJ');
    expect(checkOperatorEdit(kerned, edit.value, fonts).ok).toBe(true);
  });

  it('gives a block a measure by setting every paragraph of it again, wrapped there', () => {
    // A WORD IS 22.5 POINTS HERE (three letters of 10 in a 0.75 text space), so thirty points hold one and not two.
    const narrow = made([{ lines: [[0]], soft: [false], text: 'abc abc', place: { width: 30 } }]);
    expect(narrow.written).toStrictEqual(['abc\nabc']);
    // THE MEASURE DRIVES THE WRAP BOTH WAYS: three hundred points hold both words on one line, where the block's own right
    // edge (the line's 22.5) held one. The last is the control that the measure and not the words made the first wrap.
    const wide = made([{ lines: [[0]], soft: [false], text: 'abc abc', place: { width: 300 } }]);
    expect(wide.written).toStrictEqual(['abc abc']);
    const own = made([{ lines: [[0]], soft: [false], text: 'abc abc' }]);
    expect(own.written).toStrictEqual(['abc\nabc']);
  });

  describe('an added box', () => {
    // THE CALLER'S ADDED FONT: a code per letter it is asked for, as in the case above.
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
    const asked: { word: string; family: string | undefined }[] = [];
    const faces: OperatorFaces = {
      set: (word, _source, _own, restyle) => {
        asked.push({ word, family: restyle?.family });
        return Array.from(word, (character) => ({ font: face, codes: [codeFor(character)] }));
      },
      drawn: () => undefined,
      isBold: statedBold,
    };
    const box = { left: 100, baseline: 600, measure: 200, size: 10, text: 'xyz' };
    const withFonts = new Map([...fonts, ['MonsteraFace1', face]]);

    it('is drawn last, closing what the page left open first, under the CTM the page is drawn under', () => {
      // A PAGE THAT NEVER CLOSED ITS q, and a cm outside it that stays: the CTM at the end is 2 across and 3 up, 2 and 3 and 0.
      const open = bytes('2 0 0 3 5 7 cm\nq 0.5 0 0 0.5 0 0 cm\nBT /F1 20 Tf 1 0 0 1 10 10 Tm (abc) Tj ET');
      const page = runsOf(open, fonts);
      const result = editOperators(open, fonts, page, [], faces, 'reflow', [box]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      const text = latin1(result.value.content);
      // ONE Q, said once, then the box's own object.
      expect(text).toMatch(/Tj ET\nQ\nq BT/u);
      expect(checkOperatorEdit(open, result.value, withFonts).ok).toBe(true);
      // AND IT DRAWS WHERE THE BOX SAYS in user space: (100, 600), through the CTM the content is left in once the q is closed.
      const [first] = showOperators(result.value.content).filter((op) => op.start >= text.indexOf('q BT', text.indexOf('Q\n')));
      const m = multiplyMatrices(first?.state.matrix ?? [], first?.state.ctm ?? []);
      expect(m[4]).toBeCloseTo(100, 3);
      expect(m[5]).toBeCloseTo(600, 3);
      // CONTROL: the Q is the page's closing and not every box's: a second box adds none.
      const two = editOperators(open, fonts, page, [], faces, 'reflow', [box, { ...box, baseline: 500, text: 'xy' }]);
      if (!two.ok) throw new Error(`refused: ${JSON.stringify(two.error)}`);
      expect(latin1(two.value.content).match(/\nQ\nq BT/gu)?.length).toBe(1);
    });

    it('is set in the face the resolver gives for the family asked, and only for the words it holds', () => {
      asked.length = 0;
      const result = editOperators(content, fonts, stated(), [], faces, 'reflow', [{ ...box, base: { family: 'Courier' } }]);
      if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
      expect(asked).toContainEqual({ word: 'xyz', family: 'Courier' });
      expect(result.value.drawn).toStrictEqual(['xyz']);
    });

    it('is refused where nothing can set it, naming the characters, and writes nothing', () => {
      const result = editOperators(content, fonts, stated(), [], null, 'reflow', [box]);
      expect(result).toStrictEqual({ ok: false, error: { reason: 'needs-a-face', characters: ['x', 'y', 'z'] } });
    });
  });
});

describe('a block set at an angle is written in its own frame (ADR-0273)', () => {
  const fonts = new Map([['F1', font('F1', 'abcdefghijklmnopqrstuvwxyz')]]);
  /**
   * A block of two lines set by `frame` (a turn, a slant or a flip), its first origin at (100, 500) and its second a
   * line of 14 below it along the frame's own down: what a producer writes for a label turned on the page.
   */
  const page = (frame: readonly [number, number, number, number]) => {
    const [a, b, c, d] = frame;
    const second = [100 - 14 * c, 500 - 14 * d];
    const line = (x: number, y: number, words: string) => `BT /F1 12 Tf ${[a, b, c, d, x, y].map(String).join(' ')} Tm (${words}) Tj ET\n`;
    const content = bytes(`${line(100, 500, 'turned at an angle')}${line(second[0] ?? 0, second[1] ?? 0, 'and only two lines')}`);
    return { content, runs: runsOf(content, fonts), second };
  };
  /**
   * Edits the second line's `only` to `also`, a word as wide, so the line is set again and does not wrap (a wrap is the
   * layout's own case), and answers the new line's text matrix in user space.
   */
  const editSecond = (frame: readonly [number, number, number, number]) => {
    const { content, runs, second } = page(frame);
    const [first, next] = runs.runs;
    const result = editOperators(content, fonts, runs, [
      { lines: [[first?.index ?? -1], [next?.index ?? -1]], soft: [false, false], text: 'turned at an angle\nand also two lines' },
    ]);
    if (!result.ok) return { refused: result.error, second };
    // THE OPERATORS OF THE INSERTED OBJECT, read back from the edited content with the state the content gives them.
    const inside = (op: ShowOperator) => result.value.changes.some((change) => change.inserted && op.start >= change.after.start && op.end <= change.after.end);
    const shown = showOperators(result.value.content).find((op) => inside(op) && op.state.font === 'F1');
    return { matrix: shown === undefined ? undefined : multiply(shown.state.matrix, shown.state.ctm), drawn: result.value.drawn, second };
  };

  it.each([
    ['turned 30 degrees', [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)]],
    ['running up the page', [0, 1, -1, 0]],
    ['slanted by its matrix', [1, 0, 0.25, 1]],
    ['mirrored', [-1, 0, 0, 1]],
  ] as const)('%s: the edited line is written, set by the same frame, where the old line stood', (_name, frame) => {
    const answer = editSecond(frame);
    if (answer.refused !== undefined) throw new Error(`refused: ${JSON.stringify(answer.refused)}`);
    expect(answer.drawn).toStrictEqual(['and also two lines']);
    const m = answer.matrix;
    if (m === undefined) throw new Error('no line was written');
    // THE FRAME, scaled by nothing but the font's own size, which the Tf carries: the letters turn, slant or flip as the
    // old ones did.
    m.slice(0, 4).forEach((value, at) => {
      expect(value).toBeCloseTo(frame[at] ?? 0, 6);
    });
    // AND WHERE THE OLD SECOND LINE BEGAN, on the page, not where an upright layout would have put it.
    expect(m[4]).toBeCloseTo(answer.second[0] ?? 0, 3);
    expect(m[5]).toBeCloseTo(answer.second[1] ?? 0, 3);
  });

  it('an underline on a turned block is drawn turned with its words, and read back in the frame as the words’ own rule', () => {
    const turn = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)] as const;
    const { content, runs } = page(turn);
    const [first, next] = runs.runs;
    const result = editOperators(content, fonts, runs, [
      { lines: [[first?.index ?? -1], [next?.index ?? -1]], soft: [false, false], text: 'turned at an angle\nand also two lines', marks: [{ from: 19, to: 22, set: { underline: true } }] },
    ]);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    const [rule] = operatorsAndDecorations(result.value.content).decorations;
    if (rule === undefined) throw new Error('no rule was drawn');
    // EVERY POINT OF THE RULE, taken back through the turn, lies on one of two lines a rule's thickness apart: the rule runs
    // along the turned line, not along the page's x.
    const back = rule.points.map(([x, y]) => -x * turn[1] + y * turn[0]);
    expect(Math.max(...back) - Math.min(...back)).toBeLessThan(2);
    // CONTROL: on the page the same points spread far in y, so the line above measures the turn and not a flat rule.
    const ys = rule.points.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
    // AND IT IS THE WORDS' OWN: an edit of the written page that takes the underline off finds the turned rule as theirs
    // (in the frame, `editFrame`) and takes it away with them. Read as PDFium reads what this writer wrote: each operator
    // that shows letters a run of its own, so the rule is under the whole of `and`, its run.
    const written = showOperators(result.value.content);
    const shows = written.filter((op) => op.object !== null && said(op, fonts).trim() !== '');
    const again: PageRuns = {
      textObjects: Array.from({ length: textObjectCount(written) }, (_, at) => at),
      runs: shows.map((op) => ({ index: op.object ?? -1, members: [op.object ?? -1], text: said(op, fonts), left: 0, right: 0, bottom: 0, top: 0 })),
    };
    const [heading, ...rest] = again.runs;
    const off = editOperators(result.value.content, fonts, again, [
      {
        lines: [[heading?.index ?? -1], rest.map((run) => run.index)],
        soft: [false, false],
        text: 'turned at an angle\nand also two lines',
        marks: [{ from: 19, to: 22, set: { underline: false } }],
      },
    ]);
    if (!off.ok) throw new Error(`refused: ${JSON.stringify(off.error)}`);
    expect(operatorsAndDecorations(off.value.content).decorations).toHaveLength(0);
  });

  it('CONTROL: the same block upright is written upright where it stood, so the cases above are the frame’s', () => {
    const answer = editSecond([1, 0, 0, 1]);
    if (answer.refused !== undefined) throw new Error(`refused: ${JSON.stringify(answer.refused)}`);
    expect(answer.drawn).toStrictEqual(['and also two lines']);
    expect(answer.matrix?.slice(0, 4)).toStrictEqual([1, 0, 0, 1]);
    expect(answer.matrix?.[5]).toBeCloseTo(486, 3);
  });
});
