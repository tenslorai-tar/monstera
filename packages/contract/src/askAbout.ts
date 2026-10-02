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
 * How many documents one *All Open Docs* ask may carry
 * ([ADR-0134](../../../docs/DECISIONS/0134-an-ask-about-every-open-document-carries-one-window-each-inside-the-one-bound.md)).
 * Each has an equal share of {@link MAX_ASK_CONTEXT}, so sixteen is 6,250 characters each, about two pages; past that a
 * share stops being a reading of the document. More tabs than this are named as not sent, never refused.
 */
export const MAX_ASK_DOCUMENTS = 16;

/**
 * Each text source's share of the bound in an ask carrying `count` of them — THE ONE RULE, which `main` reads windows
 * and attached files by and answers on the turn, so the number a person is shown is the number that was applied
 * (ADR-0134 Decision 2, ADR-0135 Decision 5). `carried` is a selection or comment the ask carries whole, which the
 * shares divide what is left of.
 */
export function askShareOf(count: number, carried = 0): number {
  return Math.floor(Math.max(MAX_ASK_CONTEXT - carried, 0) / Math.max(count, 1));
}

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
  /**
   * EVERY OPEN DOCUMENT, as the person chose *All Open Docs* (ADR-0134): the ids of the tabs open at Send, the focused
   * one first. Bytes of intent like `document`; `main` reads each one's window with an equal share of the bound. All
   * different, which `ai.ask`'s refinement states.
   */
  z.object({ scope: z.literal('documents'), docIds: z.array(docIdSchema).min(2).max(MAX_ASK_DOCUMENTS) }).strict(),
]);

export type AskAbout = z.infer<typeof askAboutSchema>;

/** An ask about ONE document — every scope but *All Open Docs*, which names several (ADR-0134). */
export type AskAboutOne = Exclude<AskAbout, { readonly scope: 'documents' }>;

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
  // ALREADY MANY (ADR-0134): its documents are in the scope itself, so a second beside it would be a document twice.
  documents: false,
};

/** Whether a `documents` ask names each document once — the other half of `ai.ask`'s refinement (ADR-0134). */
export function namesEachOnce(about: AskAbout | undefined): boolean {
  return about?.scope !== 'documents' || new Set(about.docIds).size === about.docIds.length;
}

/**
 * Whether `alongside` may travel with `about` — the one rule `ai.ask`'s refinement states:
 * a DIFFERENT document, in the SAME scope, and a scope that pairs. A `Record` over the scopes,
 * so a fifth is a compile error until it says whether it pairs.
 */
