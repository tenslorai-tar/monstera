import { z } from 'zod';

import { channel, replaceTextObjectSchema } from '@monstera/contract';

import type { KindsRoutedTo } from '../commandRouting.js';
import {
  byteImageWire,
  coreEngineChannels,
  outputNameSchema,
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
 * The map in that file is MuPDF's, and its own header says the twelve reads are
 * MuPDF's document model. Adding a PDFium map beside them would put two engines'
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
 * ## A union of ONE, and it is written out for `mupdfCommandSchema`'s reason
 *
 * A filter over `commandSchema.options` needs two assertions and its narrowing
 * has to be re-stated by a cast, which is a list with a cast in front of it.
 * Written out, the inference is exact — and the pair of aliases below buys back
 * what a list gives up: an omission fails `Covers`, an extra fails `Excludes`,
 * both at this line rather than as a runtime refusal.
 *
 * `z.discriminatedUnion` with one option is deliberate rather than a `z.object`
 * that would be simpler today. The second PDFium command is a row in this same
 * stage — object-level edit, document-wide replace-all, the replace half of
 * find-and-replace — so the shape that has to be edited when one arrives is the
 * shape that already discriminates.
 */
const pdfiumCommandSchema = z.discriminatedUnion('kind', [replaceTextObjectSchema]);

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
 * How many text objects one page's answer may name.
 *
 * A page-scaled read, so it is bounded like every other one here
 * (`ENGINE_ANNOTATIONS_MAX`'s reason). Far past what any producer emits for one
 * page and far short of a payload that could carry a document.
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
export const ENGINE_TEXT_OBJECTS_MAX = 8192;

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
      prior: z
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
        .strict(),
    })
    .strict(),
]);

/** What a capture answers, in `captureResultSchema`'s shape. */
const pdfiumCaptureSchema = z.discriminatedUnion('captured', [
  z.object({ captured: z.literal(true), value: pdfiumPriorSchema }).strict(),
  z.object({ captured: z.literal(false), reason: z.string().min(1) }).strict(),
]);

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
    wire: byteImageWire,
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
   * ## The extent, and only the vertical one
   *
   * [ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)
   * groups runs into visual lines by vertical **overlap**, so `bottom` and
   * `top` are what a grouping needs and a horizontal position decides nothing.
   * A fuller rectangle would be geometry travelling further than the question
   * it answers, and the next reader would take it as available for a second.
   *
   * **The grouping is not done here.** The host answers the engine's facts; the
   * editor's own opinion about what a line is belongs to `textLines.ts` in
   * main, where ADR-0049's checkable rule — *does this grouping's output reach
   * any consumer other than a dialog a person answers?* — can be applied to one
   * module rather than to a wire.
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
  'engine/text-runs': channel(
    'Answers a page’s text runs: which object each is, what it says, and its vertical extent.',
    z.object({ session: sessionSchema, from: outputNameSchema, page: z.number().int().nonnegative() }).strict(),
    z
      .object({
        runs: z
          .array(
            z
              .object({
                /** The object's index in the page's own object order. */
                index: z.number().int().nonnegative(),
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
              })
              .strict(),
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
} as const;

/** The PDFium host's channel map. */
export type PdfiumChannels = typeof pdfiumChannels;
