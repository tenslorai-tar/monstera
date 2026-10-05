import type { ComposeFonts } from './composeFonts.js';
import {
  BODY_LEADING,
  BODY_SIZE,
  MARGIN,
  type PageWriter,
  type PlacedLine,
  type Run,
  measureRuns,
  wrap,
} from './composeLayout.js';

/**
 * A table on composed pages, for New PDF from CSV and a Markdown table (Part A2).
 *
 * ## Measured, then fitted, and never refused for its width
 *
 * Every column is measured first: its widest line as written, and its widest word. Then the table is fitted by the
 * least change that holds it, in this order:
 *
 * 1. **As written, on the page asked for**, each column as wide as its widest line.
 * 2. **Turned**, where the table is wider than that page: the table's pages are set with the long side across.
 * 3. **Smaller type**, half a point at a time down to {@link TABLE_FLOOR_SIZE}, before anything wraps.
 * 4. **Wrapped**: each column given at least its widest word, the room left shared by what each still wants, and a
 *    cell's lines broken between words. Inside a word only where one word is wider than its column, the last resort,
 *    because text past a cell's edge is drawn over the next.
 * 5. **Split into groups of columns** where even the narrowest columns do not fit at the floor: each group drawn as
 *    its own table on its own pages, with the first column repeated so every row is still named.
 *
 * **Steps 2 and 3 are skipped for a table with a LONG column**, one whose widest line is past
 * {@link COLUMN_MAX_EMS} ems — a cell holding a paragraph. That column wraps at any size, because the readable most
 * is in ems of the type, so turning the page and making the type smaller would buy nothing but smaller type. Such a
 * table is wrapped at the largest size, upright first, that keeps every short column whole, and the long columns
 * take the room left. Measured 2026-10-04 on a three-column table of people and summaries: in the order above it was
 * turned and set at 8 pt, then wrapped anyway in half the page's width.
 *
 * So no table is refused for its width. A refusal would tell a person who picked a spreadsheet that their file cannot
 * be made a PDF because of its shape, which is a person refused because of their document.
 *
 * ## The header row comes back on every page
 *
 * The leading header rows are drawn again at the top of each page the table continues onto, and a row is kept whole
 * on one page wherever it fits on one. A header taller than a third of a page is drawn once, because repeating it
 * would leave each page little room for anything else.
 */

/** The smallest type a table is set at before its cells wrap: the size of a printed timetable's small print. */
export const TABLE_FLOOR_SIZE = 8;

/** The step the type is made smaller by while a table does not fit. */
const SIZE_STEP = 0.5;

/** The inset between a cell's edge and its text, either side. */
const CELL_PADDING = 4;

/**
 * The widest a column is drawn when columns share the room, in ems of the table's type: about forty characters of
 * prose, a readable measure, so one long column cannot take the room every other column needs.
 */
export const COLUMN_MAX_EMS = 24;

/**
 * How much wider than its column a cell's line may measure and still be one line: a thousandth of a point.
 *
 * A column planned to its widest word or line is that width plus padding, scaled, and `wrap` measures the same text
 * again by its own sum. The two are the same number computed in two orders, so in floating point they can differ in
 * the last bit, and a word exactly as wide as its column was broken in two (`valu` and `e`, measured in this module's
 * test). No line differing by this much is visibly wider than another.
 */
const WIDTH_RESOLUTION = 0.001;

/** The space after each row, at body size. */
const ROW_GAP = 2;

/** One table row: whether it is a header, and each cell's runs, which carry the source line they came from. */
export interface TableRow {
  readonly header: boolean;
  readonly cells: readonly (readonly Run[])[];
}

/** A column as measured at the cells' own sizes, without padding. */
export interface ColumnMeasure {
  /** The widest line any cell in the column holds as written, between its hard breaks. */
  readonly content: number;
  /** The widest single word any cell in the column holds. */
  readonly word: number;
}

/** A column in a plan: which one, and the width it is drawn at, padding included. */
export interface PlannedColumn {
  readonly column: number;
  readonly width: number;
}

/** How a table is set: on turned pages or not, its type's scale against the cells' own, and its groups of columns. */
export interface TablePlan {
  readonly turned: boolean;
  readonly scale: number;
  /** One group for a table that fits; more, each beginning with the first column, for one split. */
  readonly groups: readonly (readonly PlannedColumn[])[];
}

/** The room a table has across, on the page asked for and on that page turned. */
export interface TableRoom {
  readonly upright: number;
  readonly turned: number;
}

/**
 * Measures every column: its widest line and its widest unbreakable unit, by `composeLayout.ts`' `measureRuns`, which
 * breaks where `wrap` does — so a unit planned whole is one `wrap` keeps whole.
 */
