import { type DocId, type DocVersion, type MessageKey, isDottedName } from '@monstera/shared';

import type { Placement } from './placement.js';

/**
 * The command registry — §7's first row, and the one every surface projects.
 *
 * ADR-0029 in one paragraph: a registry is a **value** that is composed, never
 * a module side effect (Decision 1); `run` is required by the type (Decision
 * 2); a duplicate id is a build failure (Decision 3); `when` is pure and takes
 * its context as a parameter (Decision 5); the title is a `MessageKey`
 * (Decision 6).
 *
 * ## What this file is NOT, stated because a reader will assume it
 *
 * `check:secondwiring` treats this module's existence as the signal that
 * projections must live under `packages/ui/src/surfaces/`, and refuses when
 * they do not. That is deliberate — the scan's third state — so this file
 * arriving is what makes the surfaces directory obligatory rather than
 * eventual.
 */

/**
 * What a command may read to decide visibility and to run.
 *
 * **Passed in, never reached for** (Decision 5). A `when` that read a
 * module-level store would bind the command to a singleton, which §6 forbids
 * for document state and which would also make the predicate untestable without
 * one. A plain object, so a case constructs one in a line.
 *
 * No `FileHandle`, no path, no bytes: the renderer holds an opaque `DocId` and
 * a `DocVersion` and nothing else about a document (invariant 2).
 */
export interface CommandContext {
  /** The focused document, or `undefined` on the start screen. */
  readonly docId: DocId | undefined;
  /** The focused document's version. Present exactly when `docId` is. */
  readonly version: DocVersion | undefined;
  /** Whether anything is selected on the canvas. */
  readonly hasSelection: boolean;
  /** Whether the document has unsaved changes. */
  readonly dirty: boolean;
  /**
   * The page the user is looking at, **zero-based**, or `undefined` with no
   * document.
   *
   * ## Why this arrived, and what it replaced
   *
   * `SHOWN_PAGE` was a constant, because this build drew one page and *the page
   * on screen* had one answer. Continuous scroll ends that: several pages are
   * on screen and one of them is the one a command means. Its own header said
   * the day would come — *"the day there are several, every caller of this is
   * the list of places that have to learn which one"* — and this is that list,
   * reduced to one entry by putting the answer in the context every command
   * already receives.
   *
   * **Zero-based, like every page index that crosses the contract.** PDF.js
   * numbers from 1 and this build has already sent the wrong one once;
   * `pageNumbering.ts` is where the two meet and is the only place that
   * converts.
   */
  readonly page: number | undefined;
  /**
   * How many pages the document has, or `undefined` with no document.
   *
   * **The parser's count, not the view model's** — the same correction the
   * scroller made: taking it from `document.viewModel` couples a surface to an
   * engine session, and a document PDF.js reads perfectly would then have no
   * count wherever no host starts.
   *
   * Here because navigation needs an END, and a command that clamped against a
   * number it fetched itself would be a second answer to a question the shell
   * already holds.
   */
  readonly pageCount: number | undefined;
}

/**
 * One registered command.
 *
 * ## `run` is required, and that closes half the problem
 *
 * Decision 2, whose limit is worth repeating where a builder meets it: a
 * required `run` makes **forgetting** an implementation impossible and does
 * nothing about a `run` that is present and empty — `() => {}` compiles.
 * §10.4's *a control that renders but does nothing is a defect* is enforced by
 * the wired-tools test PAIR, not by this type. A reader who believes the type
 * covers it will not write the pair.
 *
 * ## `when` decides existence, not enablement
 *
 * CLAUDE.md: *"the registry's `when` predicate hides what does not exist yet."*
 * A command whose `when` is false is absent from every projection — not greyed
 * out — because a disabled control is a promise and an absent one is not.
 */
