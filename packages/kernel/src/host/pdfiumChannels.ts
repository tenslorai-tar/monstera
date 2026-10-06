import { z } from 'zod';

import {
  MAX_BLOCK_FONTS,
  MAX_FONT_RUNS,
  MAX_RUN_FONT_BYTES,
  channel,
  fileAnswered,
  deletePageObjectsSchema,
  editTextBlockSchema,
  placePageObjectSchema,
  promoteFormObjectsSchema,
  recolorPageObjectsSchema,
  replaceAllTextSchema,
  replaceTextAtSchema,
  replaceTextObjectSchema,
} from '@monstera/contract/host';

import type { CommandPrior } from '../commandLog.js';
import type { DeclaredCommands } from '../commandDeclarations.js';
import type { KindsRoutedTo } from '../commandRouting.js';
import {
  ENGINE_CAPTURE_REASON_MAX,
  byteImageWire,
  coreEngineChannels,
  sessionSchema,
} from './engineChannels.js';

/**
 * The channel set of the **PDFium** host
 * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)
 * Decision 1, as corrected the same day).
 *
 * ## Six plus one, and that is the whole of what a second engine owes
 *
 * The six `coreEngineChannels` returns, plus **one read of its own**. None of
 * MuPDF's twelve document-model reads: they are MuPDF's model answered by
 * MuPDF's host, and a second host declaring them and stubbing them would be a
 * process answering questions with nothing behind it.
 *
 * Not `engine/serialise` either. That channel means *hand back the bytes you
 * are holding*, and this host holds none — ADR-0047 makes PDFium a byte-image
 * writer, so its `engine/apply` reads an image, applies, writes the result into
 * the granted output directory and answers a count. That count IS
 * `engine/serialise`'s result schema, which is why the channel does not appear
 * here twice under two names.
 *
 * ## Its own file rather than a second entry in `engineChannels.ts`
 *
 * The map in that file is MuPDF's, and its own header says its document-model
 * reads are MuPDF's. Adding a PDFium map beside them would put two engines'
 * wire surfaces in one module and make *which channels does this host serve* a
 * question about which half of a file you are reading. `EngineChannelsFor<W>`
 * is a type; this is where the value lives.
 *
 * ## Nothing here binds PDFium
 *
 * Schemas and channel definitions only. The adapter is behind
 * `@monstera/kernel/pdfium` and reached by `pdfiumHostEntry.ts`, so main's
 * client can import this map to make its calls without loading a native
 * library — which is the same property `engineChannels.ts` has for MuPDF and
 * the reason a channel's definition may live in `packages/kernel` at all.
 */

/**
 * The commands this host may be asked to run — the PDFium-routed ones.
 *
 * ## Written out, for `mupdfCommandSchema`'s reason
 *
 * A filter over `commandSchema.options` needs two assertions and its narrowing
 * has to be re-stated by a cast, which is a list with a cast in front of it.
 * Written out, the inference is exact — and the pair of aliases below buys back
 * what a list gives up: an omission fails `Covers`, an extra fails `Excludes`,
 * both at this line rather than as a runtime refusal.
 *
 * This was a union of ONE, kept as a `discriminatedUnion` rather than a
 * `z.object` on the reasoning that the second PDFium command was a row in this
 * same stage. It arrived on 2026-09-10 — three of them — and the shape needed
 * no edit beyond three names, which is the note being paid rather than merely
 * having been right.
 */
const pdfiumCommandSchema = z.discriminatedUnion('kind', [
  replaceTextObjectSchema,
  placePageObjectSchema,
  recolorPageObjectsSchema,
  deletePageObjectsSchema,
  promoteFormObjectsSchema,
  replaceAllTextSchema,
  replaceTextAtSchema,
  editTextBlockSchema,
]);

/** What travels as a command to this host. */
export type PdfiumWireCommand = z.infer<typeof pdfiumCommandSchema>;

