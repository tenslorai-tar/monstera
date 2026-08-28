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
 * **Invariant L11 applies to every entry below, and is not yet mechanically
 * checked.** No channel's payload may scale with document size *per operation*;
 * the single sanctioned byte crossing is a snapshot, once per **version**. The
 * check was deliberately not written at Stage 0: with one channel carrying a
 * version string it would have inspected nothing, passed, and stayed green
 * while the channels that make L11 bite were added. It is a Stage 1 gate, owed
 * as the first document-carrying channel lands — which is this file, so whoever
 * writes that channel is the person who owes it.
 */
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
   * **The result is the version and nothing else.** A log entry holds an inverse
   * or a checkpoint — a whole byte image of the document — so returning what the
   * bus produced would put the document on the wire once per operation, which is
   * exactly what L11 forbids. The version is what the renderer needs to know its
   * view is stale.
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
      z.object({ kind: z.literal('opened'), docId: docIdSchema, version: docVersionSchema }),
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
    z.object({ version: docVersionSchema }),
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
      z.object({ kind: z.literal('undone'), version: docVersionSchema }),
      z.object({ kind: z.literal('nothing-to-undo') }),
    ]),
    [
      'document-not-open',
      'document-busy',
      'document-poisoned',
      'checkpoint-restore-not-built',
    ],
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
