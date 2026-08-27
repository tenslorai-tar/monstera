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
   */
  record(entry: LogEntry): void {
    this.#entries.length = this.#applied;
    this.#entries.push(entry);
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
