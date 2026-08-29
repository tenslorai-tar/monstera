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
  | { readonly surface: 'ribbon'; readonly section: SectionId; readonly group: string; readonly order: number }
  | { readonly surface: 'quick-toolbar'; readonly order: number }
  | { readonly surface: 'context-menu'; readonly context: MenuContext; readonly order: number }
  | { readonly surface: 'start-screen'; readonly order: number };

/** Every `surface` tag, for a projection that needs to name the one it is. */
export type SurfaceId = Placement['surface'];
