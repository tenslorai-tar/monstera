import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { MarkdownComposeRefused, composeMarkdown } from './markdownCompose.js';
import { shownOn } from './shownText.js';

/** US Letter, the size a composed document is set at when nothing else decides it. */
const LETTER = { width: 612, height: 792 } as const;

/** The source as the picker hands it: bytes, never a string. */
function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Every string a composed document shows, page by page, joined per page. */
async function shownText(pdf: Uint8Array): Promise<readonly string[]> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const pages: string[] = [];
  for (let page = 0; page < document.getPageCount(); page += 1) {
    pages.push((await shownOn(pdf, page)).join(''));
  }
  return pages;
}

/** The pages a composed document has. */
async function pageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
}

describe('composeMarkdown', () => {
  it('sets headings and paragraphs as text a reader can see', async () => {
    const pdf = await composeMarkdown(bytesOf('# Quarterly report\n\nRevenue rose in the third quarter.\n'), LETTER);
    const [first] = await shownText(pdf);
    // THE POSITIVE CONTROL for every absence asserted below: the reader this
    // file uses does find text the composer drew.
    expect(first).toContain('Quarterly report');
    expect(first).toContain('Revenue rose in the third quarter.');
  });

  it('draws a raw HTML line as its literal text, and interprets none of it', async () => {
    const pdf = await composeMarkdown(bytesOf('Before.\n\n<div>raw html</div>\n'), LETTER);
    const [first] = await shownText(pdf);
    expect(first).toContain('Before.');
    expect(first).toContain('<div>raw html</div>');
  });

  it('draws an image as its alt text, and never its path', async () => {
    const pdf = await composeMarkdown(bytesOf('![a sleeping cat](../private/cat.png)\n'), LETTER);
    const [first] = await shownText(pdf);
    expect(first).toContain('[image: a sleeping cat]');
    expect(first).not.toContain('cat.png');
  });

  it('follows a link with its address, and CONTROL: not when the text already is the address', async () => {
    const pdf = await composeMarkdown(
      bytesOf('See [the plan](https://example.invalid/plan).\n\n[https://example.invalid/](https://example.invalid/)\n'),
      LETTER,
    );
    const [first] = await shownText(pdf);
    expect(first).toContain('the plan (https://example.invalid/plan)');
    // The second link's text is its address, so repeating it would print it twice.
    expect(first).not.toContain('https://example.invalid/ (https://example.invalid/)');
  });

  it('numbers an ordered list from the number its source starts at', async () => {
    const pdf = await composeMarkdown(bytesOf('3. third\n4. fourth\n'), LETTER);
    const shown = (await shownOn(pdf, 0)).join(' ');
    expect(shown).toContain('3.');
    expect(shown).toContain('4.');
    expect(shown).not.toContain('1.');
  });

  it('refuses a source that is not UTF-8, by name', async () => {
    const refusal = composeMarkdown(Uint8Array.of(0x48, 0x69, 0xff, 0xfe, 0x21), LETTER);
    await expect(refusal).rejects.toBeInstanceOf(MarkdownComposeRefused);
    await expect(refusal).rejects.toMatchObject({ reason: 'not-utf8', line: null });
  });

  it('refuses a character the standard fonts cannot draw, naming its line — and CONTROL: an accent they can', async () => {
    await expect(composeMarkdown(bytesOf('First line.\n\n中文\n'), LETTER)).rejects.toMatchObject({
      reason: 'unencodable-text',
      line: 3,
    });
    // U+00E9 is in WinAnsi, so a refusal here would be the check refusing
    // everything outside ASCII rather than asking the font.
    const pdf = await composeMarkdown(bytesOf('Café menu.\n'), LETTER);
    expect((await shownText(pdf))[0]).toContain('Café menu.');
  });

  it('refuses a source with nothing to draw, and CONTROL: one character is enough', async () => {
    await expect(composeMarkdown(bytesOf(''), LETTER)).rejects.toMatchObject({ reason: 'nothing-to-draw' });
    await expect(composeMarkdown(bytesOf('   \n\n\n'), LETTER)).rejects.toMatchObject({
      reason: 'nothing-to-draw',
    });
    expect(await pageCount(await composeMarkdown(bytesOf('x\n'), LETTER))).toBe(1);
  });

  it('continues onto new pages, and the last paragraph is on the last page', async () => {
    const paragraphs = Array.from({ length: 120 }, (_, at) => `Paragraph number ${String(at)} of the report.`);
    const pdf = await composeMarkdown(bytesOf(paragraphs.join('\n\n')), LETTER);
    const pages = await shownText(pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('Paragraph number 0 of the report.');
    expect(pages[pages.length - 1]).toContain('Paragraph number 119 of the report.');
  });

  it('breaks a word wider than the page rather than letting it run off the edge', async () => {
    const word = 'x'.repeat(400);
    const pdf = await composeMarkdown(bytesOf(`${word}\n`), LETTER);
    const pieces = await shownOn(pdf, 0);
    // More than one drawn string, and every character still drawn.
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(word);
  });

  it('writes the same bytes for the same source, so a composition can be compared with itself', async () => {
    const source = bytesOf('# Title\n\nSame words, twice.\n');
    const first = await composeMarkdown(source, LETTER);
    const second = await composeMarkdown(source, LETTER);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('composes two thousand nested list levels without running away', async () => {
    // THE MEASURED SHAPE that exhausted `marked`'s heap (ADR-0060). The parser's
    // own `maxNesting` is what bounds it, so this asserts the composer does not
    // undo that bound — and the item text proves it drew something.
    const nested = Array.from({ length: 2000 }, (_, at) => `${' '.repeat(at * 2)}- item ${String(at)}`).join('\n');
    const started = performance.now();
    const pdf = await composeMarkdown(bytesOf(nested), LETTER);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect((await shownText(pdf)).join('')).toContain('item 0');
  });
});
