import { z } from 'zod';

/**
 * Where new pages go, as a value: the pure half of `PagePlacement.tsx`, its own module so the dialogs' result schemas,
 * which are loaded before their bodies, can carry it without loading a component (`deletePagesResult.ts`' reason).
 *
 * The question is a SIDE and a PAGE: before or after; the first page, the last page, or page N, as a person counts pages.
 * The answer is `at`, ZERO-BASED in the target's frame, converted once here (`pageNumbering.ts`' rule): before page *p*
 * is *p − 1*, after it is *p*, so after the last page is `pageCount`, the one position past the end an insert may name.
 */

export type PlacementSide = 'before' | 'after';
export type PlacementPage = 'first' | 'last' | 'page';

/** What a placement holds, and what a dialog reopened after *Choose file…* restores. */
export const PAGE_PLACEMENT_DRAFT = z
  .object({
    side: z.enum(['before', 'after']),
    page: z.enum(['first', 'last', 'page']),
    typed: z.string().max(20),
  })
  .strict();
export type PagePlacementDraft = z.infer<typeof PAGE_PLACEMENT_DRAFT>;

/**
 * The zero-based position a placement names among `pageCount` pages, or `undefined` where the page typed is not one of
 * them. THE ONE CONVERSION from what is shown to what is sent.
 */
export function placementAt(placement: PagePlacementDraft, pageCount: number): number | undefined {
  let index: number;
  if (placement.page === 'first') index = 0;
  else if (placement.page === 'last') index = pageCount - 1;
  else {
    const typed = placement.typed.trim();
    const parsed = Number.parseInt(typed, 10);
    if (!/^\d+$/u.test(typed) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > pageCount) return undefined;
    index = parsed - 1;
  }
  return placement.side === 'before' ? index : index + 1;
}
