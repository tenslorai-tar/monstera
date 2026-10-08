/**
 * What a box's read is shown as, and where its lines go back (the owner's review of 0.1.12.0, *Send a box to Claude to
 * recognise*).
 *
 * The page's text layer answers a read with LINES, each with its box in display space at scale 1. A recogniser gives a
 * table's cells as separate lines — one per word — so shown one to a row they read as a column of single words. A person
 * reads a page in ROWS: the lines that sit at one height are one row, left to right, with the cells tab-separated so that a
 * copy pastes into Word or Excel as a table. This module is the one place that groups them, and it is pure.
 */

/** A box in the page's display space at scale 1: `y` grows downward, as the text layer reports it. */
export interface ReadBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One line the text layer holds. */
export interface ReadLine {
  readonly text: string;
  readonly box: ReadBox;
}

/**
 * The lines the read ADDED to a page: its lines after, less the lines that were already there.
 *
 * A line that was on the page before is taken out ONCE per occurrence, by its text, so a box over words the page already had
 * still shows what was added. The lines kept are `after`'s own, with their boxes.
 */
export function addedReadLines(before: readonly ReadLine[], after: readonly ReadLine[]): readonly ReadLine[] {
  const remaining = new Map<string, number>();
  for (const line of before) remaining.set(line.text, (remaining.get(line.text) ?? 0) + 1);
  return after.filter((line) => {
    const left = remaining.get(line.text) ?? 0;
    if (left === 0) return true;
    remaining.set(line.text, left - 1);
    return false;
  });
}

/** Whether two boxes sit at one height: they share more than half of the shorter one's height. */
function sameRow(a: ReadBox, b: ReadBox): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return shorter > 0 && overlap > shorter / 2;
}

/**
 * The lines grouped into ROWS in reading order: top to bottom, and left to right within a row.
 *
 * A row's height is the first line's that opened it, so a tall word is not stretched by a short neighbour, and a line joins
 * the first row it sits in. Lines are taken top first, so the row a line opens is the highest of its own.
 */
export function rowsOf(lines: readonly ReadLine[]): readonly (readonly ReadLine[])[] {
  const ordered = [...lines].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  const rows: ReadLine[][] = [];
  for (const line of ordered) {
    const row = rows.find((candidate) => {
      const [first] = candidate;
      return first !== undefined && sameRow(first.box, line.box);
    });
    if (row === undefined) rows.push([line]);
    else row.push(line);
  }
  return rows.map((row) => [...row].sort((a, b) => a.box.x0 - b.box.x0));
}

/** The rows as text: a row on a line, its cells separated by a tab, which Word and Excel take as columns. */
export function readingText(rows: readonly (readonly ReadLine[])[]): string {
  return rows.map((row) => row.map((line) => line.text.trim()).join('\t')).join('\n');
}

/**
 * Whether the rows are a TABLE: at least two rows, and at least two of them with two or more cells. A single line of words
 * the recogniser split in two, or a paragraph, is not.
 */
export function isTabular(rows: readonly (readonly ReadLine[])[]): boolean {
  return rows.filter((row) => row.length >= 2).length >= 2;
}

/**
 * The font size a line is put back at: one that fits both the line's height and its width, so the words land where they
 * were read and neither spill past the box nor shrink to nothing.
 *
 * @param measure the average width of a character as a share of the size — 0.5 for the sans face the text boxes use
 */
export function fitSize(box: ReadBox, text: string, measure = 0.5): number {
  const height = Math.abs(box.y1 - box.y0);
  const width = Math.abs(box.x1 - box.x0);
  const characters = Math.max(1, Array.from(text).length);
  const byHeight = height * 0.8;
  const byWidth = width / (characters * measure);
  return Math.max(4, Math.min(72, Math.floor(Math.min(byHeight, byWidth))));
}
