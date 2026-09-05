import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind, OutlineEntry } from '@monstera/contract';

import {
  applyGenerateToc,
  captureGenerateToc,
  fit,
  invertGenerateToc,
  rowsPerPage,
  shownPageNumber,
  tocPageCount,
} from './pageToc.js';
import { shownOn } from './shownText.js';

/**
 * The table of contents, read back through **MuPDF** — a different library from
 * the one that wrote it, for `pageWatermark.test.ts`' reason.
 *
 * ## THE FIXTURE HAS PAGES ON BOTH SIDES OF THE INSERTION POINT
 *
 * This is the one property the whole file turns on, and a fixture without it
 * separates nothing. The defect this command can have is *printing the numbers
 * it was handed* — and for an entry BEFORE the insertion point that is the
 * correct answer, so a document whose bookmarks all sit after the table would
 * pass every assertion here against an implementation that shifted nothing and
 * one that shifted everything.
 *
 * So {@link OUTLINE} names a page on each side of `at`, and every case asserts
 * both. That is item 4b's rule arriving as a fixture: *never build a fixture
 * the bug also handles correctly.*
 *
 * ## The numbers here are one-based; the entries' are zero-based
 *
 * `shownPageNumber` is the third thing that states the correspondence, which is
 * the remedy the wired-tools rule names for a pair of tests either side of a
 * frame change. This file asserts against that function's output **and**
 * against literals computed by hand in the case names, so a wrong function is
 * not vouched for by a test that calls it.
 */
const PAGE_COUNT = 8;
const PAGE_SIZE: readonly [number, number] = [400, 300];

/** Eight blank pages, all one size. */
async function blankDocument(pages = PAGE_COUNT): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([...PAGE_SIZE]);
  return document.save();
}

/**
 * Four entries: two before page 3, one at it, one after — plus one resolving to
 * no page.
 *
 * The unresolved entry is not decoration. `page: null` is a real state the
 * outline reader preserves deliberately, and a table that dropped those rows
 * would leave a gap a reader cannot account for; a table that printed `null` as
 * a number would be worse.
 */
const OUTLINE: readonly OutlineEntry[] = [
  { title: 'Front matter', page: 0, depth: 0 },
  { title: 'Chapter one', page: 2, depth: 0 },
  { title: 'A subsection', page: 3, depth: 1 },
  { title: 'Elsewhere on the web', page: null, depth: 1 },
  { title: 'Chapter two', page: 6, depth: 0 },
];

const AT_FRONT: CommandOfKind<'generateToc'> = { kind: 'generateToc', at: 0 };

describe('shownPageNumber', () => {
  it('shifts a page at or after the insertion point, and only those', () => {
    // Inserting 2 pages at index 3. Page 2 is untouched and prints as 3; page 3
    // moves to 5 and prints as 6. The literals are computed by hand so that a
    // wrong implementation is not vouched for by the function under test.
    expect(shownPageNumber(2, 3, 2)).toBe(3);
    expect(shownPageNumber(3, 3, 2)).toBe(6);
    expect(shownPageNumber(7, 3, 2)).toBe(10);
  });

  it('shifts everything when the table goes at the front', () => {
    expect(shownPageNumber(0, 0, 1)).toBe(2);
    expect(shownPageNumber(5, 0, 3)).toBe(9);
  });

  it('shifts nothing when the table is appended past every page', () => {
    expect(shownPageNumber(0, 8, 1)).toBe(1);
    expect(shownPageNumber(7, 8, 1)).toBe(8);
  });
});

describe('tocPageCount and rowsPerPage', () => {
  it('is one page while the rows fit, and grows by whole pages', () => {
    expect(tocPageCount(1, 10)).toBe(1);
    expect(tocPageCount(10, 10)).toBe(1);
    expect(tocPageCount(11, 10)).toBe(2);
    expect(tocPageCount(20, 10)).toBe(2);
    expect(tocPageCount(21, 10)).toBe(3);
  });

  it('is never zero, so the table always occupies a page', () => {
    // A zero would make the shift zero, and the document would gain nothing
    // while every page number claimed it had.
    expect(tocPageCount(0, 10)).toBe(1);
    expect(tocPageCount(5, 0)).toBe(1);
  });

  it('fits at least one row on a page too short for its own margins', () => {
    // PDF permits a 3×3 point page. A floor of zero here divides the entry
    // count by nothing, which is a table of infinite length rather than a
    // cramped one.
    expect(rowsPerPage(3)).toBe(1);
    expect(rowsPerPage(300)).toBeGreaterThan(1);
  });
});