type Covers<Whole, Listed extends Whole> = Listed;
type Excludes<Listed, Whole extends Listed> = Whole;
type PdfiumChannelKind = z.infer<typeof pdfiumCommandSchema>['kind'];
export type PdfiumChannelCoversEveryRoutedKind = Covers<
  PdfiumChannelKind,
  KindsRoutedTo<'pdfium'>
>;
export type PdfiumChannelExcludesEveryOtherKind = Excludes<
  PdfiumChannelKind,
  KindsRoutedTo<'pdfium'>
>;

/**
 * How many text objects one page's answer may name — a bound against a HOSTILE host, derived, and one no real page
 * reaches ([ADR-0130](../../../../docs/DECISIONS/0130-a-documents-size-never-refuses-an-action.md) Decision 3).
 *
 * ## It was 8,192, a guess about real pages, and a real page passed it
 *
 * A producer that draws one text object per glyph puts 8,400 on a page of 60 lines × 140 characters, and the page was
 * answered truncated: *"more text than can be outlined at once"*, and the rest could not be edited. The host now joins
 * a run's glyph objects before it answers (`textRunJoin.ts`), so that page answers 60 runs; and what stays here is the
 * bound against a peer that is not a document at all: the most runs an answer within `ENGINE_ANSWER_FILE_MAX_BYTES`
 * (8 MiB, ADR-0125) could carry at the smallest a run can serialise to — {@link SMALLEST_RUN_BYTES}, 192 bytes for a run
 * with no text and no font name, and one more for the comma between runs — which is 43,464, rounded down to 43,400. It
 * was 45,800 until the style carried the font's name (2026-10-03, for the block grouping's change of font). A real
 * page's runs are larger and far fewer.
 *
 * A literal, not the division: computed at module load, a field added to the schema would move the bound with no line of
 * any diff saying so. `pdfiumChannels.test.ts` holds the literal to the division, so a change to either is a red case
 * and a visible edit, never a silent one.
 *
 * ## It bounds the PRIOR's list too, and that is one question rather than two
 *
 * A prior is one recorded string per object the command named, and a command
 * names objects on one page — so the largest honest prior is a page's worth,
 * which is the number this already is. Main knows how many it asked for and
 * this schema does not, which is the whole reason the wire carries its own
 * bound: a host that answered a longer list is refused here rather than
 * believed. Declared above the schemas because a `const` referenced during
 * module evaluation cannot be declared below them.
 */
export const ENGINE_TEXT_OBJECTS_MAX = 43_400;

/**
 * The fewest bytes one text run can serialise to on this wire: no text, every number `0`, every flag `true`.
 * Measured by `pdfiumChannels.test.ts` against the schema's own shape, and the divisor of {@link ENGINE_TEXT_OBJECTS_MAX}.
 */
export const SMALLEST_RUN_BYTES = 192;

/**
 * How many text objects, or one run's members, `engine/page-runs` may name: the most single-digit indices with their
 * commas an answer within `ENGINE_ANSWER_FILE_MAX_BYTES` (8 MiB) could hold, 8,388,608 / 2. A bound against a hostile
 * host, as {@link ENGINE_TEXT_OBJECTS_MAX} is; a literal held to the division by `pdfiumChannels.test.ts`, for that
 * constant's reason.
 */
export const PAGE_TEXT_OBJECTS_MAX = 4_194_304;

/**
 * How long a captured run's text may be on this wire.
 *
 * **Deliberately larger than `MAX_REPLACED_TEXT`, and the asymmetry is the
 * point.** That constant bounds what a *renderer* may send in, and this bounds
 * what a *document* may say — the two are different questions and a document
 * did not read the contract. A prior longer than this is refused rather than
 * truncated: a truncated prior is an inverse that would silently shorten the
 * run it restores, which is worse than a command that cannot be undone.
 */
export const PDFIUM_PRIOR_TEXT_MAX = 65_536;

/**
 * How long a run's font name may be on this wire: ISO 32000's own limit on a name, 127 bytes. The adapter reads the
 * whole name, whatever its length, and cuts a longer one to this at a whole character for the wire (`wireFontName` in
 * `pdfiumFfi.ts`), so a document past the limit is still read. This said the bound followed from a 128-byte read
 * buffer, which answered a longer name as 127 NULs (CR-NAT-12).
 */
