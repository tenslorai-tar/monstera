import { z } from 'zod';

import { channel, replaceTextObjectSchema } from '@monstera/contract';

import type { KindsRoutedTo } from '../commandRouting.js';
import {
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
       * The string that object held, and **which object puts it back**.
       *
       * The page and index travel because an inverse RESTORES rather than
       * derives (ADR-0009 §3) — see `CommandPrior.replaceTextObject`. The text
       * is bounded by the same constant the command's is: a prior read off a
       * document is not a payload a renderer chose, and it is bounded anyway
       * because every field on this wire is.
       */
      prior: z
        .object({
          page: z.number().int().nonnegative(),
          index: z.number().int().nonnegative(),
          text: z.string().max(PDFIUM_PRIOR_TEXT_MAX),
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

/**
 * How many text objects one page's answer may name.
 *
 * A page-scaled read, so it is bounded like every other one here
 * (`ENGINE_ANNOTATIONS_MAX`'s reason). Far past what any producer emits for one
 * page and far short of a payload that could carry a document.
 */
export const ENGINE_TEXT_OBJECTS_MAX = 8192;

export const pdfiumChannels = {
  ...coreEngineChannels({
    command: pdfiumCommandSchema,
    capture: pdfiumCaptureSchema,
    inverse: pdfiumPriorSchema,
    // THE BYTE-IMAGE TRANSFER SHAPE. This host holds no parse between commands,
    // so every write names where its input image is and where its result goes.
    // Names, never places: the directories are the ones this session's area
    // granted, which is `engine/open`'s `snapshotName` shape and the reason
    // Decision 2's containment property survives ADR-0047.
    read: { from: outputNameSchema },
    write: { into: outputNameSchema },
    // A COUNT, which is `engine/serialise`'s own result. See this file's header.
    wrote: z.object({ bytes: z.number().int().nonnegative() }).strict(),
    // AN INVERT READS AN INPUT IMAGE HERE, so it can find it gone — main wrote
    // it and it went, or main did not write it. MuPDF's invert cannot, which is
    // why this is a per-engine field rather than a widening of the shared list.
    transferFailures: ['asset-missing'],
  }),

  /**
   * PDFium's one read: which of a page's objects are **text** objects.
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
   * ## Indices, not handles and not text
   *
   * A `FPDF_PAGEOBJECT` is owned by the page it came from and invalid once that
   * page is closed, so a handle crossing this wire would be a dangling pointer
   * as a value. The text is not here either: a caller that wants one object's
   * string asks for it as prior state when it edits, and a caller wanting the
   * page's words has `document.pageTextLayer`, which is MuPDF's and bounded.
   *
   * ## It carries `from`, like every other call to this host
   *
   * The host holds no parse, so a read opens the image too. That is the cost
   * ADR-0047 priced at 0.1–3.5 ms per `FPDF_LoadMemDocument` and accepted.
   */
  'engine/text-objects': channel(
    'Answers which of a page’s objects are text objects, in the page’s own object order.',
    z.object({ session: sessionSchema, from: outputNameSchema, page: z.number().int().nonnegative() }).strict(),
    z
      .object({
        indices: z.array(z.number().int().nonnegative()).max(ENGINE_TEXT_OBJECTS_MAX),
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
    // `asset-missing` for the reason every call to this host declares it: the
    // read opens the image too, so it can find the file gone.
    ['no-such-session', 'asset-missing', 'text-objects-failed'],
  ),
} as const;

/** The PDFium host's channel map. */
export type PdfiumChannels = typeof pdfiumChannels;
