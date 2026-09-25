import { type DocId, type DocVersion, type MessageKey, isDottedName } from '@monstera/shared';

import type { ComparableDocument } from '../ComparePane.js';
import type { IconName } from '../primitives/icons.js';
import type { Placement, SurfaceId } from './placement.js';

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
  /**
   * Every open document, as a command that names a second one has to name it.
   *
   * ## Here for `pageCount`'s reason, on a different question
   *
   * ADR-0040's commands name a second document by `DocId`, and the renderer
   * already holds the ids — tabs are keyed by them. A command that fetched the
   * list itself would be *a second answer to a question the shell already
   * holds*, which is the sentence `pageCount` is here for.
   *
   * **`ComparableDocument`, not a new shape.** `ComparePane` already declares
   * *"One open document, as the picker needs to name it"* and already receives
   * `others={tabs}`; a second declaration of the same four fields would be the
   * duplicate B3 spends its time on.
   *
   * **Includes the focused document**, deliberately, exactly as `ComparePane`'s
   * `others` does — the caller filters. A list that pre-excluded it would make
   * *this document* unnameable for any command that legitimately wants it, and
   * every consumer would then need to know whether the filtering had already
   * happened.
   *
   * Empty on the start screen rather than `undefined`: there is nothing to
   * merge into, and an empty list says that without a second absent state.
   */
  readonly openDocuments: readonly ComparableDocument[];
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
  /**
   * The user-facing label, as a key. A literal is a compile error here.
   *
   * **The full form**, and it stays the full form: the palette is searched, and a
   * context menu has room for a sentence. {@link ribbonTitle} is what the ribbon
   * draws instead where this is too long for it.
   */
  readonly title: MessageKey;
  /**
   * One or two words, for the RIBBON only — the owner's design pass, 2026-09-21.
   *
   * ## Why the short form is the addition, rather than the long one
   *
   * The obvious shape is the other way round: shorten `title` and add a
   * `description` carrying the sentence. It was built that way first and is worse
   * in three ways, all of which the measurement or the record already answer.
   *
   * `title` reaches **every** surface. Shortening it shortens the command palette,
   * which is searched rather than scanned, and the four context menus, where the
   * owner's own row spells the items out in full — *Mark for redaction*, *Close
   * other tabs*. Nothing about those surfaces was crowded; the ribbon was, and it
   * is the only one the owner's complaint names.
   *
   * It also makes the sentence a **new string** for every command, where here it
   * already exists and is already translated. And it makes the two texts
   * independently editable, so they can drift into saying different things — which
   * is the defect `Tooltip`'s original rule was written against.
   *
   * ## Absent means the title already fits
   *
   * `ToolButton` is then rendered with no tooltip at all rather than one repeating
   * the caption: a tooltip that says what is already on screen is noise a pointer
   * user cannot dismiss, and it adds nothing to the accessibility tree, since the
   * visible caption is already the name. **So a tooltip appears on the ribbon
   * exactly where the label is an abbreviation**, which is the rule a reader can
   * learn rather than a per-button decision.
   *
   * Measured before the rule was applied, at 800 px: Organize asked for 2980 px,
   * Comment 2642, Tools 2508, Forms 1611, Review 1428, Home 1366, Protect 896,
   * Edit 800. Every section but one overflowed.
   */
  readonly ribbonTitle?: MessageKey;
  /**
   * One line a start-screen shortcut CARD shows under its title — v5-01's six cards (ADR-0068's `shortcut`
   * slot). Absent, the card draws the title alone.
   *
   * **Every word of it is a claim about this build**, on the first screen a person sees: each was checked
   * against the code before it was written (JOURNAL, 2026-09-25), and where the design's line said more than
   * the build does, the line says less.
   */
  readonly summary?: MessageKey;
  /**
   * The glyph a surface draws for this command, from the one closed set.
   *
   * **Required wherever the command is drawn as a control** — on the ribbon, the
   * quick toolbar or the start screen. {@link CommandRegistry} refuses a command
   * placed there without one, because §10.4 gives those surfaces icons and a
   * control with none would be sized for a glyph that is not there. A command in
   * the palette or a context menu alone may omit it.
   */
  readonly icon?: IconName;
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
/**
 * The surfaces that draw a command as a glyph (§10.4's four icon uses).
 *
 * A context menu row and a palette entry are text, so they are not here. A new
 * `Placement` surface has to be added or left out deliberately, and the
 * compiler holds the member names to the union.
 */
const DRAWS_A_GLYPH: ReadonlySet<SurfaceId> = new Set<SurfaceId>([
  'ribbon',
  'quick-toolbar',
  'start-screen',
  // §10.4: "14 px status bar". Its buttons are icon-only (ADR-0067).
  'status-bar',
  // §10.4: "16 px primary controls (rail …)" — the rail's foot draws the command's glyph (ADR-0098).
  'rail',
  // NOT `properties`: v5-02 draws the Properties tab's foot as two text buttons, Reply and Delete.
]);

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
      // A GLYPH WHERE ONE IS DRAWN. §10.4 gives the ribbon, the quick toolbar,
      // the start screen and the status bar icons at stated sizes, and `icon` was optional with
      // nothing requiring it: every command on those surfaces carried none, and
      // they rendered as text. Refused here, at startup, naming the command and
      // the surface, rather than left to a screenshot someone has to notice.
      const drawn = command.placements.find((placement) => DRAWS_A_GLYPH.has(placement.surface));
      if (drawn !== undefined && command.icon === undefined) {
        throw new Error(
          `"${command.id}" is placed on the ${drawn.surface} and names no icon. That surface ` +
            `draws a glyph at one of §10.4's four sizes; give the command an \`icon\` from ` +
            `primitives/icons.ts.`,
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
    // A GROUP OF SECONDARIES ONLY would be a caption over a lone *More* — the shape the width fold
    // already refuses to produce (ADR-0098 Decision 1). Refused here, naming the group, so the
    // mistake is a startup crash rather than a ribbon somebody has to look at.
    const primaries = new Map<string, boolean>();
    for (const command of this.#byId.values()) {
      for (const placement of command.placements) {
        if (placement.surface !== 'ribbon') continue;
        // A MENU IS NOT A SECONDARY (ADR-0101): a secondary is already in a menu, the group's More,
        // so the pair would name two menus for one tool.
        if (placement.menu !== undefined && placement.prominence === 'secondary') {
          throw new Error(
            `"${command.id}" names a menu and is secondary in ${placement.section} › ${placement.group}. ` +
              `A secondary is already in its group's More; drop one of the two (ADR-0101).`,
          );
        }
        const key = `${placement.section} › ${placement.group}`;
        primaries.set(key, (primaries.get(key) ?? false) || placement.prominence !== 'secondary');
      }
    }
    for (const [group, hasPrimary] of primaries) {
      if (!hasPrimary) {
        throw new Error(
          `The ribbon group ${group} holds only secondary tools, so it would draw as a caption over a ` +
            `lone More. Make at least one of its placements primary (ADR-0098).`,
        );
      }
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
