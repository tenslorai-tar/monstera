import { MAX_RULING_INCHES, type RuledGrid, type Ruling } from './rasterRulings.js';

/**
 * The tables a page draws with rules ACROSS and none down, read from the drawing's own rules
 * ([ADR-0297](../../../docs/DECISIONS/0297-a-table-ruled-only-across-is-read-from-its-drawn-rules.md)).
 *
 * A shaded header band and a hairline under every row, with nothing down, encloses no cell, so MuPDF's table hunt
 * proposes no table from it (the Supply Agreement's products table: none) or cuts it where segmentation cuts (the
 * report's Volunteers table: two, without its header). The rules are the evidence that a table is there and where its
 * rows are; the columns are where no character of any row reaches, read only inside the rules. An unruled table is
 * still not read: with no run of rules there is nothing here to bound a grid by.
 *
 * Everything is in points of the page's display space, the structured text's, and every length is a property of what a
 * ruling or a table is, in ADR-0233's own bounds where it has one. Nothing is tuned to a document.
 */

/** The thickest stroke or fill that is a rule and not a box: ADR-0233's four points. */
const THICKEST = MAX_RULING_INCHES * 72;
/** The shortest rule: half an inch, ADR-0233's own, longer than any letter is wide. */
const SHORTEST = 36;
/** The tallest shaded band whose two edges are rules (a header row's shading): one inch. A panel taller is no row. */
const TALLEST_BAND = 72;
/** How far two rules' ends may differ and still be one table's width: two points. */
const SAME_END = 2;
/** Two rules this close down the page are one rule (a band's edge drawn over a hairline): a point and a half. */
const SAME_RULE = 1.5;
/** The tallest row between two rules of one table: two inches. Past it, the rules belong to separate things. */
const TALLEST_ROW = 144;
/** The narrowest stripe no character crosses that parts two columns: six points, twice a word space at 12 points. */
const NARROWEST_GUTTER = 6;
/**
 * How close to a run's ends, on its own rows, a character makes the run part of something wider: a quarter inch. A table
 * whose every cell is shaded on its own lines its cells' shading up column by column, and each column's run of shading
 * edges is not a table (measured 2026-11-19 on a corpus page: a five-column table read as two two-column ones inside it).
 * A neighbouring cell's words sit a cell's padding from the edge; a page's own margin or a gutter between page columns
 * is wider than this.
 */
const BESIDE = 18;

/** A painted shape as the drawing reports it, in display space. */
export interface DrawnShape {
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  /** A filled area, or a stroked path's ink. A stroked outline taller than {@link THICKEST} is no rule across. */
  readonly kind: 'fill' | 'stroke';
  /** Whether it is painted the paper's colour, which draws nothing a reader sees. */
  readonly paper: boolean;
}

/** A character's box in display space. */
export interface CharacterBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The page's rules across, as rulings in display space: each thin wide shape at its middle, and each shaded band's top
 * and bottom edges. In the order found, which callers sort.
 */
export function rulesAcross(shapes: readonly DrawnShape[]): Ruling[] {
  const rules: Ruling[] = [];
  for (const { box, kind, paper } of shapes) {
    if (paper) continue;
    const width = box.x1 - box.x0;
    const height = box.y1 - box.y0;
    if (width < SHORTEST) continue;
    if (height <= THICKEST) rules.push({ at: (box.y0 + box.y1) / 2, from: box.x0, to: box.x1 });
    else if (kind === 'fill' && height <= TALLEST_BAND) {
      rules.push({ at: box.y0, from: box.x0, to: box.x1 }, { at: box.y1, from: box.x0, to: box.x1 });
    }
  }
  return rules;
}

const centreX = (box: CharacterBox): number => (box.x0 + box.x1) / 2;
const centreY = (box: CharacterBox): number => (box.y0 + box.y1) / 2;

/**
 * The grids the rules across make with the characters between them: a run of three or more rules of one width, each
 * gap a row that holds text, and two or more columns parted by stripes no character crosses.
 */
export function acrossGrids(rules: readonly Ruling[], characters: readonly CharacterBox[]): RuledGrid[] {
  // ONE TABLE'S RULES SHARE THEIR ENDS: grouped by width, each group top to bottom.
  const groups: Ruling[][] = [];
  for (const rule of [...rules].sort((a, b) => a.at - b.at)) {
    const group = groups.find(
      (each) => Math.abs((each[0]?.from ?? 0) - rule.from) <= SAME_END && Math.abs((each[0]?.to ?? 0) - rule.to) <= SAME_END,
    );
    if (group === undefined) groups.push([rule]);
    else if (rule.at - (group.at(-1)?.at ?? -Infinity) > SAME_RULE) group.push(rule);
  }

  const grids: RuledGrid[] = [];
  for (const group of groups) {
    const from = Math.min(...group.map((rule) => rule.from));
    const to = Math.max(...group.map((rule) => rule.to));
    const holdsText = (top: number, bottom: number): boolean =>
      characters.some((box) => {
        const x = centreX(box);
        const y = centreY(box);
        return x >= from && x <= to && y > top && y < bottom;
      });
    // RUNS: a gap that is too tall, or that holds no text, ends one.
    let run: number[] = [];
    const runs: number[][] = [];
    for (const rule of group) {
      const last = run.at(-1);
      if (last !== undefined && (rule.at - last > TALLEST_ROW || !holdsText(last, rule.at))) {
        runs.push(run);
        run = [];
      }
      run.push(rule.at);
    }
    runs.push(run);

    for (const rows of runs) {
      if (rows.length < 3) continue;
      const top = rows[0] ?? 0;
      const bottom = rows.at(-1) ?? 0;
      const inside = characters.filter((box) => {
        const x = centreX(box);
        const y = centreY(box);
        return x >= from && x <= to && y > top && y < bottom;
      });
      // PART OF SOMETHING WIDER, where words stand just past either end on these rows: the run is one column's shading.
      const beside = characters.some((box) => {
        const x = centreX(box);
        const y = centreY(box);
        return y > top && y < bottom && ((x < from && x > from - BESIDE) || (x > to && x < to + BESIDE));
      });
      if (beside) continue;
      const columns = columnEdges(inside, from, to);
      if (columns.length < 3) continue;
      grids.push({
        rows,
        columns,
        borders: rows.slice(0, -1).map(() => columns.slice(0, -1).map(() => ({ top: true, left: false, bottom: true, right: false }))),
      });
    }
  }
  return grids;
}

/** The column edges from `from` to `to`: the middles of the stripes at least {@link NARROWEST_GUTTER} wide no character crosses. */
function columnEdges(characters: readonly CharacterBox[], from: number, to: number): number[] {
  const spans = characters
    .map((box) => [Math.max(from, box.x0), Math.min(to, box.x1)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const edges = [from];
  let reach = spans[0]?.[1];
  for (const [start, end] of spans.slice(1)) {
    if (reach !== undefined && start - reach >= NARROWEST_GUTTER) edges.push((start + reach) / 2);
    reach = Math.max(reach ?? end, end);
  }
  edges.push(to);
  return edges;
}