describe('fit', () => {
  // One unit per character, so the expectations are countable by hand and the
  // case does not depend on a font's metrics.
  const perCharacter = (text: string): number => text.length;

  it('returns the text unchanged when it fits', () => {
    expect(fit('Chapter one', 11, perCharacter)).toBe('Chapter one');
    expect(fit('Chapter one', 40, perCharacter)).toBe('Chapter one');
  });

  it('truncates with a marker that FITS, rather than to the width', () => {
    // Ten units of room, three spent on the marker: seven characters kept.
    expect(fit('Chapter one and two', 10, perCharacter)).toBe('Chapter...');
    expect(fit('Chapter one and two', 10, perCharacter).length).toBe(10);
  });

  it('draws nothing rather than overhanging when even the marker will not fit', () => {
    // The failure this prevents is three periods drawn over the page number,
    // which is the one overlap the layout has no room to absorb.
    expect(fit('Chapter one', 2, perCharacter)).toBe('');
    expect(fit('Chapter one', 0, perCharacter)).toBe('');
  });

  it('CONTROL: the measure is consulted, not the length', () => {
    // Every case above uses a measure equal to the length, so all of them would
    // pass against an implementation that ignored `measure` and counted
    // characters. This one doubles the width of every string, so a
    // length-counting implementation keeps seven characters where the correct
    // one keeps two.
    const doubled = (text: string): number => text.length * 2;
    expect(fit('Chapter one and two', 10, doubled)).toBe('Ch...');
  });
});

