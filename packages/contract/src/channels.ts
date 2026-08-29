import { z } from 'zod';

import { channel, type ClientApi, type Handlers, type ParamsOf, type ResultOf } from './channel.js';
import { commandSchema } from './commands.js';
import { docIdSchema, docVersionSchema } from './schemas.js';

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
export const channels = {
  'app.info': channel(
    'Version and install channel of the running application.',
    z.object({}),
    z.object({
      version: z.string().min(1),
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
   * view is stale; **rebuilding that view needs the new byte length too**,
   * because the renderer drives PDF.js through a `PDFDataRangeTransport` bound
   * to a total size, and a command rewrites the document. Rebinding on the
   * version alone binds to the previous image's length — a range past the end is
   * a `RangeError` the handler reports as `internal`, and a range short of it is
   * a parse of a truncated document.
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
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('opened'),
        docId: docIdSchema,
        version: docVersionSchema,
        /**
         * The document's size in bytes — what a `PDFDataRangeTransport` is
         * constructed with. Bounded, so L11 is untouched: a number is the same
         * size for a 2 KB document and a 2 GB one.
         */
        byteLength: z.number().int().nonnegative(),
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
    ]),
  ),

  'document.execute': channel(
    'Applies one command to an open document, returning the version it produced.',
    z.object({ docId: docIdSchema, command: commandSchema }),
    z.object({ version: docVersionSchema, byteLength: z.number().int().nonnegative() }),
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
