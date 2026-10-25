import { HIGHLIGHT_ABOVE, HIGHLIGHT_BELOW, STRIKE_RISE, UNDERLINE_DROP, UNDERLINE_THICKNESS } from './markFigures.js';

/**
 * The rectangles a page-text writer draws for a mark (ADR-0228 Decision 1), as the page says them and as a read finds them
 * again: the ONE answer both take (B3a, ADR-0228's correction of 2026-10-13, the owner's L2).
 *
 * ## Marked, so a read can tell them from a drawing
 *
 * Each is an `/Artifact` (PDF 32000-1, 14.8.2.2: not part of the words, so a reader and a screen reader leave it out)
 * whose {@link DECORATION_KEY} parameter names its kind. A rectangle another producer drew carries no such mark and is
 * never taken for one: it stays a drawing and nothing here moves or removes it.
 *
 * ## Which words it belongs to is where it is drawn
 *
 * {@link decorationBand} is where a kind is drawn for words of a size on a baseline, and the writer draws by it; a marked
 * rectangle belongs to the run whose band it fills and whose extent it spans ({@link decorationsOf}).
 */

export type DecorationKind = 'under' | 'through' | 'behind';

/** The marked-content tag a decoration is drawn under. */
export const DECORATION_TAG = 'Artifact';
/** The parameter of that mark naming the decoration's kind. */
export const DECORATION_KEY = 'MonsteraDecoration';

/** Every kind, in the order a writer considers them. */
export const DECORATION_KINDS: readonly DecorationKind[] = ['under', 'through', 'behind'];

const KINDS: ReadonlySet<string> = new Set<string>(DECORATION_KINDS);

/** A mark parameter's value as a decoration's kind, or `undefined` for anything else. */
export function decorationKindOf(value: string | null | undefined): DecorationKind | undefined {
  return value !== null && value !== undefined && KINDS.has(value) ? (value as DecorationKind) : undefined;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A marked rectangle on the page: its kind, its box in user space, and its fill. */
export interface PageDecoration {
  readonly kind: DecorationKind;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly colour: Rgb;
}

/** What a run's words carry of the three: present only where they do. */
export interface RunDecorations {
  readonly underline?: true;
  readonly strike?: true;
  readonly highlight?: Rgb;
}

/** How thick a rule is for words of `size`: never thinner than half a point, which a reader would drop. */
export function ruleThickness(size: number): number {
  return Math.max(0.5, UNDERLINE_THICKNESS * size);
}

/** Where a kind is drawn for words of `size` whose baseline is at `baseline`: its bottom and top in user space. */
export function decorationBand(kind: DecorationKind, baseline: number, size: number): { readonly bottom: number; readonly top: number } {
  if (kind === 'under') {
    const top = baseline - UNDERLINE_DROP * size;
    return { bottom: top - ruleThickness(size), top };
  }
  if (kind === 'through') {
    const bottom = baseline + STRIKE_RISE * size;
    return { bottom, top: bottom + ruleThickness(size) };
  }
  return { bottom: baseline - HIGHLIGHT_BELOW * size, top: baseline + HIGHLIGHT_ABOVE * size };
}

/** How far a rectangle's edges may sit from its band and still be that band: a tenth of the size, and half a point. */
const BAND_SLACK = 0.1;
/** How much of a run's extent a rectangle must span to be that run's: more than half of it. */
const SPAN_SHARE = 0.5;

/**
 * Which of `decorations` a run's words carry: each one drawn in its kind's band for the run's baseline and size, and
 * spanning more than half the run's extent. A run over no marked rectangle carries none.
 */
export function decorationsOf(
  run: { readonly left: number; readonly right: number; readonly baseline: number; readonly size: number },
  decorations: readonly PageDecoration[],
): RunDecorations {
  const width = run.right - run.left;
  if (width <= 0 || run.size <= 0) return {};
  const slack = BAND_SLACK * run.size + 0.5;
  let found: { underline?: true; strike?: true; highlight?: Rgb } = {};
  for (const decoration of decorations) {
    const band = decorationBand(decoration.kind, run.baseline, run.size);
    if (Math.abs(decoration.bottom - band.bottom) > slack || Math.abs(decoration.top - band.top) > slack) continue;
    const overlap = Math.min(run.right, decoration.right) - Math.max(run.left, decoration.left);
    if (overlap <= SPAN_SHARE * width) continue;
    if (decoration.kind === 'under') found = { ...found, underline: true };
    else if (decoration.kind === 'through') found = { ...found, strike: true };
    else found.highlight ??= decoration.colour;
  }
  return found;
}
