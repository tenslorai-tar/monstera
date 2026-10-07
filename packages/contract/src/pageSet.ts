import { z } from 'zod';

/**
 * A command's pages as RUNS (finding AAA-1, decision D).
 *
 * ## Why a run
 *
 * A page list was one decimal index per page — six bytes a page, measured — so a selection scaled with the document,
 * which is invariant L11's own example of a wrong payload, and a whole-document selection met the engine host's frame
 * at about 43,600 pages (`hostProtocol.ts`). A person's selection is almost always a few runs: a range, a block ticked
 * in the grid, every page. `[first, last]` names a run in one entry whatever its length.
 *
 * ## An entry is a page OR a run, in the caller's order
 *
 * A single page stays a number, so a one-page command reads as it always has; a run is a pair whose last is past its
 * first. Order is kept, and a page may be named twice, because both mean something to some command — a capture
 * records its prior state in the order the command named its pages, and `placeImage` refuses a page named twice
 * rather than dropping it (see `pageScope.ts`, which expands a set once for every command).
 *
 * ## Bounded, so every command fits a frame
 *
 * {@link MAX_PAGE_INDEX} is the format's: PDF 32000-1 Annex C allows at most 8,388,607 indirect objects and each page
 * is one, so no page index exceeds it. {@link MAX_PAGE_SET_ENTRIES} bounds the number of entries, so the set's largest
 * encoding is computable and fits the frame, where the index list could not be bounded at all; the host route check
 * asserts no array in a command is unbounded any more. A selection of more separate runs than that is refused as that
 * command, never by ending a host.
 */

/** PDF 32000-1 Annex C, Table C.1: 8,388,607 indirect objects at most, one per page at least — so this index at most. */
export const MAX_PAGE_INDEX = 8_388_606;

/**
 * The most entries one page set holds. At the longest entry — a run of two seven-digit indices, eighteen bytes with
 * its separator — this is 147,456 bytes, which `pageSet.test.ts` holds under three quarters of the engine hosts'
 * frame by the contract's own reader.
 */
export const MAX_PAGE_SET_ENTRIES = 8_192;

const pageIndexSchema = z.number().int().min(0).max(MAX_PAGE_INDEX);

/** A run of pages, first to last inclusive, with last past first — a single page is written as its number. */
const pageRunSchema = z
  .tuple([pageIndexSchema, pageIndexSchema])
  .refine(([first, last]) => first < last, { message: 'a run ends after it starts; a single page is its number' });

/** A command's pages: single pages and runs, in the caller's order. */
export const pageSetSchema = z.array(z.union([pageIndexSchema, pageRunSchema])).min(1).max(MAX_PAGE_SET_ENTRIES);

/** See {@link pageSetSchema}. */
export type PageSet = z.infer<typeof pageSetSchema>;

/**
 * The most entries each page set holds in a command that carries TWO — its own pages and a second document's: half of
 * {@link MAX_PAGE_SET_ENTRIES}, so the pair's worst encoding is one set's and fits the frame by the same margin. Two
 * full sets were measured at 297,411 bytes against the hosts' 262,144-byte frame (`hostRoutes.test.ts`, 2026-10-04).
 */
export const MAX_PAIRED_PAGE_SET_ENTRIES = MAX_PAGE_SET_ENTRIES / 2;

/**
 * A page set held to `max` entries — the one shape a bounded page set is spelt in, so a set that shares the frame with
 * others is a number chosen at its call site and never a second definition of what an entry is.
 */
export function pageSetOfAtMost(max: number): z.ZodArray<z.ZodUnion<readonly [typeof pageIndexSchema, typeof pageRunSchema]>> {
  return z.array(z.union([pageIndexSchema, pageRunSchema])).min(1).max(max);
}

/** A page set in a command that carries two, each bounded by {@link MAX_PAIRED_PAGE_SET_ENTRIES}. */
export const pairedPageSetSchema = pageSetOfAtMost(MAX_PAIRED_PAGE_SET_ENTRIES);

/**
 * Pages as the shortest page set that names them in the same order: each stretch of consecutive ascending pages
 * becomes one run. Nothing is sorted or dropped, so `pagesOfSet(pageSetOf(pages))` is `pages` again.
 */
export function pageSetOf(pages: readonly number[]): PageSet {
  const set: PageSet[number][] = [];
  let at = 0;
  while (at < pages.length) {
    const first = pages[at] ?? 0;
    let last = first;
    while (at + 1 < pages.length && pages[at + 1] === last + 1) {
      at += 1;
      last += 1;
    }
    set.push(last === first ? first : [first, last]);
    at += 1;
  }
  return set;
}

/** The page-list fields a command carries: its own pages, and the pages of a second document it copies. */
const PAGE_LIST_FIELDS = ['pages', 'sourcePages'] as const;

/** The field holding a merge's parts, each of which carries its own `sourcePages` (ADR-0152). */
const PARTS_FIELD = 'documents';

/**
 * A command with its page lists written as runs — the renderer's one spelling, applied where every command leaves it
 * (`applyDocumentCommand`), so no surface has to remember to. A field that is absent, `'all'`, or a set already holding
 * runs is answered as it came, and so is a command whose every list already is.
 */
export function withPageRuns<TCommand extends object>(command: TCommand): TCommand {
  let written: TCommand = command;
  for (const field of PAGE_LIST_FIELDS) {
    if (!(field in written)) continue;
    const pages: unknown = (written as Record<string, unknown>)[field];
    if (!Array.isArray(pages) || !pages.every((page): page is number => typeof page === 'number')) continue;
    written = { ...written, [field]: pageSetOf(pages) };
  }
  const parts: unknown = (written as Record<string, unknown>)[PARTS_FIELD];
  if (Array.isArray(parts) && parts.every((part): part is object => typeof part === 'object' && part !== null)) {
    const runs = parts.map((part) => withPageRuns(part));
    if (runs.some((part, at) => part !== parts[at])) written = { ...written, [PARTS_FIELD]: runs };
  }
  return written;
}

/**
 * The pages a set names, in order — refusing, before one is listed, a page past `total`, so a run of millions against a
 * short document is a refusal and never a list of millions.
 *
 * @param refuse the caller's one refusal for an index its document does not have, so the words and the class are the
 *   same whether the index arrived alone or inside a run
 */
export function pagesOfSet(set: PageSet, total: number, refuse: (page: number, total: number) => never): readonly number[] {
  const pages: number[] = [];
  for (const entry of set) {
    if (typeof entry === 'number') {
      if (entry >= total) refuse(entry, total);
      pages.push(entry);
      continue;
    }
    const [first, last] = entry;
    if (last >= total) refuse(last, total);
    for (let page = first; page <= last; page += 1) pages.push(page);
  }
  return pages;
}
