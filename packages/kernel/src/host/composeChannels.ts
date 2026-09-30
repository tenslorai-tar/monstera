import { z } from 'zod';

import {
  COMPOSE_REFUSALS,
  MAX_IMPORT_IMAGES,
  MAX_PAGE_COORDINATE,
  MAX_WORKBOOK_PARTS,
  MAX_WORKBOOK_ROW,
  MAX_WORKBOOK_SHEET_NAME,
  channel,
  fileAnswered,
  fileRequested,
  insertImagePageSchema,
} from '@monstera/contract/host';

import { byteImageWire, hostAreaChannels, outputNameSchema, sessionSchema } from './engineChannels.js';

/**
 * The compose host's channel set
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## The probe and a granted area, and none of the three command channels
 *
 * Decision 3. This host changes no open document, so it is asked no `apply`,
 * `capture` or `invert` — those carry a writer's command union, and a host that
 * declared them and stubbed them would answer questions with nothing behind it. It
 * does owe the containment probe, because its verdict is about its own token, and
 * the area, because directories carried per call are the shape §3 refuses. Both
 * come from {@link hostAreaChannels}, with the byte-image wire's `open`: register
 * the area, parse nothing.
 *
 * ## What crosses is names and a count
 *
 * Decision 4, and `engine/extract`'s shape. Main writes the source into the area's
 * snapshot directory under a name it chose, the host writes the composed PDF into
 * the output directory under another, and the answer is how many bytes it wrote —
 * which main compares with the file it reads, separating *the host wrote nothing*
 * from *the read found nothing*. No path, no token tree and no document bytes
 * travel on the pipe.
 */
/**
 * What composing a source is asked with — one shape for every source format.
 *
 * ## The page is bounded by the format
 *
 * `MAX_PAGE_COORDINATE` is PDF 32000-1 Annex C.2's page limit, taken from the
 * contract rather than written again: a composition asked for a page past it could
 * not be a conforming document.
 */
const composeRequestSchema = z
  .object({
    session: sessionSchema,
    /** The source file's name in the area's snapshot directory. */
    from: outputNameSchema,
    /** The composed PDF's name in the area's output directory. */
    into: outputNameSchema,
    /** The size every composed page is set at, in points. */
    page: z
      .object({
        width: z.number().gt(0).max(MAX_PAGE_COORDINATE),
        height: z.number().gt(0).max(MAX_PAGE_COORDINATE),
      })
      .strict(),
  })
  .strict();

/**
 * What composing a source answers — one shape for every source format.
 *
 * ## A refusal is an ANSWER, with its line
 *
 * A source that is not UTF-8, is malformed for its format, holds a character the
 * standard fonts cannot draw, or draws nothing is a fact about the file a person
 * picked, and the person is owed which one — and, where there is one, the line. So it
 * rides in the result rather than as a failure code, which carries no line.
 */
const composeResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('composed'), bytes: z.number().int().nonnegative() }).strict(),
  z
    .object({
      kind: z.literal('refused'),
      reason: z.enum(COMPOSE_REFUSALS),
      /** The one-based source line the refusal is about, where there is one. */
      line: z.number().int().positive().nullable(),
      /** The one-based position of the picked file the refusal is about, for a multi-file import. */
      item: z.number().int().positive().nullable(),
    })
    .strict(),
]);

/**
 * The highest dpi a subsampling bound may name. Twice the 1,200 dpi a print is ever asked for, so
 * no setting a person could want is refused, and a bound past it is a request this build did not
 * write.
 */
const MAX_REWRITE_DPI = 2400;

/** Sheets in one workbook this outline answers. Excel's own is memory; a workbook past this is a crafted one. */
export const MAX_WORKBOOK_SHEETS = 4096;

