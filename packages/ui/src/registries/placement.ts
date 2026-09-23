import type { MessageKey } from '@monstera/shared';

/**
 * Where a command appears — declared BY the command, never by the surface.
 *
 * §7: *"Placements are part of the command, not of the surface. A projection
 * needs data to project from, so every command declares where it appears."* A
 * surface that decided its own contents would be the second wiring place the
 * registry exists to forbid, and `check:secondwiring` scans for exactly that.
 *
 * ## Why the union is the exhaustiveness anchor
 *
 * ADR-0029 Decision 4: a projection is only a projection if nothing else can
 * add to it, and the cheapest *you have not finished* signal is a `never` case.
 * Every surface narrows on `placement.surface` and ends in one, so **adding a
 * variant here fails to compile in every surface that has not handled it**.
 *
 * That property is the whole reason this union lives in its own module rather
 * than beside `UiCommand`: the surfaces import it and the commands import it,
 * and a cycle between them would be resolved by someone duplicating the union.
 */

/**
 * The eight feature sections of §10.3's left rail, in rail order.
 *
 * A literal union rather than an enum, and the array below is the runtime half:
 * §7 says `SectionId` is *exactly* the eight sections, so a ninth is a change to
 * the layout anatomy and not to a command.
 */
export type SectionId =
  | 'home'
  | 'comment'
  | 'edit'
  | 'organize'
  | 'forms'
  | 'review'
  | 'protect'
  | 'tools';

/**
 * The sections in rail order, which is also ribbon order.
 *
 * Ordered because the ribbon renders them in this sequence and a `Set` would
 * not say so; the ORDER is data the projection needs, and deriving it from
 * object key order elsewhere would make it depend on a declaration nobody reads
 * as ordering.
 */
export const SECTION_IDS: readonly SectionId[] = [
  'home',
  'comment',
  'edit',
  'organize',
  'forms',
  'review',
  'protect',
  'tools',
];

/**
 * Where on the start screen a command sits (ARCHITECTURE §7, ADR-0068): the button under the hero, the grid of
 * feature shortcuts, or the footer beside the screen's own text. A slot and not an `order` range, because a range is a
 * convention in numbers that no type and no single placement shows.
 */
export type StartScreenSlot = 'primary' | 'shortcut' | 'footer';

/** Where a context menu was opened. §7's four contexts. */
export type MenuContext = 'page' | 'annotation' | 'selection' | 'tab';

/**
 * One place a command appears.
 *
 * `order` is a number rather than a position in an array because two features
 * that never see each other's code have to interleave — §7's example is
 * Highlight living in Home › Quick tools, Comment › Markup and the annotation
 * context menu at once. Ties are broken by id, so a projection is deterministic
 * even when two features pick the same number, which they will.
 */
export type Placement =
  | {
      readonly surface: 'ribbon';
      readonly section: SectionId;
      /**
       * The captioned group this command sits in, as a catalogue key.
       *
       * **A `MessageKey` and not a `string`** (ARCHITECTURE amendment,
       * 2026-09-08). §10.3 puts this on screen as the group's caption, so a
       * plain string here is a visible user-facing literal reaching the ribbon
       * through the one door the JSX lint rule cannot see — a variable. Free-
       * form is preserved, which is what §7 needs so two features that never
       * see each other's code can interleave; a `MessageKey` is a branded
       * string, so ordering and map keying are unchanged.
       */
      readonly group: MessageKey;
      readonly order: number;
    }
  | { readonly surface: 'quick-toolbar'; readonly order: number }
  | { readonly surface: 'context-menu'; readonly context: MenuContext; readonly order: number }
  | { readonly surface: 'start-screen'; readonly slot: StartScreenSlot; readonly order: number }
  | StatusBarPlacement
  | TitleBarPlacement;

/**
 * A labelled button in the title bar (ARCHITECTURE §7 and §10.3,
 * [ADR-0095](../../../../docs/DECISIONS/0095-the-title-bar-projects-the-applications-own-commands.md)).
 *
 * The owner's design puts Donate and Rate Us in the row between the document tabs and the command
 * search, and each is an ordinary command that opens a dialog.
 *
 * **`emphasis` is here rather than on the command** because the design gives one the filled accent
 * treatment and the other the outline, and a bar that decided that by reading a command's id would be
 * the hand-maintained layout table this union exists to forbid, one field narrower. It is also not a
 * property of the command: Highlight sits in three surfaces at once and looks different in each.
 *
 * The bar's other controls — the tabs, the search, the layout switcher — each hold a value, so none of
 * them can be a command (`run` takes no argument). That is ADR-0067's rule, unchanged.
 */
export interface TitleBarPlacement {
  readonly surface: 'title-bar';
  readonly emphasis: 'primary' | 'normal';
  readonly order: number;
}

/**
 * A status-bar button, DISCRIMINATED BY CLUSTER (ARCHITECTURE §7, ADR-0067 and its 2026-09-15
 * correction). Each cluster's `side` is exactly the gaps between the bar's own controls in that
 * cluster, so a gap that does not exist cannot be spelt:
 *
 * - `navigation` — `before` or `after` the page field;
 * - `zoom` — `before` the slider, `between` the slider and the percentage, `after` the percentage,
 *   which is what renders §10.3's *"zoom-out button · slider · zoom-in button · current percentage ·
 *   fit mode"*;
 * - `chrome` — the commands about the chrome itself. No control of the bar's own, so no `side`.
 */
export type StatusBarPlacement =
  | {
      readonly surface: 'status-bar';
      readonly cluster: 'navigation';
      readonly side: 'before' | 'after';
      readonly order: number;
    }
  | {
      readonly surface: 'status-bar';
      readonly cluster: 'zoom';
      readonly side: 'before' | 'between' | 'after';
      readonly order: number;
    }
  | { readonly surface: 'status-bar'; readonly cluster: 'chrome'; readonly order: number };

/** §10.3's status-bar groups (ADR-0067). */
export type StatusBarCluster = StatusBarPlacement['cluster'];

/** Every `surface` tag, for a projection that needs to name the one it is. */
export type SurfaceId = Placement['surface'];
