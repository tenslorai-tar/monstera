import { type CommandKind, commandSchema, channel } from '@monstera/contract';
import { z } from 'zod';

import type { CommandPrior } from '../commandLog.js';
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

const sessionSchema = z.string().min(1).max(ENGINE_SESSION_ID_MAX_CHARS);

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
 * Prior state, tagged by the command kind it belongs to.
 *
 * The tag is not redundant with the request's own `command.kind`. A response is
 * validated on its own terms — the correlation id says which call it answers,
 * and nothing else about the request is in scope at the point the body is
 * parsed. A kernel that narrowed by the kind it *sent* would be trusting the
 * peer to have answered the question it was asked.
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
const outputNameSchema = z
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

export const engineChannels = {
  /**
   * ADR-0023 §5's startup check, and the ONE channel whose answer decides
   * whether this host is allowed to see a document at all.
   *
   * ## The request carries two paths and nothing else
   *
   * `classifyContainment` takes a request AND a report, and the request half
   * stays in main: `negative.readableBytes` is main's own reading taken
   * immediately before the ask, and `positive.origin` is main's knowledge of
   * which path it named. Neither crosses. So the host supplies **observations**
   * and main supplies **everything the observations are judged against** — a
   * host that wanted a `contained` verdict cannot reach the inputs that produce
   * one, which is the split `containment.ts` describes as *measured inside,
   * decided outside* expressed in the wire shape rather than in a comment (B5).
   *
   * ## And the answer carries no path, like every other answer here
   *
   * Two outcomes and, at most, an errno. The paths in the report's detail lines
   * are the ones main sent, joined on this side. That is the same asymmetry the
   * lifecycle channels have, for the same reason.
   *
   * No declared failures. A probe that could not read is not a failed call — it
   * is an observation, and `absent`/`error` are how it says so. Collapsing that
   * into a channel failure would put *could not look* and *the call broke* in
   * one output, which is the distinction this whole mechanism turns on.
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

  'engine/open': channel(
    'Opens a document image the host reads from a directory it was granted.',
    z
      .object({
        /** The directory main granted this session READ on. */
        snapshotDirectory: pathSchema,
        /** The file inside it holding the canonical bytes. */
        snapshotName: outputNameSchema,
        /** The directory main granted this session MODIFY on. */
        outputDirectory: pathSchema,
      })
      .strict(),
    // The host mints the identity (Decision 10b). Main holds a token it cannot
    // dereference, and this string is what the adapter records beside it.
    z.object({ session: sessionSchema }).strict(),
    ['open-failed'],
  ),

  'engine/serialise': channel(
    'Writes the session’s current bytes into the output directory, under a name main chose.',
    z.object({ session: sessionSchema, into: outputNameSchema }).strict(),
    // A COUNT, NOT A NAME. Main already knows where it asked for the bytes; what
    // it cannot know without being told is how many arrived, and comparing that
    // against the file it reads separates "the host wrote nothing" from "the
    // read found nothing" — which are otherwise the same empty buffer.
    z.object({ bytes: z.number().int().nonnegative() }).strict(),
    ['no-such-session', 'serialise-failed'],
  ),

  'engine/close': channel(
    'Releases the session’s native resources.',
    z.object({ session: sessionSchema }).strict(),
    z.object({}).strict(),
    ['no-such-session'],
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

  'engine/apply': channel(
    'Applies one command to a session this host holds.',
    z.object({ session: sessionSchema, command: commandSchema }).strict(),
    z.object({}).strict(),
    ['no-such-session'],
  ),

  'engine/capture': channel(
    'Reads prior state for one command, before it is applied.',
    z.object({ session: sessionSchema, command: commandSchema }).strict(),
    captureResultSchema,
    ['no-such-session'],
  ),

  'engine/invert': channel(
    'Restores prior state recorded by an earlier capture.',
    z.object({ session: sessionSchema, inverse: inverseSchema }).strict(),
    z.object({}).strict(),
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
export type EngineFailureCode = 'no-such-session' | 'open-failed' | 'serialise-failed';