export function measureColumns(rows: readonly TableRow[], columns: number, fonts: ComposeFonts): ColumnMeasure[] {
  const content = new Array<number>(columns).fill(0);
  const word = new Array<number>(columns).fill(0);
  for (const row of rows) {
    row.cells.forEach((cell, column) => {
      const measure = measureRuns(cell, fonts);
      content[column] = Math.max(content[column] ?? 0, measure.content);
      word[column] = Math.max(word[column] ?? 0, measure.word);
    });
  }
  return content.map((widest, column) => ({ content: widest, word: word[column] ?? 0 }));
}

/** A column's three widths at a scale: as written, the least it may take, and the most it wants when sharing. */
function widthsOf(measure: ColumnMeasure, scale: number, narrowestText: number) {
  const padding = 2 * CELL_PADDING;
  const floor = narrowestText * scale + padding;
  const most = COLUMN_MAX_EMS * BODY_SIZE * scale;
  const least = Math.max(floor, Math.min(measure.word * scale + padding, most));
  const written = Math.max(floor, measure.content * scale + padding);
  return { written, least, wanted: Math.max(least, Math.min(written, most)) };
}

type Widths = ReturnType<typeof widthsOf>;

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

/**
 * The widths of a group of columns sharing `room`: each what it wants where all of that fits, with the room left
 * over given to the long columns, which then wrap less; else each its least, and the room left over shared by how
 * much more each wants; and where even the least does not fit, the least scaled down alike, which is where a word
 * breaks inside itself.
 */
function shared(group: readonly number[], widths: readonly Widths[], room: number): PlannedColumn[] {
  const of = (column: number): Widths => widths[column] ?? { written: 0, least: 0, wanted: 0 };
  const wanted = total(group.map((column) => of(column).wanted));
  if (wanted <= room) {
    // THE READABLE MOST IS A SHARE, NOT A MEASURE: it stops one long column taking what the others need, and where
    // nothing else needs the room, the long columns take it, up to their widest lines, by how much more each holds.
    const beyond = total(group.map((column) => of(column).written - of(column).wanted));
    const given = beyond <= 0 ? 0 : Math.min(1, (room - wanted) / beyond);
    return group.map((column) => {
      const width = of(column);
      return { column, width: width.wanted + (width.written - width.wanted) * given };
    });
  }
  const least = total(group.map((column) => of(column).least));
  if (least >= room) return group.map((column) => ({ column, width: (of(column).least * room) / least }));
  const spare = room - least;
  const asked = wanted - least;
  return group.map((column) => ({
    column,
    width: of(column).least + (spare * (of(column).wanted - of(column).least)) / asked,
  }));
}

/**
 * How a table is set, from its columns' measures and the room it has: the first of the five steps in this module's
 * header that holds it.
 *
 * @param narrowestText the width of `000` at body size: a cell narrower than three digits holds almost nothing
 */
export function planTable(measures: readonly ColumnMeasure[], room: TableRoom, narrowestText: number): TablePlan {
  const all = measures.map((_, column) => column);
  const at = (scale: number): Widths[] => measures.map((measure) => widthsOf(measure, scale, narrowestText));
  const asWritten = (widths: readonly Widths[]): PlannedColumn[] =>
    widths.map((width, column) => ({ column, width: width.written }));

  const upright = at(1);
  if (total(upright.map((width) => width.written)) <= room.upright) {
    return { turned: false, scale: 1, groups: [asWritten(upright)] };
  }
  const turned = room.turned > room.upright;
  const across = turned ? room.turned : room.upright;
  const sizes: number[] = [];
  for (let size = BODY_SIZE; size >= TABLE_FLOOR_SIZE; size -= SIZE_STEP) sizes.push(size / BODY_SIZE);

  // A LONG COLUMN, one whose widest line is past the readable most, wraps at any size, because that most is in ems
  // of the type. Turning the page and making the type smaller exist to stop a cell wrapping, so for a table with one
  // they buy nothing: they are skipped, and the short columns are kept whole at the largest size that holds them.
  const long = upright.some((width) => width.written > width.wanted);
  if (!long) {
    for (const scale of sizes) {
      const widths = at(scale);
      if (total(widths.map((width) => width.written)) <= across) return { turned, scale, groups: [asWritten(widths)] };
    }
  }
  const candidates = [
    { turned: false, room: room.upright, scale: 1 },
    ...sizes.map((scale) => ({ turned, room: across, scale })),
  ];
  for (const candidate of candidates) {
    const widths = at(candidate.scale);
    if (total(widths.map((width) => width.wanted)) <= candidate.room) {
      return { turned: candidate.turned, scale: candidate.scale, groups: [shared(all, widths, candidate.room)] };
    }
  }

  const scale = TABLE_FLOOR_SIZE / BODY_SIZE;
  const widths = at(scale);
  if (total(widths.map((width) => width.least)) <= across) {
    return { turned, scale, groups: [shared(all, widths, across)] };
  }
  // GROUPS, each the first column and as many after it as fit at their least. A group always takes a second column
  // even where the two do not fit, so the split always ends; `shared` then narrows both alike.
  const groups: number[][] = [];
  let group = [0];
  for (let column = 1; column < measures.length; column += 1) {
    const grown = [...group, column];
    if (group.length === 1 || total(grown.map((index) => widths[index]?.least ?? 0)) <= across) {
      group = grown;
    } else {
      groups.push(group);
      group = [0, column];
    }
  }
  groups.push(group);
  return { turned, scale, groups: groups.map((columns) => shared(columns, widths, across)) };
}

