import {
  type CommandKind,
  type CommandOfKind,
  addAnnotationSchema,
  placeImageSchema,
  deleteFormFieldsSchema,
  fieldFillSchema,
  fillFormFieldSchema,
  flattenFormFieldsSchema,
  MAX_ANNOTATION_BORDER,
  addLinkSchema,
  annotationKindNameSchema,
  annotationRectSchema,
  formDataFormatSchema,
  formFieldKindSchema,
  importFormDataSchema,
  channel,
  cropPagesSchema,
  setPageTransitionSchema,
  deletePagesSchema,
  duplicatePageSchema,
  insertBlankPageSchema,
  mergeDocumentSchema,
  movePageSchema,
  ocrLanguageSchema,
  trocrSizeSchema,
  placeAnnotationSchema,
  styleAnnotationSchema,
  removeAnnotationSchema,
  replacePageSchema,
  deskewPagesSchema,
  enhancePagesSchema,
  resizePagesSchema,
  rotatePagesSchema,
  setLayerVisibilitySchema,
  swapPagesSchema,
} from '@monstera/contract';
import { z } from 'zod';

import type { CommandPrior } from '../commandLog.js';
import { type DeclaredCommands, declaredCommands } from '../commandDeclarations.js';
import type { KindsRoutedTo } from '../commandRouting.js';
import { PROBE_CODE_MAX_CHARS, PROBE_CODE_PATTERN } from './containment.js';

/**
 * The engine host's channels (ADR-0023 Decision 11).
 *
 * ## Why these are declared HERE and not in `packages/contract`
 *
 * `engine/capture` **answers with prior state**, and
 * `packages/contract/src/commands.ts` states in its own header why a schema for
 * that cannot live beside the renderer's channels: *"Inverses are deliberately
 * absent from this file. They stay kernel-only: they carry structural prior
 * state the renderer must not see, and a renderer-supplied inverse would let the
 * UI dictate undo."* `packages/ui` imports `packages/contract`; it may not
 * import this package, and that is a red build rather than a convention.
 *
 * So the *discipline* is shared and the *declaration* sits where its schemas may
 * live — `channel()` from the contract package, one declaration, validated in
 * the same `wrapHandler` everything else goes through.
 * `ARCHITECTURE.md` §5 carries the amendment.
 *
 * ## The session is a STRING here, and that is 10b
 *
 * The host mints and owns session identity; main holds an opaque handle it
 * cannot dereference. A branded `MupdfSession` never crosses — it could not,
 * being a token whose meaning is membership of an adapter's `WeakMap` in one
 * process. What crosses is the id that adapter recorded beside it.
 *
 * ## The lifecycle channels exchange FILES, and only ONE direction carries a path
 *
 * `open`, `serialise` and `close` move document images through the two handed
 * directories rather than through the pipe (Decision 7's verb split, measured).
 * The asymmetry below is the whole security content of that:
 *
 * - **main → host may carry a path.** Main created those directories and wrote
 *   their DACLs, so it is naming something it granted. The string is an
 *   address; the *capability* is the ACE, and the host reaches nothing by being
 *   told a name it was not granted.
 * - **host → main carries no path, and no component of one.** A compromised
 *   host that could name the file main reads back would have main open an
 *   arbitrary path and treat the bytes as the user's document. So main mints
 *   the output file name in the **request**, and the answer carries a byte
 *   count. Nothing this side joins to a directory came from the peer (B5).
 *
 * That is why `serialise` takes `into` rather than returning a name, which is
 * the shape a first implementation reaches for.
 *
 * ## Why the pair is PER SESSION, and the reason is lifetime rather than isolation
 *
 * Stated precisely because the obvious reading is wrong and would be believed.
 * There is **one host per engine** (Decision 9c), not one per document, and
 * every session's directories are granted to the same container SID — so
 * per-session directories do **not** isolate one document's snapshot from a
 * host compromised while parsing another. They cannot; that would need a
 * container per session, which is not this design.
 *
 * What they buy is that a snapshot's lifetime is the **session's** rather than
 * the host's. A host outlives every document that passes through it, so a pair
 * handed at host creation would accumulate a copy of every document the user
 * had opened, readable by the host, until the app exited.
 */

/** How long a session handle may be. Bounded for the reason a correlation id is:
 * an unbounded id is a peer deciding how many bytes of our frame it spends. */
export const ENGINE_SESSION_ID_MAX_CHARS = 64;

/**
 * How many pages one geometry read may name.
 *
 * The same argument `MAX_RANGE_BYTES` makes: any constant satisfies L11, so the
 * only real constraint is the lower one — it must sit above what a working
 * renderer actually asks for. A viewer asks about the pages it is drawing, and
 * a window of 512 is far above any plausible one; the value exists so that
 * *the whole document* is not a request a peer can make.
 *
 * **The trigger, so this is a number with an expiry rather than a guess:** the
 * first surface that legitimately needs more than this in one read — a thumbnail
 * strip over a long document is the obvious candidate — is the evidence the
 * bound is wrong, and the fix is a measurement of what that surface draws.
 */
export const ENGINE_GEOMETRY_MAX_PAGES = 512;

/**
 * How large one page's structured-text payload may be.
 *
 * **The host is hostile by invariant 25's own premise**, so an unbounded string
 * here is a peer choosing how many bytes of our frame it spends — the argument
 * `ENGINE_SESSION_ID_MAX_CHARS` already makes, applied to the one payload on
 * this contract whose size follows a document's content.
 *
 * 8 MB against a measured page. `scripts/research/textRetention.mjs` reads a
 * dense 50-line page at roughly 8 KB of JSON, so this is three orders of
 * magnitude above the shape it was measured on — the lower bound is the real
 * constraint, exactly as it is for `MAX_RANGE_BYTES`, because a bound that
 * refuses a page a working viewer must render stops being a guard.
 *
 * **The trigger:** the first page refused by this is the evidence the bound is
 * wrong, and the fix is a measurement of what such a page contains — not a
 * larger round number.
 */
export const ENGINE_PAGE_TEXT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * How many links one page may report.
 *
 * A COUNT rather than a byte size, because links cross as a declared shape and
 * each one is bounded by its own schema — so the only unbounded axis is how
 * many there are.
 *
 * 4096 for the same reason the byte bound is generous: the lower bound is the
 * real constraint. A page of a link-heavy index carries hundreds; a page with
 * four thousand is one no panel could present to a reader anyway.
 *
 * **The trigger:** the first page refused by this is the evidence the bound is
 * wrong, and the fix is a measurement of what such a page contains.
 */
export const ENGINE_PAGE_LINKS_MAX = 4096;

/**
 * How long a link's URI may be.
 *
 * The one string in this shape that a document controls, so it is the one that
 * needs a length. 2048 is the ceiling every browser applies to a URL in
 * practice, which makes it a bound a real document cannot legitimately cross
 * rather than a number chosen here.
 */
export const ENGINE_LINK_URI_MAX = 2048;

/**
 * How many recognised lines one page may answer with.
 *
 * Measured 2026-09-10 across the eleven-document corpus at 200 dpi: **5 to 54
 * lines** per page, the densest being a two-column HTML-engine export. Two
 * thousand is two orders of magnitude past that — a page whose image Tesseract
 * reads two thousand lines out of is a page of noise, and the bound's job is to
 * stop a hostile host claiming a hundred thousand rather than to characterise a
 * document.
 *
 * **The trigger:** the first real page refused by this is the evidence it is
 * wrong, and the fix is a measurement of what such a page contains.
 */
export const ENGINE_OCR_LINES_MAX = 2048;

/** How many words one recognised line may carry. Measured: the densest is 34. */
export const ENGINE_OCR_WORDS_PER_LINE_MAX = 512;

/**
 * How long one recognised line's text may be.
 *
 * A line is a line of a page, not a paragraph: the longest in the corpus is
 * under 120 characters. The bound is generous against a page set sideways, where
 * Tesseract's idea of a line is the long edge.
 */
export const ENGINE_OCR_LINE_TEXT_MAX = 4096;

/** How long one recognised word may be. A real word is short; noise is not. */
export const ENGINE_OCR_WORD_TEXT_MAX = 256;

/**
 * A recognised box, in PDF user space.
 *
 * `linkBoundsSchema`'s reason for existing, on a second noun: a hostile host can
 * send `Infinity` or `NaN` through JSON as easily as a coordinate, and a box
 * carrying either reaches the text layer's arithmetic. `z.number()` refuses both
 * — zod 4.4.3 rejects non-finite numbers by default.
 *
 * A TUPLE, matching `RecognisedWord['box']` exactly, so the handler needs no
 * cast to satisfy this schema and no reshaping to satisfy the type.
 */
const ocrBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).readonly();

/**
 * A link's rectangle, in the page's own units.
 *
 * A hostile host can send `Infinity` or `NaN` through JSON as easily as a
 * coordinate, and a rectangle carrying either reaches a renderer's layout
 * arithmetic — where it produces an element of infinite size rather than an
 * error anybody can trace. **`z.number()` refuses both**: zod 4.4.3 rejects
 * non-finite numbers by default, so the base schema is what carries this and
 * `.finite()` is a deprecated no-op. Stated because the property matters and
 * the modifier that used to advertise it is gone.
 */
const linkBoundsSchema = z
  .object({
    x0: z.number(),
    y0: z.number(),
    x1: z.number(),
    y1: z.number(),
  })
  .strict();

/**
 * How many outline entries may cross, and how long a title may be.
 *
 * Counts and a length, because those are the two axes a document controls.
 * A long technical manual carries hundreds of headings; four thousand is past
 * what a panel could present and short of what a hostile document could try.
 *
 * The title length is generous for the same reason every bound here is: the
 * lower bound is the real constraint, and a heading of 512 characters is one a
 * panel truncates rather than one it refuses to show.
 */
export const ENGINE_DESTINATIONS_MAX = 4096;
export const ENGINE_DESTINATION_TITLE_MAX = 512;

/**
 * How many layers may cross, and how long a name may be.
 *
 * Much smaller than the outline's, because the shapes differ: a design carries
 * a handful of optional-content groups where a manual carries hundreds of
 * headings. A bound copied from the outline would be one nobody had thought
 * about — the number is supposed to be a statement about what the thing is.
 */
export const ENGINE_LAYERS_MAX = 1024;
export const ENGINE_LAYER_NAME_MAX = 256;