export function pairsWith(about: AskAbout | undefined, alongside: AskAbout): boolean {
  if (about === undefined || about.scope === 'documents' || alongside.scope === 'documents') return false;
  return about.scope === alongside.scope && PAIRS[about.scope] && about.docId !== alongside.docId;
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
 * Which document a page is in, when an ask carries more than one: a SIDE of two side by side (ADR-0089), or a
 * document's PLACE, zero-based, in an *All Open Docs* ask (ADR-0134). One type, so the frame below is one frame with
 * three spellings — `[Page 3]`, `[Left page 3]`, `[Doc 2 page 3]` — and never two frames that drift apart (B3a).
 */
export type AskLabel = AskSide | number | AskFileLabel;

/**
 * A file attached to the question, by its place, zero-based (ADR-0135): the fourth spelling of the one frame,
 * `[File 2 page 3]`. A file's citation is never a link, since no open document holds it, so {@link citationsIn} does
 * not read it and it stays text.
 */
export interface AskFileLabel {
  readonly file: number;
}

/**
 * How a label is written to the model: *Left*, *Right*, *Doc 2* for the document in the second place, or *File 2* for
 * the second attached file — the one spelling the markers, the citations and an instruction's own sentences all use.
 */
export function askLabelWord(label: AskLabel): string {
  if (typeof label === 'object') return `File ${String(label.file + 1)}`;
  return typeof label === 'number' ? `Doc ${String(label + 1)}` : SIDE_WORD[label];
}

/**
 * The marker that opens a page in the window: the page as a person reads it. With more than one document it names the
 * document too — `[Left page 3]`, `[Doc 2 page 3]` — because `[Page 3]` would name several pages.
 */
export function askPageMarker(page: number, label?: AskLabel): string {
  const shown = String(page + 1);
  return label === undefined ? `[Page ${shown}]` : `[${askLabelWord(label)} page ${shown}]`;
}

/** A citation as the instruction asks for it, for one document, one side of two, or one of several. */
export function askCitation(page: number, label?: AskLabel): string {
  const shown = String(page + 1);
  return label === undefined ? `[p. ${shown}]` : `[${askLabelWord(label)} p. ${shown}]`;
}

/**
 * One piece of an answer: its own text, or a citation of a page (zero-based) — on a side, when the answer was about two
 * documents and named one, or in a document by its place (zero-based), when it was about several.
 */
export type AnswerPiece =
  | { readonly text: string }
  | { readonly cited: number; readonly label: string; readonly side?: AskSide; readonly document?: number };

/** A citation as the instruction asks for it: `[p. 3]`, `[p.3]`, `[Left p. 3]` / `[Right p. 3]`, or `[Doc 2 p. 3]`. */
const CITATION = /\[(?:(Left|Right|Doc (\d{1,2})) )?p\.\s?(\d{1,6})\]/gu;

const SIDE_OF: Readonly<Record<string, AskSide>> = { Left: 'left', Right: 'right' };

/**
 * An answer split into text and page citations, each citation as the kernel indexes the page.
 *
 * A citation of page 0 — `[p. 0]` — names no page a person reads, and stays text rather than becoming a link to the
 * page before the first; *Doc 0* names no document, and stays text the same way.
 */
export function citationsIn(answer: string): readonly AnswerPiece[] {
  const pieces: AnswerPiece[] = [];
  let at = 0;
  for (const match of answer.matchAll(CITATION)) {
    const shown = Number(match[3]);
    const place = match[2] === undefined ? undefined : Number(match[2]);
    if (shown < 1 || place === 0) continue;
    if (match.index > at) pieces.push({ text: answer.slice(at, match.index) });
    const side = match[1] === undefined ? undefined : SIDE_OF[match[1]];
    pieces.push({
      cited: shown - 1,
      label: match[0],
      ...(side === undefined ? {} : { side }),
      ...(place === undefined ? {} : { document: place - 1 }),
    });
    at = match.index + match[0].length;
  }
  if (at < answer.length) pieces.push({ text: answer.slice(at) });
  return pieces;
}

/**
 * Why a document in an *All Open Docs* ask was not read (ADR-0134 Decision 4): the refusals a one-document ask would
 * have answered, here naming one document while the rest go on.
 */
export const ASK_UNREAD_REASONS = ['document-not-open', 'document-busy', 'document-poisoned', 'page-too-large'] as const;

/** What one document of an *All Open Docs* ask carried, in the ask's order: its window, or why it was not read. */
export const askAmongSchema = z.union([
  z.object({ docId: docIdSchema, sent: askSentSchema }).strict(),
  z.object({ docId: docIdSchema, unread: z.enum(ASK_UNREAD_REASONS) }).strict(),
]);

export type AskAmong = z.infer<typeof askAmongSchema>;

/** Files one question carries (ADR-0135 Decision 1). */
export const MAX_ASK_ATTACHMENTS = 8;

/**
 * Why an attached file was not read (ADR-0135 Decision 6), each a sentence the turn says: a handle `main` never minted
 * or whose file has gone; a file past what is read or sent; a kind this build does not read; a reader that refused it;
 * a picture for a model whose list says it cannot see; a reader this build does not have here.
 */
export const ASK_FILE_UNREAD = [
  'not-found',
  'too-large',
  'not-supported',
  'unreadable',
  'cannot-see',
  'cannot-read-here',
] as const;

export type AskFileUnread = (typeof ASK_FILE_UNREAD)[number];

/** What one attached file carried, in the question's order: its window, that it went as a picture, or why neither. */
export const askFileSchema = z.union([
  z.object({ sent: askSentSchema }).strict(),
  z.object({ pictured: z.literal(true) }).strict(),
  z.object({ unread: z.enum(ASK_FILE_UNREAD) }).strict(),
]);

export type AskFile = z.infer<typeof askFileSchema>;
