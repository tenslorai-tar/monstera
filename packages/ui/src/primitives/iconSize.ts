/**
 * The four icon sizes §10.4 mandates, named by their USE rather than by their
 * number.
 *
 * §10.4: *"One icon set: lucide, consistent stroke, at exactly four sizes with a
 * stated use each: 12 px panel tabs and inline chrome · 14 px status bar and
 * dense controls · 16 px primary controls (rail, floating toolbar, buttons) ·
 * 20 px ribbon buttons."*
 *
 * ## Why the names are uses and not numbers
 *
 * A `size={16}` prop admits `size={15}`, and it admits `size={16}` chosen
 * because it looked right rather than because the control is a primary one. Both
 * are the same defect — a pixel value decided at a call site — and §10 bans
 * magic pixel values for exactly that reason.
 *
 * Naming the use makes the wrong choice unsayable rather than explained (B5):
 * there is no fifth member to pass, and a caller has to answer *what kind of
 * control is this* instead of *how big should this look*.
 *
 * ## THE PIXEL VALUES ARE NOT HERE, AND THAT IS THE POINT
 *
 * `tokens.css` already declares `--icon-12`, `--icon-14`, `--icon-16` and
 * `--icon-20`. A `Record<IconSize, 12 | 14 | 16 | 20>` beside them would be a
 * second writer of one concern (B3): two tables that agree until somebody edits
 * one, and the disagreement renders rather than throwing.
 *
 * `CLAUDE.md` states when a copy is allowed — *"copy only where the reader
 * cannot reach the source"* — and the reader reaches it here, because CSS can
 * size an `<svg>`. So the use-to-size mapping lives once, in `primitives.css` as
 * `.m-icon-button--<use> svg { width: var(--icon-N); }`, and this module carries
 * only the vocabulary.
 *
 * The consequence worth knowing: nothing in a component test can assert an icon
 * is 16 px, because no stylesheet is loaded there. That claim belongs to the
 * visual pass (§10.7), and asserting it here would mean building the copy this
 * comment exists to refuse.
 */

/** The four uses §10.4 states, in ascending size order. */
export type IconSize = 'chrome' | 'dense' | 'control' | 'ribbon';

/**
 * Every member of {@link IconSize}, for a caller that must cover all four.
 *
 * Typed as the tuple rather than `IconSize[]` so a fifth use added to the union
 * without being added here is a compile error — the roster deriving its extent
 * from the thing it governs would agree with any shrink (checklist 4c), and this
 * one cannot.
 */
export const ICON_SIZES: readonly [IconSize, IconSize, IconSize, IconSize] = [
  'chrome',
  'dense',
  'control',
  'ribbon',
];