/** One optional-content group, as it crosses from the host. */
const engineLayerSchema = z
  .object({
    index: z.number().int().nonnegative(),
    name: z.string().max(ENGINE_LAYER_NAME_MAX),
    visible: z.boolean(),
  })
  .strict();

/**
 * How many duplicate page indices may cross in one answer.
 *
 * Larger than every other bound in this file, and the reason is the shape
 * rather than generosity: a scanned bundle of one repeated blank page is
 * duplicates all the way down, which is an ordinary document rather than a
 * hostile one. The renderer's own bound
 * (`MAX_DUPLICATE_PAGES` in `packages/contract`) is the same number for the
 * same reason, and the two are separate because this boundary is hostile by
 * invariant 25 while that one is not.
 */
export const ENGINE_DUPLICATE_PAGES_MAX = 4096;

/**
 * How many page indices an extract may name.
 *
 * {@link ENGINE_DUPLICATE_PAGES_MAX}'s number for a different reason, stated
 * rather than shared: that one bounds an ANSWER a hostile host produces, and
 * this bounds a REQUEST main sends it. Extracting every page of a large
 * document is an ordinary thing to ask, so the bound is the document-shaped one
 * rather than a small guard — what it refuses is a list that could not have
 * come from a page count.
 *
 * Not an import of the other constant: two bounds that happen to agree are not
 * one bound, and tying them would make a change to either silently move the
 * other.
 */
export const ENGINE_EXTRACT_PAGES_MAX = 4096;

/**
 * How many annotations may be listed in one answer, and how much of a note.
 *
 * The duplicate bound's number for the duplicate bound's reason: a heavily
 * reviewed document carries thousands of comments and is ordinary rather than
 * hostile. Stated rather than shared for {@link ENGINE_EXTRACT_PAGES_MAX}'s
 * reason — two bounds that happen to agree are not one bound.
 *
 * The note is much smaller, because it is text a hostile document controls and
 * a panel shows one line of it. It is a SLICE rather than a refusal: a note
 * longer than this is still a note, and refusing the annotation would hide it.
 */
export const ENGINE_ANNOTATIONS_MAX = 4096;
export const ENGINE_ANNOTATION_CONTENTS_MAX = 512;

/**
 * How many form fields may be listed, and how much of a value, name or option.
 *
 * {@link ENGINE_ANNOTATIONS_MAX}' numbers for its reason, stated rather than
 * shared: a generated form pack carries fields in the thousands and is ordinary
 * rather than hostile, and two bounds that happen to agree are not one bound.
 *
 * The text is a SLICE rather than a refusal for the note's reason — a value
 * longer than this is still a value, and refusing the field would hide it from
 * the list it belongs in.
 */
export const ENGINE_FORM_FIELDS_MAX = 4096;
export const ENGINE_FORM_FIELD_TEXT_MAX = 512;
export const ENGINE_FORM_FIELD_OPTIONS_MAX = 512;
/** How many values one field may carry. The contract's bound, on this wire. */
export const ENGINE_FORM_FIELD_VALUES_MAX = 256;

/**
 * How many field candidates one page may propose, and how long a label may be.
 *
 * `MAX_FLAT_CANDIDATES`' number on this wire, and it is the create's bound
 * rather than a second opinion about it: a proposal a person accepts becomes
 * one `createFormField`, so a page that could propose more than that command
 * carries would offer something the accept could not send.
 */
export const ENGINE_FLAT_CANDIDATES_MAX = 256;
export const ENGINE_FLAT_LABEL_MAX = 128;

/**
 * One annotation, as it crosses from the host.
 *
 * **`kind` is a closed union, not the document's `/Subtype`.** A subtype is a
 * `/Name` a hostile document chooses, and a renderer that received one would
 * have to label a string nobody anticipated — which B9 forbids, since there is
 * no message key for it. The members are what this build writes; everything
 * else is `other`, which is honest and which a panel has a key for.
 */
const engineAnnotationSchema = z
  .object({
    page: z.number().int().nonnegative(),
    /**
     * Its position in the reader's walk on that page, not in `/Annots`.
     * See `pageAnnotations.ts` and ADR-0041 — it crosses because a handle is
     * useless if the host answers with a list nothing can point into.
     */
    index: z.number().int().nonnegative(),
    /**
     * Where it is, in PDF user space, or `null` for a page that displays no
     * region. The eraser hit-tests against it, so it crosses for the handle's
     * reason: a surface cannot point at an annotation it cannot locate.
     */
    rect: annotationRectSchema.nullable(),
    /**
     * What it is drawn in. `borderWidth` is null where the subtype has no
     * `/BS` — six of the thirteen, measured — and it crosses so a styles panel
     * can show what is there rather than only what it would apply.
     */
    style: z
      .object({
        colour: z.array(z.number().min(0).max(1)).max(4).readonly(),
        opacity: z.number().min(0).max(1),
        borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER).nullable(),
      })
      .strict(),
    // THE CONTRACT'S ENUM, and this was the FIFTH place the same list of names
    // was written down — the draft union that defines them, the renderer
    // channel, the kernel's derived alias, the panel's interface, and here.
    // Adding the sticky note reddened three of them and would have reddened
    // none had any been spelt slightly differently. `commands.ts` holds it now.
    kind: annotationKindNameSchema,
    contents: z.string().max(ENGINE_ANNOTATION_CONTENTS_MAX),
    /**
     * Whether this build wrote it — the `srcRef` mark, read from the
     * annotation's own dictionary (ADR-0043). It crosses for the handle's
     * reason: the surface is what tells a person whose annotation they are
     * about to change, and it cannot derive this from anything it holds.
     */
    authored: z.boolean(),
  })
  .strict();

/**
 * One AcroForm field's widget, as it crosses from the host.
 *
 * **`kind` is the contract's enum**, for `engineAnnotationSchema`'s reason and
 * with its history: the annotation name list was written down five times before
 * `commands.ts` was made to own it, and a sixth spelling here would be the same
 * defect one walk along.
 *
 * `on` is nullable rather than optional, and `rect` likewise, for
 * `engineDestinationSchema`'s reason — JSON cannot carry `undefined`, so an
 * optional property would make the wire spelling differ from the reader's.
 */
const engineFormFieldSchema = z
  .object({
    page: z.number().int().nonnegative(),
    /**
     * Its position in the WIDGET walk on that page, which shares no entries
     * with the annotation walk beside it — measured, seven widgets against zero
     * annotations on one page. It crosses for the annotation handle's reason: a
     * list nothing can point into is a list nothing can fill.
     */
    index: z.number().int().nonnegative(),
    kind: formFieldKindSchema,
    /** Not unique — a radio group is one field with several widgets. */
    name: z.string().max(ENGINE_FORM_FIELD_TEXT_MAX),
    /**
     * Empty for every button kind, by construction. See `formFields.ts`.
     *
     * A LIST, because a multi-select choice field's `/V` is an array — and
     * measured 2026-09-08, `getValue()` answers `""` for one, so the string
     * this replaced reported a field holding two options as holding none.
     */
    values: z
      .array(z.string().max(ENGINE_FORM_FIELD_TEXT_MAX))
      .max(ENGINE_FORM_FIELD_VALUES_MAX)
      .readonly(),
    /** Whether THIS widget is on, or null for a field with no on-state. */
    on: z.boolean().nullable(),
    options: z
      .array(z.string().max(ENGINE_FORM_FIELD_TEXT_MAX))
      .max(ENGINE_FORM_FIELD_OPTIONS_MAX)
      .readonly(),
    readOnly: z.boolean(),
    /** PDF user space, or null for a page that displays no region. */
    rect: annotationRectSchema.nullable(),
  })
  .strict();

/** One group of identical pages, as it crosses from the host. */
const engineDuplicateGroupSchema = z
  .object({
    pages: z.array(z.number().int().nonnegative()).min(2).max(ENGINE_DUPLICATE_PAGES_MAX),
  })
  .strict();

/**
 * One outline entry, as it crosses from the host.
 *
 * `page` is **nullable rather than optional**, matching the reader: an entry
 * that resolves to no page is a real state — an external URI, or a destination
 * the document does not define — and it must reach a panel rather than be
 * dropped, because a gap in a table of contents is more confusing than an entry
 * that cannot be followed.
 *
 * Nullable and not optional because JSON cannot carry `undefined`: an optional
 * property would make the wire spelling differ from the reader's, with a
 * conversion at each end that nobody would remember.
 */
const engineDestinationSchema = z
  .object({
    title: z.string().max(ENGINE_DESTINATION_TITLE_MAX),
    page: z.number().int().nonnegative().nullable(),
    depth: z.number().int().nonnegative(),
  })
  .strict();

/**
 * One link, as it crosses from the host.
 *
 * A DISCRIMINATED UNION, so `{kind: 'internal', uri}` is unrepresentable rather
 * than merely unexpected — an internal link carries a page and an external one
 * carries a URI, and a shape with both optional would let a hostile host send
 * the pair and leave every reader to decide which to believe (B5).
 */
const engineLinkSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('internal'),
      page: z.number().int().nonnegative(),
      bounds: linkBoundsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('external'),
      uri: z.string().max(ENGINE_LINK_URI_MAX),
      bounds: linkBoundsSchema,
    })
    .strict(),
]);

export const sessionSchema = z.string().min(1).max(ENGINE_SESSION_ID_MAX_CHARS);

/**
 * One page's prior `/Rotate`, verbatim (ADR-0009 §3).
 *
 * `present: false` is a page that **inherited**, and its inverse is a delete
 * rather than a write — which is why absence is a case in the union rather than
 * a sentinel value. `raw` is the number as MuPDF stored it, unnormalised: §3
 * requires prior state restored verbatim, and a page carrying `45` is restored
 * to `45`.
 */
const priorRotationSchema = z.discriminatedUnion('present', [
  z.object({ present: z.literal(false) }).strict(),
  z.object({ present: z.literal(true), raw: z.number() }).strict(),
]);

const priorPageRotationSchema = z
  .object({ page: z.number().int().nonnegative(), prior: priorRotationSchema })
  .strict();

/**
 * A box as the document held it, verbatim.
 *
 * `priorRotationSchema`'s shape and its argument: absence is a case rather than
 * a sentinel, because a page that inherited its box is restored by deleting the
 * key and no value can express that. The numbers are **unnormalised** — §3 asks
 * for prior state restored verbatim, and a box written `[0 0 612 792]` comes
 * back the way it went in.
 */
const priorBoxSchema = z.discriminatedUnion('present', [
  z.object({ present: z.literal(false) }).strict(),
  z.object({ present: z.literal(true), raw: z.array(z.number()).readonly() }).strict(),
]);