export const composeChannels = {
  ...hostAreaChannels(byteImageWire),

  /**
   * Rewrites a document's images through MuPDF's own rewriter and writes the copy into the area
   * ([ADR-0087](../../../../docs/DECISIONS/0087-optimize-is-mupdfs-native-image-rewriter-in-the-compose-host.md)).
   *
   * ## Three integers, never an option string
   *
   * The setting arrives as the shim's own three numbers, bounded here, so nothing a pipe carries
   * is a string MuPDF would parse. A subsampling target must sit below its threshold, or both be
   * zero — the shim refuses the other shapes too, and refusing them at the schema is what makes a
   * shim refusal a fault rather than a request this channel let through.
   *
   * ## `unreadable` and `unavailable` are answers
   *
   * `unreadable`: MuPDF could not open the document — a fact about the document, such as its
   * encryption. `unavailable`: this host was started without the native library, which is every
   * packaged build until packaging resolves its path. Neither is a fault in this build.
   */
  'engine/optimize': channel(
    'Rewrites the images of a document from the area and writes the copy into the area.',
    z
      .object({
        session: sessionSchema,
        from: outputNameSchema,
        into: outputNameSchema,
        quality: z.number().int().min(1).max(100),
        over: z.number().int().min(0).max(MAX_REWRITE_DPI),
        to: z.number().int().min(0).max(MAX_REWRITE_DPI),
      })
      .strict()
      .refine((request) => (request.over === 0 ? request.to === 0 : request.to > 0 && request.to < request.over), {
        message: 'a subsampling target sits below its threshold, or both are 0',
      }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('optimized'), bytes: z.number().int().nonnegative() }).strict(),
      z.object({ kind: z.literal('unreadable') }).strict(),
      z.object({ kind: z.literal('unavailable') }).strict(),
    ]),
    ['no-such-session', 'asset-missing'],
  ),

  /**
   * Makes a document's inline images XObjects on the pages a PDFium command is about to regenerate
   * ([ADR-0126](../../../../docs/DECISIONS/0126-a-pdfium-command-is-handed-its-pages-with-inline-images-made-xobjects.md)).
   *
   * ## Its scope is the command's, in the two shapes a PDFium command has
   *
   * One page, which six of the seven commands name, or `all`, which `replaceAllText` regenerates. Nothing else is
   * expressible, so a request for a range no command makes is refused by the schema.
   *
   * ## `unchanged` writes nothing
   *
   * No inline image on those pages is the ordinary answer, and then no file is written: main hands PDFium the image
   * it would have had. `left` counts inline images MuPDF could not read, which stay as they were in both answers.
   */
  'engine/keep-inline-images': channel(
    'Rewrites the inline images on a document’s pages as XObjects, writing the document into the area when any changed.',
    z
      .object({
        session: sessionSchema,
        from: outputNameSchema,
        into: outputNameSchema,
        scope: z.union([z.literal('all'), z.number().int().nonnegative()]),
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('kept'),
          bytes: z.number().int().positive(),
          converted: z.number().int().positive(),
          left: z.number().int().nonnegative(),
        })
        .strict(),
      z.object({ kind: z.literal('unchanged'), left: z.number().int().nonnegative() }).strict(),
      z.object({ kind: z.literal('unreadable') }).strict(),
      z.object({ kind: z.literal('unavailable') }).strict(),
    ]),
    ['no-such-session', 'asset-missing'],
  ),

  /**
   * The sheets of a workbook a person picked, in order, with each one's state and last row — what main plans a
   * workbook's parts from: one per visible sheet, since x2t prints the active sheet only, halved where a part reaches
   * its 1,500-page cut-off (decision C, `workbookParts.ts`).
   *
   * IN A FILE (ADR-0125): the answer grows with the workbook — thousands of sheets, each name up to its bound — and the
   * route check measured its schema at 6,476,226 bytes against a 262,144-byte frame.
   */
  'engine/workbook-outline': fileAnswered(
    'Reads a workbook’s sheets, their states and last rows, from the area.',
    z.object({ session: sessionSchema, from: outputNameSchema }).strict(),
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('outline'),
          sheets: z
            .array(
              z
                .object({
                  name: z.string().max(MAX_WORKBOOK_SHEET_NAME),
                  state: z.enum(['visible', 'hidden', 'veryHidden']),
                  lastRow: z.number().int().min(0).max(MAX_WORKBOOK_ROW),
                })
                .strict(),
            )
            .max(MAX_WORKBOOK_SHEETS),
        })
        .strict(),
      z.object({ kind: z.literal('unreadable') }).strict(),
    ]),
    ['no-such-session', 'asset-missing'],
  ),

  /**
   * A copy of the workbook in which one sheet is visible and, where `rows` is given, prints only that block — the author's
   * own print area intersected, never replaced. `nothing` where the author's print area does not reach the block;
   * `unsplittable` where it is one this host cannot narrow, which main names to the person rather than guesses.
   */
  'engine/workbook-part': channel(
    'Writes a copy of a workbook from the area showing one sheet, and one block of its rows.',
    z
      .object({
        session: sessionSchema,
        from: outputNameSchema,
        into: outputNameSchema,
        sheet: z.number().int().min(0).max(MAX_WORKBOOK_SHEETS - 1),
        rows: z
          .object({ from: z.number().int().min(1).max(MAX_WORKBOOK_ROW), to: z.number().int().min(1).max(MAX_WORKBOOK_ROW) })
          .strict()
          .refine((rows) => rows.from <= rows.to, { message: 'a block of rows starts at or before its end' })
          .nullable(),
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('written'), bytes: z.number().int().positive() }).strict(),
      z.object({ kind: z.literal('nothing') }).strict(),
      z.object({ kind: z.literal('unsplittable') }).strict(),
      z.object({ kind: z.literal('unreadable') }).strict(),
    ]),
    ['no-such-session', 'asset-missing'],
  ),

  /** How many pages a PDF in the area has — whether a conversion reached x2t's cut-off. */
  'engine/pdf-pages': channel(
    'Counts the pages of a PDF in the area.',
    z.object({ session: sessionSchema, from: outputNameSchema }).strict(),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('counted'), pages: z.number().int().min(0) }).strict(),
      z.object({ kind: z.literal('unreadable') }).strict(),
    ]),
    ['no-such-session', 'asset-missing'],
  ),

  /**
   * The listed PDFs in the area joined in order into one, and each one's page count.
   *
   * ITS PARAMS IN A FILE (ADR-0125's addendum): the list grows with the parts, and the route check found it past a
   * frame at its bound.
   */
  'engine/join-pdfs': fileRequested(
    'Joins the listed PDFs from the area, in order, into one PDF written into the area.',
    z
      .object({
        session: sessionSchema,
        from: z.array(outputNameSchema).min(1).max(MAX_WORKBOOK_PARTS),
        into: outputNameSchema,
      })
      .strict(),
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('joined'),
          bytes: z.number().int().positive(),
          pages: z.array(z.number().int().min(0)).max(MAX_WORKBOOK_PARTS),
        })
        .strict(),
      z.object({ kind: z.literal('unreadable'), item: z.number().int().min(0).max(MAX_WORKBOOK_PARTS - 1) }).strict(),
    ]),
    ['no-such-session', 'asset-missing'],
  ),

  /**
   * Sets a Markdown source as a new PDF.
   *
   * The two failures are the transport's: an area this host does not hold, and a
   * source file main did not write or that went.
   */
  'engine/compose-markdown': channel(
    'Sets a Markdown source from the area as a new PDF, written into the area.',
    composeRequestSchema,
    composeResultSchema,
    ['no-such-session', 'asset-missing'],
  ),

  /**
   * Sets a CSV source as a table on new PDF pages.
   *
   * A channel of its own rather than a format field on the one above, because the
   * handler it reaches runs a different parser, and a routing field is a string the
   * host would have to trust to pick one. The request and result are the same
   * schemas, declared once.
   */
  'engine/compose-csv': channel(
    'Sets a CSV source from the area as a table on new PDF pages, written into the area.',
    composeRequestSchema,
    composeResultSchema,
    ['no-such-session', 'asset-missing'],
  ),

  /**
   * Makes each image in the area a page of a new PDF, in the order listed.
   *
   * ## Its own request, because an image import is a LIST of sources
   *
   * Each entry names a file main wrote into the snapshot directory and the decoder it
   * goes to; the list is bounded by `MAX_IMPORT_IMAGES`, so the frame is too. There is
   * no page size: each page is its image's size, scaled down only past the format's
   * page limit (`addImagePage`). The result is the shared one, and a
   * refusal carries the one-based position of the image it is about.
   *
   * The media type is the contract's `insertImagePage` enum, taken rather than spelt
   * again, so the two routes to a page from an image name one set of decoders.
   */
  'engine/compose-images': channel(
    'Makes each listed image from the area a page of a new PDF, written into the area.',
    z
      .object({
        session: sessionSchema,
        images: z
          .array(
            z.object({ from: outputNameSchema, mediaType: insertImagePageSchema.shape.mediaType }).strict(),
          )
          .min(1)
          .max(MAX_IMPORT_IMAGES),
        into: outputNameSchema,
      })
      .strict(),
    composeResultSchema,
    ['no-such-session', 'asset-missing'],
  ),
};

/** The compose host's channel map. */
export type ComposeChannels = typeof composeChannels;
