import { describe, expect, it } from 'vitest';

import { COMPOSED_FAMILY_DEFAULT } from '@monstera/contract';

import { ComposeRefused, type ComposedSource } from './composeOutcome.js';
import { composeCsv } from './csvCompose.js';
import { faceSourceOf } from './fontCatalogue.js';
import { readLines } from './shownText.js';

/** US Letter, the size a composed document is set at. */
const LETTER = { width: 612, height: 792 } as const;

/** The bundled faces, `markdownCompose.test.ts`' reading and its rule: absent is a failure. */
const FACES = faceSourceOf([{ path: process.env['MONSTERA_FONTS_DIRECTORY'] ?? '', origin: 'bundled' }]);

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function compose(source: Uint8Array | string): Promise<ComposedSource> {
  return composeCsv(typeof source === 'string' ? bytesOf(source) : source, LETTER, FACES, COMPOSED_FAMILY_DEFAULT);
}

/** Every page's text as a reader copies it, one line per line. */
async function shownText(pdf: Uint8Array): Promise<readonly string[]> {
  return (await readLines(pdf)).map((lines) => lines.map((line) => line.text).join('\n'));
}

/** A row of `count` columns, each holding its own index. */
function row(count: number): string {
  return Array.from({ length: count }, (_, at) => String(at)).join(',');
}

describe('composeCsv', () => {
  it('sets every field as text a reader can see', async () => {
    const [first] = await shownText((await compose('name,qty\nApples,3\n"Pears, green",12\n')).pdf);
    // THE POSITIVE CONTROL for every absence asserted below.
    expect(first).toContain('name');
    expect(first).toContain('Apples');
    expect(first).toContain('Pears, green');
    expect(first).toContain('12');
  });

  it('draws a byte-order mark as nothing, rather than refusing the file for it', async () => {
    const withMark = Uint8Array.of(0xef, 0xbb, 0xbf, ...bytesOf('a,b\n'));
    const [first] = await shownText((await compose(withMark)).pdf);
    expect(first).toContain('a');
    expect(first).not.toContain('\u{feff}');
  });

  it('refuses a source that is not UTF-8, by name', async () => {
    await expect(compose(Uint8Array.of(0x61, 0xff, 0x2c, 0x62))).rejects.toMatchObject({ reason: 'not-utf8', line: null });
  });

  it('composes the rest and NAMES a record it left out by its line (Codex’s importer audit)', async () => {
    const { pdf, skipped } = await compose('a,b\nc,"open\nd,e\n');
    expect(skipped).toStrictEqual([{ reason: 'quote-never-closed', line: 2, item: null }]);
    const [first] = await shownText(pdf);
    expect(first).toContain('d');
  });

  it('CONTROL: a file whose EVERY record is malformed is refused, naming the first line, not composed blank', async () => {
    const refusal = compose('a,"b"c\nx"y\n');
    await expect(refusal).rejects.toBeInstanceOf(ComposeRefused);
    await expect(refusal).rejects.toMatchObject({ reason: 'malformed-csv', line: 1 });
  });

  it('draws a character no face carries as a box and names it on the line a person finds it — after a two-line field', async () => {
    const { pdf, boxed } = await compose('a,b\n"one\ntwo",x\n中文,y\n');
    expect(boxed).toStrictEqual([
      { character: '中', line: 4, column: 1 },
      { character: '文', line: 4, column: 2 },
    ]);
    // CONTROL: the record is drawn and the boxes copy as the characters written.
    expect((await shownText(pdf)).join('\n')).toContain('中文');
  });

  it('a CONTROL character is never a refusal: BEL and NUL are each a box, named on their line and column (C3)', async () => {
    const { pdf, boxed } = await compose('a,b\nbell \u0007,nul \u0000\n');
    // NUL WAS DRAWN INVISIBLY AND NAMED NOWHERE until 2026-10-12: the bundled faces map it to an empty glyph.
    expect(boxed).toStrictEqual([
      { character: '\u0007', line: 2, column: 6 },
      { character: '\u0000', line: 2, column: 12 },
    ]);
    // CONTROL: the words beside them are drawn, so the record was composed and not refused.
    const shown = (await shownText(pdf)).join('\n');
    expect(shown).toContain('bell');
    expect(shown).toContain('nul');
  });

  it('names a box inside a field that spans lines by the line it is on', async () => {
    const { boxed } = await compose('a,b\n"one\ntwo 中",x\n');
    expect(boxed).toStrictEqual([{ character: '中', line: 3, column: 5 }]);
  });

  it('sets Hebrew and Arabic fields as written, boxing nothing', async () => {
    const { pdf, boxed } = await compose('name,greeting\nשלום,مرحبا\n');
    expect(boxed).toStrictEqual([]);
    const [first = ''] = await shownText(pdf);
    expect(first).toContain('שלום');
    expect(first).toContain('مرحبا');
  });

  it('SETS a table wider than any page rather than refusing it, every field drawn (`composeTable.test.ts` has the layout)', async () => {
    const pages = await shownText((await compose(`${row(60)}\n${row(60)}\n`)).pdf);
    const shown = pages.join('\n');
    for (let at = 0; at < 60; at += 1) expect(shown).toContain(String(at));
    // CONTROL: a narrow table is one page.
    const narrow = await shownText((await compose(`${row(5)}\n`)).pdf);
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toContain('4');
  });

  it('refuses a file whose every field is empty — CONTROL: one filled field is enough', async () => {
    await expect(compose(',,\n , \n')).rejects.toMatchObject({ reason: 'nothing-to-draw' });
    await expect(compose('')).rejects.toMatchObject({ reason: 'nothing-to-draw' });
    expect((await shownText((await compose(',x,\n')).pdf))[0]).toContain('x');
  });

  it('continues onto new pages, with the last record on the last page', async () => {
    const lines = Array.from({ length: 400 }, (_, at) => `item ${String(at)},${String(at * 2)}`);
    const pages = await shownText((await compose(`name,value\n${lines.join('\n')}\n`)).pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('item 0');
    expect(pages[pages.length - 1]).toContain('item 399');
  });

  it('sets a line break inside a field and a tab without refusing either', async () => {
    const [first] = await shownText((await compose('"top\nbottom",a\tb\n')).pdf);
    expect(first).toContain('top');
    expect(first).toContain('bottom');
    expect(first).toContain('a');
  });

  it('writes the same bytes for the same source', async () => {
    const first = await compose('a,b\n1,2\n');
    const second = await compose('a,b\n1,2\n');
    expect(Buffer.from(first.pdf).equals(Buffer.from(second.pdf))).toBe(true);
  });
});
