import type { CommandKind, CommandOfKind } from '@monstera/contract';
import type { Brand } from '@monstera/shared';

// `import type`, NOT `import { type … }`. The second form keeps the specifier
// in the emitted JavaScript as `import {} from './rotatePages.js'`, which RUNS —
// and `rotatePages.js` imports `withDocument` from `mupdfWriter.js` as a value,
// which loads the native MuPDF binding.
//
// Measured: importing `documentService.js` cost **38.1 MB of RSS** before this
// line was corrected, for a module that must never parse a document. `main`
// holds bytes and hands work to a host (ARCHITECTURE §2); pulling the parser
// into it is the creep §9.17's base term exists to catch, and it arrived
// through a type-only import of a type.
//
// Same mechanism as the Electron download one file over, with a different bill.
import type { ByteImage } from './engineSeam.js';
import type { PriorLayerVisibility } from './layers.js';
import type {
  PriorPageCopy,
  PriorPageInsert,
  PriorPageOrder,
  PriorPageSwap,
} from './pageOrder.js';
import type { PriorPageCrop } from './pageCrop.js';
import type { PriorPageRotation } from './rotatePages.js';

/**
 * The command log: a cursor over entries, not a stack (ADR-0009 §4).
 *
 * ## Why a cursor, and why now
 *
 * Neither the founding record nor `ARCHITECTURE` mentioned redo. Converting a
 * stack into a cursor-plus-log is a structural change *beneath already-built
 * features*, so §4 added it before any command existed. Undo moves the cursor
 * back and never pops; redo moves it forward; a new command truncates whatever
 * the cursor is no longer pointing past.
 *
 * ## The two shapes, and what makes the wrong one unrepresentable
 *
 * An entry is `{ kind: 'invertible', command, inverse }` or
 * `{ kind: 'terminal', command, checkpoint }` — never both, never neither. A
 * non-invertible command without a checkpoint cannot be constructed, which is
 * §4's sentence as a type rather than as a rule someone follows.
 *
 * ## Applying an inverse is NOT here
 *
 * This structure records what happened and where the cursor is. Reversing an
 * entry — restoring a leaf to *inheriting* rather than to declaring the value it
 * used to inherit — is §3's assertion and lands with the first command that
 * exercises it. A log that both stored and applied would make that assertion
 * untestable without driving the whole pipeline.
 */

/**
 * A byte snapshot taken before a command that cannot be inverted.
 *
 * **Branded, with the only mint inside `commandBus.ts`.** §4 says the
 * checkpoint is taken by the bus, in one code path, never by a handler — and
 * that has to be structural rather than documented. Unbranded this is
 * `Uint8Array`, so any handler could produce one and the rule would survive
 * exactly as long as everyone remembered it.
 *
 * The brand is what a handler cannot forge. It is reinforced by the seam: a
 * live-session `apply` returns `Promise<void>` and has nowhere to put one, and
 * `capture` returns a {@link CaptureResult} that cannot carry one either. Three
 * doors, all shut, and the compile-fail proof holds each of them.
 */
export type Checkpoint = Brand<ByteImage, 'Checkpoint'>;

/**
 * The prior state each command's inverse needs, per kind.
 *
 * Exhaustiveness is free rather than asserted: `CommandSpecs` is a mapped type
 * over `CommandKind` and each spec's `capture` is typed `CommandPrior[K]`, so a
 * command kind with no entry here cannot be indexed and does not compile at its
 * own spec.
 *
 * §3's shape lives on the values, not here — `PriorPageRotation` carries
 * `{ present: false }` for a page that inherited, which is what makes its
 * inverse a delete.
 */