const priorPageCropSchema = z
  .object({ page: z.number().int().nonnegative(), prior: priorBoxSchema })
  .strict();

/**
 * A page's `/Contents` **shape**, not its value.
 *
 * `wasArray` is not cosmetic: a bare stream reference and a one-element array
 * render identically and are two different documents, which is the same
 * argument absence gets above.
 */
const priorContentsSchema = z.discriminatedUnion('present', [
  z.object({ present: z.literal(false) }).strict(),
  z
    .object({
      present: z.literal(true),
      wasArray: z.boolean(),
      length: z.number().int().nonnegative(),
    })
    .strict(),
]);

const priorPageResizeSchema = z
  .object({
    page: z.number().int().nonnegative(),
    mediaBox: priorBoxSchema,
    cropBox: priorBoxSchema,
    contents: priorContentsSchema,
  })
  .strict();

/** A deskewed page's prior state: the wrap's shape, and no box. */
const priorPageDeskewSchema = z
  .object({
    page: z.number().int().nonnegative(),
    contents: priorContentsSchema,
  })
  .strict();

/**
 * One entry of a page's `/Trans` dictionary, typed by what it holds.
 *
 * The three members are the value kinds the format uses there, and they are
 * separated rather than carried as a string because restoring `/D 3` as the
 * name `/3` is a different dictionary that parses.
 */
const priorTransitionEntrySchema = z.discriminatedUnion('kind', [
  z.object({ key: z.string(), kind: z.literal('name'), value: z.string() }).strict(),
  z.object({ key: z.string(), kind: z.literal('number'), value: z.number() }).strict(),
  z.object({ key: z.string(), kind: z.literal('boolean'), value: z.boolean() }).strict(),
]);

const priorTransitionSchema = z.discriminatedUnion('present', [
  z.object({ present: z.literal(false) }).strict(),
  z
    .object({ present: z.literal(true), entries: z.array(priorTransitionEntrySchema).readonly() })
    .strict(),
]);

const priorPageTransitionSchema = z
  .object({ page: z.number().int().nonnegative(), prior: priorTransitionSchema })
  .strict();

/**
 * Prior state, tagged by the command kind it belongs to.
 *
 * The tag is not redundant with the request's own `command.kind`. A response is
 * validated on its own terms — the correlation id says which call it answers,
 * and nothing else about the request is in scope at the point the body is
 * parsed. A kernel that narrowed by the kind it *sent* would be trusting the
 * peer to have answered the question it was asked.
 *
 * ## THIS UNION CARRIED TWO OF NINE UNTIL 2026-09-07
 *
 * Measured, not reasoned: `engineChannels['engine/capture'].result.safeParse`
 * accepted a `rotatePages` prior and **refused** `swapPages` and `movePage`.
 * Seven of the nine invertible MuPDF commands had no member here, so on a real
 * engine host their capture answered a value the outbound validation rejected —
 * which `wrapHandler` turns into `internal` plus an incident, and the command
 * fails. Undo was not degraded; the command did not run.
 *
 * Nothing saw it because every case that drives this channel uses
 * `rotatePages`. That is NNN-1's shape exactly — a fixture SET that holds one
 * argument constant, where no individual case looks wrong — and the reason it
 * survived is that a member being absent and a member being unexercised produce
 * the same green.
 *
 * ## So the set is now tied to the declarations, in both directions
 *
 * {@link CaptureCoversEveryInvertibleKind} and its sibling below are the
 * mechanism. The tie is not just over the KINDS: {@link PriorPairs} pairs each
 * kind with `CommandPrior[K]`, so a member present with the wrong shape — the
 * version of this defect that reads as covered — is a compile error too. Both
 * are written here rather than in a test for `MupdfChannelCoversEveryRoutedKind`'s
 * reason: an omission should fail at the line that omitted it.
 */
const capturedPriorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('rotatePages'),
      // `.readonly()` so the inferred wire type IS `CommandPrior['rotatePages']`
      // rather than a mutable neighbour of it. Without it the two differ only in
      // mutability, and every crossing needs a cast that reads as a formality
      // while being the only thing standing between them.
      prior: z.array(priorPageRotationSchema).readonly(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('setLayerVisibility'),
      /**
       * The layer's own visibility, as it was.
       *
       * **The state, not the negation of the command.** A command setting a
       * layer to the value it already had must invert to a no-op, and an
       * inverse derived as `!command.visible` flips it — which is why this
       * crosses at all rather than being recomputed on arrival.
       */
      prior: z
        .object({
          layer: z.number().int().nonnegative(),
          visible: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('movePage'),
      /**
       * Where the page was and where it went.
       *
       * The one prior here that is not state read off the document: a single
       * move has no prior structure to hold, because the tree it produces is a
       * function of the tree it started from and the two indices.
       */
      prior: z
        .object({
          from: z.number().int().nonnegative(),
          to: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('duplicatePage'),
      /** Where the copy landed, so the inverse removes that page and not the original. */
      prior: z.object({ at: z.number().int().nonnegative() }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('swapPages'),
      /** The pair, as validated against the document. A transposition is its own inverse. */
      prior: z
        .object({
          a: z.number().int().nonnegative(),
          b: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('insertBlankPage'),
      /** Where the new page landed. */
      prior: z.object({ at: z.number().int().nonnegative() }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cropPages'),
      /**
       * Each page's own `/CropBox`, including its **absence**.
       *
       * `present: false` is a page that inherited, and its inverse is a delete —
       * the same §3 shape `priorRotationSchema` carries, and the same reason it
       * is a case in a union rather than a sentinel.
       */
      prior: z.array(priorPageCropSchema).readonly(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('resizePages'),
      /** Each page's two boxes and the SHAPE of its `/Contents`. */
      prior: z.array(priorPageResizeSchema).readonly(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('deskewPages'),
      /** The SHAPE of each page's `/Contents`, and nothing else — no box moved. */
      prior: z.array(priorPageDeskewSchema).readonly(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('setPageTransition'),
      /**
       * Each page's own `/Trans`, with **all** of its entries.
       *
       * A page may carry `/Dm`, `/M` or `/Di` from another producer, so an
       * inverse restoring only what this command writes would leave a document
       * neither the user nor the producer made.
       */
      prior: z.array(priorPageTransitionSchema).readonly(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('fillFormField'),
      /**
       * The value a field held, and **which widget puts it back**.
       *
       * The index is part of it because a radio group's inverse acts on a
       * different widget from the one the command named — measured, toggling
       * the second radio moves the field to it and turns the first off, so the
       * inverse of *select the second* is *select the first*.
       */
      prior: z
        .object({
          page: z.number().int().nonnegative(),
          index: z.number().int().nonnegative(),
          value: fieldFillSchema,
        })
        .strict(),
    })
    .strict(),
]);

/**
 * What a capture answers.
 *
 * `captured: false` is an **outcome, not a failure** (ADR-0009's 2026-08-19
 * decision): the bus answers it by taking a checkpoint and applying anyway. So
 * it travels in the result rather than in a failure code, and a `reason` is
 * required — a refusal nobody can explain is one nobody can act on.
 *
 * **It is also the ordinary outcome at scale, measured 2026-08-26** (ADR-0023,
 * Decision 10's correction): a select-all `rotatePages` inverse on this
 * project's stated 20,000-page extreme weighs 809,018 bytes absent and 969,018
 * present — three to four times the whole frame. So this branch is a live path,
 * not a defensive one.
 */
/** Prior state with its kind, as it crosses. */
export type CapturedPrior = z.infer<typeof capturedPriorSchema>;

/**
 * The MuPDF-routed kinds that declare an inverse.
 *
 * Derived, and 4c's rule says why that is the right direction here: the failure
 * feared is a kind arriving with no member above, which makes this set BIGGER.
 * A hand-kept list would have to be edited by whoever adds the tenth invertible
 * command, and forgetting is exactly what left seven of nine unrepresentable.
 */
type InvertibleMupdfKind = {
  [K in KindsRoutedTo<'mupdf'>]: DeclaredCommands[K]['invertible'] extends true ? K : never;
}[KindsRoutedTo<'mupdf'>];

/**
 * Each such kind paired with the prior the kernel actually captures for it.
 *
 * **The load-bearing half.** Tying the kinds alone would accept a member whose
 * `prior` is the wrong shape — which is the version of this defect that reads
 * as covered, because the union would have an entry for the kind and refuse
 * every value of it at run time.
 */
type PriorPairs = {
  [K in InvertibleMupdfKind]: { readonly kind: K; readonly prior: CommandPrior[K] };
}[InvertibleMupdfKind];

export type CaptureCoversEveryInvertibleKind = Covers<CapturedPrior, PriorPairs>;
export type CaptureExcludesEveryOtherKind = Excludes<PriorPairs, CapturedPrior>;

/**
 * Pairs a command kind with the prior state captured for it.
 *
 * ## The correlated-union limit, for the third time in one change
 *
 * `{ kind: command.kind, prior: captured.prior }` builds an object whose two
 * fields are each widened to a union independently — `{kind: A|B, prior: X|Y}`
 * — and that is not assignable to `{kind:A,prior:X} | {kind:B,prior:Y}`, which
 * is what the schema declares. The value is correct by construction and the
 * checker cannot see the correlation.
 *
 * It compiled while there was one command, because a union of one is its own
 * member. The second command surfaced it in three places at once:
 * `CommandLog.record`, `localMupdfExecution`'s dispatch, and here.
 *
 * **This is the one that got a constructor rather than a cast**, because it is
 * the one with more than one caller — the capture handler and the inverse it
 * sends back both build this pair. A function is where the claim can be stated
 * once and where a future caller inherits it, instead of copying a cast whose
 * reasoning lives in someone else's comment (B3a).
 */
export function taggedPrior<K extends CommandKind>(
  kind: K,
  prior: CommandPrior[K],
): CapturedPrior {
  return { kind, prior } as CapturedPrior;
}

const captureResultSchema = z.discriminatedUnion('captured', [
  z.object({ captured: z.literal(true), value: capturedPriorSchema }).strict(),
  z.object({ captured: z.literal(false), reason: z.string().min(1) }).strict(),
]);

/**
 * The inverse travelling back to be applied.
 *
 * Carries its `kind` and nothing of the command, which is §3's rule in the
 * schema: an inverse that could see the intent could be computed *from* the
 * intent — rotate back by the same quarter turns — and that is the one
 * implementation §3 forbids, because a page that inherited its rotation is
 * restored by deleting the key and no amount of rotating backwards reaches that
 * state.
 */
const inverseSchema = capturedPriorSchema;

/**
 * The commands this host may be asked to run — **the MuPDF-routed ones, and
 * they are derived rather than listed**
 * ([ADR-0039](../../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
 *
 * ## Why the whole `commandSchema` stopped being right
 *
 * These two channels carried it while every command routed to MuPDF. With a
 * second writer of record, a `watermarkPages` arriving here would be a
 * well-formed command handed to `localMupdfExecution`, which would look up its
 * spec — the table holds every kind — and call pdf-lib's `apply` with a
 * **MuPDF session handle** as the document's bytes. That is not a crash at the
 * boundary; it is a native library handed a pointer where a byte array was
 * expected, inside the process invariant 25 assumes is hostile.
 *
 * The compiler found it: `CommandExecution<'mupdf'>` binds `K` to
 * `KindsRoutedTo<'mupdf'>`, so the handler stopped accepting the channel's own
 * payload. Narrowing the schema is what makes the two agree, rather than a cast
 * that would have made the error go away and the hazard stay.
 *
 * ## Derived, and this is the direction where derivation is right
 *
 * 4c's rule: derive from a set when the failure you fear makes that set
 * **bigger**. It does here — the danger is a command routed elsewhere being
 * accepted, which is a member arriving. A hand-kept list would have to be
 * edited by whoever adds the ninth command, and forgetting is the failure that
 * reopens exactly this hole.
 *
 * The filter reads `declaredCommands`, which is the routing table itself, so
 * this cannot disagree with what `CommandExecution` will accept.
 */
const mupdfCommandSchema = z.discriminatedUnion('kind', [
  rotatePagesSchema,
  setLayerVisibilitySchema,
  movePageSchema,
  deletePagesSchema,
  duplicatePageSchema,
  swapPagesSchema,
  insertBlankPageSchema,
  cropPagesSchema,
  setPageTransitionSchema,
  resizePagesSchema,
  deskewPagesSchema,
  enhancePagesSchema,
  mergeDocumentSchema,
  replacePageSchema,
  addAnnotationSchema,
  removeAnnotationSchema,
  placeAnnotationSchema,
  // WITHOUT ITS IMAGE, and this is the only member that differs from the kernel's
  // own schema for its kind
  // ([ADR-0044](../../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)).
  // This wire is JSON — `client.ts` frames `JSON.stringify` and `runtime.ts`
  // parses it — so a `Uint8Array` arrives as an object of numeric keys and
  // `placeImageSchema`'s own `instanceof` refines it away. The bytes travel the
  // granted directory instead, named by `asset` on the call.
  //
  // `.omit` rather than a second schema written out, because two hand-kept
  // shapes for one command would be a second opinion about what that command is
  // (B3a) — and the derivation is in the direction 4c allows: a field added to
  // the payload arrives here on its own, and the one field removed is named.
  placeImageSchema.omit({ bytes: true }),
  styleAnnotationSchema,
  addLinkSchema,
  fillFormFieldSchema,
  deleteFormFieldsSchema,
  flattenFormFieldsSchema,
  // THE SECOND ASSET-BEARING KIND, and `.omit` for `placeImage`'s reason: two
  // hand-kept shapes for one command would be a second opinion about what that
  // command is, and the derivation runs in the direction 4c allows — a field
  // added to the payload arrives here on its own, and the one removed is named.
  importFormDataSchema.omit({ bytes: true }),
]);

/** What travels in place of a command, once its asset has been taken out. */
export type MupdfWireCommand = z.infer<typeof mupdfCommandSchema>;

/**
 * Splits a command into what crosses the wire and what does not.
 *
 * **The axis decides, not the kind.** `declaredCommands` is where a command
 * says whether it carries an asset, so this reads that rather than naming
 * `placeImage` — which would be a second opinion about a question the
 * declaration table owns, and one that agrees with it until somebody adds the
 * next image-carrying command.
 *
 * One function for both `engine/apply` and `engine/capture`, because a capture
 * carries the same command and has the same reason not to carry its bytes.
 */
export function splitAsset(command: CommandOfKind<KindsRoutedTo<'mupdf'>>): {
  readonly command: MupdfWireCommand;
  readonly asset: Uint8Array | undefined;
} {
  if (declaredCommands[command.kind].asset === 'none') {
    return { command, asset: undefined };
  }
  // A NARROWING, NOT A CAST. `CommandAsset<K>` admits `'bytes'` only for a kind
  // whose payload has `bytes`, so this cannot be false — and writing it as a
  // check means the day the axis gains a third member the compiler asks here
  // instead of a `Uint8Array` reaching `JSON.stringify` unremarked.
  if (!('bytes' in command)) {
    throw new Error(
      `"${command.kind}" declares an asset and carries no bytes to send. The declaration and the ` +
        `payload have diverged, which CommandAsset exists to make impossible.`,
    );
  }
  const { bytes, ...rest } = command;
  return { command: rest, asset: bytes };
}

/**
 * Which kinds declare an asset — **derived from the declaration table**, so a
 * command that starts carrying one appears here without anybody editing this.
 *
 * The alternative is a union written out, and it fails in 4c's dangerous
 * direction: the danger is a kind arriving, which a hand-kept list is blind to,
 * and the symptom would be an image silently reaching `JSON.stringify`.
 */
type AssetBearingKind = {
  [K in keyof typeof declaredCommands]: (typeof declaredCommands)[K]['asset'] extends 'none'
    ? never
    : K;
}[keyof typeof declaredCommands];

/**
 * Whether the command that arrived is one whose bytes were taken out.
 *
 * A type predicate, which is a claim — and both halves of this one come from
 * `declaredCommands`, the type from its `asset` fields and the answer from the
 * same fields at run time, so they cannot disagree with each other or with what
 * {@link splitAsset} decided on the other side of the pipe.
 */
function carriesAsset(
  command: MupdfWireCommand,
): command is Extract<MupdfWireCommand, { kind: AssetBearingKind }> {
  return declaredCommands[command.kind].asset !== 'none';
}

/**
 * Puts an asset back into the command it was taken out of — {@link splitAsset}
 * read backwards, on the host's side of the wire.
 *
 * @returns the whole command, or `undefined` when one that needs an asset
 *   arrived without its bytes. That is an OUTCOME rather than a throw because
 *   the handler answers it as `asset-missing`: the file main named is not in
 *   the directory this session reads, which is a defect on main's side, and a
 *   distinguishable answer is what stops the supervisor reading it as a sick
 *   host.
 */
export function joinAsset(
  command: MupdfWireCommand,
  asset: Uint8Array | undefined,
): CommandOfKind<KindsRoutedTo<'mupdf'>> | undefined {
  if (!carriesAsset(command)) {
    // AN ASSET FOR A COMMAND THAT DECLARED NONE is a peer contradicting the
    // declaration table, and this host's peer is main rather than the hostile
    // side — so it is our own defect and refused as one rather than ignored,
    // which would apply a command whose sender believed it carried bytes.
    return asset === undefined ? command : undefined;
  }
  if (asset === undefined) return undefined;
  return { ...command, bytes: asset };
}

/**
 * The list above is **exactly** `KindsRoutedTo<'mupdf'>`, checked in both
 * directions at compile time.
 *
 * ## Why a list and not a filter over `commandSchema.options`
 *
 * The derived version was written first and it needed two type assertions: zod
 * cannot see that a filtered `.options` is still non-empty and still
 * discriminated, and — the half that actually mattered — the filtered array's
 * element type stays the **whole** union, so the schema parsed correctly and
 * inferred a payload including commands the handler cannot run. A derivation
 * whose narrowing has to be re-stated by a cast is not a derivation; it is a
 * list with a cast in front of it.
 *
 * Written out, the inference is exact and there is no assertion anywhere. What
 * a list gives up is 4c's growth direction — nothing makes you add the ninth
 * MuPDF command here — and that is what this check buys back, more cheaply than
 * the filter did: an omission fails `Covers`, an extra fails `Excludes`, and
 * both are compile errors at the line rather than a refusal at runtime.
 *
 * `Covers` and `Excludes` are separate on purpose. One conditional checking
 * `A extends B ? B extends A ? …` would report a single failure and leave a
 * reader to work out which way round it went; two named aliases say whether a
 * kind is missing from this channel or present in it and routed elsewhere,
 * which are opposite repairs.
 *
 * A mutual `extends` constraint on one generic — `<A extends B, B extends A>` —
 * was the first spelling and TypeScript rejects it as a circular constraint.
 */
type Covers<Whole, Listed extends Whole> = Listed;
type Excludes<Listed, Whole extends Listed> = Whole;
type ChannelKind = z.infer<typeof mupdfCommandSchema>['kind'];
export type MupdfChannelCoversEveryRoutedKind = Covers<ChannelKind, KindsRoutedTo<'mupdf'>>;
export type MupdfChannelExcludesEveryOtherKind = Excludes<ChannelKind, KindsRoutedTo<'mupdf'>>;

/**
 * How long a handed path may be.
 *
 * Bounded because every field on this wire is, not because a long path is the
 * hazard here — these travel main → host, and main composed them. `\\?\`-form
 * Windows paths exceed `MAX_PATH`, so the bound is well clear of 260 rather
 * than at it.
 */
export const ENGINE_PATH_MAX_CHARS = 1024;

/**
 * The file name main asks the host to write its serialised bytes into.
 *
 * Minted by MAIN and travelling main → host, which is the point: main joins
 * this to a directory it created, so the name it joins is one it chose. The
 * allowlist is the same shape the handed directory names use — hex and hyphen,
 * nothing that can spell a separator, a parent, a device name or a stream —
 * and it carries **no extension**, because MuPDF picks a writer from a file
 * extension and invariant 23 keeps that dispatch closed.
 */
export const outputNameSchema = z
  .string()
  .min(1)
  .max(ENGINE_SESSION_ID_MAX_CHARS)
  .regex(/^[0-9a-f-]+$/u);

const pathSchema = z.string().min(1).max(ENGINE_PATH_MAX_CHARS);

/**
 * One attempt's outcome, exactly as `containment.ts` defines it.
 *
 * The code's bound and charset are imported rather than restated: the host
 * composes with `probeCode` and this validates the same rule, so there is no
 * pair of spellings that can drift into a host producing codes its own channel
 * refuses (B3a).
 */
const probeCodeSchema = z.string().min(1).max(PROBE_CODE_MAX_CHARS).regex(PROBE_CODE_PATTERN);

const probeOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read'), bytes: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('refused'), code: probeCodeSchema }).strict(),
  z.object({ kind: z.literal('absent'), code: probeCodeSchema }).strict(),
  z.object({ kind: z.literal('error'), code: probeCodeSchema }).strict(),
]);

/**
 * How a WRITER SHAPE looks on the wire — everything about a host's protocol
 * that is decided by `writerShapes` rather than by which library is behind it
 * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md),
 * as corrected 2026-09-09).
 *
 * ## Why this is one object and not six parameters
 *
 * The first attempt spread these across `CoreChannelSchemas` beside the command
 * union, and that spelling said the differences are each engine's — which is
 * exactly what the correction found to be false. They are `byte-image`'s and
 * `live-session`'s, and there are two of them: {@link liveSessionWire} and
 * {@link byteImageWire}. A third engine of either shape takes the matching
 * constant and supplies only its commands, which is what makes *one host body,
 * parameterised by engine* a claim about a parameter rather than about a set of
 * parallel ones.
 */
export interface WireShape<
  TOpen extends z.ZodRawShape,
  TOpenFailure extends readonly string[],
  TRead extends z.ZodRawShape,
  TWrite extends z.ZodRawShape,
  TWrote extends z.ZodType,
  TTransferFailure extends readonly string[],
> {
  /**
   * What `engine/open` carries beyond the two granted directories.
   *
   * `{ snapshotName }` for a **live-session** engine: its open opens a
   * *document* and keeps the parse. Empty for a **byte-image** engine, whose
   * open registers the granted area and nothing else — at that moment there is
   * no document, and the area's lifetime is the host's rather than any
   * document's.
   */
  readonly open: TOpen;
  /**
   * What `engine/open` can fail with.
   *
   * `['open-failed']` for a live-session engine, which parses. **Empty** for a
   * byte-image one, which does not: registering an area the host was granted
   * has nothing in it that can go wrong, and declaring a failure it cannot
   * produce is what ADR-0048 refuses one channel up.
   */
  readonly openFailures: TOpenFailure;
  /**
   * Where this engine READS the document image it is about to work on.
   *
   * Empty for a live-session engine, whose session *is* the parse it is
   * holding. `{ from: outputNameSchema }` for a byte-image engine, which holds
   * no parse between commands and is handed the bytes each time (ADR-0047).
   *
   * A NAME, never a place: the directory is the one this host's area granted.
   * So nothing here lets a caller point the host at a path it was not granted,
   * and Decision 2's containment property survives a decision about where a
   * parse lives.
   */
  readonly read: TRead;
  /**
   * Where this engine WRITES what a command produced.
   *
   * {@link read}'s sibling in the other direction, and empty for the same
   * reason: a live-session apply mutates the session and produces nothing to
   * write. `{ into: outputNameSchema }` for a byte-image engine, whose apply
   * answers new bytes.
   */
  readonly write: TWrite;
  /**
   * What a write ANSWERS — `engine/apply` and `engine/invert`'s result.
   *
   * `z.object({}).strict()` for a live-session engine; a byte count for a
   * byte-image one, which is `engine/serialise`'s own result schema and is not
   * a coincidence: a byte-image `engine/apply` **is** that channel's job and
   * this engine's apply in one call.
   *
   * `CommandExecution<W>` declared this asymmetry before any of it was built —
   * `apply` returns `Promise<ByteImage>` for a byte-image writer and
   * `Promise<void>` for a live-session one — so this is that sentence reaching
   * the wire rather than a new idea.
   */
  readonly wrote: TWrote;
  /**
   * What a call that names a **transfer** can fail with, beyond the codes every
   * host declares.
   *
   * Empty for a live-session engine: an apply against a parse the host is
   * holding can miss the session or the ADR-0044 asset, and both are already
   * declared. A byte-image engine adds two — the input image can be gone
   * (`asset-missing`, ours), and the engine can refuse the call against those
   * bytes (`engine-refused`, nobody's fault but not the host's health).
   *
   * **The second is the correction's own consequence.** Decision 3 put that
   * failure at `engine/open`; withdrawing it moves the failure to the call that
   * needed the engine, which is the moment it actually matters — a document the
   * viewer can display and PDFium cannot parse refuses one command rather than
   * being poisoned.
   */
  readonly transferFailures: TTransferFailure;
}

/**
 * The three schemas a core channel set cannot be built without, plus the wire
 * shape of the writer it serves.
 *
 * The three carry the engine's own **commands**, which is exactly what
 * `CommandExecution<W>` binds per writer. The fourth carries everything
 * `writerShapes` decides, and is one of two constants rather than a set of
 * fields.
 */
export interface CoreChannelSchemas<
  TCommand extends z.ZodType,
  TCapture extends z.ZodType,
  TInverse extends z.ZodType,
  TWire,
> {
  /** The union of commands routed to this engine. `mupdfCommandSchema`. */
  readonly command: TCommand;
  /** What a capture answers for those commands. */
  readonly capture: TCapture;
  /** The prior state an invert restores. */
  readonly inverse: TInverse;
  /** {@link liveSessionWire} or {@link byteImageWire}. */
  readonly wire: TWire;
}

/**
 * The wire of a writer whose session is a parse the host holds.
 *
 * MuPDF's, and any future live-session engine's. Read it against
 * {@link byteImageWire} — the pair is the whole of what `writerShapes` decides
 * about a host's protocol, and the two being constants is what stops an engine
 * inventing a third arrangement.
 */
export const liveSessionWire = {
  open: { snapshotName: outputNameSchema },
  openFailures: ['open-failed'],
  read: {},
  write: {},
  wrote: z.object({}).strict(),
  transferFailures: [],
} as const satisfies WireShape<
  z.ZodRawShape,
  readonly string[],
  z.ZodRawShape,
  z.ZodRawShape,
  z.ZodType,
  readonly string[]
>;

/**
 * The wire of a writer whose session is the document's bytes.
 *
 * PDFium's, and any future byte-image engine's that runs in a host. Every call
 * names where its image is; a write also names where its result goes and
 * answers how many bytes arrived.
 *
 * **`engine-refused` is where ADR-0048's withdrawn Decision 3 went.** That
 * decision put *this engine cannot read this document* at `engine/open`; main's
 * answer to a failed open is to poison the document, which is right for the
 * engine a document is read through and wrong for one only needed to edit. So
 * the failure belongs to the call that wanted the engine.
 */
export const byteImageWire = {
  open: {},
  openFailures: [],
  read: { from: outputNameSchema },
  write: { into: outputNameSchema },
  wrote: z.object({ bytes: z.number().int().nonnegative() }).strict(),
  transferFailures: ['asset-missing', 'engine-refused'],
} as const satisfies WireShape<
  z.ZodRawShape,
  readonly string[],
  z.ZodRawShape,
  z.ZodRawShape,
  z.ZodType,
  readonly string[]
>;

/**
 * The **six** channels a contained host owes whatever engine it holds
 * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md),
 * as corrected the same day).
 *
 * ## It was SEVEN, and `engine/serialise` is the one that left
 *
 * That channel means *write the session's current bytes into the output
 * directory*, and a byte-image host's session has no current bytes — it holds a
 * granted area and no parse. A host declaring it would answer by copying its
 * input to its output, which is that ADR's own *process answering questions
 * with nothing behind it* wearing a working channel's shape.
 *
 * It lives in {@link liveSessionChannels} instead, and the rule the correction
 * states is the transferable part: **a channel is engine-agnostic when its
 * ANSWER means the same thing, not when every engine can be asked it.**
 *
 * ## Why a factory and not a constant
 *
 * Three of the six are engine-agnostic outright: a probe, an open and a close
 * say nothing about which library is behind them. Three carry the engine's
 * command union, and **that union is derived per writer** from the routing
 * table — so a constant would have to name one engine's, which is the thing
 * §3's amendment forbids a second host from copying. Those same three also
 * carry {@link CoreChannelSchemas.read} and {@link CoreChannelSchemas.write},
 * which is where the two writer shapes differ on the wire.
 *
 * ## It infers with no cast, which is what made this shape available
 *
 * `channel()` is generic in its params, result and failure tuple, and this
 * function's three type parameters flow straight into it. Nothing here needs an
 * assertion, and that matters: a factory that needed one would be a place where
 * the schemas and the types could disagree, inside the boundary discipline
 * every other channel in the repository takes from `packages/contract`.
 *
 * **The document-model reads are NOT here**, and that is Decision 1: they
 * are MuPDF's model, answered by MuPDF's host. A second engine owes none of
 * them, and a host that declared them and stubbed them would be a process
 * answering questions with nothing behind it.
 */
export function coreEngineChannels<
  TCommand extends z.ZodType,
  TCapture extends z.ZodType,
  TInverse extends z.ZodType,
  TOpen extends z.ZodRawShape,
  const TOpenFailure extends readonly string[],
  TRead extends z.ZodRawShape,
  TWrite extends z.ZodRawShape,
  TWrote extends z.ZodType,
  const TTransferFailure extends readonly string[],
>(
  schemas: CoreChannelSchemas<
    TCommand,
    TCapture,
    TInverse,
    WireShape<TOpen, TOpenFailure, TRead, TWrite, TWrote, TTransferFailure>
  >,
) {
  const wire = schemas.wire;
  return {
    /**
     * ADR-0023 §5's startup check, and the ONE channel whose answer decides
     * whether this host is allowed to see a document at all.
     *
     * ## The request carries two paths and nothing else
     *
     * `classifyContainment` takes a request AND a report, and the request half
     * stays in main: `negative.readableBytes` is main's own reading taken
     * immediately before the ask, and `positive.origin` is main's knowledge of
     * which path it named. Neither crosses. So the host supplies
     * **observations** and main supplies **everything the observations are
     * judged against** — a host that wanted a `contained` verdict cannot reach
     * the inputs that produce one, which is the split `containment.ts`
     * describes as *measured inside, decided outside* expressed in the wire
     * shape rather than in a comment (B5).
     *
     * ## And the answer carries no path, like every other answer here
     *
     * Two outcomes and, at most, an errno. The paths in the report's detail
     * lines are the ones main sent, joined on this side. That is the same
     * asymmetry the lifecycle channels have, for the same reason.
     *
     * No declared failures. A probe that could not read is not a failed call —
     * it is an observation, and `absent`/`error` are how it says so. Collapsing
     * that into a channel failure would put *could not look* and *the call
     * broke* in one output, which is the distinction this whole mechanism turns
     * on.
     */
    'engine/probe-containment': channel(
      'Attempts two paths and one loopback port, reporting what happened and judging nothing.',
      z
        .object({
          positive: pathSchema,
          negative: pathSchema,
          // A port and nothing else. `mainReadBytes` — the evidence the verdict
          // is reached against — stays in main and never crosses (ADR-0023
          // Decision 15).
          loopbackPort: z.number().int().min(1).max(65_535),
        })
        .strict(),
      z
        .object({
          positive: probeOutcomeSchema,
          negative: probeOutcomeSchema,
          loopback: probeOutcomeSchema,
        })
        .strict(),
    ),

    /**
     * Registers a granted area, and — for a live-session engine — the parse it
     * keeps
     * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)).
     *
     * The two directories are held against the id this answers with, never
     * carried per call, and that is a containment property rather than a
     * convenience: `HostSession`'s own comment says a `serialise` that carried
     * a directory would be a channel through which a confused main could
     * redirect the document's bytes on every save. A byte-image host holds no
     * parse between commands and still holds the area, for exactly that reason.
     *
     * **What it does NOT do is parse**, and that is ADR-0048's withdrawn
     * Decision 3. A byte-image open registers the area and stops: at that
     * moment there is no document, its area's lifetime is the host's rather
     * than any document's, and *this engine cannot read this document* belongs
     * to the call that wanted the engine — because main answers a failed open
     * by poisoning the document, which is right for the engine a document is
     * read through and wrong for one only needed to edit.
     *
     * So `snapshotName` and `open-failed` come from the wire shape rather than
     * from this literal.
     */
    'engine/open': channel(
      'Registers a granted area, and for a live-session engine opens the document in it.',
      z
        .object({
          /** The directory main granted this session READ on. */
          snapshotDirectory: pathSchema,
          /** The directory main granted this session MODIFY on. */
          outputDirectory: pathSchema,
          ...wire.open,
        })
        .strict(),
      // The host mints the identity (Decision 10b). Main holds a token it
      // cannot dereference, and this string is what the adapter records beside
      // it.
      z.object({ session: sessionSchema }).strict(),
      wire.openFailures,
    ),

    'engine/close': channel(
      'Releases the session’s native resources.',
      z.object({ session: sessionSchema }).strict(),
      z.object({}).strict(),
      ['no-such-session'],
    ),

    'engine/apply': channel(
      'Applies one command routed to this host’s engine to a session it holds.',
      z
        .object({
          session: sessionSchema,
          command: schemas.command,
          /**
           * The source document's session, for a `sources: 'one'` command.
           *
           * **A second SESSION TOKEN, which is why ADR-0040 needs no new
           * process shape**: both documents are sessions in this same host, so
           * what crosses is another handle this host already holds — never
           * bytes, and never a path.
           *
           * Optional because eleven of the twelve MuPDF-routed commands name no
           * second document. It is `.optional()` rather than nullable for the
           * reason `mergeDocumentSchema` is not: this is a field that may be
           * absent from the message, not a value that may be null, and the two
           * spellings mean different things to a caller.
           *
           * A token this host does not hold answers `no-such-session` exactly
           * as the target's does — the handler looks both up the same way, so a
           * closed source is the same ordinary race as a closed target.
           */
          source: sessionSchema.optional(),
          /**
           * The file in this session's snapshot directory holding the command's
           * bytes, for an `asset: 'bytes'` command
           * ([ADR-0044](../../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)).
           *
           * **A NAME, and the directory is the one this session was opened
           * from** — the host already holds it, so nothing here lets a caller
           * name a place. That is the same shape `engine/open`'s `snapshotName`
           * has and deliberately so: an asset arrives by the door the document
           * arrived by, in the direction the host may only read.
           *
           * Optional because twenty-three of the twenty-four MuPDF-routed
           * commands carry no asset, and `.optional()` rather than nullable for
           * `source`'s reason — a field absent from the message, not a value
           * that may be null.
           */
          asset: outputNameSchema.optional(),
          /**
           * Where the document image is, and where the result goes — **for a
           * byte-image engine only**, and absent from a live-session engine's
           * schema rather than optional in it.
           *
           * That is the difference between a field a caller may omit and a
           * field a caller cannot express (B5). Main's MuPDF client has no
           * `into` to fill in; main's PDFium client cannot leave one out.
           */
          ...wire.read,
          ...wire.write,
        })
        .strict(),
      wire.wrote,
      ['no-such-session', 'asset-missing', ...wire.transferFailures],
    ),

    'engine/capture': channel(
      'Reads prior state for one command routed to this host’s engine, before it is applied.',
      z
        .object({
          session: sessionSchema,
          command: schemas.command,
          /**
           * `engine/apply`'s field, and a capture needs it for a reason that is
           * not the obvious one: **no capture reads an asset** — prior state is
           * what was there before, and bytes arriving with the command are not
           * that. It is here because the command must be whole to be handed to
           * `CommandExecution.capture`, whose parameter is the command.
           *
           * So this costs one extra write and read of the image per placement,
           * and the alternative was measured against and rejected on shape
           * rather than on cost: keeping the file alive from capture until
           * apply makes its lifetime span two calls, and a capture with no
           * apply after it — a refusal, a closed document, a dead host — leaks
           * it with nothing left holding the name.
           */
          asset: outputNameSchema.optional(),
          /**
           * Where the document image is — **for a byte-image engine only**, as
           * on `engine/apply`.
           *
           * There is no `write` half here: a capture reads prior state and
           * produces no bytes, whichever shape the engine is. So the two halves
           * are separate parameters rather than one *transfer* shape, and this
           * channel is where that separation earns its keep.
           */
          ...wire.read,
        })
        .strict(),
      schemas.capture,
      ['no-such-session', 'asset-missing', ...wire.transferFailures],
    ),

    'engine/invert': channel(
      'Restores prior state recorded by an earlier capture.',
      z
        .object({
          session: sessionSchema,
          inverse: schemas.inverse,
          ...wire.read,
          ...wire.write,
        })
        .strict(),
      wire.wrote,
      ['no-such-session', ...wire.transferFailures],
    ),
  };
}

/**
 * The channel a **live-session** engine owes on top of the six, and a
 * byte-image engine does not
 * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)'s
 * correction of 2026-09-09).
 *
 * ## Why it is a factory returning one channel rather than a constant
 *
 * Symmetry with {@link coreEngineChannels}, and it is worth the extra call: a
 * constant spread into `engineChannels` would read as *part of the core set,
 * kept separate for tidiness*. A named function called *the live-session
 * channels* says what the separation is about, and the day a second
 * live-session engine arrives it takes this one call rather than copying a
 * channel definition.
 *
 * There is nothing to parameterise, which is why it takes no schemas: a
 * serialise names a session and an output file, and both are the same shape for
 * any engine that holds a parse.
 */
export function liveSessionChannels() {
  return {
    'engine/serialise': channel(
      'Writes the session’s current bytes into the output directory, under a name main chose.',
      z.object({ session: sessionSchema, into: outputNameSchema }).strict(),
      // A COUNT, NOT A NAME. Main already knows where it asked for the bytes;
      // what it cannot know without being told is how many arrived, and
      // comparing that against the file it reads separates "the host wrote
      // nothing" from "the read found nothing" — which are otherwise the same
      // empty buffer.
      //
      // A byte-image `engine/apply` answers this same shape, and that is the
      // correction's whole point rather than a coincidence: an apply that
      // writes its result IS this channel's job, so the engine that does not
      // hold a parse does not owe it separately.
      z.object({ bytes: z.number().int().nonnegative() }).strict(),
      ['no-such-session', 'serialise-failed'],
    ),
  };
}

export const engineChannels = {
  ...coreEngineChannels({
    command: mupdfCommandSchema,
    capture: captureResultSchema,
    inverse: inverseSchema,
    // THE SHAPE, NOT A SET OF FIELDS. MuPDF is `writerShapes`' one live-session
    // entry, so its wire is the constant every live-session engine takes: an
    // open that opens a document, no image named on the way in, nothing written
    // on the way out, and an apply that answers nothing — which is
    // `CommandExecution<'mupdf'>.apply`'s `Promise<void>` on the wire.
    wire: liveSessionWire,
  }),
  // THE LIVE-SESSION CHANNEL. MuPDF holds a parse between commands, so it owes
  // the channel that hands the parse's bytes back (ADR-0048's correction).
  ...liveSessionChannels(),

  'engine/extract': channel(
    'Writes a NEW document made of the named pages into the output directory.',
    z
      .object({
        session: sessionSchema,
        /** Zero-based indices in the session's document, in the order asked. */
        pages: z.array(z.number().int().nonnegative()).min(1).max(ENGINE_EXTRACT_PAGES_MAX),
        into: outputNameSchema,
      })
      .strict(),
    // A COUNT, for `engine/serialise`'s reason: main knows where it asked for
    // the bytes and cannot know how many arrived, and comparing that against
    // the file it reads separates "the host wrote nothing" from "the read found
    // nothing" — otherwise the same empty buffer.
    z.object({ bytes: z.number().int().nonnegative() }).strict(),
    ['no-such-session', 'extract-failed'],
  ),

  /**
   * A region of one page, rasterised to a PNG in the output directory.
   *
   * ## THE RASTER NEVER CROSSES, which is why this is a channel at all
   *
   * §9.17's gate says no raster crosses the boundary, and the way this row
   * satisfies it is the way `engine/extract` satisfies invariant 20: the bytes
   * are built where the engine is and written into the granted directory, and
   * what travels is a rectangle and a count. A channel answering PNG bytes
   * would be the one payload that scales with what the user dragged.
   *
   * The rectangle is PDF user space, as every annotation payload is, because
   * the drag that produced it went through the one adapter — and the kernel
   * converts through the same `placedRect` a placement is mapped with.
   */
  // `snapshotRegion` AND NOT `snapshot`, for the reason `RegionRequest` carries
  // in `pageSnapshot.ts`: `engine/open` two channels above takes a
  // `snapshotDirectory` and a `snapshotName`, and those are the CANONICAL BYTE
  // IMAGE. A channel called `engine/snapshot` beside them would read as the one
  // that writes those bytes out.
  'engine/snapshotRegion': channel(
    'Rasterises a region of one page to a PNG in the output directory.',
    z
      .object({
        session: sessionSchema,
        page: z.number().int().nonnegative(),
        /** The region in PDF user space; need not be ordered. */
        rect: annotationRectSchema,
        /** Device pixels per PDF point. The kernel holds the bounds. */
        scale: z.number().positive(),
        into: outputNameSchema,
      })
      .strict(),
    // A COUNT, for `engine/serialise`'s reason, and the same one applies to a
    // raster: main knows where it asked for the bytes and cannot know how many
    // arrived without being told.
    //
    // AND THE FRAME, since ADR-0052's 2026-09-12 addition. D6 row 8's cloud
    // recogniser is handed this PNG, gets word boxes back in the PNG's own
    // pixels, and has to put them on the page — which needs the displayed crop,
    // the effective rotation and where the raster's (0, 0) sits. All three are
    // facts only the host can read, and main's use of them is to call
    // `pageTransform` and `toPdf`, the one converter, as a reader.
    //
    // Nine numbers, and every one of them bounded: a hostile host sending
    // `Infinity` for a crop edge would otherwise reach a transform.
    z
      .object({
        bytes: z.number().int().nonnegative(),
        crop: ocrBoxSchema,
        // THE FOUR LEGAL VALUES, not any multiple of 90: `snapRotation` has
        // already resolved inheritance and snapped, so anything else is a host
        // answering about a page shape this build cannot produce.
        rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
        origin: z.tuple([z.number(), z.number()]).readonly(),
      })
      .strict(),
    ['no-such-session', 'snapshot-failed'],
  ),

  /**
   * The view model's geometry half (`docs/ARCHITECTURE.md` §2), read from the
   * process that holds the session.
   *
   * ## Why it is a channel rather than something main works out
   *
   * Main holds bytes and never parses (invariant 20), and the rotation the
   * renderer needs is the one the **session** is at — which, after a command,
   * is not the one main's canonical image carries (finding OOOOO-1). So the
   * question can only be answered here.
   *
   * ## The REQUEST names the pages, which is what keeps L11 satisfied
   *
   * One rotation per page scales with the document, so a channel that answered
   * the whole vector would put a document-sized payload on the command path the
   * moment anything re-read it. The caller names the pages it is about to draw,
   * exactly as `document.readRange` names the bytes it is about to parse, and
   * the bound is the request's own length.
   *
   * The rotations carry no page identity: they are positionally aligned with the
   * request, so an answer that lost an entry is a different length rather than a
   * plausible one. The page **count** is a scalar and always crosses.
   */
  'engine/page-geometry': channel(
    'Reads the named pages’ effective rotations from a session this host holds.',
    z
      .object({
        session: sessionSchema,
        /** Zero-based indices, as `commands.ts` declares them. */
        // `.readonly()`, so the inferred wire type IS `readonly number[]` — the
        // same reason the inverse schema carries one, and what lets the adapter
        // pass a caller's array through rather than copying it to satisfy a
        // mutable parameter.
        pages: z
          .array(z.number().int().nonnegative())
          .max(ENGINE_GEOMETRY_MAX_PAGES)
          .readonly(),
      })
      .strict(),
    z
      .object({
        pageCount: z.number().int().nonnegative(),
        // A QUARTER TURN, snapped the way MuPDF snaps it, checked here so a
        // host that stopped snapping is refused at the boundary rather than
        // reaching a viewport.
        //
        // `refine` rather than a union of literals, and the difference is which
        // side pays. A union would infer `(0|90|180|270)[]`, and `snapRotation`
        // returns `number` — it is a port of C arithmetic whose range the
        // compiler cannot see — so the handler would need a cast, which is the
        // point at which the type stops carrying the property it claims. The
        // refinement checks the same set and leaves the static type honest.
        //
        // `.readonly()` for the reason the inverse schema carries one: it makes
        // the inferred wire type `readonly number[]`, which IS
        // `PageGeometry['rotations']`, so the handler type-checks rather than
        // being asserted into place.
        rotations: z
          .array(
            z
              .number()
              .int()
              .refine((value) => value >= 0 && value < 360 && value % 90 === 0, {
                message: 'a rotation must be a quarter turn: 0, 90, 180 or 270',
              }),
          )
          .readonly(),
      })
      .strict(),
    ['no-such-session'],
  ),

  /**
   * One page's text, structured, from the process that holds the session.
   *
   * ## Why it is a channel, and why it carries text rather than matches
   *
   * The same reason geometry is: main holds bytes and never parses, so only the
   * host can answer. It carries the page's **text** rather than a query's
   * matches because searching is not the engine's concern — the substrate's
   * reading order is what search consumes, and putting a query here would make
   * the host stateful about something that is not a document
   * ([ADR-0035](../../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)
   * rejects a per-search cache in the host for that reason).
   *
   * ## ONE PAGE, and the singular is the L11 mechanism
   *
   * A page array here would let a caller ask for the document, which is exactly
   * what ADR-0035 forbids main to hold: measured, a text-heavy document's
   * extracted text is 3.59× its bytes. Geometry can carry a bounded window
   * because a rotation is one number; a page's text is unbounded by the page's
   * content, so the only honest bound is *one page*, and a schema that cannot
   * express more is B5 over a limit somebody has to remember.
   *
   * ## The payload is MuPDF's own JSON, unparsed
   *
   * `parsePageText` is the one reader of it (§3.2), and it lives main-side so
   * the host ships no opinion about the structure. Re-serialising a parsed shape
   * here would be a second format for the same answer, and the frame would then
   * describe a tree this build invented rather than the one MuPDF computed.
   */
  'engine/page-text': channel(
    'Reads one page’s structured text from a session this host holds.',
    z
      .object({
        session: sessionSchema,
        /** Zero-based index, as `commands.ts` declares them. */
        page: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        /**
         * MuPDF's structured-text JSON for that page.
         *
         * Bounded by {@link ENGINE_PAGE_TEXT_MAX_BYTES} rather than trusted: the
         * host is hostile by invariant 25's own premise, and an unbounded string
         * is a peer deciding how many bytes of our frame it spends — the same
         * argument the session id and the correlation id already make.
         */
        json: z.string().max(ENGINE_PAGE_TEXT_MAX_BYTES),
      })
      .strict(),
    ['no-such-session'],
  ),

  /**
   * One page's links.
   *
   * ## PARSED HERE, unlike the text beside it, and the difference is who owns
   *   the format
   *
   * `engine/page-text` carries MuPDF's JSON unread, because MuPDF owns that
   * format and a host that parsed it would be shipping an opinion about a tree
   * it did not compute. A link is not a format: it is three values MuPDF hands
   * back through an API, and there is no serialisation to preserve. So the
   * shape crosses declared, and the schema is what bounds it.
   *
   * **The internal/external split crosses too**, because it is the engine that
   * knows — `isExternal()` is MuPDF's answer, and a reader working it out from
   * the URI would be a second opinion about a question the authority already
   * answers (B3a). Invariant 24 rests on that split: a surface may jump to an
   * internal destination and must ask before following an external one.
   */
  /**
   * One page's characters and their boxes, recognised where the raster is.
   *
   * ## Why it is a channel, and what it keeps on this side of the pipe
   *
   * §3's matrix puts OCR recognition inside the engine host, beside the
   * rasteriser that feeds it — so the raster is produced and consumed in one
   * process and **no bitmap crosses**, which is §9.17's gate satisfied by
   * construction rather than by a bound. Measured: one A4 page at 200 dpi is
   * 1.7 MB of PNG, against about 20 KB of text and boxes.
   *
   * ## The BOXES ARE IN PDF USER SPACE, and that is decided by `ocrRecognise.ts`
   *
   * Tesseract answers in raster pixels, y-down. Converting at the boundary here
   * would make this schema the second place that knows the dpi, which is the
   * wired pair's coordinate blind spot arriving on a wire. The host converts,
   * because it holds the matrix it rasterised with and the box it rasterised
   * from, and nothing on this channel is a pixel.
   *
   * ## The model directory is a PATH THIS HOST WAS GRANTED
   *
   * `engine/open`'s rule: the path is used, not validated. Main composed the
   * grant and wrote the DACL; this process reaches the directory because it was
   * given it and would reach nothing by being told a name it was not. The
   * language is a closed enum, which is what keeps ADR-0014 constraint 1 true —
   * a name from fourteen supplies no file and no path.
   */
  /**
   * ## TWO ENGINES, ONE CHANNEL, AND THE ARMS ARE NOT INTERCHANGEABLE
   *
   * [ADR-0052](../../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)
   * Decision 1: the request names the engine and nothing else in the build
   * chooses. A second channel would put *which recogniser* in as many places as
   * there are callers.
   *
   * A **discriminated union** rather than one object with optional extras,
   * because the two engines do not accept the same request and B5 says make the
   * difference unrepresentable rather than checked:
   *
   * - `tesseract` takes a language and an OPTIONAL region — the page is the
   *   absence of one.
   * - `handwriting` takes a REQUIRED region and a model size, and no language:
   *   TrOCR reads one text line at seconds per line, so a page-scoped request is
   *   not a thing this channel can express (Decision 4), and its repositories
   *   are English so a language field would be a value nothing could honour.
   *
   * Each arm carries **its own** `modelDirectory`, which is the half that
   * matters at a hostile boundary: the two caches hold different things, and a
   * shared field would let a confused main hand the handwriting loader the
   * tessdata directory and get *model unreadable* instead of a compile error.
   */
  'engine/ocr-page': channel(
    'Recognises text and boxes for a page or a region, inside the process that holds the raster.',
    z.discriminatedUnion('engine', [
      z
        .object({
          engine: z.literal('tesseract'),
          session: sessionSchema,
          /** Zero-based index, as `commands.ts` declares them. */
          page: z.number().int().nonnegative(),
          language: ocrLanguageSchema,
          /**
           * A rectangle of the page to read instead of all of it, in PDF user space.
           *
           * D6 row 6. Bounded by `ocrBoxSchema`'s own shape — four numbers — and
           * absent for a whole page, which is the same distinction `OcrRequest` makes
           * one layer in: *the page* and *a rectangle that happens to cover it* are
           * different requests.
           */
          region: ocrBoxSchema.optional(),
          /** The directory main granted this host READ on for the models. */
          modelDirectory: pathSchema,
        })
        .strict(),
      z
        .object({
          engine: z.literal('handwriting'),
          session: sessionSchema,
          page: z.number().int().nonnegative(),
          /** REQUIRED. This engine is never offered on a page. */
          region: ocrBoxSchema,
          size: trocrSizeSchema,
          /** The cache main downloaded the runtime and models into, and granted. */
          modelDirectory: pathSchema,
        })
        .strict(),
    ]),
    z
      .object({
        lines: z
          .array(
            z
              .object({
                text: z.string().max(ENGINE_OCR_LINE_TEXT_MAX),
                box: ocrBoxSchema,
                words: z
                  .array(
                    z
                      .object({
                        text: z.string().max(ENGINE_OCR_WORD_TEXT_MAX),
                        box: ocrBoxSchema,
                        // TESSERACT'S OWN SCALE, 0 to 100, refused outside it.
                        // A hostile host sending 10,000 would reach a UI that
                        // renders a confidence as a proportion.
                        confidence: z.number().min(0).max(100),
                      })
                      .strict(),
                  )
                  .max(ENGINE_OCR_WORDS_PER_LINE_MAX)
                  .readonly(),
              })
              .strict(),
          )
          .max(ENGINE_OCR_LINES_MAX)
          .readonly(),
        confidence: z.number().min(0).max(100),
        language: ocrLanguageSchema,
      })
      .strict(),
    // A MODEL THAT CANNOT BE READ IS ITS OWN STATE, and not `ocr-failed`: the
    // two are answered by different people. A grant or a provisioning problem is
    // main's to fix; a page Tesseract will not read is this row's.
    ['no-such-session', 'ocr-failed', 'ocr-model-unreadable'],
  ),

  'engine/page-links': channel(
    'Reads one page’s links from a session this host holds.',
    z
      .object({
        session: sessionSchema,
        /** Zero-based index, as `commands.ts` declares them. */
        page: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        /**
         * The page's links, bounded in COUNT rather than trusted.
         *
         * The host is hostile by invariant 25's own premise, so a document
         * claiming a hundred thousand links on one page is a peer deciding how
         * many bytes of our frame it spends. A page that genuinely carries more
         * than this is a page no reader can use a panel for.
         */
        links: z.array(engineLinkSchema).max(ENGINE_PAGE_LINKS_MAX),
      })
      .strict(),
    ['no-such-session'],
  ),

  /**
   * The document's outline, flattened.
   *
   * **WHOLE-DOCUMENT, and that does not breach invariant 11.** L11 forbids a
   * payload that scales with the document *per operation*; an outline scales
   * with the number of headings an author wrote, which is a property of the
   * document's structure and not of its size. A thousand-page scan has none. It
   * is read once when a document opens rather than per page, so there is no
   * per-operation growth to bound.
   *
   * Bounded anyway, by count, because the host is hostile by invariant 25's own
   * premise and *an author would not do that* is not a guarantee.
   */
  'engine/destinations': channel(
    'Reads the document’s outline from a session this host holds.',
    z.object({ session: sessionSchema }).strict(),
    z
      .object({
        destinations: z.array(engineDestinationSchema).max(ENGINE_DESTINATIONS_MAX),
      })
      .strict(),
    ['no-such-session'],
  ),

  /**
   * The document's optional-content groups.
   *
   * Whole-document for `engine/destinations`' reason: layers are a property of
   * the document's structure, read once when it opens, and a design carries a
   * handful rather than one per page.
   */
  'engine/layers': channel(
    'Reads the document’s optional-content groups from a session this host holds.',
    z.object({ session: sessionSchema }).strict(),
    z.object({ layers: z.array(engineLayerSchema).max(ENGINE_LAYERS_MAX) }).strict(),
    ['no-such-session'],
  ),

  'engine/annotations': channel(
    'Lists every annotation in a session this host holds, in page order.',
    z.object({ session: sessionSchema }).strict(),
    z
      .object({
        annotations: z.array(engineAnnotationSchema).max(ENGINE_ANNOTATIONS_MAX),
        /** Whether the bound stopped the walk. See `engine/duplicate-pages`. */
        truncated: z.boolean(),
      })
      .strict(),
    ['no-such-session'],
  ),

  'engine/form-fields': channel(
    'Lists every AcroForm field in a session this host holds, in page order.',
    z.object({ session: sessionSchema }).strict(),
    z
      .object({
        fields: z.array(engineFormFieldSchema).max(ENGINE_FORM_FIELDS_MAX),
        /** Whether the bound stopped the walk. See `engine/duplicate-pages`. */
        truncated: z.boolean(),
      })
      .strict(),
    ['no-such-session'],
  ),

  /**
   * Writes the form's data out, in one of three encodings, to the granted area.
   *
   * ## The FILE goes through the granted directory, for `engine/extract`'s
   * reason
   *
   * An export is a second document's bytes rather than an answer about this
   * one, and it is built where the engine is because reading the fields reaches
   * MuPDF (invariant 20). Answering the bytes on this pipe would be a payload
   * that scales with the form.
   *
   * ## And there is a reason a channel answering the FIELDS would not do
   *
   * `engine/form-fields` already crosses every field, so a serialiser in main
   * looks free. It is not: that answer is bounded — a value is sliced at
   * `ENGINE_FORM_FIELD_TEXT_MAX` and the list stops at `ENGINE_FORM_FIELDS_MAX`
   * — because it feeds a panel a person reads. An export built from it would be
   * silently truncated at both bounds, which is this row's own subject wearing
   * a boundary's clothes. So the export reads the document, and the bounds that
   * exist for a panel stay where they belong.
   */
  'engine/exportFormData': channel(
    'Writes a session’s form data to a file in the output directory.',
    z
      .object({ session: sessionSchema, format: formDataFormatSchema, into: outputNameSchema })
      .strict(),
    // A COUNT, for `engine/serialise`'s reason: main knows where it asked for
    // the bytes and cannot know how many arrived without being told.
    z.object({ bytes: z.number().int().nonnegative() }).strict(),
    // `unrepresentable` IS SEPARATE FROM `export-failed`, because it is the one
    // failure that names a different format the user can choose instead — XFDF
    // cannot carry a control character and the other two can. Folding it into
    // the general code would tell them the export failed and nothing they could
    // act on.
    ['no-such-session', 'export-failed', 'unrepresentable'],
  ),

  /**
   * Where one page's fields probably are, on a page that has none.
   *
   * **Per PAGE and not per document**, unlike `engine/form-fields` beside it,
   * and the difference is what the answer is for: the field list feeds a panel
   * that describes the whole form, and this feeds a proposal a person reviews
   * on the page in front of them. Walking every page of a long document to
   * offer a hundred candidates is a question nobody asked.
   */
  'engine/flat-fields': channel(
    'Proposes where a flat page’s form fields probably are.',
    z.object({ session: sessionSchema, page: z.number().int().nonnegative() }).strict(),
    z
      .object({
        candidates: z
          .array(
            z
              .object({
                rect: annotationRectSchema,
                label: z.string().max(ENGINE_FLAT_LABEL_MAX),
                name: z.string().max(ENGINE_FLAT_LABEL_MAX),
              })
              .strict(),
          )
          .max(ENGINE_FLAT_CANDIDATES_MAX),
        /** Whether the bound stopped the walk. See `engine/duplicate-pages`. */
        truncated: z.boolean(),
      })
      .strict(),
    ['no-such-session'],
  ),

  'engine/duplicate-pages': channel(
    'Groups pages of a session this host holds whose content and resources are identical.',
    z.object({ session: sessionSchema }).strict(),
    z
      .object({
        groups: z.array(engineDuplicateGroupSchema).max(ENGINE_DUPLICATE_PAGES_MAX),
        /**
         * Whether the bound stopped the report.
         *
         * Computed on THIS side, because only the side that walked the document
         * knows there was more. Main receiving a full array and inferring
         * truncation from its length would be inferring it from the bound it
         * already knows — which answers *you asked for that many* every time.
         */
        truncated: z.boolean(),
      })
      .strict(),
    ['no-such-session'],
  ),

} as const;

export type EngineChannels = typeof engineChannels;

/**
 * The declared failures.
 *
 * `no-such-session` is **an outcome rather than a defect**, and named rather
 * than left to `internal`, because it is reachable without anything being
 * wrong: a host dies, main rebuilds it, and a call issued against the old
 * session arrives at the new process. The supervisor's answer to that is a
 * rebuild, which it cannot decide from an opaque `internal`.
 *
 * `open-failed` and `serialise-failed` are named for a different reason, and it
 * is the one that matters here: they are the **document's** fault, not the
 * host's. A file that is not a PDF, or a save the engine refuses, must not
 * reach the supervisor as evidence that the host is unhealthy — invariant 25's
 * premise is that a host death is a plausible compromise signal, and a
 * rebuild-and-retry loop driven by a document that will never parse is exactly
 * the runaway Decision 9a bounds. Distinguishable codes are what let the
 * supervisor decline to count them.
 */
export type EngineFailureCode =
  | 'no-such-session'
  | 'open-failed'
  | 'serialise-failed'
  // THE DOCUMENT'S FAULT, joining the two above for their reason. An extract
  // whose page list the document cannot satisfy, or a graft the engine refuses,
  // is a statement about that document — and it must not reach the supervisor
  // as evidence the host is unhealthy, because a rebuild-and-retry loop driven
  // by a request that will never succeed is the runaway Decision 9a bounds.
  | 'extract-failed'
  // The third of that class, and a snapshot's refusals are all of that shape: a
  // page the document does not have, a page that displays no region, a region
  // with no extent, a scale outside its bounds. None of them says anything
  // about the host's health.
  | 'snapshot-failed'
  // OURS, and it is the only code here that is. The asset a command named is
  // not in the directory this session reads, which means main wrote it and it
  // went, or main did not write it at all — a defect on our side of the pipe
  // either way. It is a code rather than a throw because the alternative is the
  // handler calling an apply with no bytes to give it, and a distinguishable
  // answer is what stops the supervisor reading our own bug as a sick host.
  | 'asset-missing'
  // NOT THE HOST'S, and it is where ADR-0048's withdrawn Decision 3 went. A
  // byte-image host is handed an image per call, so a document it cannot parse
  // is a per-call outcome; that used to be `open-failed` at `engine/open`, and
  // main answers a failed open by POISONING the document — right for the engine
  // a document is read through, wrong for one only needed to edit.
  //
  // ONE CODE FOR TWO CAUSES, deliberately: a document this engine cannot parse,
  // and a request this document cannot satisfy — a page or an object index it
  // does not have. They are one code because the axis a code exists to separate
  // is *is the host sick*, and neither of them is; main refuses the command
  // either way, and the supervisor rebuilds for neither. A pair of codes here
  // would be two names for one decision.
  | 'engine-refused';
