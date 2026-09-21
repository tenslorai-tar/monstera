import { z } from 'zod';

import { docIdSchema } from './schemas.js';

/**
 * What an assistant ask is ABOUT, and how its pages are named on both sides of the provider
 * ([ADR-0088](../../../docs/DECISIONS/0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md)).
 *
 * ## The renderer names a scope; `main` reads the text
 *
 * `main` never holds a document's extracted text (ADR-0035), so a whole-document ask is a
 * **window**: pages read one at a time until {@link MAX_ASK_CONTEXT} characters are held. The
 * renderer sends which document and which scope — bytes of intent — except for a selection,
 * whose text it already holds from the kernel's own text layer.
 *
 * ## One page frame, stated here, because the provider sits between the two halves
 *
 * The window marks each page as a person reads it — `[Page 3]` — and the answer cites pages as
 * `[p. 3]`. The kernel indexes from zero and a person counts from one, and the two halves of
 * this feature meet only through text a model wrote. So the conversion is written **once**,
 * in {@link askPageMarker} and {@link citationsIn}, and a round trip through both is what the
 * cases assert.
 */

/**
 * How many characters of a document one ask may carry.
 *
 * **A choice, not a measurement** (ADR-0088 Decision 2): about 25,000 tokens, inside the
 * context of each listed provider's general models. What it bounds is `main`'s resident text,
 * which ADR-0035 requires be independent of the document.
 */
export const MAX_ASK_CONTEXT = 100_000;

/** How much selected text an ask may carry — one turn's own bound. */
export const MAX_ASK_SELECTION = 16_384;

export const askAboutSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('selection'),
      docId: docIdSchema,
      /** Zero-based, as every page index crossing the contract is. */
      page: z.number().int().nonnegative(),
      text: z.string().min(1).max(MAX_ASK_SELECTION),
    })
    .strict(),
  z.object({ scope: z.literal('page'), docId: docIdSchema, page: z.number().int().nonnegative() }).strict(),
  z.object({ scope: z.literal('document'), docId: docIdSchema }).strict(),
]);

export type AskAbout = z.infer<typeof askAboutSchema>;

/**
 * What an ask actually carried: the pages its window covers, zero-based, and whether it stopped
 * before the scope ended. `null` pages for a document with no pages.
 */
export const askSentSchema = z
  .object({
    firstPage: z.number().int().nonnegative().nullable(),
    lastPage: z.number().int().nonnegative().nullable(),
    pageCount: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative().max(MAX_ASK_CONTEXT),
    truncated: z.boolean(),
  })
  .strict();

export type AskSent = z.infer<typeof askSentSchema>;

/** The marker that opens a page in the window: the page as a person reads it. */
export function askPageMarker(page: number): string {
  return `[Page ${String(page + 1)}]`;
}

/** One piece of an answer: its own text, or a citation of a page (zero-based). */
export type AnswerPiece = { readonly text: string } | { readonly cited: number; readonly label: string };

/** A citation as the instruction asks for it: `[p. 3]`, or `[p.3]`. */
const CITATION = /\[p\.\s?(\d{1,6})\]/gu;

/**
 * An answer split into text and page citations, each citation as the kernel indexes the page.
 *
 * A citation of page 0 — `[p. 0]` — names no page a person reads, and stays text rather than
 * becoming a link to the page before the first.
 */
export function citationsIn(answer: string): readonly AnswerPiece[] {
  const pieces: AnswerPiece[] = [];
  let at = 0;
  for (const match of answer.matchAll(CITATION)) {
    const shown = Number(match[1]);
    if (shown < 1) continue;
    if (match.index > at) pieces.push({ text: answer.slice(at, match.index) });
    pieces.push({ cited: shown - 1, label: match[0] });
    at = match.index + match[0].length;
  }
  if (at < answer.length) pieces.push({ text: answer.slice(at) });
  return pieces;
}