export interface CommandPrior {
  readonly rotatePages: readonly PriorPageRotation[];
  /**
   * A layer's own visibility, read before it was changed.
   *
   * §3's shape again, on a different axis: `PriorPageRotation` carries absence
   * because a rotation may be inherited, and this carries the boolean the
   * document held because a toggle may have changed nothing. Both exist so an
   * inverse RESTORES rather than derives — an inverse computed as
   * `!command.visible` flips a layer the command left alone.
   */
  readonly setLayerVisibility: PriorLayerVisibility;
  /**
   * Where a page was, and where it went.
   *
   * The odd one of the three: the other two carry state read OFF the document
   * before it changed, and this carries the move itself. That is not a
   * shortcut — a single move has no prior structure to hold, because the tree
   * it produces is a function of the tree it started from and the two indices.
   *
   * What the capture adds over the command is **validation against the
   * document**: an inverse cannot be built from a `to` this document never had,
   * which is the state `captureMovePage` refuses rather than records.
   */
  readonly movePage: PriorPageOrder;
  /**
   * **`never`, and that is the declaration rather than a placeholder.**
   *
   * A deleted page's prior state is its object and everything that object
   * reaches — content streams, resources, annotations — which is
   * document-scaled and has no serialisable form. Recording it would put
   * unbudgeted document-scaled bytes in the log, where `retainedBytes` counts
   * **checkpoints only** and would report a figure smaller than what the
   * process holds. §4's retention would then trim against a number that is
   * wrong in the direction nobody notices.
   *
   * So a delete is a checkpoint command, and `never` is what makes that
   * structural rather than a rule: `CaptureResult<never>`'s `{ captured: true }`
   * member requires a `prior: never` and cannot be constructed, and
   * `LogEntryFor<'deletePages'>`'s `invertible` member cannot either. **An
   * invertible delete is unrepresentable** (B5) — there is no runtime check
   * anywhere for it, and none is needed.
   */
  readonly deletePages: never;
  /**
   * Where the copy landed.
   *
   * `movePage`'s shape rather than `rotatePages`': there is no prior state on
   * the document to read, because the page the inverse removes did not exist
   * before the command. What the capture adds over the command is
   * **validation** — an index this document actually has — and the destination
   * the kernel chose, so an inverse cannot be built from a placement rule a
   * later version changed.
   */
  readonly duplicatePage: PriorPageCopy;
  /**
   * The pair, as validated against the document.
   *
   * The only prior state in this table whose inverse is the command itself,
   * because a transposition is an involution. It is still **captured** rather
   * than read back off the command at undo time: `movePage` next door records
   * the same two numbers for the same reason, and a log entry that reached for
   * `entry.command` to invert would be the one shape §3 forbids.
   */
  readonly swapPages: PriorPageSwap;
  /**
   * Where the blank page landed.
   *
   * {@link PriorPageCopy}'s shape and its reason: the page the inverse removes
   * did not exist before the command, so there is no prior state on the
   * document to read — what the capture adds is validation, and an index the
   * command's own bound accepts *one past the end* where every other command in
   * this table refuses it.
   */
  readonly insertBlankPage: PriorPageInsert;
  /**
   * Each cropped page's own `/CropBox`, read before the command ran.
   *
   * `PriorPageRotation`'s shape on a second key, and for §3's same reason:
   * **absence is a value**. A page that displayed its media box because it
   * declared no crop box must come back declaring none — writing the box in
   * renders identically and is a different document, and the next crop would
   * inset from a box the page never had.
   */
  readonly cropPages: readonly PriorPageCrop[];
  /**
   * **`never`, for `deletePages`' reason arriving from the opposite side.**
   *
   * A delete's prior state is unrecordable because it is the page and
   * everything the page reaches. A watermark's is unrecordable because it is
   * the page's **whole content stream** — drawing appends to it, and restoring
   * the page means restoring the stream it had, which is document-scaled and
   * has the same effect on `retainedBytes` that entry describes: a log that
   * reports a figure smaller than what the process holds, trimmed against a
   * number wrong in the direction nobody notices.
   *
   * So every command routed to a byte-image writer is a checkpoint command, and
   * `never` is what makes it structural: `CaptureResult<never>` has no
   * constructible `{ captured: true }` member, so `captureWatermarkPages`
   * cannot report success even by mistake, and `LogEntryFor<'watermarkPages'>`
   * has no `invertible` member to build.
   *
   * **The checkpoint costs nothing beyond what this command already does**
   * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)):
   * the bytes the bus serialises for the checkpoint are the same bytes the
   * `apply` consumes as its input image.
   */
  readonly watermarkPages: never;
}

