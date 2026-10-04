import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { BODY_SIZE } from './composeLayout.js';
import { COLUMN_MAX_EMS, TABLE_FLOOR_SIZE, planTable } from './composeTable.js';
import { composeCsv } from './csvCompose.js';
import { composeMarkdown } from './markdownCompose.js';
import { contentOf, shownOn } from './shownText.js';

/** US Letter, upright. */
const LETTER = { width: 612, height: 792 } as const;

/** Letter's room across between the margins, upright and turned. */
const ROOM = { upright: 500, turned: 680 } as const;

/** About the width of `000` at body size in Helvetica. */
const NARROWEST = 18;

/** `count` columns alike. */
function alike(count: number, content: number, word = content): { content: number; word: number }[] {
  return Array.from({ length: count }, () => ({ content, word }));
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Each page's size, as the composed document sets it. */
async function sizesOf(pdf: Uint8Array): Promise<{ width: number; height: number }[]> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  return document.getPages().map((page) => page.getSize());
}

/** Every type size a page sets, read from its `Tf` operators. */
async function typeSizesOn(pdf: Uint8Array, page: number): Promise<number[]> {
  const content = await contentOf(pdf, page);
  return [...content.matchAll(/\/\S+ ([\d.]+) Tf/gu)].map(([, size]) => Number(size));
}

/** The strings every page shows, page by page. */
async function shownPages(pdf: Uint8Array): Promise<(readonly string[])[]> {
  const pages: (readonly string[])[] = [];
  for (let page = 0; page < (await sizesOf(pdf)).length; page += 1) pages.push(await shownOn(pdf, page));
  return pages;
}

describe('planTable: the least change that holds the table (Part A2)', () => {
  it('SIZES EACH COLUMN by what it holds, on the page asked for', () => {
    const plan = planTable([{ content: 100, word: 50 }, { content: 40, word: 40 }], ROOM, NARROWEST);
    expect(plan.turned).toBe(false);
    expect(plan.scale).toBe(1);
    // Each its widest line and the padding either side. CONTROL against the equal widths this replaced: 250 each.
    expect(plan.groups).toStrictEqual([[{ column: 0, width: 108 }, { column: 1, width: 48 }]]);
  });

  it('TURNS the page for a table wider than it, before making the type smaller', () => {
    // 6 * 100 = 600: past the 500 upright, inside the 680 turned.
    const plan = planTable(alike(6, 92), ROOM, NARROWEST);
    expect(plan).toMatchObject({ turned: true, scale: 1 });
    // CONTROL: a page already turned is not turned again, and the type is made smaller on it instead.
    expect(planTable(alike(6, 92), { upright: 500, turned: 500 }, NARROWEST)).toMatchObject({ turned: false });
  });

  it('MAKES THE TYPE SMALLER, by half points, before anything wraps', () => {
    // 8 * (92 + 8) = 800 at body size. At 9 pt each is 92 * 9/11 + 8 = 83.3, 666 in all; at 9.5 it is 695.
    const plan = planTable(alike(8, 92), ROOM, NARROWEST);
    expect(plan).toMatchObject({ turned: true, scale: 9 / BODY_SIZE });
    expect(plan.groups).toHaveLength(1);
  });

  it('WRAPS at the floor only, each column at least its widest word, the room shared out', () => {
    // Sentences 400 wide in four columns: too wide at the floor too, while their words are 30.
    const plan = planTable(alike(4, 400, 30), ROOM, NARROWEST);
    expect(plan.scale).toBe(TABLE_FLOOR_SIZE / BODY_SIZE);
    expect(plan.groups).toHaveLength(1);
    const widths = plan.groups[0]?.map((column) => column.width) ?? [];
    // Each wants its readable most, 24 ems at 8 pt = 192, which is 768 for four: so they share the 680 alike.
    expect(COLUMN_MAX_EMS * TABLE_FLOOR_SIZE * 4).toBeGreaterThan(ROOM.turned);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(ROOM.turned);
    expect(new Set(widths.map((width) => width.toFixed(6))).size).toBe(1);
  });

  it('keeps a table with a PARAGRAPH upright at body size, its short columns whole and the long one given the rest', () => {
    // 68 + 68 + 608 = 744 is past the 500 upright. The third wants its most, 24 ems = 264, so 400 in all fits upright
    // and the hundred left goes to the third. CONTROL: steps 2 and 3 would have turned it and made the type smaller.
    const plan = planTable([{ content: 60, word: 50 }, { content: 60, word: 60 }, { content: 600, word: 40 }], ROOM, NARROWEST);
    expect(plan).toMatchObject({ turned: false, scale: 1 });
    expect(plan.groups).toStrictEqual([
      [
        { column: 0, width: 68 },
        { column: 1, width: 68 },
        { column: 2, width: 364 },
      ],
    ]);
  });

  it('SPLITS a table too wide even at its narrowest into groups, each beginning with the first column', () => {
    const plan = planTable(alike(40, 60), ROOM, NARROWEST);
    expect(plan.groups.length).toBeGreaterThan(1);
    for (const group of plan.groups) {
      expect(group[0]?.column).toBe(0);
      expect(group.reduce((sum, column) => sum + column.width, 0)).toBeLessThanOrEqual(ROOM.turned + 1e-9);
    }
    // EVERY OTHER COLUMN EXACTLY ONCE: a split that dropped one or drew one twice is red here.
    const rest = plan.groups.flatMap((group) => group.slice(1).map((column) => column.column));
    expect(rest).toStrictEqual(Array.from({ length: 39 }, (_, at) => at + 1));
  });
});

