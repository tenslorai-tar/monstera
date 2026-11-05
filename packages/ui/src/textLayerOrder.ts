import type { TextLayerLine } from './TextLayer.js';

/**
 * The order a page's lines are laid out in the text layer, as indices into the engine's reading order.
 *
 * ## Why it is not simply the engine's order
 *
 * A browser's selection runs through elements in document order, so a drag from a line to the one below selects every
 * line laid out between them. The engine's reading order comes from MuPDF's segmentation, which cuts a page along its
 * white space: measured 2026-11-05 on a form whose second line is wider than anything else on the page, the cut left that
 * line out of the region holding the lines above and below it and read it last, after the form's labels. A drag from the
 * heading to the third line then skipped the second, and went on through the labels to reach it.
 *
 * ## What it changes
 *
 * Only where a line lies between two lines that the order holds side by side, and overlaps both across. A column beside
 * them overlaps neither, so column order stands. Each line keeps its index, which is what search and the letters know it
 * by: this moves where an element sits and nothing else. A line not upright is left where it is, since *between* and
 * *across* are questions about rows.
 */

/** A line's box as this order reads it. */
interface Row {
  readonly index: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly middle: number;
}

function rowOf(line: TextLayerLine, index: number): Row | null {
  const { x0, y0, x1, y1 } = line.box;
  const direction = line.letters?.direction;
  // MORE THAN A DEGREE OFF THE PAGE'S ACROSS IS NOT A ROW; with no letters, a box taller than it is wide is not either.
  const upright = direction === undefined ? x1 - x0 >= y1 - y0 : Math.abs(direction.y) < 0.02 && direction.x > 0;
  return upright ? { index, left: x0, right: x1, top: y0, bottom: y1, middle: (y0 + y1) / 2 } : null;
}

const overlapsAcross = (one: Row, two: Row): boolean => one.left < two.right && two.left < one.right;

/**
 * Whether `line` belongs between `above` and `below`: its middle lies between theirs, with room for a line there, and it
 * overlaps both across.
 */
function liesBetween(line: Row, above: Row, below: Row): boolean {
  return (
    above.middle < line.middle &&
    line.middle < below.middle &&
    below.middle - above.middle >= line.bottom - line.top &&
    overlapsAcross(line, above) &&
    overlapsAcross(line, below)
  );
}

/**
 * The lines' indices in layout order. Asked only of a line that goes back up the page from the one before it, so a page
 * read straight down asks nothing; a page holds at most `MAX_TEXT_LAYER_LINES` lines, which bounds the rest.
 */
export function layoutOrder(lines: readonly TextLayerLine[]): readonly number[] {
  const rows = lines.map(rowOf);
  const order: number[] = [];
  for (const [index, row] of rows.entries()) {
    const last = order.at(-1);
    const before = last === undefined ? null : (rows[last] ?? null);
    if (row === null || before === null || row.middle >= before.middle) {
      order.push(index);
      continue;
    }
    let place = -1;
    for (let at = 0; at + 1 < order.length; at += 1) {
      const above = rows[order[at] ?? -1] ?? null;
      const below = rows[order[at + 1] ?? -1] ?? null;
      if (above !== null && below !== null && liesBetween(row, above, below)) {
        place = at + 1;
        break;
      }
    }
    if (place === -1) order.push(index);
    else order.splice(place, 0, index);
  }
  return order;
}