/**
 * What a capture returns: the prior state, or a stated reason it could not be
 * taken.
 *
 * **Not an exception**, and the difference is the ADR decision of 2026-08-19.
 * "This command is invertible in general and is not on this document" is an
 * ordinary outcome the bus handles by taking a checkpoint instead — so it is a
 * value in the type, where the caller cannot fail to consider it, rather than a
 * throw the caller may or may not catch.
 *
 * A genuinely invalid command still throws. An out-of-range page index and a
 * forged session are not documents the log can route around; they are callers
 * getting it wrong, and they must not be quietly converted into checkpoints.
 */
export type CaptureResult<T> =
  | { readonly captured: true; readonly prior: T }
  | { readonly captured: false; readonly reason: string };

/**
 * One entry, in one of exactly two shapes.
 *
 * Distributed over the kind union, so `command` and `inverse` are the same
 * command's — an entry pairing a `rotatePages` command with another command's
 * prior state does not compile.
 */
export type LogEntryFor<K extends CommandKind> =
  | {
      readonly kind: 'invertible';
      readonly command: CommandOfKind<K>;
      readonly inverse: CommandPrior[K];
    }
  | {
      readonly kind: 'terminal';
      readonly command: CommandOfKind<K>;
      readonly checkpoint: Checkpoint;
      /** Why no inverse could be recorded. Carried so undo can explain itself. */
      readonly reason: string;
    };

/**
 * Any entry, as the log holds them.
 *
 * A mapped type collapsed to its own union rather than `LogEntryFor<CommandKind>`
 * — the second would let a `rotatePages` command pair with another command's
 * prior state, because the two type arguments would be resolved independently.
 */
export type LogEntry = { readonly [K in CommandKind]: LogEntryFor<K> }[CommandKind];

/**
 * What a lane entry may ask of the log without holding the bus's capability.
 *
 * Queries only. "Is there anything to undo" is a fair question for any work
 * running in the lane; recording an entry or moving the cursor is not, because
 * an entry recorded without an applied command makes undo reverse a change the
 * document never received.
 */
/**
 * What a retention trim discarded.
 *
 * Always returned, never `undefined` for *nothing happened*. Invariant 18
 * obliges the caller to tell the user when history was shortened, and an
 * obligation that arrives as an absent value is one that gets skipped by a
 * caller writing `if (trim)`.
 */
export interface LogTrim {
  /** Entries the user can no longer reach, applied and redo tail together. */
  readonly droppedEntries: number;
  /** Document-scaled bytes reclaimed. Zero when only invertible entries went. */
  readonly droppedBytes: number;
}

export interface ReadonlyCommandLog {
  readonly entries: readonly LogEntry[];
  readonly redoDepth: number;
  /** Document-scaled bytes retained, cursor position irrelevant. */
  retainedBytes(): number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  peekRedo(): LogEntry | undefined;
}

/**
 * The log and its cursor.
 *
 * The cursor is a count of **applied** entries, not an index, so "nothing
 * applied" is `0` rather than `-1` and there is no off-by-one to get wrong at
 * either end.
 */
export class CommandLog implements ReadonlyCommandLog {
  /** @internal */
  readonly #entries: LogEntry[] = [];

  /** How many entries are currently applied. */
  #applied = 0;

  /** Entries that are applied right now, oldest first. */
  get entries(): readonly LogEntry[] {
    return this.#entries.slice(0, this.#applied);
  }

  /** How many entries could be redone — the tail the cursor has stepped back over. */
  get redoDepth(): number {
    return this.#entries.length - this.#applied;
  }

  /**
   * Document-scaled bytes this log is holding, checkpoints included.
   *
   * ## Why the log answers this rather than the caller summing `entries`
   *
   * **`entries` is the APPLIED view, and memory does not care about the
   * cursor.** Undo steps the cursor back and never pops, so a checkpoint in the
   * redo tail is invisible to `entries` and is still in the process. A caller
   * summing what it can see would under-report by exactly the amount an undo
   * just made invisible — the wrong direction, and undetectable from outside.
   *
   * So the log reports what it physically retains, which is the only question
   * `DocumentService`'s ceiling is asking.
   *
   * Only checkpoints are document-scaled. An invertible entry's `inverse` is a
   * `CommandPrior` — for `rotatePages`, one small record per page — and counting
   * it would put a rounding error into a figure compared against a budget.
   */
  retainedBytes(): number {
    let total = 0;
    for (const entry of this.#entries) {
      if (entry.kind === 'terminal') total += entry.checkpoint.byteLength;
    }
    return total;
  }

