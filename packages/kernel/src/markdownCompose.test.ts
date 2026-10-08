import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { ComposeRefused } from './composeOutcome.js';
import { faceSourceOf } from './fontCatalogue.js';
import { composeMarkdown } from './markdownCompose.js';
import { type ReadLine, readLines } from './shownText.js';

/** US Letter, the size a composed document is set at when nothing else decides it. */
const LETTER = { width: 612, height: 792 } as const;

/** How long composing the deepest nesting may take — the case's claim that it does not run away, in milliseconds. */
const RUNAWAY_BOUND_MS = 10_000;

/**
 * The bundled faces, read as the compose host reads them, from the folder `vitest.config.mjs` passes. ABSENT IS A
 * FAILURE, never a skip: `faceSourceOf` throws for a folder with no face in it.
 */
const FACES = faceSourceOf([{ path: process.env['MONSTERA_FONTS_DIRECTORY'] ?? '', origin: 'bundled' }]);

/** The source as the picker hands it: bytes, never a string. */
function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function compose(text: string): Promise<{ pdf: Uint8Array; boxed: readonly { character: string; line: number; column: number | null }[] }> {
  return composeMarkdown(bytesOf(text), LETTER, FACES);
}

/** Every page's text as a reader copies it, one line per line. */
async function pagesOf(pdf: Uint8Array): Promise<string[]> {
  return (await readLines(pdf)).map((lines) => lines.map((line) => line.text).join('\n'));
}

/** The pages a composed document has. */
async function pageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
}

describe('composeMarkdown', () => {
  it('sets headings and paragraphs as text a reader can see', async () => {
    const [first] = await pagesOf((await compose('# Quarterly report\n\nRevenue rose in the third quarter.\n')).pdf);
    // THE POSITIVE CONTROL for every absence asserted below: the reader this
    // file uses does find text the composer drew.
    expect(first).toContain('Quarterly report');
    expect(first).toContain('Revenue rose in the third quarter.');
  });

  it('draws a raw HTML line as its literal text, and interprets none of it', async () => {
    const [first] = await pagesOf((await compose('Before.\n\n<div>raw html</div>\n')).pdf);
    expect(first).toContain('Before.');
    expect(first).toContain('<div>raw html</div>');
  });

  it('draws an image as its alt text, and never its path', async () => {
    const [first] = await pagesOf((await compose('![a sleeping cat](../private/cat.png)\n')).pdf);
    expect(first).toContain('[image: a sleeping cat]');
    expect(first).not.toContain('cat.png');
  });

  it('follows a link with its address, and CONTROL: not when the text already is the address', async () => {
    const [first] = await pagesOf(
      (await compose('See [the plan](https://example.invalid/plan).\n\n[https://example.invalid/](https://example.invalid/)\n')).pdf,
    );
    expect(first).toContain('the plan (https://example.invalid/plan)');
    // The second link's text is its address, so repeating it would print it twice.
    expect(first).not.toContain('https://example.invalid/ (https://example.invalid/)');
  });

  it('numbers an ordered list from the number its source starts at', async () => {
    const [first] = await pagesOf((await compose('3. third\n4. fourth\n')).pdf);
    expect(first).toContain('3.');
    expect(first).toContain('4.');
    expect(first).not.toContain('1.');
  });

  it('refuses a source that is not UTF-8, by name', async () => {
    const refusal = composeMarkdown(Uint8Array.of(0x48, 0x69, 0xff, 0xfe, 0x21), LETTER, FACES);
    await expect(refusal).rejects.toBeInstanceOf(ComposeRefused);
    await expect(refusal).rejects.toMatchObject({ reason: 'not-utf8', line: null });
  });

  it('refuses a source with nothing to draw, and CONTROL: one character is enough', async () => {
    await expect(compose('')).rejects.toMatchObject({ reason: 'nothing-to-draw' });
    await expect(compose('   \n\n\n')).rejects.toMatchObject({ reason: 'nothing-to-draw' });
    expect(await pageCount((await compose('x\n')).pdf)).toBe(1);
  });

  it('SETS a Markdown table wider than any page rather than refusing it — CONTROL: a narrow one draws on one page', async () => {
    // THE SHARED LAYOUT'S RULE, reached through the Markdown composer too (`composeTable.test.ts` has the layout).
    const wide = (cells: number): string => {
      const header = `|${Array.from({ length: cells }, (_, at) => ` c${String(at)} `).join('|')}|`;
      const rule = `|${Array.from({ length: cells }, () => '---').join('|')}|`;
      return `${header}\n${rule}\n`;
    };
    const shown = (await pagesOf((await compose(`Intro.\n\n${wide(60)}`)).pdf)).join('\n');
    for (let at = 0; at < 60; at += 1) expect(shown).toContain(`c${String(at)}`);
    const narrow = await pagesOf((await compose(wide(3))).pdf);
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toContain('c2');
  });

  it('continues onto new pages, and the last paragraph is on the last page', async () => {
    const paragraphs = Array.from({ length: 120 }, (_, at) => `Paragraph number ${String(at)} of the report.`);
    const pages = await pagesOf((await compose(paragraphs.join('\n\n'))).pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain('Paragraph number 0 of the report.');
    expect(pages[pages.length - 1]).toContain('Paragraph number 119 of the report.');
  });

  it('breaks a word wider than the page rather than letting it run off the edge', async () => {
    const word = 'x'.repeat(400);
    const [lines = []] = await readLines((await compose(`${word}\n`)).pdf);
    // More than one line, and every character still drawn.
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join('')).toBe(word);
  });

  it('writes the same bytes for the same source, so a composition can be compared with itself', async () => {
    const source = '# Title\n\nSame words, twice, and שלום and Ωmega.\n';
    const first = await compose(source);
    const second = await compose(source);
    expect(Buffer.from(first.pdf).equals(Buffer.from(second.pdf))).toBe(true);
  });

  it(
    'composes two thousand nested list levels without running away',
    async () => {
      // THE MEASURED SHAPE that exhausted `marked`'s heap (ADR-0060). The parser's
      // own `maxNesting` is what bounds it, so this asserts the composer does not
      // undo that bound — and the item text proves it drew something.
      const nested = Array.from({ length: 2000 }, (_, at) => `${' '.repeat(at * 2)}- item ${String(at)}`).join('\n');
      const started = performance.now();
      const { pdf } = await compose(nested);
      expect(performance.now() - started).toBeLessThan(RUNAWAY_BOUND_MS);
      expect((await pagesOf(pdf)).join('\n')).toContain('item 0');
    },
    // THE CASE'S OWN BOUND DECIDES, `csvRead.test.ts`' reason: below it, Vitest's 5 s default ends the case first
    // under load and this claim is never the one tested.
    RUNAWAY_BOUND_MS * 2,
  );
});