describe('a composed table (Part A2)', () => {
  it('SETS a table of sixty columns, every value drawn, where it used to be refused', async () => {
    const header = Array.from({ length: 60 }, (_, at) => `h${String(at)}`).join(',');
    const values = Array.from({ length: 60 }, (_, at) => `v${String(at)}`).join(',');
    const pdf = await composeCsv(bytesOf(`${header}\n${values}\n`), LETTER);
    const pages = await shownPages(pdf);
    const shown = pages.flat();
    for (let at = 0; at < 60; at += 1) expect(shown).toContain(`v${String(at)}`);
    // SPLIT, and every group's pages carry the first column, so each row is still named.
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page).toContain('v0');
    // On turned pages, at the floor.
    for (const size of await sizesOf(pdf)) expect(size).toStrictEqual({ width: 792, height: 612 });
    expect(await typeSizesOn(pdf, 0)).toContain(TABLE_FLOOR_SIZE);
  });

  it('TURNS the pages for a table wider than Letter — CONTROL: a narrower one stays upright at body size', async () => {
    const cell = 'abcdefghijklmn';
    const wide = await composeCsv(bytesOf(`${Array.from({ length: 7 }, () => cell).join(',')}\n`), LETTER);
    expect(await sizesOf(wide)).toStrictEqual([{ width: 792, height: 612 }]);
    const narrow = await composeCsv(bytesOf(`${Array.from({ length: 3 }, () => cell).join(',')}\n`), LETTER);
    expect(await sizesOf(narrow)).toStrictEqual([LETTER]);
    expect(new Set(await typeSizesOn(narrow, 0))).toStrictEqual(new Set([BODY_SIZE]));
  });

  it('MAKES THE TYPE SMALLER rather than wrap, while that holds the row whole', async () => {
    const cell = 'abcdefghijklmn';
    const pdf = await composeCsv(bytesOf(`${Array.from({ length: 10 }, () => cell).join(',')}\n`), LETTER);
    const sizes = await typeSizesOn(pdf, 0);
    expect(Math.max(...sizes)).toBeLessThan(BODY_SIZE);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(TABLE_FLOOR_SIZE);
    // UNWRAPPED: every cell drawn whole, as one string.
    expect((await shownOn(pdf, 0)).filter((shown) => shown === cell)).toHaveLength(10);
  });

  it('WRAPS between words, never inside one while the word fits its column', async () => {
    const sentence = 'the quick brown fox jumps over the lazy dog and keeps on running across the field until dark';
    const pdf = await composeCsv(bytesOf(`${Array.from({ length: 6 }, () => `"${sentence}"`).join(',')}\n`), LETTER);
    const shown = await shownOn(pdf, 0);
    const words = new Set(sentence.split(' '));
    // Several lines per cell, and every one of them whole words.
    expect(shown.length).toBeGreaterThan(6);
    for (const piece of shown) {
      for (const word of piece.trim().split(' ')) expect(words.has(word)).toBe(true);
    }
  });

  it('draws WHOLE a word exactly as wide as its column', async () => {
    // `value` is this column's widest line, so the plan gives the column exactly its width; `wrap` measures it again
    // and the two sums can differ in the last bit. Without the width resolution this was drawn `valu`, `e`.
    const shown = await shownOn(await composeCsv(bytesOf('name,value\nitem 1,1\n'), LETTER), 0);
    expect(shown.slice(0, 2)).toStrictEqual(['name', 'value']);
  });

  it('REPEATS the header row on every page — CONTROL: the body row it sits over differs per page', async () => {
    const rows = Array.from({ length: 300 }, (_, at) => `item ${String(at)},${String(at)}`);
    const pages = await shownPages(await composeCsv(bytesOf(`name,value\n${rows.join('\n')}\n`), LETTER));
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) expect(page.slice(0, 2)).toStrictEqual(['name', 'value']);
    // Each word is drawn as its own string, so the first body row is its next three.
    expect(pages[1]?.slice(2, 5).join('')).not.toBe(pages[2]?.slice(2, 5).join(''));
    expect(pages[1]?.slice(2, 4).join('')).toMatch(/^item \d+$/u);
  });

  it('turns only a Markdown table’s pages, and the prose after it is upright again', async () => {
    const cells = (text: string): string => `|${Array.from({ length: 7 }, () => ` ${text} `).join('|')}|`;
    const table = `${cells('abcdefghijklmn')}\n${cells('---')}\n${cells('opqrstuvwxyzab')}\n`;
    const pdf = await composeMarkdown(bytesOf(`Before the table.\n\n${table}\nAfter the table.\n`), LETTER);
    expect(await sizesOf(pdf)).toStrictEqual([LETTER, { width: 792, height: 612 }, LETTER]);
    expect((await shownOn(pdf, 2)).join('')).toBe('After the table.');
    expect((await shownOn(pdf, 0)).join('')).toBe('Before the table.');
  });
});
