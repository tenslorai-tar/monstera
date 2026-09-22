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

/**
 * Text the renderer already holds and sends with the ask: a selection, or a comment's contents.
 *
 * TWO SCOPES OF ONE SHAPE, because the instruction must say which it is. A comment used to go as
 * a `selection`, and the provider was told the note was "text the person selected" — which the
 * model then repeated back (seen live, 2026-09-21).
 */
const carried = <Scope extends 'selection' | 'comment'>(scope: Scope) =>
  z
    .object({
      scope: z.literal(scope),
      docId: docIdSchema,
      /** Zero-based, as every page index crossing the contract is. */
      page: z.number().int().nonnegative(),
      text: z.string().min(1).max(MAX_ASK_SELECTION),
    })
    .strict();

export const askAboutSchema = z.discriminatedUnion('scope', [
  carried('selection'),
  carried('comment'),
  z.object({ scope: z.literal('page'), docId: docIdSchema, page: z.number().int().nonnegative() }).strict(),
  z.object({ scope: z.literal('document'), docId: docIdSchema }).strict(),
  /**
   * The document's comments — every annotation's own words, under the page it is on — for
   * *Summarise comments*. Bytes of intent like `document`: `main` reads the annotation list in
   * the document's lane, where the Comments panel's list comes from.
   */
  z.object({ scope: z.literal('comments'), docId: docIdSchema }).strict(),
  /**
   * A PICTURE of one page, for a model that can see it — vision analysis
   * ([ADR-0090](../../../docs/DECISIONS/0090-a-vision-ask-sends-one-page-picture-drawn-in-the-engine-host.md)).
   * Bytes of intent: the engine host draws the page and `main` sends it; the renderer never
   * holds the picture.
   */
  z.object({ scope: z.literal('page-image'), docId: docIdSchema, page: z.number().int().nonnegative() }).strict(),
]);

export type AskAbout = z.infer<typeof askAboutSchema>;

/**
 * Where a document sits when two are side by side
 * ([ADR-0089](../../../docs/DECISIONS/0089-a-two-document-ask-carries-one-window-per-document-inside-one-bound.md)).
 * *Left* is the tab's own document, *right* the one compared against it.
 */
export type AskSide = 'left' | 'right';

/** Which documents a person chose to ask about, with two side by side. */
export type AskSides = AskSide | 'both';

/** The scopes that can pair: the carried ones belong to the one document they came from. */
const PAIRS: Readonly<Record<AskAbout['scope'], boolean>> = {
  selection: false,
  comment: false,
  page: true,
  document: true,
  // NOT PAIRED YET: the owner's two-document design names pages and documents, and a summary of
  // two documents' comments is a question nobody has asked for.
  comments: false,
  // ONE PICTURE PER ASK (ADR-0090): a second document's picture is a second image nobody's
  // design asks for.
  'page-image': false,
};

/**
 * Whether `alongside` may travel with `about` — the one rule `ai.ask`'s refinement states:
 * a DIFFERENT document, in the SAME scope, and a scope that pairs. A `Record` over the scopes,
 * so a fifth is a compile error until it says whether it pairs.
 */
export function pairsWith(about: AskAbout | undefined, alongside: AskAbout): boolean {
  return about?.scope === alongside.scope && PAIRS[about.scope] && about.docId !== alongside.docId;
}

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
    /** Present and true when what went was a picture of the page rather than its text (ADR-0090). */
    picture: z.literal(true).optional(),
    /**
     * Present when what went was the document's COMMENTS: how many. Their pages are only the pages
     * that carry one, so a page range alone would read as *page 1 of 3 was sent* when every comment
     * in the document was. Each comment sent is at least one character, so the window's own bound
     * bounds the count.
     */
    comments: z.number().int().nonnegative().max(MAX_ASK_CONTEXT).optional(),
  })
  .strict();

export type AskSent = z.infer<typeof askSentSchema>;

/** How a side is named to the model: a word about the screen, not interface text. */
const SIDE_WORD: Readonly<Record<AskSide, string>> = { left: 'Left', right: 'Right' };

/**
 * The marker that opens a page in the window: the page as a person reads it. With two documents
 * it names the side too — `[Left page 3]` — because `[Page 3]` would name two pages (ADR-0089).
 */
export function askPageMarker(page: number, side?: AskSide): string {
  const shown = String(page + 1);
  return side === undefined ? `[Page ${shown}]` : `[${SIDE_WORD[side]} page ${shown}]`;
}

/** A citation as the instruction asks for it, for one document or for one side of two. */
export function askCitation(page: number, side?: AskSide): string {
  const shown = String(page + 1);
  return side === undefined ? `[p. ${shown}]` : `[${SIDE_WORD[side]} p. ${shown}]`;
}

/**
 * One piece of an answer: its own text, or a citation of a page (zero-based) — on a side, when
 * the answer was about two documents and named one.
 */
export type AnswerPiece =
  | { readonly text: string }
  | { readonly cited: number; readonly label: string; readonly side?: AskSide };

/** A citation as the instruction asks for it: `[p. 3]`, `[p.3]`, or `[Left p. 3]` / `[Right p. 3]`. */
const CITATION = /\[(?:(Left|Right) )?p\.\s?(\d{1,6})\]/gu;

const SIDE_OF: Readonly<Record<string, AskSide>> = { Left: 'left', Right: 'right' };

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
    const shown = Number(match[2]);
    if (shown < 1) continue;
    if (match.index > at) pieces.push({ text: answer.slice(at, match.index) });
    const side = match[1] === undefined ? undefined : SIDE_OF[match[1]];
    pieces.push({ cited: shown - 1, label: match[0], ...(side === undefined ? {} : { side }) });
    at = match.index + match[0].length;
  }
  if (at < answer.length) pieces.push({ text: answer.slice(at) });
  return pieces;
}