describe('composeMarkdown: every character is drawn (ADR-0172)', () => {
  it('draws Greek, Cyrillic, Hebrew and Arabic, which the standard fonts refused, and boxes none of them', async () => {
    // THE BUNDLED SET'S SCRIPTS, the owner's Q3: every other script is the machine's installed fonts' to carry.
    const text = 'Ωmega Привет שלום مرحبا';
    const { pdf, boxed } = await compose(`${text}\n`);
    expect(boxed).toStrictEqual([]);
    const [first = ''] = await pagesOf(pdf);
    // EACH WORD READ BACK AS WRITTEN, which a reader recovers only through the fonts' `ToUnicode`.
    for (const word of text.split(' ')) expect(first).toContain(word);
  });

  it('draws a character no face carries as a box that copies as the character, and names its line and column', async () => {
    const { pdf, boxed } = await compose('First line.\n\nA word 中文 here.\n');
    expect(boxed).toStrictEqual([
      { character: '中', line: 3, column: 8 },
      { character: '文', line: 3, column: 9 },
    ]);
    // THE BOX COPIES AS WHAT WAS WRITTEN: the reader gets 中文, never the box character.
    const [first = ''] = await pagesOf(pdf);
    expect(first).toContain('A word 中文 here.');
    expect(first).not.toContain('□');
    // CONTROL: the text around the box is drawn from the bundled faces, so the case is about the box alone.
    expect(first).toContain('First line.');
  });

  it('NEVER REFUSES A WHOLE FILE FOR ONE CHARACTER: emoji, CJK, symbols and box-drawing at line 60 compose, and every one is kept as text', async () => {
    // THE OWNER'S 0.1.11.0 FILE (Recording 2026-10-07 152122): a long document refused with "line 60 has a character the
    // built-in font cannot draw; nothing was imported". Sixty ordinary lines, then the characters that were refused.
    const filler = Array.from({ length: 59 }, (_, at) => `Ordinary line ${String(at + 1)}.`).join('\n\n');
    const hard = 'Done ✅ 🚀 中文 ★ ┌──┬──┐ │ A│ B│ └──┴──┘ → ≠ ∑';
    const text = `${filler}\n\n${hard}\n`;
    const { pdf, boxed } = await compose(text);
    // A COMPOSED DOCUMENT, not a refusal: the call returned, and the line past the sixtieth is on a page.
    const pages = await pagesOf(pdf);
    const all = pages.join('\n');
    expect(all).toContain('Ordinary line 59.');
    // EVERY ONE OF THE CHARACTERS IS KEPT AS TEXT, drawn or boxed, and copies as what was written.
    for (const character of ['✅', '🚀', '中', '文', '┌', '│', '→', '≠', '∑']) expect(all).toContain(character);
    // THE ONES NO FACE CARRIES ARE NAMED BY LINE, and the line is the sixtieth-and-after, never a refusal's.
    expect(boxed.length).toBeGreaterThan(0);
    expect(boxed.every((box) => box.line >= 60)).toBe(true);
    // CONTROL: the same sixty lines with nothing outside the faces compose with nothing boxed, so the boxes above are the
    // hard line's and not the filler's.
    const plain = await compose(`${filler}\n\nPlain last line.\n`);
    expect(plain.boxed).toStrictEqual([]);
  });

  it('names the exact line inside a paragraph that spans several, and every place a character repeats', async () => {
    const { boxed } = await compose('One line\nthen 中 a second\nand 中 a third.\n');
    expect(boxed).toStrictEqual([
      { character: '中', line: 2, column: 6 },
      { character: '中', line: 3, column: 5 },
    ]);
  });

  it('names a character written as an entity by its block, with no column it could point at', async () => {
    const { boxed } = await compose('Intro.\n\nAn entity &#x4E2D; here.\n');
    expect(boxed).toStrictEqual([{ character: '中', line: 3, column: null }]);
  });

  it('names a box in code by the code line it is on — an indented block and a fence both', async () => {
    const indented = await compose('Intro.\n\n    first code\n    code 中\n');
    expect(indented.boxed).toStrictEqual([{ character: '中', line: 4, column: 10 }]);
    // CONTROL: the same code line in a fence is one line further down, because the fence is a line of its own.
    const fenced = await compose('Intro.\n\n```\nfirst code\ncode 中\n```\n');
    expect(fenced.boxed).toStrictEqual([{ character: '中', line: 5, column: 6 }]);
  });

  it('sets a right-to-left paragraph against the right margin — CONTROL: a left-to-right one against the left', async () => {
    const { pdf } = await compose('שלום עולם\n\nHello world\n');
    const [lines = []] = await readLines(pdf);
    const hebrew = lines.find((line) => line.text.includes('שלום'));
    const latin = lines.find((line) => line.text.includes('Hello'));
    expect(latin?.x).toBeCloseTo(56, 0);
    expect(hebrew?.x ?? 0).toBeGreaterThan(300);
  });

  it('breaks a long Thai paragraph between its words, never cutting a mark from its letter', async () => {
    const sentence = 'ภาษาไทยไม่มีการเว้นวรรคระหว่างคำ';
    const paragraph = Array.from({ length: 12 }, () => sentence).join('');
    const { pdf, boxed } = await compose(`${paragraph}\n`);
    // NO BUNDLED FACE CARRIES THAI, so every letter is a box here — and the breaks are still between words, because
    // where a line may end is the text's and not its font's. Each box copies as its letter, which is what is read.
    expect(boxed.length).toBeGreaterThan(0);
    const [lines = []] = await readLines(pdf);
    const texts = lines.map((line: ReadLine) => line.text);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.join('')).toBe(paragraph);
    // A line that began with a vowel sign or tone mark would be one cut from the consonant it belongs to.
    for (const text of texts) expect(text).not.toMatch(/^\p{M}/u);
  });
});
