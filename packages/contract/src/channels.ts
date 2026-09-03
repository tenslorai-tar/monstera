import { MATCH_TEXT_WINDOW } from '@monstera/shared';
import { z } from 'zod';

import { channel, type ClientApi, type Handlers, type ParamsOf, type ResultOf } from './channel.js';
import { commandSchema } from './commands.js';
import { docIdSchema, docVersionSchema, fileHandleSchema } from './schemas.js';

/**
 * Every IPC channel, defined once.
 *
 * A channel is added here only when a real handler for it exists. The wired
 * rule (Part H) applies as much to the contract as to the UI: a declared
 * channel with nothing behind it is a call that hangs, which is worse than a
 * call that is absent. The `Handlers` mapped type enforces this mechanically —
 * adding an entry here breaks the build until something implements it.
 *
 * **Invariant L11 applies to every entry below, and the gate it was owed is
 * {@link MAX_RANGE_BYTES}.** No channel's payload may scale with document size
 * *per operation*. That gate was deliberately not written at Stage 0: with one
 * channel carrying a version string it would have inspected nothing, passed, and
 * stayed green while the channels that make L11 bite were added. It was owed by
 * the first document-carrying channel, `document.readRange` is it, and the
 * answer is a bound in that channel's own params schema rather than a scan over
 * this file — see the note there for why the schema is the stronger of the two.
 *
 * The sentence this replaced said the single sanctioned byte crossing is a
 * snapshot once per version. There is no snapshot; §2 was amended on 2026-08-29
 * ([ADR-0031](../../../docs/DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)).
 */

/**
 * The largest byte range one read may carry.
 *
 * **This is invariant L11's mechanism, so its size is an argument and not a
 * preference.** Any constant satisfies L11 — a fixed bound cannot scale with
 * document size, which is the whole of what the invariant asks. So the only real
 * constraint is the lower one: it must sit above the largest range a working
 * renderer actually asks for, or the bound stops being a guard and becomes a
 * bug.
 *
 * Measured 2026-08-29 with `pdfjs-dist@6.2.108` against
 * `packages/testing/fixtures/generated/perf-image-200mb.pdf` (209,105,721 bytes):
 * the largest single range requested while opening the document and producing
 * page 1 was **5,111,808 bytes** — the page's image XObject, asked for whole.
 * The object-dense fixture's largest was 327,680. 16 MiB leaves 3.28× headroom
 * over the measured maximum and is about 1% of `main`'s 1.5 GB budget, so a
 * request at the bound is nowhere near a figure the budget notices.
 *
 * ## What this refuses that is not an attack
 *
 * A document holding one object larger than this cannot be rendered: PDF.js asks
 * for the object whole, and a range cannot be answered in several calls —
 * measured, the reader completes and is deleted after the first chunk. So the
 * failure mode is real and it is the honest one, because the alternative is a
 * channel that will hand over a 300 MB object and call L11 satisfied.
 *
 * **The trigger, so this is a number with an expiry rather than a guess:** the
 * first document that fails to render with a refused range is the evidence that
 * this bound is wrong, and the fix is a measurement of what such documents
 * actually contain — not a larger round number.
 */
export const MAX_RANGE_BYTES = 16 * 1024 * 1024;

/**
 * How many pages one view-model read may name.
 *
 * L11's mechanism for the geometry channel, and the same argument
 * {@link MAX_RANGE_BYTES} makes: any constant satisfies the invariant, so the
 * only real constraint is the lower one — it must sit above what a working
 * renderer actually asks for, or the bound stops being a guard and becomes a
 * bug. This build draws one page; a thumbnail strip is the surface that will
 * ask for many, and 512 is far above any window a screen can hold.
 *
 * **The trigger:** the first surface that legitimately needs more than this in
 * one read is the evidence the bound is wrong, and the fix is a measurement of
 * what that surface draws — not a larger round number.
 */
export const MAX_VIEW_MODEL_PAGES = 512;

/**
 * How many matches one page's search may answer with.
 *
 * L11's mechanism for the search channel, and it needs the bound more plainly
 * than its two siblings do: a common word in a dense page produces a result
 * list that scales with the *content*, and across a document-wide search that
 * is document-scaled by another name.
 *
 * **The caller states its own limit and this is the ceiling on it**, so
 * *exhausted* and *truncated* stay distinguishable — a bound applied silently
 * would make "no more matches" and "the cap was reached" the same observation
 * for every caller. `truncated` in the result is what separates them.
 *
 * 512 for the same reason `MAX_VIEW_MODEL_PAGES` is: any constant satisfies the
 * invariant, so the only real constraint is the lower one, and no results
 * surface shows more than a screenful before the user narrows the query.
 *
 * **The trigger:** the first surface that legitimately needs more than this from
 * one page is the evidence the bound is wrong, and the fix is a measurement of
 * what that surface shows — not a larger round number.
 */
export const MAX_SEARCH_MATCHES = 512;

/**
 * How many links one page may report to the renderer.
 *
 * A COUNT, because each link is a declared shape whose own fields are bounded —
 * so the only unbounded axis is how many there are. Any constant satisfies
 * invariant 11; the real constraint is the lower one, and a page of a
 * link-heavy index carries hundreds rather than thousands.
 *
 * **The trigger:** the first page refused by this is the evidence the bound is
 * wrong, and the fix is a measurement of what that page contains.
 */
export const MAX_PAGE_LINKS = 4096;

/**
 * How long a link's URI may be.
 *
 * The one string in that shape a DOCUMENT controls, so it is the one that needs
 * a length. 2048 is the ceiling browsers apply to a URL in practice, which
 * makes it a bound a real document cannot legitimately cross rather than a
 * number chosen here.
 */
export const MAX_LINK_URI_LENGTH = 2048;