describe('generateToc', () => {
  it('inserts the table at the named index and shifts nothing else', async () => {
    const built = await applyGenerateToc(await blankDocument(), { kind: 'generateToc', at: 3 }, OUTLINE);
    const document = await PDFDocument.load(built);
    // Five rows on a 300pt page fit one sheet, so the document gains exactly
    // one page.
    expect(document.getPageCount()).toBe(PAGE_COUNT + 1);
    expect(await shownOn(built, 3)).not.toStrictEqual([]);
    // The pages either side of the insertion are still blank, which is what
    // says the table was inserted rather than drawn onto a neighbour.
    expect(await shownOn(built, 2)).toStrictEqual([]);
    expect(await shownOn(built, 4)).toStrictEqual([]);
  });

  it('NUMBERS THE PAGES AS THEY WILL BE, not as they were handed in', async () => {
    // The load-bearing case. One table page inserted at the front, so every
    // entry's page moves by one: 0→1, 2→3, 3→4, 6→7. An implementation that
    // printed what it was given writes 1, 3, 4, 7 for the same rows — the
    // numbers this asserts are each one MORE than that, which is what makes the
    // two distinguishable.
    const built = await applyGenerateToc(await blankDocument(), AT_FRONT, OUTLINE);
    expect(await shownOn(built, 0)).toStrictEqual([
      'Front matter',
      '2',
      'Chapter one',
      '4',
      'A subsection',
      '5',
      'Elsewhere on the web',
      'Chapter two',
      '8',
    ]);
  });

  it('shifts only the entries at or after the insertion point', async () => {
    // Inserted at 3: pages 0 and 2 keep their numbers (1 and 3), pages 3 and 6
    // gain one (5 and 8). A table that shifted everything writes 2 and 4 for
    // the first two, and one that shifted nothing writes 4 and 7 for the last
    // two — so this row separates all three implementations at once.
    const built = await applyGenerateToc(await blankDocument(), { kind: 'generateToc', at: 3 }, OUTLINE);
    expect(await shownOn(built, 3)).toStrictEqual([
      'Front matter',
      '1',
      'Chapter one',
      '3',
      'A subsection',
      '5',
      'Elsewhere on the web',
      'Chapter two',
      '8',
    ]);
  });

  it('draws no number for an entry that resolves to no page', async () => {
    // Asserted as an ABSENCE between two present neighbours rather than as a
    // shorter list, because a decoder that read nothing at all would also
    // produce a list without it.
    const shown = await shownOn(await applyGenerateToc(await blankDocument(), AT_FRONT, OUTLINE), 0);
    expect(shown).toContain('Elsewhere on the web');
    expect(shown.indexOf('Chapter two')).toBe(shown.indexOf('Elsewhere on the web') + 1);
  });

  it('spills onto a second page and shifts by BOTH pages', async () => {
    // A 300pt page holds eleven rows at this leading — `rowsPerPage(300)`, and
    // the number is read from the function rather than guessed, because a
    // margin change moves it. Thirteen entries therefore need two sheets, and
    // the shift must then be two rather than one. This is the case that
    // separates *counted the pages* from *assumed one*: with a single-sheet
    // fixture the two are the same number.
    const perPage = rowsPerPage(PAGE_SIZE[1]);
    const many: readonly OutlineEntry[] = Array.from({ length: perPage + 2 }, (_unused, index) => ({
      title: `Section ${String(index)}`,
      page: index === perPage + 1 ? 7 : 0,
      depth: 0,
    }));
    const built = await applyGenerateToc(await blankDocument(), AT_FRONT, many);
    const document = await PDFDocument.load(built);
    expect(document.getPageCount()).toBe(PAGE_COUNT + 2);
    // The overflow sheet carries the last two rows, and the second of them
    // points at page 7 — which prints as 10 only if the shift counted BOTH
    // inserted pages. An implementation assuming one writes 9.
    expect(await shownOn(built, 1)).toStrictEqual([
      `Section ${String(perPage)}`,
      '3',
      `Section ${String(perPage + 1)}`,
      '10',
    ]);
  });

  it('appends when `at` is past the end, and then shifts nothing', async () => {
    const built = await applyGenerateToc(
      await blankDocument(),
      { kind: 'generateToc', at: 99 },
      OUTLINE,
    );
    const document = await PDFDocument.load(built);
    expect(document.getPageCount()).toBe(PAGE_COUNT + 1);
    expect(await shownOn(built, PAGE_COUNT)).toStrictEqual([
      'Front matter',
      '1',
      'Chapter one',
      '3',
      'A subsection',
      '4',
      'Elsewhere on the web',
      'Chapter two',
      '7',
    ]);
  });

  it('takes the page size from a page this document already has', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 900]);
    const built = await applyGenerateToc(await source.save(), AT_FRONT, OUTLINE);
    const document = await PDFDocument.load(built);
    const { width, height } = document.getPage(0).getSize();
    expect(width).toBeCloseTo(200, 1);
    expect(height).toBeCloseTo(900, 1);
  });

  it('refuses an empty outline rather than adding a blank page', async () => {
    const original = await blankDocument();
    await expect(applyGenerateToc(original, AT_FRONT, [])).rejects.toThrow(/empty outline/u);
    // The document is untouched — asserted rather than assumed, because a
    // throw after a partial write is the failure this ordering prevents.
    expect((await PDFDocument.load(original)).getPageCount()).toBe(PAGE_COUNT);
  });

  it('does not throw on a title outside the standard font’s character set', async () => {
    // MEASURED 2026-09-05 and recorded rather than asserted from the docs:
    // `@cantoo/pdf-lib` does not refuse a character WinAnsi has no glyph for.
    // The row is present and its page number is right; the title is not
    // legible. That is the row's stated limit, and a document this build could
    // not process at all would be the worse outcome.
    const built = await applyGenerateToc(
      await blankDocument(),
      AT_FRONT,
      [{ title: '第一章', page: 2, depth: 0 }],
    );
    const shown = await shownOn(built, 0);
    expect(shown).toHaveLength(2);
    expect(shown[1]).toBe('4');
  });

  it('is reproducible: the same document and outline write the same bytes', async () => {
    const source = await blankDocument();
    const once = await applyGenerateToc(source, AT_FRONT, OUTLINE);
    const twice = await applyGenerateToc(source, AT_FRONT, OUTLINE);
    expect(Buffer.from(twice)).toStrictEqual(Buffer.from(once));
  });

  it('CONTROL: the fixture shows nothing before the command runs', async () => {
    // Without this every negative assertion above is satisfied by a decoder
    // that cannot see, which is 4b's reassuring answer in the shape this file
    // relies on most.
    const original = await blankDocument();
    for (let page = 0; page < PAGE_COUNT; page += 1) {
      expect(await shownOn(original, page)).toStrictEqual([]);
    }
  });

  it('CONTROL: the decoder reads a title this fixture really shows', async () => {
    // The positive control for `shownOn`. Its own module says why it lives with
    // the caller: what is known-present is a property of this fixture.
    const built = await applyGenerateToc(await blankDocument(), AT_FRONT, [
      { title: 'CONTROL TITLE', page: 0, depth: 0 },
    ]);
    expect(await shownOn(built, 0)).toContain('CONTROL TITLE');
  });

  it('captures nothing and says why', async () => {
    const captured = await captureGenerateToc();
    expect(captured.captured).toBe(false);
    if (!captured.captured) expect(captured.reason).toMatch(/removing the pages it added/u);
  });

  it('CONTROL: the inverse is unreachable and returns the image unchanged', async () => {
    // `CommandPrior['generateToc']` is `never`, so this cannot be called from
    // anywhere the type reaches. Asserted so the body is not mistaken for a
    // path that runs.
    const image = await blankDocument();
    expect(await invertGenerateToc(image, undefined as never)).toBe(image);
  });
});
