import type { Result } from '@monstera/shared';
import { err, ok } from '@monstera/shared';

import { kernelPageOf } from './pageNumbering.js';

/**
 * The one parser for a page-range expression a person types — `1-3, 5`.
 *
 * ## Why this is a module and not three lines in a dialog body
 *
 * D2 has three surfaces that take one: deleting a range, extracting one, and
 * splitting by them. Three parsers is three answers to *"is `3-1` a range"* and
 * they agree until the day one of them is fixed (B3a). The dialog that needed
 * it first is where it was written, and it is written here so the second caller
 * takes it rather than re-deriving it.
 *
 * ## The numbers a person types are ONE-BASED
 *
 * Every user-facing surface counts from 1 and the document model indexes from
 * 0. `pageNumbering.ts` is the one place those two meet, so the conversion goes
 * through {@link kernelPageOf} rather than a `- 1` here — the same rule the
 * thumbnail strip's labels follow, and the reason a rotate once turned the page
 * after the one on screen.
 *
 * ## What it refuses, and why each refusal is a refusal
 *
 * A parse that quietly dropped what it could not read would delete the pages it
 * happened to understand out of an expression the user believed said something
 * else. So every part must parse, and each failure names the part that failed.
 */

/** How a range expression failed to parse. Each names the offending text. */
export type PageRangeProblem =
  | { readonly kind: 'empty' }
  | { readonly kind: 'not-a-number'; readonly part: string }
  | { readonly kind: 'out-of-range'; readonly part: string; readonly pageCount: number }
  | { readonly kind: 'backwards'; readonly part: string };

/**
 * Parses `1-3, 5` into zero-based page indices, ascending and without
 * duplicates.
 *
 * **Sorted and de-duplicated**, because the answer is a *set of pages* and the
 * order somebody typed them in is not information any consumer wants. A caller
 * receiving `[4, 0, 1]` would either sort it or be wrong, and both callers
 * sorting it is the second opinion this module exists to prevent.
 *
 * @param text what the user typed
 * @param pageCount how many pages the document has
 */
export function parsePageRanges(
  text: string,
  pageCount: number,
): Result<readonly number[], PageRangeProblem> {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return err({ kind: 'empty' });

  const pages = new Set<number>();
  for (const part of parts) {
    // A HYPHEN SPLITS, and exactly one of them: `1-2-3` is not a range and must
    // not be read as `1-2` with a stray tail. Two ends or it is not a range.
    const ends = part.split('-').map((end) => end.trim());
    const [first, last] = ends.length === 1 ? [ends[0], ends[0]] : ends;
    if (ends.length > 2 || first === undefined || last === undefined) {
      return err({ kind: 'not-a-number', part });
    }

    const from = readPageNumber(first);
    const to = readPageNumber(last);
    if (from === null || to === null) return err({ kind: 'not-a-number', part });
    // REFUSED RATHER THAN REVERSED. `5-3` is a person having made a mistake,
    // and silently reading it as `3-5` deletes three pages they did not name —
    // the same class of quiet helpfulness as dropping an unparseable part.
    if (to < from) return err({ kind: 'backwards', part });
    if (from < 1 || to > pageCount) return err({ kind: 'out-of-range', part, pageCount });

    for (let page = from; page <= to; page += 1) pages.add(kernelPageOf(page));
  }

  return ok([...pages].sort((a, b) => a - b));
}

/**
 * A page number, or `null`.
 *
 * `Number.parseInt` is not used: it reads `12abc` as `12`, which would accept
 * an expression the user cannot have meant and is exactly the quiet-drop
 * failure this module refuses everywhere else. The pattern is the check.
 */
function readPageNumber(text: string): number | null {
  if (!/^\d+$/u.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}