/**
 * How many outline entries may reach the renderer, and how long a title may be.
 *
 * The two axes a document controls. A long technical manual carries hundreds of
 * headings; four thousand is past what a panel could present and short of what
 * a hostile document could try. A 512-character heading is one a panel
 * truncates rather than one it refuses.
 *
 * **The trigger:** the first document refused by either is the evidence the
 * bound is wrong, and the fix is a measurement of what that document carries.
 */
export const MAX_DESTINATIONS = 4096;
export const MAX_DESTINATION_TITLE_LENGTH = 512;

/**
 * How many layers may reach the renderer, and how long a name may be.
 *
 * Much smaller than the outline's, because the shapes differ: a design carries
 * a handful of optional-content groups where a manual carries hundreds of
 * headings. A bound copied across would be a number nobody had thought about,
 * and the number is meant to be a statement about what the thing is.
 */
export const MAX_LAYERS = 1024;
export const MAX_LAYER_NAME_LENGTH = 256;

/**
 * How long a document's name may be.
 *
 * NTFS bounds a single path component at 255 UTF-16 code units, so this is that
 * limit rather than a number chosen here — the name main sends is a file name,
 * and a bound looser than the filesystem's would be admitting a value no file
 * can have. **It bounds the string and does not shorten it**: truncating a name
 * on the way to the renderer would put a lie in the one place a reader checks
 * which document they are looking at.
 */
export const MAX_DOCUMENT_NAME_LENGTH = 255;

/**
 * How many recent documents may cross.
 *
 * The store's own cap, restated as the boundary's bound — and restated rather
 * than imported because `apps/desktop` may import this package and not the
 * reverse. The two agreeing is asserted by a case rather than by the type,
 * which is the honest arrangement: a bound the sender could exceed is the one
 * worth having at a boundary.
 */
export const MAX_RECENT_ENTRIES = 10;

/**
 * A link's rectangle, in the page's own units.
 *
 * ## `z.number()` ALREADY refuses `Infinity` and `NaN` here, and that matters
 *
 * This was written `z.number().finite()` on the reasoning that a non-finite
 * corner travels through JSON as easily as a coordinate and arrives in the
 * renderer's layout arithmetic, where it produces an element of infinite size
 * rather than an error anybody can trace. The reasoning is right and the call
 * was a **no-op**: zod 4.4.3 rejects non-finite numbers by default, and
 * `.finite()` is deprecated for saying so.
 *
 * Recorded rather than silently dropped, because the property is load-bearing
 * and the next reader deserves to know it is the base schema that carries it —
 * not a modifier they might remove as noise.
 */
const linkBoundsSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

/**
 * The longest query this boundary will carry.
 *
 * Not an L11 bound — a query is the *renderer's* string and does not scale with
 * the document — but a schema that accepted an unbounded one would let a
 * renderer hand main an arbitrarily large allocation, and every other payload
 * here is bounded. 512 is far above any search a person types and far below
 * anything worth worrying about.
 */
export const MAX_QUERY_LENGTH = 512;

/**
 * What opening a document answers, for the two channels that open one.
 *
 * Named once because `document.open` and `document.openRecent` differ in what
 * they are ASKED and not in what they answer — a renderer that handles one
 * handles the other, and two copies of a five-variant union would be two places
 * for the next variant to land in one of.
 *
 * See `document.open` for what each variant means and why `cancelled` is an
 * outcome rather than a failure.
 */
const openOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('opened'),
    docId: docIdSchema,
    version: docVersionSchema,
    /**
     * The document's size in bytes — what a `PDFDataRangeTransport` is
     * constructed with. Bounded, so L11 is untouched: a number is the same size
     * for a 2 KB document and a 2 GB one.
     */
    byteLength: z.number().int().nonnegative(),
    /**
     * What to call this document on screen — its file name, and **only** its
     * file name.
     *
     * ## Stated by main rather than derived by the renderer
     *
     * There is no path here to derive it from, by invariant L2, and that is the
     * point rather than an inconvenience: a renderer that could produce a name
     * would be a renderer that had a path. So main answers the question it is
     * the only one able to answer, and the renderer displays a string.
     *
     * ## A NAME, not a path, and the difference is a leak
     *
     * `report.pdf`, never `C:\Users\someone\Documents\report.pdf`. A status bar
     * showing the second one puts a user's directory layout on screen — in a
     * screenshot, in a screen share, in a support ticket — and it is the same
     * thing L2 keeps out of the renderer's hands, arriving as text.
     * `documentService.ts` sends `basename` for that reason.
     */
    name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
  }),
  z.object({ kind: z.literal('already-open'), docId: docIdSchema }),
  z.object({ kind: z.literal('absent') }),
  z.object({
    kind: z.literal('at-capacity'),
    /** What the resident total would have become, in bytes. */
    wouldHold: z.number().int().nonnegative(),
    /** The ceiling it would have crossed. */
    ceiling: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('cancelled') }),
]);