export const PDFIUM_FONT_NAME_MAX = 127;

/**
 * The prior state a PDFium command records, with its kind.
 *
 * `capturedPriorSchema`'s shape on this engine's own kinds, and a separate
 * schema rather than a shared one because the two engines' priors have nothing
 * in common: MuPDF's carry page rotations, layer visibilities and field values,
 * and this carries a text object's string. A union of both would let a MuPDF
 * prior arrive on this wire and be handed to `localPdfiumExecution.invert`,
 * which is the *native library given a shape from elsewhere* hazard
 * `mupdfCommandSchema`'s own note is about, on the inverse instead of the
 * command.
 */
/** Text objects' strings as they were, and which objects put them back — `PriorTextObjects` on the wire. */
const textObjectsPriorSchema = z
  .object({
    page: z.number().int().nonnegative(),
    objects: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            text: z.string().max(PDFIUM_PRIOR_TEXT_MAX),
          })
          .strict(),
      )
      .min(1)
      .max(ENGINE_TEXT_OBJECTS_MAX)
      // `.readonly()` because `CommandPrior.replaceTextObject` is, and a
      // wire type that inferred a mutable array would make main's own
      // prior unassignable to the channel it travels on — which is the
      // compile error that put this line here rather than a cast.
      .readonly(),
  })
  .strict();

const pdfiumPriorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('replaceTextObject'),
      /**
       * The strings those objects held, and **which objects put them back**.
       *
       * The page and the indices travel because an inverse RESTORES rather than
       * derives (ADR-0009 §3) — see `CommandPrior.replaceTextObject`. The text
       * is bounded by this file's own constant rather than the command's: a
       * prior read off a document is not a payload a renderer chose, and it is
       * bounded anyway because every field on this wire is.
       *
       * A LIST, matching the command's: a line edit names several objects, and
       * an inverse that restored one of them would leave a state the person
       * never saw. Nothing here requires the list to match the command's — the
       * caller checks the kind and the schema checks the shape, and a host that
       * answered a prior for objects it was not asked about would still restore
       * only what it named. What that could cost is bounded by the page.
       */
      prior: textObjectsPriorSchema,
    })
    .strict(),
  // `replaceTextAt`'s prior is `replaceTextObject`'s shape and restores through its inverse (ADR-0156): ONE schema for
  // the two, so the restore cannot be handed a shape one of them would not write.
  z.object({ kind: z.literal('replaceTextAt'), prior: textObjectsPriorSchema }).strict(),
  z
    .object({
      kind: z.literal('placePageObject'),
      /**
       * The object's own matrix, put back.
       *
       * Six floats and no bound beyond finiteness, which is `z.number()`'s own
       * in zod 4 — a matrix is what PDFium answered about this document, not a
       * value a renderer chose, and there is no smaller number that is correct
       * for every page. What it CAN do wrong is arrive as `NaN`, which
       * `FPDFPageObj_SetMatrix` would take and leave an object nothing can
       * render; the schema is where that stops.
       */
      prior: z
        .object({
          page: z.number().int().nonnegative(),
          index: z.number().int().nonnegative(),
          matrix: z
            .object({
              a: z.number(),
              b: z.number(),
              c: z.number(),
              d: z.number(),
              e: z.number(),
              f: z.number(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('recolorPageObjects'),
      /** One fill per object the recolour named, bounded by the page. */
      prior: z
        .object({
          page: z.number().int().nonnegative(),
          objects: z
            .array(
              z
                .object({
                  index: z.number().int().nonnegative(),
                  red: z.number().int().min(0).max(255),
                  green: z.number().int().min(0).max(255),
                  blue: z.number().int().min(0).max(255),
                  alpha: z.number().int().min(0).max(255),
                })
                .strict(),
            )
            .min(1)
            .max(ENGINE_TEXT_OBJECTS_MAX)
            .readonly(),
        })
        .strict(),
    })
    .strict(),
  // NO `deletePageObjects` MEMBER, and its absence is the mechanism. That
  // command declares `invertible: false` because PDFium cannot reconstruct an
  // object, so a prior tagged with its kind is a message this wire refuses to
  // parse — main could not be handed one to hand to an invert that does not
  // exist.
  //
  // AND NO `promoteFormObjects` MEMBER, for the same mechanism and the mirror
  // reason: PDFium can take a Form XObject apart and cannot build one, so its
  // prior is unrepresentable from the container's side rather than the object's.
  // `replaceAllText` is absent too, its prior being document-scaled, and
  // `editTextBlock` for `deletePageObjects`' own reason: it makes and removes
  // objects PDFium cannot rebuild.
]);

/** What a capture answers, in `captureResultSchema`'s shape. */
const pdfiumCaptureSchema = z.discriminatedUnion('captured', [
  z.object({ captured: z.literal(true), value: pdfiumPriorSchema }).strict(),
  z.object({ captured: z.literal(false), reason: z.string().min(1).max(ENGINE_CAPTURE_REASON_MAX) }).strict(),
]);

/** What the union above declares, as a type the ties below compare against. */
type PdfiumCapturedPrior = z.infer<typeof pdfiumPriorSchema>;

/**
 * The PDFium-routed kinds that declare themselves invertible.
 *
 * `engineChannels.ts`' `InvertibleMupdfKind` on the second engine, and its
 * warning applies unchanged: the union above is written by hand, and a hand-kept
 * list is right only where something refuses to let it drift. Derived from the
 * declaration table so that a command declared invertible and forgotten here
 * fails at the alias below rather than as a runtime refusal on the day somebody
 * undoes one.
 */
type InvertiblePdfiumKind = {
  [K in KindsRoutedTo<'pdfium'>]: DeclaredCommands[K]['invertible'] extends true ? K : never;
}[KindsRoutedTo<'pdfium'>];

/**
 * Each such kind paired with the prior the kernel actually captures for it.
 *
 * **The load-bearing half**, for the reason its MuPDF twin gives: tying the
 * kinds alone would accept a member whose `prior` is the wrong shape, which is
 * the version that reads as covered — the union would have an entry for the
 * kind and refuse every value of it at run time.
 */
type PdfiumPriorPairs = {
  [K in InvertiblePdfiumKind]: { readonly kind: K; readonly prior: CommandPrior[K] };
}[InvertiblePdfiumKind];

export type PdfiumCaptureCoversEveryInvertibleKind = Covers<PdfiumCapturedPrior, PdfiumPriorPairs>;
export type PdfiumCaptureExcludesEveryOtherKind = Excludes<PdfiumPriorPairs, PdfiumCapturedPrior>;

/**
 * Pairs a PDFium command kind with the prior state captured for it.
 *
 * ## The correlated-union limit, arriving here exactly when the file said it would
 *
 * `{ kind, prior }` widens its two fields to unions **independently** —
 * `{kind: A|B, prior: X|Y}` — which is not assignable to
 * `{kind:A,prior:X} | {kind:B,prior:Y}`. The value is correct by construction
 * and the checker cannot see the correlation.
 *
 * `remotePdfium.ts` compiled without this while one kind routed to PDFium,
 * because a union of one is its own member, and its comment said in advance
 * that the second command would need `taggedPrior`'s equivalent. Three arrived
 * on 2026-09-10 and it did.
 *
 * **A second function rather than widening `taggedPrior`**, and that is B3a
 * read the right way round: this one's return type is the PDFium wire's union,
 * and a shared helper returning *either engine's* `CapturedPrior` would let a
 * MuPDF prior be built for a PDFium channel — the hazard `pdfiumPriorSchema`'s
 * own note exists to close, arriving through the constructor instead of the
 * schema.
 */
export function pdfiumTaggedPrior<K extends KindsRoutedTo<'pdfium'>>(
  kind: K,
  prior: CommandPrior[K],
): PdfiumCapturedPrior {
  return { kind, prior } as PdfiumCapturedPrior;
}

export const pdfiumChannels = {
  ...coreEngineChannels({
    command: pdfiumCommandSchema,
    capture: pdfiumCaptureSchema,
    inverse: pdfiumPriorSchema,
    // THE SHAPE, NOT A SET OF FIELDS. PDFium is a byte-image writer of record
    // (ADR-0047), so its wire is the constant every byte-image engine takes: an
    // open that registers a granted area and parses nothing, a name for the
    // image on the way in and for the result on the way out, a byte count as
    // the answer, and `unreadable-image` where a document this engine cannot
    // read is refused — at the call that wanted the engine rather than at the
    // open (ADR-0048's withdrawn Decision 3).
    //
    // PLUS APPLY REFUSALS OF ITS OWN, on this engine only: an in-place edit whose typed text the page's font cannot
    // carry (ADR-0096); one occurrence named by its point that no single text object holds there (ADR-0156); a
    // replacement that matches nothing or changes nothing, which makes no version (ADR-0169 Decision 6); and one that
    // would move the text after it on its line.
    //
    // `text-not-writable` ON THE INVERT TOO: an undo writes the prior's text back and reads it back as the edit did, so
    // a font can fail to carry it there as well (finding RRRRRRR-6). The other three are an apply's alone.
    //
    // `edit-refused` ON ALL THREE, carrying the step and PDFium's number (ADR-0169 Decision 4): capture, apply and
    // invert each open the image and run native calls, and any of them can refuse at a step a person is told about.
    wire: {
      ...byteImageWire,
      transferFailures: [...byteImageWire.transferFailures, 'edit-refused'] as const,
      applyFailures: ['text-not-writable', 'text-not-in-place', 'nothing-to-replace', 'replace-moves-line'] as const,
      invertFailures: ['text-not-writable'] as const,
    },
    // IN A FILE (ADR-0138): `replaceTextObject` and `editTextBlock` multiply per-entry text bounds past a frame.
    commandRoute: 'file',
  }),

  /**
   * PDFium's one read: the page's **text runs**, each with what it says and
   * where it sits vertically.
   *
   * ## Why this is owed at all
   *
   * `replaceTextObject` names an object by its index in the page's object
   * order, and nothing else in this application can produce that number.
   * MuPDF's structured text is a different engine's reading of the same page —
   * `CommandTargets`' note says the two numberings must never be assumed
   * comparable — so a surface that wanted to name a run would otherwise have to
   * join two frames, which is `SHOWN_PAGE`'s defect one engine apart.
   *
   * ## THE TEXT TRAVELS, and that is a change of 2026-09-09
   *
   * This channel answered indices alone, on the reasoning that an object's
   * string is prior state and arrives when a command captures it. That is true
   * of a string a caller is about to REPLACE and it is not true of one a person
   * has to RECOGNISE: a chooser built on indices offers numbers, which is what
   * the region-replacement row shipped and what the line-level row exists to
   * close.
   *
   * The words are the page's own and are bounded twice — `PDFIUM_PRIOR_TEXT_MAX`
   * per run, `ENGINE_TEXT_OBJECTS_MAX` runs — so the answer is bounded by a
   * PAGE, which is what L11 asks of it. `document.pageTextLayer` is still where
   * a caller goes for the page's words as *text*: this one exists to say which
   * OBJECT each run is, and the text rides along because the object index alone
   * cannot be shown to anybody.
   *
   * ## The whole box, and how the run is set
   *
   * This carried the vertical extent alone while
   * [ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)'s
   * overlap was the only grouping and a dialog its consumer. Text is now edited
   * in place ([ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)):
   * a block splits a line at gaps wider than the line is tall, which needs the
   * horizontal extent, and the editor drawn over it is set in the run's size,
   * colour and kind of face, which needs the style.
   *
   * **The grouping is not done here.** The host answers the engine's facts; the
   * editor's own opinion about what a line is belongs to `textLines.ts` in
   * main, where ADR-0049's checkable rule — *does this grouping's output reach
   * any consumer other than the in-place editor a person answers?* — can be
   * applied to one module rather than to a wire.
   *
   * ## Handles do not cross
   *
   * A `FPDF_PAGEOBJECT` is owned by the page it came from and invalid once that
   * page is closed, so a handle crossing this wire would be a dangling pointer
   * as a value. The index is what survives the page's close.
   *
   * ## It carries `from`, like every other call to this host
   *
   * The host holds no parse, so a read opens the image too. That is the cost
   * ADR-0047 priced at 0.1–3.5 ms per `FPDF_LoadMemDocument` and accepted.
   */
  'engine/text-runs': fileAnswered(
    'Answers a page’s text runs: which object each is, what it says, where it is and how it is set.',
    z.object({ session: sessionSchema, ...byteImageWire.read, page: z.number().int().nonnegative() }).strict(),
    z
      .object({
        runs: z
          .array(
            z
              .object({
                /** The object's index in the page's own object order — the FIRST object of a joined run. */
                index: z.number().int().nonnegative(),
                /**
                 * The run's last object (`textRunJoin.ts`, ADR-0130): glyph objects that abut on one baseline in one
                 * style are one run, named by `index`, and an edit naming it is applied to every object to here.
                 */
                last: z.number().int().nonnegative(),
                /** What the run says, as PDFium read it off this page. */
                text: z.string().max(PDFIUM_PRIOR_TEXT_MAX),
                /**
                 * The run's vertical extent, in the page's own coordinates.
                 *
                 * `z.number()` alone, and that is finite: zod 4 refuses `NaN`
                 * and both infinities by default — measured 2026-09-09 against
                 * zod 4.4.3, which is also why `.finite()` is deprecated as a
                 * no-op. It matters here rather than being incidental: a `NaN`
                 * reaching the grouping makes every overlap comparison false, so
                 * every run becomes its own line and the page reads as having no
                 * lines rather than as a refusal.
                 */
                bottom: z.number(),
                top: z.number(),
                left: z.number(),
                right: z.number(),
                /** How the run is set: `pdfiumFfi.ts`' `RunStyle`. */
                style: z
                  .object({
                    size: z.number().nonnegative(),
                    colour: z
                      .object({
                        r: z.number().int().min(0).max(255),
                        g: z.number().int().min(0).max(255),
                        b: z.number().int().min(0).max(255),
                      })
                      .strict(),
                    /** Which font the run is set in, for the block grouping only; never to a renderer. */
                    font: z.string().max(PDFIUM_FONT_NAME_MAX),
                    serif: z.boolean(),
                    mono: z.boolean(),
                    italic: z.boolean(),
                    bold: z.boolean(),
                    upright: z.boolean(),
                  })
                  .strict(),
              })
              .strict()
              // A RUN ENDS AT OR AFTER ITS START: a host answering otherwise names objects that are no run.
              .refine((run) => run.last >= run.index, { message: 'a run cannot end before it starts' }),
          )
          .max(ENGINE_TEXT_OBJECTS_MAX),
        /**
         * Whether the page carried more than the bound.
         *
         * Forwarded from the walk rather than re-derived from the array's
         * length, which would answer *you asked for that many* every time —
         * `engine/duplicate-pages`' note, and the reason every bounded answer on
         * this wire carries this field rather than leaving a caller to infer it.
         */
        truncated: z.boolean(),
        /**
         * Characters this page carries that the object walk cannot name.
         *
         * Text inside a Form XObject, measured: a page with one embedded page
         * reports two objects to `FPDFPage_GetObject` while `FPDFText` extracts
         * every character, and the ones inside the form belong to objects the
         * walk does not contain. Bounded by the page's own text rather than by
         * `ENGINE_TEXT_OBJECTS_MAX`, which counts runs — so it takes the
         * character bound this wire already uses for a page's words.
         */
        unaddressable: z.number().int().nonnegative().max(PDFIUM_PRIOR_TEXT_MAX),
      })
      .strict(),
    // THE BYTE-IMAGE WIRE'S CODES, spelt out because this channel is not one of
    // the six and so does not get them from the factory. It reads an image, so
    // the file can be gone (`asset-missing`, ours) and the engine can refuse
    // the call against those bytes — a document it cannot parse, or a page this
    // one does not have. Both are `engine-refused`, because the axis a code
    // separates is *is the host sick* and neither of them is.
    ['no-such-session', 'asset-missing', 'engine-refused'],
  ),

  /**
   * PDFium's **second** read: every object on a page, with what kind it is,
   * where it sits and what colour it is filled with.
   *
   * ## Why this is not `engine/text-runs` with a filter
   *
   * That one answers a page's TEXT, run by run, with a vertical extent because
   * a grouping needs one. This answers a page's OBJECTS — an image and a path
   * have no text and are exactly what the object-level row exists to move — and
   * carries a full box because a surface has to say *which thing on the page*.
   * A single channel would answer both questions badly: text runs without their
   * extent, or every object carrying a `text` field that is empty for most of
   * them.
   *
   * ## A WORD for the kind, never PDFium's integer
   *
   * `FPDFPageObj_GetType` answers 0–5. That number is the library's private
   * numbering and this value reaches a person, so a chooser built on it would
   * offer *type 3* — the object-index chooser's defect wearing a second number.
   * The words are `pdfiumFfi.ts`'s `OBJECT_KINDS`, in PDFium's own order.
   *
   * ## The fill may be ABSENT, and that is not black
   *
   * `FPDFPageObj_GetFillColor` declines for some objects, and *this engine will
   * not say* is a different fact from *it is black*. A surface offering to
   * recolour something PDFium will not describe should say so rather than start
   * a colour picker at a guess, so the field is nullable rather than defaulted.
   */
  'engine/page-objects': fileAnswered(
    'Answers every object on a page: its kind, its box in page space, and its fill.',
    z.object({ session: sessionSchema, ...byteImageWire.read, page: z.number().int().nonnegative() }).strict(),
    z
      .object({
        objects: z
          .array(
            z
              .object({
                index: z.number().int().nonnegative(),
                kind: z.enum(['unknown', 'text', 'path', 'image', 'shading', 'form']),
                // FINITE BY `z.number()`'s own rule in zod 4, which matters
                // here for `engine/text-runs`' reason: a `NaN` box would make
                // every comparison against it false, and a surface would draw
                // a handle nowhere rather than refuse.
                left: z.number(),
                bottom: z.number(),
                right: z.number(),
                top: z.number(),
                fill: z
                  .object({
                    red: z.number().int().min(0).max(255),
                    green: z.number().int().min(0).max(255),
                    blue: z.number().int().min(0).max(255),
                    alpha: z.number().int().min(0).max(255),
                  })
                  .strict()
                  .nullable(),
              })
              .strict(),
          )
          .max(ENGINE_TEXT_OBJECTS_MAX),
        truncated: z.boolean(),
      })
      .strict(),
    ['no-such-session', 'asset-missing', 'engine-refused'],
  ),

  /**
   * One page rasterised at exactly the size the caller asked for.
   *
   * ## THE PIXELS GO TO A FILE, and that is what the granted area is for
   *
   * Every other read on this wire answers on the pipe because its answer is a
   * few hundred bytes. A page at device scale is **eight megabytes**, and the
   * host protocol frames a message per call — so this answers a byte COUNT and
   * writes the bitmap into the output directory main granted it, which is the
   * same route `engine/apply` already uses for a whole document image. Nothing
   * new is trusted: the host may write where it was handed, and main reads what
   * it named.
   *
   * ## BGRA, unconverted, and the name says so
   *
   * `FPDFBitmap_Create` with alpha produces BGRA. Main encodes it with
   * Electron's `nativeImage.createFromBitmap`, which takes BGRA — so a wire that
   * straightened it to RGBA would make both sides convert, once each, for a
   * consumer that wanted neither.
   *
   * ## The SIZE is the caller's, which is ADR-0031's sanctioned crossing
   *
   * *A raster may cross under a caller-stated maximum*; what is banned is a
   * snapshot of the document. The renderer knows its canvas's device size and
   * nothing else does, so it states it and main bounds it.
   */
  'engine/render-page': channel(
    'Rasterises one page at the size the caller states, into the granted output directory.',
    z
      .object({
        session: sessionSchema,
        // `byteImageWire`'s two names, so this read carries the key the others do (ADR-0171's addendum).
        ...byteImageWire.read,
        ...byteImageWire.write,
        page: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        /**
         * How many bytes were written.
         *
         * Answered rather than derived from the size, so main can refuse a file
         * whose length disagrees with the dimensions it asked for — the same
         * check `engine/apply` makes against its own answer, and the reason a
         * partial write is a refusal rather than a truncated image.
         */
        bytes: z.number().int().nonnegative(),
      })
      .strict(),
    ['no-such-session', 'asset-missing', 'engine-refused'],
  ),

  /**
   * The fonts the editor draws a block's runs in, rebuilt by this host from the runs' own programs, each font once
   * ([ADR-0175](../../../../docs/DECISIONS/0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md)),
   * into the granted output directory as `engine/render-page` writes a raster: font bytes cannot be framed JSON.
   *
   * The fonts are written one after another and `sizes` says where each ends; nothing is written when there are none.
   * A run with no font (not embedded, not an sfnt, a glyph that does not read as PDFium's, past the cap) is `null` in
   * `runs`: none is the ordinary case and not a failure, and the editor draws the run in its kind of face.
   */
  'engine/run-fonts': channel(
    'Rebuilds the fonts a block’s runs are drawn in, each once, into the granted output directory.',
    z
      .object({
        session: sessionSchema,
        ...byteImageWire.read,
        ...byteImageWire.write,
        page: z.number().int().nonnegative(),
        /** The runs' first objects, as `engine/text-runs` named them. */
        indices: z.array(z.number().int().nonnegative()).min(1).max(MAX_FONT_RUNS),
      })
      .strict(),
    z
      .object({
        /** Each font's length in the order written: main refuses a file whose length disagrees with their sum. */
        sizes: z.array(z.number().int().min(1).max(MAX_RUN_FONT_BYTES)).max(MAX_BLOCK_FONTS),
        /** For each run asked about, in the order asked, its font's place in `sizes`, or `null` for none. */
        runs: z.array(z.number().int().min(0).max(MAX_BLOCK_FONTS - 1).nullable()).max(MAX_FONT_RUNS),
      })
      .strict(),
    ['no-such-session', 'asset-missing', 'engine-refused'],
  ),

  /**
   * The page's joined runs WITH their members, and its text objects' page indices: the `pageRuns` pre-read of ADR-0176's
   * writer (its 2026-10-06 correction), which finds the objects a run is among a content stream's operators.
   *
   * File-answered for `engine/text-runs`' reason, and larger: a page drawn a glyph per object answers one member per
   * glyph. Never truncated, unlike that read: a writer handed part of a page would number the rest wrongly, so a page
   * past the bound is refused by the schema and the edit with it.
   */
  'engine/page-runs': fileAnswered(
    'Answers a page’s joined text runs with the objects each is, and the page indices of its text objects.',
    z.object({ session: sessionSchema, ...byteImageWire.read, page: z.number().int().nonnegative() }).strict(),
    z
      .object({
        textObjects: z.array(z.number().int().nonnegative()).max(PAGE_TEXT_OBJECTS_MAX),
        runs: z
          .array(
            z
              .object({
                index: z.number().int().nonnegative(),
                members: z.array(z.number().int().nonnegative()).min(1).max(PAGE_TEXT_OBJECTS_MAX),
                text: z.string().max(PDFIUM_PRIOR_TEXT_MAX),
                left: z.number(),
                right: z.number(),
                bottom: z.number(),
                top: z.number(),
              })
              .strict()
              // A RUN IS NAMED BY ITS FIRST OBJECT, which is how the editor's wire names it.
              .refine((run) => run.members[0] === run.index, { message: 'a run is named by its first object' }),
          )
          .max(ENGINE_TEXT_OBJECTS_MAX),
      })
      .strict(),
    ['no-such-session', 'asset-missing', 'engine-refused'],
  ),
} as const;

/** The PDFium host's channel map. */
export type PdfiumChannels = typeof pdfiumChannels;