/** The runs at `scale` of their own sizes. */
function scaled(runs: readonly Run[], scale: number): Run[] {
  return runs.map((run) => (scale === 1 ? run : { ...run, size: run.size * scale }));
}

/**
 * Sets a table at an indent, by {@link planTable}'s plan, and returns the pages after it to the size asked for.
 *
 * Nothing is drawn for a table with no columns. The composer decides which runs are bold; this sets them.
 */
export function drawTable(rows: readonly TableRow[], writer: PageWriter, indent: number): void {
  const columns = rows.reduce((most, row) => Math.max(most, row.cells.length), 0);
  if (columns === 0) return;
  const turned = writer.turned;
  const room = {
    upright: writer.base.width - 2 * MARGIN - indent,
    turned: turned.width - 2 * MARGIN - indent,
  };
  const { fonts } = writer;
  const plan = planTable(measureColumns(rows, columns, fonts), room, fonts.width('000', 'regular', BODY_SIZE));
  if (plan.turned) writer.useSize(turned);
  plan.groups.forEach((group, at) => {
    // EACH GROUP ON ITS OWN PAGES, so the pages of one group can be laid beside the pages of the next.
    if (at > 0) writer.breakPage();
    drawGroup(rows, group, plan.scale, writer, indent);
  });
  writer.useSize(writer.base);
}

/** One group of columns, every row, with the header repeated on each page it continues onto. */
function drawGroup(
  rows: readonly TableRow[],
  group: readonly PlannedColumn[],
  scale: number,
  writer: PageWriter,
  indent: number,
): void {
  const leading = BODY_LEADING * scale;
  const gap = ROW_GAP * scale;
  const offsets: number[] = [];
  group.reduce((start, column) => {
    offsets.push(start + CELL_PADDING);
    return start + column.width;
  }, 0);

  /** A row's physical lines, every cell's line at one height drawn across together so the cells share baselines. */
  const linesOf = (row: TableRow): PlacedLine[][] => {
    const cells = group.map(({ column, width }) =>
      wrap(scaled(row.cells[column] ?? [], scale), width - 2 * CELL_PADDING + WIDTH_RESOLUTION, leading, writer.fonts),
    );
    const height = cells.reduce((most, lines) => Math.max(most, lines.length), 1);
    return Array.from({ length: height }, (_, line) =>
      cells.map((lines, at) => ({
        offset: offsets[at] ?? 0,
        width: (group[at]?.width ?? 0) - 2 * CELL_PADDING,
        line: lines[line] ?? null,
      })),
    );
  };
  const heightOf = (lines: readonly unknown[]): number => lines.length * leading + gap;

  const leadingHeaders = rows.findIndex((row) => !row.header);
  const headerRows = (leadingHeaders === -1 ? rows : rows.slice(0, leadingHeaders)).map(linesOf);
  const headerHeight = total(headerRows.map(heightOf));
  const repeats = headerRows.length > 0 && headerHeight <= writer.textHeight / 3;

  const drawRow = (lines: readonly PlacedLine[][]): void => {
    for (const line of lines) writer.row(line, leading, indent);
    writer.gap(gap);
  };
  const header = (): void => {
    for (const lines of headerRows) drawRow(lines);
  };
  const freshPage = (): void => {
    writer.breakPage();
    if (repeats) header();
  };

  const body = rows.slice(headerRows.length);
  const first = body[0] === undefined ? [] : linesOf(body[0]);
  // THE HEADER WITH THE FIRST ROW, so a page never ends on a header with nothing under it.
  if (!writer.fits(headerHeight + heightOf(first))) writer.breakPage();
  header();
  body.forEach((row, at) => {
    const lines = at === 0 ? first : linesOf(row);
    const height = heightOf(lines);
    // WHOLE ON ONE PAGE wherever it fits on one; a row taller than a page is split between its lines instead.
    if (!writer.fits(height) && height <= writer.textHeight - (repeats ? headerHeight : 0)) freshPage();
    for (const line of lines) {
      if (!writer.fits(leading)) freshPage();
      writer.row(line, leading, indent);
    }
    writer.gap(gap);
  });
}