  /**
   * Sheds retained bytes until the log holds no more than `target`, and reports
   * what that cost.
   *
   * ## Dropping a checkpoint ENDS UNDO PAST IT, and that is the whole design
   *
   * A terminal entry is terminal for not being invertible, so undo cannot step
   * over one without the checkpoint it carries. Discarding that checkpoint
   * therefore makes every entry at or before it unreachable — not merely
   * unhelpful — which is why they go with it rather than being left in place
   * as a history nothing can walk. Keeping them would report a `canUndo` that
   * lies, which is worse than a shorter history.
   *
   * §4 says memory is *"one document plus a few checkpoints"*. This is *a few*
   * being enforced, and the number is not written here: the caller computes the
   * target from `DocumentService`'s ceiling, which §9.17 is the writer of record
   * for. A constant in this file would be a second policy for one concern.
   *
   * ## The REDO tail goes first, and that ordering is the only choice made here
   *
   * Both ends are the user's work and neither loss is free. A redo entry is work
   * they have already stepped back from; an undo entry is the path back to where
   * they are. So the tail is shed newest-first before any applied history is
   * touched — strictly less bad, and the alternative is not neutral: a
   * front-first walk destroys the history the user is standing on while holding
   * speculative entries behind them.
   *
   * **That ordering was UNREACHABLE through the bus and became reachable on
   * 2026-09-04**, which is the day this half stopped being documentation and
   * started being a mechanism. A redo tail can only hold a checkpoint if undo
   * stepped over a terminal entry, and `CommandBus.undo` used to refuse exactly
   * that. It now restores the entry's checkpoint and steps the cursor
   * ([ADR-0037](../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)),
   * so a terminal entry sitting in the redo tail is an ordinary state and a
   * trim that walked front-first would now discard applied history while
   * holding it.
   *
   * It was kept while unreachable on the argument that deleting it would be
   * correct for that tree and wrong the day clause (ii) landed, silently, in a
   * file nobody would be reading. That day arrived, and what changed with it is
   * the **obligation**: a branch nothing can reach owes no case, and this one
   * now owes one. `commandBus.test.ts` carries it, in the retention block —
   * this log's cases live there because reaching the state needs a bus.
   *
   * ## Invariant 18: this must never be silent
   *
   * A silently shortened history is work quietly becoming unrecoverable. The
   * return value is not a diagnostic — it is what the caller is obliged to tell
   * the user with, which is why a trim that dropped nothing is `0` rather than
   * `null`: an obligation that arrives as an absent value is one a caller
   * forgets to check.
   *
   * @param target the most this log may retain, in document-scaled bytes
   */
  trimTo(target: number): LogTrim {
    let droppedEntries = 0;
    let droppedBytes = 0;

    const shed = (entries: readonly LogEntry[]): void => {
      droppedEntries += entries.length;
      for (const entry of entries) {
        if (entry.kind === 'terminal') droppedBytes += entry.checkpoint.byteLength;
      }
    };

    // THE REDO TAIL, newest first, and ONLY while there is a checkpoint in it.
    //
    // The guard is not an optimisation. An invertible entry retains no
    // document-scaled bytes, so popping one reclaims nothing — and a loop
    // keyed on `retainedBytes() > target` alone would empty a checkpoint-free
    // tail entirely, discard the user's redo history, and still be over the
    // target. Pure loss for no gain, which is the worst thing a shedding rule
    // can do. Popping invertible entries that sit *in front of* a checkpoint is
    // different: they are in the tail being discarded anyway.
    const tailHoldsCheckpoint = (): boolean =>
      this.#entries.slice(this.#applied).some((entry) => entry.kind === 'terminal');
    while (this.retainedBytes() > target && tailHoldsCheckpoint()) {
      const removed = this.#entries.pop();
      if (removed === undefined) break;
      shed([removed]);
    }

    // Then the applied history, oldest first, in terminal-bounded chunks: the
    // entries before a checkpoint cannot be reached once it is gone.
    while (this.retainedBytes() > target) {
      const oldest = this.#entries.findIndex((entry) => entry.kind === 'terminal');
      // NOT AN ERROR AND NOT A LOOP. Nothing document-scaled is left, so the
      // target cannot be met by shedding — the remaining entries are invertible
      // and hold no checkpoint. The caller's ceiling is then exceeded by the
      // canonical images alone, which is a different problem with a different
      // answer (refusing the next open) and not one to solve by deleting undo.
      if (oldest === -1) break;
      const removed = this.#entries.splice(0, oldest + 1);
      shed(removed);
      this.#applied = Math.max(0, this.#applied - removed.length);
    }

    return { droppedEntries, droppedBytes };
  }

