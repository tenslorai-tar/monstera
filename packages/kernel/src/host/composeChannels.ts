import { z } from 'zod';

import { COMPOSE_REFUSALS, MAX_PAGE_COORDINATE, channel } from '@monstera/contract';

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
    })
    .strict(),
]);

export const composeChannels = {
  ...hostAreaChannels(byteImageWire),

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
};

/** The compose host's channel map. */
export type ComposeChannels = typeof composeChannels;
