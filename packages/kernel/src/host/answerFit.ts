// THE HOST'S ENTRY, never the root: the root builds the renderer's channel map at load, which no host serves.
import { ENGINE_ANSWER_FILE_MAX_BYTES } from '@monstera/contract/host';

/**
 * Room for the rest of an answer around its list or its page JSON: the envelope, the field names, the flags and the
 * counts beside them. Every one of those is a few dozen bytes; a kilobyte is the margin, not a measurement.
 */
export const ANSWER_ENVELOPE_ROOM = 1024;

/**
 * A list cut to what ONE answer carries, and whether it was cut: the ONE place a host's list answer is fitted to the
 * file-answer ceiling (ADR-0125), so a walk past it is answered with the part that fits and `truncated`, never replaced
 * by `answer-too-large` after it was made.
 *
 * ## Why bytes and not only a count
 *
 * Every list's count bound is the ceiling divided by the SMALLEST item the schema accepts (ADR-0130 Decision 3): a bound
 * against a hostile host, right for that. As a walk's stopping point it is wrong, because a real item is larger than
 * the smallest, so a real page reaches the 8 MiB ceiling first. Measured 2026-10-16, textWalk's L6 dense page: PDFium's
 * `engine/text-runs` cut its 39,201 runs at the count bound of 39,100 and the answer was refused as too large, so the
 * person got "That could not be done" where the editor says the page has more text than it can outline at once.
 * `pageTextBound.ts` closed the same defect for MuPDF's page text on 2026-10-14 and the lists beside it kept it.
 *
 * Items are kept in order while each one's JSON, a comma, and the envelope still fit.
 *
 * @param maxItems the schema's count bound, which a fitted list never exceeds either
 * @param maxAnswerBytes the file-answer ceiling; {@link ENGINE_ANSWER_FILE_MAX_BYTES} in the product, smaller in a test
 */
export function itemsThatFit<Item>(
  items: readonly Item[],
  maxItems: number,
  maxAnswerBytes: number = ENGINE_ANSWER_FILE_MAX_BYTES,
): { readonly kept: Item[]; readonly truncated: boolean } {
  const budget = maxAnswerBytes - ANSWER_ENVELOPE_ROOM;
  let used = 2;
  let kept = 0;
  for (const item of items) {
    if (kept >= maxItems) break;
    const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + (kept === 0 ? 0 : 1);
    if (used + bytes > budget) break;
    used += bytes;
    kept += 1;
  }
  return { kept: items.slice(0, kept), truncated: kept < items.length };
}

/**
 * A reader's bounded list fitted to one answer: its count is already the reader's (`BoundedList`), so only the bytes are
 * fitted here, and the answer is truncated where the walk stopped OR the fit cut it.
 */
export function fittedList<Item>(
  listed: { readonly items: readonly Item[]; readonly truncated: boolean },
  maxAnswerBytes?: number,
): { readonly kept: Item[]; readonly truncated: boolean } {
  const fitted = itemsThatFit(listed.items, Number.POSITIVE_INFINITY, maxAnswerBytes);
  return { kept: fitted.kept, truncated: listed.truncated || fitted.truncated };
}