  get canUndo(): boolean {
    return this.#applied > 0;
  }

  get canRedo(): boolean {
    return this.redoDepth > 0;
  }

  /**
   * Records a newly applied entry, **truncating the redo tail first**.
   *
   * §4: a new command truncates the tail. Keeping it would let redo replay a
   * command against a document that has since diverged, which is a corrupted
   * document rather than a surprising undo history.
   *
   * ## GENERIC IN THE KIND, which one command could not reveal
   *
   * This took `LogEntry` until 2026-09-03 and the bus passes `LogEntryFor<K>`
   * for a generic `K`. Those are the same type when `CommandKind` has one
   * member and are **not** when it has two: for an unresolved `K`,
   * `CommandOfKind<K>` is assignable to no single union member, so the whole
   * entry is assignable to none of them.
   *
   * The signature was correct-by-accident, and the second command is what said
   * so. A cast at the call site would have been the workaround — the value
   * genuinely is a `LogEntry` for every concrete `K`, which is exactly the kind
   * of true statement that hides a signature saying less than it means.
   *
   * ## The one narrowing, and why it is HERE rather than at the callers
   *
   * `LogEntryFor<K>` with an unresolved `K` is assignable to no member of the
   * distributed union, and TypeScript has no way to say *this is one of them,
   * whichever K turns out to be*. Something has to assert it.
   *
   * Asserting it once, at the single point where an entry enters storage, means
   * every caller keeps a signature that says what it means. The alternative is
   * a cast at each call site — which is the same unsoundness spread over more
   * places, each of which would have to re-derive why it is safe. Both the
   * `command` and the `inverse` come from the same `K` by construction, which
   * is the property `LogEntryFor` exists to enforce and the reason this is safe
   * rather than convenient.
   */
  record<K extends CommandKind>(entry: LogEntryFor<K>): void {
    this.#entries.length = this.#applied;
    this.#entries.push(entry as LogEntry);
    this.#applied += 1;
  }

  /**
   * Steps the cursor back and returns the entry that was undone.
   *
   * **Never pops.** The entry stays so redo can step forward over it, which is
   * the whole difference between this and a stack. Returns `undefined` at the
   * start of the log rather than throwing: "nothing to undo" is a state the UI
   * asks about constantly, not an error.
   */
  undo(): LogEntry | undefined {
    if (!this.canUndo) return undefined;
    this.#applied -= 1;
    return this.#entries[this.#applied];
  }

  /**
   * The entry redo would step forward over, **without moving the cursor**.
   *
   * The bus needs to know what it is about to re-apply before it commits to
   * moving: a redo that refuses — a stored-effect command — must leave the
   * cursor exactly where it was, and a `redo()` that moves first would have to
   * move back on failure. Two mutations of one field is how a cursor drifts.
   */
  peekRedo(): LogEntry | undefined {
    return this.canRedo ? this.#entries[this.#applied] : undefined;
  }

  /** Steps the cursor forward and returns the entry to re-apply. */
  redo(): LogEntry | undefined {
    if (!this.canRedo) return undefined;
    const entry = this.#entries[this.#applied];
    this.#applied += 1;
    return entry;
  }
}

// A `isKind(entry, 'rotatePages')` narrowing helper was written here and
// deleted: with one command kind the comparison is always true, and lint said
// so. A guard that cannot fail is the vacuous shape, and there is no caller for
// it — the second command kind is when it becomes a check rather than a shape.