export const channels = {
  'app.info': channel(
    'Version and install channel of the running application.',
    z.object({}),
    z.object({
      /**
       * The running application's version.
       *
       * Bounded because every string that crosses is: this one comes from
       * `package.json` rather than from a document, so it was never an L11
       * hazard — and *this particular string cannot be large* is an argument
       * about today's caller, which is the shape the sweep in
       * `payloadBounds.test.ts` exists to stop accepting. 64 is far above any
       * version this project can have and far below anything worth carrying.
       */
      version: z.string().min(1).max(64),
      /**
       * Baked at build time (E4). Exactly one update provider is active, and
       * the Store build must never self-update, so this is a property of the
       * artifact rather than something detected at runtime.
       */
      installChannel: z.enum(['store', 'web', 'development']),
    }),
  ),

  /**
   * Applies one command to an open document.
   *
   * **This is not a document-carrying channel**, and saying so is the L11 note
   * above being answered rather than skipped. What crosses is *intent*:
   * `{ pages, quarterTurns }` is the same size for a 2-page document and a
   * 20,000-page one, and the array scales with what the user selected, never
   * with the document. The gate the note owes is still owed, by the first
   * channel that carries bytes.
   *
   * **The result is two scalars, and never what the bus produced.** A log entry
   * holds an inverse or a checkpoint — a whole byte image of the document — so
   * returning it would put the document on the wire once per operation, which is
   * exactly what L11 forbids.
   *
   * This said *"the version and nothing else"* until 2026-08-30, and the first
   * real caller found the sentence too wide. The version tells the renderer its
   * view is stale; **rebuilding that view needs the byte length too**, because
   * the renderer drives PDF.js through a `PDFDataRangeTransport` bound to a
   * total size. Rebinding on the version alone binds to whatever length the
   * caller last knew — a range past the end is a `RangeError` the handler
   * reports as `internal`, and one short of it is a parse of a truncated
   * document.
   *
   * **The length does not move yet, and saying so is not a footnote** (finding
   * OOOOO-1). A command's effect lands in the engine session; main's canonical
   * image is `readonly` and stays what was opened, so this answers the same
   * number every time and `document.readRange` serves the pre-command document.
   * ADR-0031's staleness argument — *"answering a stale offset out of the new
   * bytes"* — describes a state this build does not reach. The field is here so
   * that the renderer is not written to rebind on a version alone, which would
   * be wrong the day the refresh lands and wrong invisibly.
   *
   * `document.open` already answers with a byte length for exactly this reason,
   * so **not** answering with one here was the inconsistency rather than the
   * discipline. Both are scalars: they are the same size for a two-page document
   * and a twenty-thousand-page one, which is the L11 test and the only one that
   * matters.
   *
   * All three failure codes are **outcomes, not defects**. A document closes
   * while a command is in flight (`document-not-open`), a runaway caller
   * saturates a lane (`document-busy`), and a document the supervisor has
   * stopped rebuilding an engine session for is refused engine work
   * (`document-poisoned`); the renderer's answer is to drop the result, to back
   * off, or to tell the user this document cannot be edited until it is closed
   * and reopened — none of which is an error report.
   *
   * Note the third is deliberately *the supervisor stopped rebuilding* and not
   * *this document killed the host twice*: the count is not attribution, and
   * ADR-0023's DDDD-17 correction records the case where a document busy at two
   * deaths caused by a third document's bytes reaches the bound having caused
   * neither. Everything else a command can do wrong — an out-of-range page
   * index, an unregistered writer, an engine throw — is a defect, and defects
   * are `internal` with the diagnostic recorded main-side.
   *
   * **Why `document-poisoned` is declared rather than `internal`**
   * ([ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
   * Decision 9a). The supervisor **decided** it, after bounding a rebuild loop
   * with a hostile input at the centre of it. Reporting a decision as `internal`
   * would file it as an inconsistency, and the renderer would show an
   * unexplained internal error for the one failure it can actually explain.
   *
   * It is also what stops the ordinary post-crash path arriving wearing an
   * inconsistency's clothes: without it a poisoned document has no session, and
   * a missing session is a defect by name (Decision 9c).
   */
  /**
   * Opens a document, through a picker main owns.
   *
   * ## IT TAKES NO PARAMETERS, AND THAT IS THE INVARIANT RATHER THAN A DEFAULT
   *
   * A string path in a renderer-facing type is a compile error (§2, invariant
   * 1). The obvious signature — the renderer passes a path, or a handle it got
   * from somewhere — reintroduces the thing the whole capability design exists
   * to forbid: a renderer that can name a location can name any location, and
   * the rejected alternative is a runtime allowlist that fails open at every
   * handler which forgets to call it.
   *
   * So the renderer **asks**, and main decides what was asked for. The picker,
   * the path, and the mint are all main's; what comes back is a `DocId` and a
   * `DocVersion`. The renderer cannot express which file it wants, which is why
   * it cannot express the wrong one.
   *
   * ## NOT A DOCUMENT-CARRYING CHANNEL, and the L11 gate above stays owed
   *
   * The note at the top of this file says the first channel that carries bytes
   * owes invariant L11's check. **This is not that channel** — opening a 2 GB
   * PDF and a 20 kB one put exactly the same two identifiers on the wire, and
   * the canonical image never leaves main. Said here rather than left to be
   * inferred, because *a document channel* and *a document-carrying channel*
   * are different things and the gate is owed by the second.
   *
   * ## The result mirrors the kernel's `OpenOutcome`, plus one
   *
   * `opened`, `already-open`, `absent` and `at-capacity` are the kernel's own
   * variants. Restating them as failure codes here would be a second taxonomy
   * for a question `DocumentService` already answers, and the two would drift
   * (B3a) — so the shape is mirrored and the kernel stays the writer of record
   * for what opening produces.
   *
   * `cancelled` is the one variant the kernel cannot have, because the picker
   * is main's and dismissing it never reaches the service. It is an **outcome**:
   * a user closing a dialog is not a failure, and reporting it as one would put
   * an error in front of somebody who changed their mind.
   *
   * `already-open` carries no version, matching ADR-0009 §2 — *render a second
   * copy of an already-open document* is a sentence that cannot be written down
   * rather than a bug to be caught, so the only thing a caller can do with this
   * variant is focus the document that is already there.
   *
   * There are **no declared failure codes**. Every way this can end that a user
   * can cause is above; everything else — a picker that throws, a registry
   * miss, a read fault — is a defect, and defects are `internal` with the
   * diagnostic recorded main-side.
   */
  'document.open': channel(
    'Opens a document chosen in a picker main owns, returning its id and version.',
    z.object({}),
    openOutcomeSchema,
  ),

  /**
   * The documents this user opened recently, and whether the last run finished.
   *
   * ## A HANDLE PER ENTRY, never a path
   *
   * A recent-files list is a list of paths, and the renderer holds none
   * (invariant L2). What crosses is a `FileHandle` — the capability the
   * registry already mints for an open document, which a renderer may name and
   * cannot read — with the file's name beside it for the label. So this list is
   * exactly as much as a renderer needs to offer a document and no more.
   *
   * The handle is what `document.openRecent` takes, which is what makes the
   * pair honest: nothing here lets a renderer name a file main did not already
   * record.
   *
   * ## `lastExitClean` rides along, and that is not two channels squashed
   *
   * The crash-recovery offer is *this list* plus *did the last run finish*, and
   * neither half is useful alone: a marker saying the last run died tells the
   * renderer nothing to do about it, and a list says nothing about whether to
   * offer one. A surface asking one question gets one answer.
   */
  'document.recent': channel(
    'The documents opened recently, and whether the previous run exited cleanly.',
    z.object({}),
    z.object({
      entries: z
        .array(
          z.object({
            handle: fileHandleSchema,
            name: z.string().max(MAX_DOCUMENT_NAME_LENGTH),
          }),
        )
        .max(MAX_RECENT_ENTRIES)
        .readonly(),
      /**
       * `false` when the previous run did not reach its shutdown.
       *
       * **True on a first launch**, which is the honest reading: there is no
       * previous run that failed to finish, and a first launch offering to
       * recover from a crash that never happened is worse than one that says
       * nothing.
       */
      lastExitClean: z.boolean(),
    }),
  ),

  /**
   * Opens a document from the recent list, by the handle that list carried.
   *
   * ## Why not a parameter on `document.open`
   *
   * `document.open` takes NO parameters, and that is its invariant: main picks,
   * main mints, the kernel opens, so *"opened the wrong file"* is not a state a
   * renderer can steer into. Adding an optional handle to it would end that
   * sentence for every caller in order to serve one.
   *
   * Here the renderer does name a file, and what makes that safe is where the
   * name came from: a handle main minted for a document main recorded. The
   * registry resolves it or refuses; a renderer cannot construct one, because
   * the value is a minted token rather than a path in a coat.
   *
   * The outcomes are `document.open`'s, including `cancelled` — which this can
   * never answer, and which is present because the two channels share a result
   * type on purpose. A renderer handling one handles the other.
   */
  'document.openRecent': channel(
    'Opens a document the recent list named, by its handle.',
    z.object({ handle: fileHandleSchema }),
    openOutcomeSchema,
    // `unknown-handle` rather than `internal`: a handle can be stale — the
    // registry is per-run and a renderer may hold a list from before a restart —
    // and that is an outcome a surface acts on by refreshing the list, not a
    // defect with an incident id.
    ['unknown-handle'],
  ),

  'document.execute': channel(
    'Applies one command to an open document, returning the version it produced.',
    z.object({ docId: docIdSchema, command: commandSchema }),
    z.object({
      version: docVersionSchema,
      byteLength: z.number().int().nonnegative(),
      /**
       * Undo steps the command cost, because the checkpoint budget was reached
       * (§4, invariant 18).
       *
       * **Required, and `0` rather than an absent field.** A silently shortened
       * history is work quietly becoming unrecoverable, which is the thing
       * invariant 18 exists to forbid — and an optional field is one a renderer
       * satisfies by not reading it. Making the ordinary answer a number the
       * caller must still handle is B5 over a rule nobody would enforce.
       *
       * A COUNT and not the bytes: what the user lost is undo steps, and a
       * figure in megabytes answers a question they did not ask.
       */
      historyDropped: z.number().int().nonnegative(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Steps one entry back in a document's command log.
   *
   * ## The request carries a `DocId` AND NOTHING ELSE, which is the invariant
   *
   * [ADR-0009](../../../docs/DECISIONS/0009-document-identity-and-the-command-log.md)
   * §3a: *"inverses stay kernel-only: they carry structural prior state the
   * renderer must not see, and a renderer-supplied inverse would let the UI
   * dictate undo."* Both halves of that sentence are load-bearing here. The
   * prior state is structural — a page's `/Rotate` may have been **absent**,
   * and restoring it means deleting the key rather than rotating back — so an
   * inverse is not something a renderer could compute even if it were allowed
   * to. Folding undo into {@link commandSchema} would put one on the wire.
   *
   * So the renderer says *undo this document* and the kernel decides what that
   * means. The same shape `document.open` has, for the same reason: a request
   * that carries no choice is one the caller cannot get wrong.
   *
   * ## `nothing-to-undo` is an OUTCOME, and that is not politeness
   *
   * An empty log is a state a user reaches by undoing to the start, and it is
   * the state every document is in at open. A failure code would make the
   * ordinary end of undoing indistinguishable from a defect, and the renderer's
   * answer to it — leave the button alone — is not the answer to a defect.
   *
   * A **terminal** entry is different and is a declared failure:
   * `checkpoint-restore-not-built`. §4's answer there is to restore the nearest
   * checkpoint and replay forward, which needs the save pipeline, so the honest
   * response is a code naming what is missing rather than a silent no-op that
   * leaves the user's document one operation ahead of what they asked for.
   */
  'document.undo': channel(
    'Steps one entry back in an open document’s command log.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      // Carries the byte length for the same reason `document.execute` does:
      // an undo is an applied mutation, it rewrites the canonical image, and a
      // renderer rebinding its transport on the version alone binds to the
      // image the undo replaced.
      z.object({
        kind: z.literal('undone'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
      }),
      // `nothing-to-undo` carries neither, and that is not an omission: nothing
      // moved, so the renderer's view is not stale and there is nothing to
      // rebind. A version here would invite a caller to reopen for no reason.
      z.object({ kind: z.literal('nothing-to-undo') }),
    ]),
    [
      'document-not-open',
      'document-busy',
      'document-poisoned',
      'checkpoint-restore-not-built',
    ],
  ),
  /**
   * Save, and every part of its shape is invariant 18 or ADR-0009 §9.
   *
   * ## The request carries a `DocId` and nothing else
   *
   * Same reason as {@link 'document.undo'} and `document.open`: the destination
   * is the file the document was opened from, which main already holds as a
   * `FileHandle`. A renderer-supplied path would be a path in a renderer-facing
   * type, which is a compile error here by design — and *Save As* is a
   * different question with its own check, not a parameter on this one.
   *
   * ## THREE RESULTS RATHER THAN ONE SUCCESS AND TWO FAILURE CODES
   *
   * `refused` and `write-failed` are **outcomes**, not defects, and the
   * distinction is the whole of invariant 18: *"never by a dialog whose only
   * option discards their edits"*. In both, the document is intact, still
   * dirty, and its command log is untouched — so the renderer's response is to
   * say what happened and leave the work alone. A failure code would put them
   * in the same bucket as an inconsistency the user cannot act on.
   *
   * ## `reason` is the verdict's kind and NOT its contents
   *
   * `WriteTargetVerdict` carries more than this — `contested` names the other
   * open documents, `unverifiable` names which of three reads was missing. None
   * of it crosses, because nothing consumes it: a field shipped with no reader
   * is a declared state nobody can produce a use for, which is the shape that
   * accumulates. It widens when a renderer has something to do with it.
   *
   * `sole-writer` is absent from the enum on purpose — it is the verdict that
   * PERMITS the write, so it cannot be a refusal reason. That is a state made
   * unrepresentable rather than a case nobody writes.
   */
  'document.save': channel(
    'Writes an open document’s current content to the file it was opened from.',
    z.object({ docId: docIdSchema }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('saved'), version: docVersionSchema }),
      z.object({
        kind: z.literal('refused'),
        reason: z.enum(['contested', 'replaced', 'target-absent', 'unverifiable']),
      }),
      z.object({ kind: z.literal('write-failed') }),
    ]),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Reads one byte range of an open document, at a version the caller names.
   *
   * **This is the first document-carrying channel, so it is the one that owes
   * the L11 gate the note at the top of this file names — and the gate is
   * {@link MAX_RANGE_BYTES}, in the params schema, not a scan.**
   *
   * A range read's payload is whatever the caller asked for, so the question
   * L11 asks — *does this scale with document size?* — is decided entirely by
   * whether the ask can. Bounding it in the schema means a request for the whole
   * document is refused at the boundary, before any handler runs, by the same
   * validation that refuses a malformed one. A scan over these definitions was
   * the alternative and it is the weaker mechanism twice over: it would have to
   * decide by inspection which schemas *could* carry bytes, and it would leave
   * the unbounded request expressible and merely disapproved of (B5).
   *
   * ## The stale outcome is an OUTCOME
   *
   * A transport is bound to one `DocVersion`, and a command may bump between its
   * construction and its next ask. Byte offsets mean nothing outside the version
   * that produced them, so answering a stale offset from new bytes would build a
   * document out of two of them — a corruption with no symptom where it happens.
   * The renderer's answer is to rebuild the transport, which is ordinary, so this
   * is a variant rather than a failure code, and it carries the new version
   * **and** the new length so rebuilding costs no second round trip.
   *
   * ## No `document-busy`
   *
   * The read does not enter the lane. It mutates nothing, a page costs tens of
   * these, and queueing them behind a running command would serialise a reader
   * against itself — §2's *mutations are commands, reads are queries*. So the
   * one thing a lane can refuse is not a thing this can be refused for.
   */
  'document.readRange': channel(
    'Reads one bounded byte range of an open document at a named version.',
    z
      .object({
        docId: docIdSchema,
        /** The version the caller's transport is bound to. */
        version: docVersionSchema,
        /** First byte, inclusive. */
        begin: z.number().int().nonnegative(),
        /** Last byte, exclusive. */
        end: z.number().int().positive(),
      })
      .refine((range) => range.end > range.begin, {
        message: 'end must be greater than begin',
      })
      .refine((range) => range.end - range.begin <= MAX_RANGE_BYTES, {
        message: `a range may not exceed ${String(MAX_RANGE_BYTES)} bytes (invariant L11)`,
      }),
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('bytes'), bytes: z.instanceof(Uint8Array) }),
      z.object({
        kind: z.literal('stale'),
        version: docVersionSchema,
        byteLength: z.number().int().nonnegative(),
      }),
    ]),
    ['document-not-open'],
  ),

  /**
   * The view model `docs/ARCHITECTURE.md` §2 names beside the bytes.
   *
   * ## Why the renderer cannot derive this from what it already reads
   *
   * Finding OOOOO-1, measured 2026-08-30: a command's effect lands in the engine
   * session and main's canonical image is never replaced, so
   * {@link 'document.readRange'} serves the **pre-command** document for the
   * whole life of an open file. PDF.js parsing those bytes sees the rotation the
   * document was opened with, and no amount of rebinding a transport changes it.
   * §3.2 already says why that is the right way round — *PDF.js is never a
   * source of truth. It renders* — and this is the channel that makes the
   * sentence true rather than aspirational.
   *
   * ## What it carries, and why not more
   *
   * A page count and one absolute rotation per page **named in the request**.
   * **Not page sizes**: a page's box comes from `/MediaBox`, `/CropBox` and
   * their intersection rules, which PDF.js already implements in
   * `page.getViewport` — restating them here would be a second opinion that
   * agrees most of the time (B3a). Rotation is the one piece of geometry the
   * parser reads from bytes that have moved on.
   *
   * §2's other members — annotations, form fields, outline — are absent for
   * §10.4's reason rather than because the list is unfinished: a field nothing
   * reads is the display-only sin one layer down.
   *
   * ## The REQUEST names the pages, and that is invariant L11
   *
   * One rotation per page scales with the document. A channel that answered the
   * whole vector would be correct once — at open — and would become the
   * payload-scales-with-document defect the moment anything re-read it, which is
   * exactly what a renderer must do after every command. So a caller names the
   * pages it is about to draw, the same shape `document.readRange` has, and the
   * bound is {@link MAX_VIEW_MODEL_PAGES}.
   *
   * §2 describes a command *"returning a view-model delta"*. This is the same
   * property reached from the other side: the renderer asks about the window it
   * displays rather than being sent the difference. `document.execute` answers
   * with a version and a byte length, which is what tells the renderer the
   * window it is holding is stale.
   *
   * The page **count** is a scalar and always crosses. A viewer that cannot say
   * how many pages a document has cannot show a scrollbar, and one number is not
   * a payload.
   *
   * ## The version is on the ANSWER, not on the request
   *
   * `readRange` takes a version because a byte offset is only meaningful inside
   * the one that produced it, and answering a stale offset from new bytes builds
   * a document out of two. A geometry read has no offset to be wrong about: the
   * caller wants *the model as it is now*, and asking for a named version would
   * only let it ask for one that no longer exists. What it does need is to
   * recognise a **late** answer — a command can bump while this is in flight —
   * so the version the lane read it at travels back with it.
   */
  'document.viewModel': channel(
    'The geometry of the pages a renderer names, as it must draw them.',
    z.object({
      docId: docIdSchema,
      /**
       * Zero-based page indices, as {@link commandSchema} declares them.
       *
       * **Zero-based, and this is the one place both numbering schemes meet.**
       * PDF.js numbers pages from 1 and the document model indexes from 0, and
       * a renderer holding both had already sent `pages: [1]` for the first page
       * in a rotate command — a control that rotated the page after the one on
       * screen, on a build with no page navigation, where nothing could see it.
       */
      pages: z.array(z.number().int().nonnegative()).min(1).max(MAX_VIEW_MODEL_PAGES),
    }),
    z.object({
      version: docVersionSchema,
      pageCount: z.number().int().nonnegative(),
      /**
       * Degrees, snapped to a quarter turn, positionally aligned with `pages`.
       *
       * Absolute rather than relative, because `page.getViewport({ rotation })`
       * **replaces** the page's own rotation rather than adding to it —
       * measured by `proof:viewportrotation` rather than read off the
       * declaration. A model carrying the turns a command applied would draw
       * correctly on every document whose pages started at zero, which is every
       * fixture anyone reaches for first.
       */
      /**
       * BOUNDED HERE TOO, and not only by the request that produced it.
       *
       * The params already cap `pages` at `MAX_VIEW_MODEL_PAGES`, so a correct
       * handler cannot answer with more — which is an argument about the
       * handler and not a property of the boundary. L11 is about what may
       * cross, and a result schema that accepts an array of any length accepts
       * a document-sized one from a handler that got it wrong. Found by the
       * L11 sweep in `payloadBounds.test.ts`, 2026-09-03.
       */
      rotations: z.array(z.number().int().nonnegative()).max(MAX_VIEW_MODEL_PAGES).readonly(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Matches for one page, in the reading order the text substrate produced.
   *
   * ## ONE PAGE PER OPERATION, and that is L11 and §9.17 together
   *
   * A document-wide search is this channel called once per page, by the
   * renderer, which is the design rather than a cost to reduce later
   * ([ADR-0035](../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)).
   * Measured 2026-09-02: a text-heavy document's extracted text is **3.59× the
   * file size**, so `main` holding it — even transiently, since the budget is a
   * peak — is over twice its whole multiple before the canonical bytes it
   * already holds. Reading a page at a time bounds what is resident by the
   * largest page rather than by the document.
   *
   * The row's *cancellable background indexing* needs a per-page grain to cancel
   * at, so the shape the invariants force is also the shape the feature wants.
   *
   * ## `page` is ZERO-BASED, like every other page index that crosses here
   *
   * PDF.js numbers from 1. A renderer holds both and has already sent the wrong
   * one once — see `document.viewModel`'s note, which is the same trap and the
   * reason `SHOWN_PAGE` exists. A match's `page` comes back in the frame it went
   * out in, so nothing here changes numbering scheme mid-channel.
   */
  'document.searchPage': channel(
    'Matches for a query on one page, in reading order, bounded by the caller.',
    z.object({
      docId: docIdSchema,
      page: z.number().int().nonnegative(),
      /**
       * Refused when empty, at the boundary rather than in the kernel.
       *
       * Every position matches an empty query, so the honest answers are a
       * page-sized result list and a silent zero, and both are wrong. A renderer
       * with an empty search box has not asked a question yet.
       */
      query: z.string().min(1).max(MAX_QUERY_LENGTH),
      limit: z.number().int().positive().max(MAX_SEARCH_MATCHES),
      /**
       * How the query is compared — the same four the find bar offers.
       *
       * **Optional with defaults on the far side, rather than required here.**
       * The matching rule lives in one module (`@monstera/shared`'s
       * `textMatch.ts`) and its defaults are stated there; restating them in the
       * schema would be a second opinion about what an omitted flag means, and
       * the two would agree until one of them changed.
       *
       * **The pattern is NOT compiled here**, though it could be. A schema that
       * rejected an unparseable regex would answer with `internal` plus an
       * incident id — the shape reserved for a defect — for a person who has
       * typed `(` on the way to `(a)`. It is a declared failure instead.
       */
      caseSensitive: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      regex: z.boolean().optional(),
      normalise: z.enum(['nfc', 'nfkc', 'none']).optional(),
    }),
    z.object({
      version: docVersionSchema,
      matches: z
        .array(
          z.object({
            /** Index within this page's reading order, not a visual row. */
            line: z.number().int().nonnegative(),
            /** Offset within the line, in UTF-16 code units. */
            offset: z.number().int().nonnegative(),
            /**
             * The line the match sits in, so a result needs no second call.
             *
             * **BOUNDED, and this was the L11 gap the sweep found** (2026-09-03).
             * A line's length is chosen by whoever made the PDF, so an unclipped
             * one is a payload a hostile document sets — up to
             * `MAX_SEARCH_MATCHES` times per call. `findInLines` clips to a
             * window around the match and moves `offset` with it, so the pair
             * still indexes what crossed.
             */
            text: z.string().max(MATCH_TEXT_WINDOW),
          }),
        )
        .max(MAX_SEARCH_MATCHES)
        .readonly(),
      /**
       * Whether the limit stopped the search rather than the page running out.
       *
       * **The whole reason the limit is a parameter.** Without this a caller
       * cannot tell *this page holds four matches* from *you asked for four*,
       * and a results surface would silently stop paging.
       */
      truncated: z.boolean(),
    }),
    // `search-pattern-invalid` is DECLARED rather than left to `internal`, and
    // the difference is who it is about: the other three describe the document,
    // this one describes what the user typed. An incident id and "something
    // went wrong" is the wrong answer to a regex with an unclosed bracket, and
    // a renderer that could not tell the two apart would have to show one of
    // them for both.
    ['document-not-open', 'document-busy', 'document-poisoned', 'search-pattern-invalid'],
  ),

  /**
   * The document's optional-content groups.
   *
   * ## A READ, and the toggle is `document.execute`
   *
   * There is no `document.setLayerVisibility` channel and there must not be: a
   * layer's visibility lives in the document, so changing it is a **command**,
   * and commands go through the one channel that routes them with a capture and
   * an inverse. A second mutating channel would be the second wiring place — and
   * it would be one whose changes no undo could reach.
   *
   * Whole-document for `document.destinations`' reason: layers are structure,
   * read once when a document opens.
   */
  'document.layers': channel(
    'The document’s optional-content groups, with each one’s current visibility.',
    z.object({ docId: docIdSchema }),
    z.object({
      version: docVersionSchema,
      layers: z
        .array(
          z.object({
            /** The layer's address, as a `setLayerVisibility` command names it. */
            index: z.number().int().nonnegative(),
            name: z.string().max(MAX_LAYER_NAME_LENGTH),
            visible: z.boolean(),
          }),
        )
        .max(MAX_LAYERS)
        .readonly(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * The document's named destinations, as its outline states them.
   *
   * ## WHOLE-DOCUMENT, and why that is not invariant 11's concern
   *
   * L11 forbids a payload that scales with the document **per operation**. An
   * outline scales with the number of headings an author wrote — a property of
   * the document's structure rather than of its size, and a thousand-page scan
   * has none. It is read once when a document opens rather than per page, so
   * there is no per-operation growth here to bound.
   *
   * The contrast with `document.pageLinks` is the point: links exist per page
   * and would grow with the document, so that channel takes one. Both are
   * bounded by count regardless, because a bound that only exists where the
   * invariant demands it is a bound nobody applies to the hostile case.
   *
   * ## Flat with a depth, not a tree
   *
   * The outline nests and a panel renders rows. Carrying the nesting would put
   * the same tree walk in every consumer, and the first thing each would do is
   * flatten it. The order is the document's own, depth-first; nothing sorts,
   * because an outline's order is authored.
   */
  'document.destinations': channel(
    'The document’s outline, flattened, with each entry’s resolved page.',
    z.object({ docId: docIdSchema }),
    z.object({
      version: docVersionSchema,
      destinations: z
        .array(
          z.object({
            title: z.string().max(MAX_DESTINATION_TITLE_LENGTH),
            /**
             * Zero-based, or `null` when the entry resolves to no page.
             *
             * **`null` is a real state**: an outline may point at an external
             * URI or at a destination the document does not define, and both
             * should reach a reader rather than be dropped — a gap in a table
             * of contents is more confusing than an entry that cannot be
             * followed. Nullable rather than optional because JSON cannot
             * carry `undefined`, so one spelling travels end to end.
             */
            page: z.number().int().nonnegative().nullable(),
            /** How deep in the outline it sits. The top level is 0. */
            depth: z.number().int().nonnegative(),
          }),
        )
        .max(MAX_DESTINATIONS)
        .readonly(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * The links on one page.
   *
   * ## ONE PAGE, for `document.searchPage`'s reason
   *
   * A document-wide answer would scale with the document, which is what
   * invariant 11 forbids per operation. A links panel shows the page a reader
   * is on; a panel for a thousand-page document that fetched every link to show
   * twelve is the same defect the text substrate was measured into avoiding.
   *
   * ## The internal/external split CROSSES, and it is the security half
   *
   * Invariant 24: opening a document runs none of its content, and **no
   * external fetch until the user asks, for that item**. A renderer that had to
   * work out which links leave the document from their URIs would be a second
   * opinion about a question MuPDF answers — and every place that got it wrong
   * would be a page that fetches on open.
   *
   * An internal link carries a resolved page and no URI: a renderer needs the
   * page, and handing it the destination string as well would give it a second
   * way to act on a link it must not interpret (§3.2).
   */
  'document.pageLinks': channel(
    'The links on one page, with internal destinations already resolved.',
    z.object({
      docId: docIdSchema,
      /** Zero-based, as every page index that crosses this contract is. */
      page: z.number().int().nonnegative(),
    }),
    z.object({
      version: docVersionSchema,
      links: z
        .array(
          z.discriminatedUnion('kind', [
            z.object({
              kind: z.literal('internal'),
              /** Zero-based, so a caller can hand it straight to a jump. */
              page: z.number().int().nonnegative(),
              bounds: linkBoundsSchema,
            }),
            z.object({
              kind: z.literal('external'),
              /**
               * The URI exactly as the document carries it.
               *
               * **Nothing on either side follows it.** A renderer shows it and
               * asks; opening it is a separate action a person takes, which is
               * what invariant 24 means by *for that item*.
               */
              uri: z.string().max(MAX_LINK_URI_LENGTH),
              bounds: linkBoundsSchema,
            }),
          ]),
        )
        .max(MAX_PAGE_LINKS)
        .readonly(),
    }),
    ['document-not-open', 'document-busy', 'document-poisoned'],
  ),

  /**
   * Everything the last run stored, for the renderer to hydrate from.
   *
   * **A setting is not a document**, so none of §6's per-document machinery
   * applies: there is one set for the application, it is the user's, and it
   * survives every document being closed.
   *
   * ## The value shape is `unknown`, and that is the boundary being honest
   *
   * Every other channel here validates its payload precisely. This one cannot,
   * and pretending otherwise would be the defect: what a settings file holds is
   * whatever a *previous build* wrote, so a schema stated here would be this
   * build's opinion about last build's data — and a value it refused would be
   * dropped by the boundary before the one component that knows how to read it
   * ever saw it.
   *
   * The registry is the writer of record for what a stored value means (B3a):
   * `SettingsRegistry.read` runs `migrate`, validates, and falls back to the
   * default when a value cannot be salvaged. So the channel's job is to carry
   * the bytes faithfully and the registry's job is to decide what they were,
   * which is one opinion rather than two.
   *
   * `z.record` still refuses a non-object, which is the part that IS this
   * boundary's business: a settings file holding an array or a string is
   * corrupt in a way no registration can migrate.
   *
   * ## No failure codes
   *
   * A settings file that does not exist yet is a first launch, and an
   * unreadable one is a corrupt file the user cannot act on — both answer with
   * the defaults, which is what an empty object is. Declaring `absent` here
   * would put a decision in the renderer that main has already taken correctly.
   */
  'settings.load': channel(
    'Everything the previous run stored, unvalidated, for the registry to read.',
    z.object({}),
    z.object({ stored: z.record(z.string(), z.unknown()) }),
  ),

  /**
   * Stores the whole settings object.
   *
   * ## THE WHOLE OBJECT, not one id at a time
   *
   * A per-id channel would make the file the sum of a sequence of writes, so an
   * interrupted sequence leaves a state no single write produced — and a
   * setting removed from the registry would need its own deletion message to
   * ever leave the file. Sending everything makes the stored document a
   * function of the store's current state, which is the only shape where
   * "what is on disk" has one answer.
   *
   * It is also within L11 by the same reasoning `document.execute` is: this
   * scales with the number of registered settings, never with a document.
   *
   * ## `secret` settings ARE included, and that is deliberate
   *
   * §7 excludes secrets from **export**, which is a different operation. A user
   * who set an API key expects it to survive a restart; conflating the two
   * either leaks the key into a shared file or forgets it every launch, and
   * which one you get would depend on which caller reached for the store first.
   * `SettingsStore.exportable()` is the other projection and stays separate.
   */
  'settings.save': channel(
    'Replaces the stored settings with the values the renderer currently holds.',
    z.object({ values: z.record(z.string(), z.unknown()) }),
    z.object({ stored: z.literal(true) }),
  ),

  /**
   * Shows the log directory in the OS file manager.
   *
   * ## NOTHING CROSSES, in either direction, and that is the design
   *
   * The obvious spelling is `log.path` returning a string for the renderer to
   * open. It is a compile error here and would be one anywhere: a filesystem
   * path in a renderer-facing type is what invariant 2 forbids, and the reason
   * is not that this particular path is sensitive — `userData` contains the
   * user's name on Windows — but that a renderer holding one has a capability
   * the architecture says it does not have.
   *
   * So the channel is an **intent** with an empty payload. Main knows where it
   * put the log; the renderer knows only that a place exists to be shown.
   *
   * ## `revealed: false` is a state, not an error
   *
   * A log directory that does not exist yet is the ordinary case on a first
   * launch that has had nothing to report, and it is not a failure — there is
   * simply nothing to show. Answering with a declared `false` rather than a
   * failure code keeps *nothing has gone wrong yet* out of the incident log,
   * which would otherwise be the one entry a quiet run produces.
   */
  'log.reveal': channel(
    'Shows the diagnostics log in the OS file manager. No path crosses.',
    z.object({}),
    z.object({ revealed: z.boolean() }),
  ),
} as const;

export type Channels = typeof channels;
export type ChannelId = keyof Channels;

export type ChannelParams<K extends ChannelId> = ParamsOf<Channels, K>;
export type ChannelResult<K extends ChannelId> = ResultOf<Channels, K>;

/** The main-process side. Exhaustive: omitting a channel is a compile error. */
export type ContractHandlers = Handlers<Channels>;

/** The renderer side, and the shape the browser shim must implement in full. */
export type ContractClient = ClientApi<Channels>;

/** Channel ids as a runtime array, for iterating registrations. */
export const channelIds = Object.keys(channels) as readonly ChannelId[];