export interface UiCommand {
  /** `<domain>.<name>`, matching a `MessageKey`'s grammar. Unique registry-wide. */
  readonly id: string;
  /** The user-facing label, as a key. A literal is a compile error here. */
  readonly title: MessageKey;
  /** An icon name from the generated set, or none for palette-only commands. */
  readonly icon?: string;
  /** A chord, e.g. `Ctrl+S`. Normalised by {@link shortcutMapOf}, not here. */
  readonly shortcut?: string;
  /** Where this appears. Empty means palette-only, which is legitimate. */
  readonly placements: readonly Placement[];
  /**
   * Whether the command exists in this context. **Pure and synchronous**
   * (Decision 5) — it runs on every projection render, and a predicate that
   * could await would make visibility a race nobody can reproduce. Absent means
   * always.
   */
  readonly when?: (context: CommandContext) => boolean;
  /** Required. See the note above about what that does and does not buy. */
  readonly run: (context: CommandContext) => void | Promise<void>;
}

/**
 * The composed set of commands.
 *
 * ## Why a class and not a frozen array
 *
 * The duplicate check needs somewhere to happen once, and Decision 3 rules that
 * a collision is a failure rather than a last-write-wins: *"the second silently
 * replacing the first is how a feature stops working with nothing red."* The
 * shape is `DocumentStores.open`'s, for the same reason — a map whose writer
 * refuses rather than overwrites.
 *
 * Construction is where it fires, so a collision is a startup crash with both
 * ids named rather than a defect that surfaces when someone presses a key.
 */
export class CommandRegistry {
  readonly #byId = new Map<string, UiCommand>();

  /**
   * @param commands every command in the application, gathered at the
   *   composition point. Order is irrelevant: projections sort by `order` and
   *   break ties by id, so nothing here depends on the sequence.
   */
  constructor(commands: readonly UiCommand[]) {
    for (const command of commands) {
      // THE GRAMMAR IS CHECKED HERE BECAUSE A GUARD DEPENDS ON IT, which is a
      // stronger reason than tidiness. `check:secondwiring` finds command ids in
      // a surfaces module by matching this shape, so an id outside it — a
      // camel-cased one, say — is an id that scan cannot see, and a hand-written
      // list built from such ids would pass the very check written to forbid it.
      // Refusing at the registry makes that unrepresentable rather than watched
      // (B5), and the rule itself comes from `isDottedName` rather than from a
      // regex written again here (B3a).
      if (!isDottedName(command.id)) {
        throw new Error(
          `"${command.id}" is not a command id. An id is <domain>.<name> — lower-case, ` +
            `dot-separated, e.g. edit.rotate-pages. The grammar is not cosmetic: ` +
            `check:secondwiring matches ids by it, so an id outside it is invisible to the scan ` +
            `that forbids a second wiring place (ADR-0029 Decision 4).`,
        );
      }
      const existing = this.#byId.get(command.id);
      if (existing !== undefined) {
        throw new Error(
          `Two commands claim the id "${command.id}". Ids reach shortcut maps, the palette and ` +
            `telemetry, so one silently replacing the other is a feature that stops working with ` +
            `nothing red (ADR-0029 Decision 3). Rename one of them.`,
        );
      }
      this.#byId.set(command.id, command);
    }
  }

  /** Every command, in registration order. Projections do their own sorting. */
  all(): readonly UiCommand[] {
    return [...this.#byId.values()];
  }

  /** One command by id, or `undefined`. */
  get(id: string): UiCommand | undefined {
    return this.#byId.get(id);
  }

  /**
   * The commands that exist in this context.
   *
   * Every projection starts here, which is what makes `when` mean *absent*
   * rather than *disabled* everywhere at once instead of per surface.
   */
  available(context: CommandContext): readonly UiCommand[] {
    return this.all().filter((command) => command.when?.(context) ?? true);
  }

  /** How many commands are registered. For diagnostics and for cases that assert a count. */
  get size(): number {
    return this.#byId.size;
  }
}
