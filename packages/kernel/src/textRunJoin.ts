/**
 * The one join the PDFium host makes before it answers a page's text
 * ([ADR-0130](../../../docs/DECISIONS/0130-a-documents-size-never-refuses-an-action.md) Decision 1).
 *
 * A producer that positions every glyph draws one text object per glyph, so a page of prose answered one run per
 * letter: 60 lines of 140 characters is 8,400 runs, past every bound that carried them, and the page could not be
 * edited. Objects that are one run by any reading — next among the page's runs, set alike, on one line, each starting
 * where the last ends — are joined here into one run named by its FIRST object and carrying its LAST.
 *
 * ## One function, read and apply alike
 *
 * `textRuns` answers the joined runs; `layOutBlocks` joins the same walk with this same function and expands each run
 * an edit names back into its members. Two joins would be two opinions about which objects a run is (B3a), and the
 * edit would then write objects other than the ones the person was shown. The edit carries the version it read, so
 * the page it is applied to is the page the join was made on.
 *
 * ## What it does NOT do
 *
 * It makes no lines or blocks: that grouping stays `main`'s (`textLines.ts`, ADR-0049), because an engine's opinion of
 * a line disagreed with what a person sees. Two runs this joins could never be read as two by anybody: a gap no
 * wider than the letters' size on one baseline in one face is a word or a space between words.
 */

/** How a run is set, compared field by field — `pdfiumFfi.ts`' `RunStyle`. */
export interface JoinStyle {
  readonly size: number;
  readonly colour: { readonly r: number; readonly g: number; readonly b: number };
  readonly serif: boolean;
  readonly mono: boolean;
  readonly italic: boolean;
  readonly bold: boolean;
  readonly upright: boolean;
}

/** One object's run, as the walk read it. */
export interface ObjectRun<Style extends JoinStyle = JoinStyle> {
  readonly index: number;
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly style: Style;
}

/** A joined run: its objects, first to last, in the page's order. */
export interface JoinedRun<Style extends JoinStyle = JoinStyle> extends ObjectRun<Style> {
  /** The last object in the run; `index` when the run is one object. */
  readonly last: number;
  /**
   * Exactly the objects the run is, in order. NOT every index from `index` to `last`: an object between two glyphs that
   * the walk holds no run for — a space drawn with no ink, a rule, an image — is not part of the run, and an edit that
   * named it would be refused for naming an object with no text it can place.
   */
  readonly members: readonly number[];
}

/**
 * How much two glyphs' heights must overlap to be on one line, as a share of the size.
 *
 * THE INK, not a baseline: the walk knows each run's lowest and highest ink and no baseline, and a descender moves the
 * lowest by a fifth of the size — measured 2026-10-01, a line drawn one glyph per object broke at its first `g` while
 * this compared bottoms. Every letter on a line covers its x-height band, about half the size, so neighbours overlap by
 * at least that; the next line at ordinary leading does not overlap at all.
 */
const SAME_LINE = 0.3;
/** The widest gap inside one run, as a share of the size: a word space is a quarter to a third of it. */
const MAX_GAP = 1;
/** The deepest overlap inside one run, as a share of the size: kerning pulls a glyph back, never a quarter of it. */
const MAX_OVERLAP = 0.25;

function sameStyle(a: JoinStyle, b: JoinStyle): boolean {
  return (
    a.size === b.size &&
    a.colour.r === b.colour.r &&
    a.colour.g === b.colour.g &&
    a.colour.b === b.colour.b &&
    a.serif === b.serif &&
    a.mono === b.mono &&
    a.italic === b.italic &&
    a.bold === b.bold &&
    a.upright === b.upright
  );
}

/** The size a join measures gaps against: the style's, or the run's own height where the style says nothing. */
function measure(run: ObjectRun): number {
  return run.style.size > 0 ? run.style.size : Math.max(0, run.top - run.bottom);
}

/**
 * Whether `next` continues `run`: the next of the page's runs, set alike, on its line, starting where it ends.
 *
 * NEXT AMONG THE RUNS, not next among the page's objects: a producer that draws a word space as its own object draws
 * it with no ink, and the walk keeps no run for it — measured 2026-10-01, a line drawn one glyph per object stopped
 * joining at its first space while the index rule required `last + 1`.
 */
function continues(run: JoinedRun, next: ObjectRun): boolean {
  // UPRIGHT ONLY: a gap along x means nothing for text set at an angle, and the editor leaves that text out anyway.
  if (!run.style.upright || !sameStyle(run.style, next.style)) return false;
  const size = measure(run);
  if (size <= 0) return false;
  const overlap = Math.min(run.top, next.top) - Math.max(run.bottom, next.bottom);
  if (overlap < SAME_LINE * size) return false;
  const gap = next.left - run.right;
  return gap <= MAX_GAP * size && gap >= -MAX_OVERLAP * size;
}

/**
 * The page's runs with every run of abutting glyph objects joined, in the page's object order.
 *
 * @param runs one run per object, in any order — sorted here by index, which is what "consecutive" means.
 */
export function joinRuns<Style extends JoinStyle>(runs: readonly ObjectRun<Style>[]): JoinedRun<Style>[] {
  const ordered = [...runs].sort((a, b) => a.index - b.index);
  const joined: JoinedRun<Style>[] = [];
  for (const run of ordered) {
    const held = joined.at(-1);
    if (held !== undefined && continues(held, run)) {
      joined[joined.length - 1] = {
        ...held,
        last: run.index,
        members: [...held.members, run.index],
        text: held.text + run.text,
        left: Math.min(held.left, run.left),
        right: Math.max(held.right, run.right),
        bottom: Math.min(held.bottom, run.bottom),
        top: Math.max(held.top, run.top),
      };
    } else {
      joined.push({ ...run, last: run.index, members: [run.index] });
    }
  }
  return joined;
}

/**
 * The objects a named run is — its {@link JoinedRun.members} — or `undefined` when no joined run begins at `index`: a
 * name the read never answered, which the edit refuses rather than guesses.
 */
export function membersOf(joined: readonly JoinedRun[], index: number): readonly number[] | undefined {
  return joined.find((candidate) => candidate.index === index)?.members;
}
