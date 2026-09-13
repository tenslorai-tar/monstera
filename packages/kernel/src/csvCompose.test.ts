import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { ComposeRefused } from './composeLayout.js';
import { composeCsv } from './csvCompose.js';
import { shownOn } from './shownText.js';

/** US Letter, the size a composed document is set at. */
const LETTER = { width: 612, height: 792 } as const;

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Every string a composed document shows, joined per page. */
async function shownText(pdf: Uint8Array): Promise<readonly string[]> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const pages: string[] = [];
  for (let page = 0; page < document.getPageCount(); page += 1) {
    pages.push((await shownOn(pdf, page)).join(''));
  }
  return pages;
}

/** A row of `count` columns, each holding its own index. */
function row(count: number): string {
  return Array.from({ length: count }, (_, at) => String(at)).join(',');
}

describe('composeCsv', () => {
  it('sets every field as text a reader can see', async () => {
    const pdf = await composeCsv(bytesOf('name,qty\nApples,3\n"Pears, green",12\n'), LETTER);
    const [first] = await shownText(pdf);
    // THE POSITIVE CONTROL for every absence asserted below.
    expect(first).toContain('name');
    expect(first).toContain('Apples');
    expect(first).toContain('Pears, green');
    expect(first).toContain('12');
  });

  it('draws a byte-order mark as nothing, rather than refusing the file for it', async () => {
    const withMark = Uint8Array.of(0xef, 0xbb, 0xbf, ...bytesOf('a,b\n'));
    const [first] = await shownText(await composeCsv(withMark, LETTER));
    expect(first).toContain('a');
  });

  it('refuses a source that is not UTF-8, by name', async () => {
    await expect(composeCsv(Uint8Array.of(0x61, 0xff, 0x2c, 0x62), LETTER)).rejects.toMatchObject({
      reason: 'not-utf8',
      line: null,
    });
  });

  it('carries the reader’s refusal and its line', async () => {
    const refusal = composeCsv(bytesOf('a,b\nc,"open\n'), LETTER);
    await expect(refusal).rejects.toBeInstanceOf(ComposeRefused);
    await expect(refusal).rejects.toMatchObject({ reason: 'malformed-csv', line: 2 });
  });

  it('refuses a character the fonts cannot draw on the line a person finds it — after a two-line field', async () => {
    await expect(composeCsv(bytesOf('a,b\n"one\ntwo",x\n中文,y\n'), LETTER)).rejects.toMatchObject({
      reason: 'unencodable-text',
      line: 4,
    });
  });

  it('refuses a table too wide for the page — CONTROL: a narrow one composes', async () => {
    await expect(composeCsv(bytesOf(`${row(60)}\n${row(60)}\n`), LETTER)).rejects.toMatchObject({
      reason: 'too-many-columns',
      line: 1,
    });
    const [first] = await shownText(await composeCsv(bytesOf(`${row(5)}\n`), LETTER));
    expect(first).toContain('4');
  });

  it('refuses a file whose every field is empty — CONTROL: one filled field is enough', async () => {
    await expect(composeCsv(bytesOf(',,\n , \n'), LETTER)).rejects.toMatchObject({ reason: 'nothing-to-draw' });
    await expect(composeCsv(bytesOf(''), LETTER)).rejects.toMatchObject({ reason: 'nothing-to-draw' });
    expect((await shownText(await composeCsv(bytesOf(',x,\n'), LETTER)))[0]).toContain('x');
  });

  it('continues onto new pages, with the last record on the last page', async () => {
    const lines = Array.from({ length: 400 }, (_, at) => `item ${String(at)},${String(at * 2)}`);
    const pages = await shownText(await composeCsv(bytesOf(`name,value\n${lines.join('\n')}\n`), LETTER));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('item 0');
    expect(pages[pages.length - 1]).toContain('item 399');
  });

  it('sets a line break inside a field and a tab without refusing either', async () => {
    const [first] = await shownText(await composeCsv(bytesOf('"top\nbottom",a\tb\n'), LETTER));
    expect(first).toContain('top');
    expect(first).toContain('bottom');
    expect(first).toContain('a');
  });

  it('writes the same bytes for the same source', async () => {
    const source = bytesOf('a,b\n1,2\n');
    const first = await composeCsv(source, LETTER);
    const second = await composeCsv(source, LETTER);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
