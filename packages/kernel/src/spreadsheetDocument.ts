import { type OoxmlPart, XML_DECLARATION, xmlText } from './ooxmlPackage.js';
import type { CellBorders, PageTable, TableCell } from './textStructure.js';
import { baseFontName } from './wordDocument.js';

/**
 * A PDF's tables as an Excel workbook — D10's *Excel*, written by this build
 * ([ADR-0072](../../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)).
 *
 * ## The tables are the engine's
 *
 * Every table, row and cell is one MuPDF's table read found
 * ([ADR-0073](../../../docs/DECISIONS/0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md)).
 * This module decides where a found table goes on a sheet and how a cell is
 * written, and nothing about what a table is.
 *
 * ## Sheets first, the parts that list them last
 *
 * A workbook's styles, its sheet list and its content types all name things known
 * only once every page has been read — the fonts used, how many sheets there are.
 * A package's parts may be in any order, so the sheets stream first, a page at a
 * time, and the parts that describe them follow. What is resident is one page's
 * tables and the set of distinct cell styles.
 *
 * ## What a cell carries
 *
 * - **Its font** — the name, size, bold and italic MuPDF reported for the cell's
 *   first line.
 * - **Its borders** — thin lines on the edges the engine's grid flags as ruled,
 *   where the table's shape lets a cell be placed on the grid (see
 *   {@link PageTable.borders}).
 * - **A number where the text is unmistakably one**, with a format that shows it
 *   as it was printed: `1,234.50` is 1234.5 shown `#,##0.00`, and `12.5%` is 0.125
 *   shown `0.0%`. Anything else stays text, including a comma as the decimal mark,
 *   which a page alone cannot tell from a thousands separator.
 * - **Wrapping** where the cell's text runs to more than one line, each on its own.
 * - **A person's text where they corrected it** in the review grid, in the cell's
 *   own style, and a number again if what they typed is one.
 *
 * **No fills and no merges.** The engine's JSON carries neither a cell's
 * background nor which grid columns a spanning cell covers, and the row says so.
 */

/**
 * A person's correction to one cell, made in the review grid — D10's *editable
 * review grid*. Addressed by the page's table, row and cell in the engine's order,
 * which is how the grid showed them. The cell keeps its style; the text is theirs.
 */
export interface TableEdit {
  readonly table: number;
  readonly row: number;
  readonly column: number;
  readonly text: string;
}

/** One page's tables, in the engine's order, and the edits made to them. */
export interface SpreadsheetPage {
  /** The page's index, from 0. */
  readonly page: number;
  readonly tables: readonly PageTable[];
  /** REQUIRED, and empty where nobody reviewed the page, for ADR-0069's reason. */
  readonly edits: readonly TableEdit[];
}

/**
 * A cell's text: its lines, one per line. **The one spelling**, taken by the review
 * grid and the writer alike, so what a person corrected is what would otherwise
 * have been written (B3a).
 */
export function cellText(cell: TableCell): string {
  return cell.lines.map((line) => line.text).join('\n');
}

/** One cell as the review grid shows it. */
export interface ReviewCell {
  readonly text: string;
  /** Longer than the grid carries, so shown cut short and not editable. */
  readonly clipped: boolean;
}

/** One page's tables as the review grid shows them, within a bound. */
export interface ReviewGrid {
  readonly tables: readonly { readonly rows: readonly (readonly ReviewCell[])[] }[];
  /** Whether cells were left out past the bound. */
  readonly truncated: boolean;
}

/**
 * A page's tables for review: every cell's text, at most `maxCells` cells in the
 * engine's order and `maxText` characters a cell.
 *
 * A cell past the character bound is CLIPPED and marked, rather than cut silently —
 * an edit to text a person never saw whole would replace what they did not read,
 * so {@link editsFit} refuses one.
 */
export function reviewGridOf(tables: readonly PageTable[], maxCells: number, maxText: number): ReviewGrid {
  let cells = 0;
  let truncated = false;
  const shown: { rows: ReviewCell[][] }[] = [];
  for (const table of tables) {
    if (cells >= maxCells) {
      truncated = true;
      break;
    }
    const rows: ReviewCell[][] = [];
    for (const row of table.rows) {
      if (cells >= maxCells) {
        truncated = true;
        break;
      }
      const room = maxCells - cells;
      if (row.length > room) truncated = true;
      rows.push(
        row.slice(0, room).map((cell) => {
          const text = cellText(cell);
          return { text: text.slice(0, maxText), clipped: text.length > maxText };
        }),
      );
      cells += Math.min(row.length, room);
    }
    shown.push({ rows });
  }
  return { tables: shown, truncated };
}

/**
 * Whether every edit names a cell the page has, whose text the grid could have
 * shown whole. An edit that does not is not a correction of these tables, and the
 * export refuses rather than writing a guess.
 */
export function editsFit(tables: readonly PageTable[], edits: readonly TableEdit[], maxText: number): boolean {
  return edits.every((edit) => {
    const cell = tables[edit.table]?.rows[edit.row]?.[edit.column];
    return cell !== undefined && cellText(cell).length <= maxText;
  });
}

/**
 * Where the tables go: a sheet for each page that has any, or every table on one
 * sheet — D10's *combine-pages option*.
 */
export type SheetLayout = 'sheet-per-page' | 'one-sheet';

export const SHEET_LAYOUTS: readonly SheetLayout[] = ['sheet-per-page', 'one-sheet'];

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * How many distinct cell styles a workbook may declare before further cells take
 * the plain one: 4,000, against Excel's own limit of 64,000 cell formats. A page's
 * fonts are the document's to choose, so their number is not this build's to
 * trust.
 */
export const MAX_CELL_STYLES = 4_000;

/**
 * Excel's row limit, 1,048,576. A sheet that would pass it is refused rather than
 * written, since Excel refuses the whole file over one row past it.
 */
export const MAX_SHEET_ROWS = 1_048_576;

/** The number formats a cell can take, by the shape of its text. */
const NUMBER = /^-?(?:0|[1-9]\d{0,14})(?:\.(\d{1,10}))?$/u;
const GROUPED = /^-?[1-9]\d{0,2}(?:,\d{3}){1,4}(?:\.(\d{1,10}))?$/u;
const PERCENT = /^-?(?:0|[1-9]\d{0,14})(?:\.(\d{1,10}))?%$/u;

/** A cell's value as the sheet stores it. */
export type CellValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'number'; readonly value: number; readonly format: string };

/**
 * A cell's value: a number where its whole text is one of the three printed shapes
 * above, and text otherwise.
 */
export function cellValue(text: string): CellValue {
  const trimmed = text.trim();
  const decimals = (digits: string | undefined): string =>
    digits === undefined ? '' : `.${'0'.repeat(digits.length)}`;
  const plain = NUMBER.exec(trimmed);
  if (plain !== null) {
    return { kind: 'number', value: Number(trimmed), format: `0${decimals(plain[1])}` };
  }
  const grouped = GROUPED.exec(trimmed);
  if (grouped !== null) {
    return { kind: 'number', value: Number(trimmed.replaceAll(',', '')), format: `#,##0${decimals(grouped[1])}` };
  }
  const percent = PERCENT.exec(trimmed);
  if (percent !== null) {
    const digits = percent[1];
    // THE STORED VALUE is the fraction, with the printed digits' precision
    // carried by rounding rather than by floating-point division's remainder.
    const places = (digits?.length ?? 0) + 2;
    const value = Number((Number(trimmed.slice(0, -1)) / 100).toFixed(places));
    return { kind: 'number', value, format: `0${decimals(digits)}%` };
  }
  return { kind: 'text', text };
}

/** A column's letters: 0 is `A`, 25 is `Z`, 26 is `AA`. */
export function columnName(index: number): string {
  let name = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

interface CellStyle {
  readonly font: string;
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly borders: CellBorders | null;
  readonly format: string | null;
  readonly wrap: boolean;
}

/** The workbook's distinct cell styles, numbered as `cellXfs` lists them. */
class StyleTable {
  readonly #keys = new Map<string, number>();
  readonly #styles: CellStyle[] = [];

  /** The style's index; 0, the plain style, once {@link MAX_CELL_STYLES} are declared. */
  indexOf(style: CellStyle): number {
    const key = JSON.stringify(style);
    const known = this.#keys.get(key);
    if (known !== undefined) return known;
    if (this.#styles.length >= MAX_CELL_STYLES) return 0;
    this.#styles.push(style);
    const index = this.#styles.length;
    this.#keys.set(key, index);
    return index;
  }

  xml(): string {
    const fonts: string[] = ['<font><sz val="11"/><name val="Calibri"/></font>'];
    const fontIndex = new Map<string, number>();
    const borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    const borderIndex = new Map<string, number>();
    const formats: string[] = [];
    const formatIndex = new Map<string, number>();
    const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];

    for (const style of this.#styles) {
      const fontKey = `${style.font}|${String(style.size)}|${String(style.bold)}|${String(style.italic)}`;
      let fontId = fontIndex.get(fontKey);
      if (fontId === undefined) {
        fontId = fonts.length;
        fontIndex.set(fontKey, fontId);
        fonts.push(
          `<font>${style.bold ? '<b/>' : ''}${style.italic ? '<i/>' : ''}` +
            `<sz val="${String(style.size)}"/><name val="${xmlText(style.font)}"/></font>`,
        );
      }

      let borderId = 0;
      if (style.borders !== null) {
        const edges = style.borders;
        const borderKey = `${String(edges.left)}${String(edges.right)}${String(edges.top)}${String(edges.bottom)}`;
        const known = borderIndex.get(borderKey);
        if (known === undefined) {
          borderId = borders.length;
          borderIndex.set(borderKey, borderId);
          const edge = (name: string, on: boolean): string =>
            on ? `<${name} style="thin"><color auto="1"/></${name}>` : `<${name}/>`;
          borders.push(
            `<border>${edge('left', edges.left)}${edge('right', edges.right)}${edge('top', edges.top)}${edge('bottom', edges.bottom)}<diagonal/></border>`,
          );
        } else {
          borderId = known;
        }
      }

      let numFmtId = 0;
      if (style.format !== null) {
        const known = formatIndex.get(style.format);
        // CUSTOM FORMATS are numbered from 164: Excel reserves 0-163 for its own.
        numFmtId = known ?? 164 + formats.length;
        if (known === undefined) {
          formatIndex.set(style.format, numFmtId);
          formats.push(`<numFmt numFmtId="${String(numFmtId)}" formatCode="${xmlText(style.format)}"/>`);
        }
      }

      xfs.push(
        `<xf numFmtId="${String(numFmtId)}" fontId="${String(fontId)}" fillId="0" borderId="${String(borderId)}" xfId="0"` +
          `${numFmtId === 0 ? '' : ' applyNumberFormat="1"'} applyFont="1"${borderId === 0 ? '' : ' applyBorder="1"'}` +
          (style.wrap ? ' applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' : '/>'),
      );
    }

    return (
      `${XML_DECLARATION}<styleSheet xmlns="${MAIN}">` +
      (formats.length > 0 ? `<numFmts count="${String(formats.length)}">${formats.join('')}</numFmts>` : '') +
      `<fonts count="${String(fonts.length)}">${fonts.join('')}</fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      `<borders count="${String(borders.length)}">${borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${String(xfs.length)}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    );
  }
}

/**
 * One cell's XML at `reference`, its style taken from `styles`.
 *
 * @param edited the person's text for this cell, which replaces the engine's and
 *   keeps the cell's font
 */
function cellXml(
  reference: string,
  cell: TableCell,
  edited: string | undefined,
  borders: CellBorders | null,
  styles: StyleTable,
): string {
  const [first] = cell.lines;
  const text = edited ?? cellText(cell);
  const value = cellValue(text);
  const style = styles.indexOf({
    font: first === undefined ? 'Calibri' : baseFontName(first.font.name),
    // A SIZE Excel shows: whole and half points, at least 1.
    size: first === undefined ? 11 : Math.max(1, Math.round(first.size * 2) / 2),
    bold: first?.font.bold ?? false,
    italic: first?.font.italic ?? false,
    borders,
    format: value.kind === 'number' ? value.format : null,
    wrap: text.includes('\n'),
  });
  const styled = style === 0 ? '' : ` s="${String(style)}"`;
  if (value.kind === 'number') return `<c r="${reference}"${styled}><v>${String(value.value)}</v></c>`;
  if (text.length === 0) return style === 0 ? '' : `<c r="${reference}"${styled}/>`;
  return `<c r="${reference}"${styled} t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

/**
 * Writes tables down a sheet from `startRow` (1-based), a blank row between two
 * tables, and answers the XML and the next free row.
 */
function tablesXml(
  page: SpreadsheetPage,
  startRow: number,
  styles: StyleTable,
): { readonly xml: string; readonly nextRow: number } {
  const edits = new Map(page.edits.map((edit) => [`${String(edit.table)}:${String(edit.row)}:${String(edit.column)}`, edit.text]));
  let row = startRow;
  let xml = '';
  for (const [t, table] of page.tables.entries()) {
    for (const [y, cells] of table.rows.entries()) {
      if (row > MAX_SHEET_ROWS) {
        throw new Error(`a sheet would pass Excel's ${String(MAX_SHEET_ROWS)} rows, so no workbook was written`);
      }
      const written = cells
        .map((cell, x) =>
          cellXml(
            `${columnName(x)}${String(row)}`,
            cell,
            edits.get(`${String(t)}:${String(y)}:${String(x)}`),
            table.borders?.[y]?.[x] ?? null,
            styles,
          ),
        )
        .join('');
      xml += `<row r="${String(row)}">${written}</row>`;
      row += 1;
    }
    row += 1;
  }
  return { xml, nextRow: row };
}

const SHEET_OPEN = `${XML_DECLARATION}<worksheet xmlns="${MAIN}" xmlns:r="${R}"><sheetData>`;
const SHEET_CLOSE = '</sheetData></worksheet>';

function relationships(entries: readonly (readonly [string, string, string])[]): string {
  const body = entries
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join('');
  return `${XML_DECLARATION}<Relationships xmlns="${RELS_NS}">${body}</Relationships>`;
}

function contentTypes(sheets: number): string {
  let overrides =
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  for (let index = 1; index <= sheets; index += 1) {
    overrides += `<Override PartName="/xl/worksheets/sheet${String(index)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }
  return (
    `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `${overrides}</Types>`
  );
}

function workbook(names: readonly string[]): string {
  const sheets = names
    .map((name, index) => `<sheet name="${xmlText(name)}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"/>`)
    .join('');
  return `${XML_DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets>${sheets}</sheets></workbook>`;
}

/**
 * The package's parts: sheets as pages arrive, then the parts that list them.
 *
 * A sheet is named by the printed page number it holds — `3`, or `1-12` for one
 * sheet — so the file carries no words in any language.
 *
 * @throws if no page holds a table, since a workbook needs a sheet and one with
 *   nothing on it is not an export of anything; the caller asks first
 */
export async function* spreadsheetParts(
  pages: AsyncIterable<SpreadsheetPage>,
  layout: SheetLayout,
): AsyncIterable<OoxmlPart> {
  const styles = new StyleTable();
  const names: string[] = [];

  if (layout === 'one-sheet') {
    let first: number | undefined;
    let last = 0;
    async function* rows(): AsyncIterable<string> {
      yield SHEET_OPEN;
      let row = 1;
      for await (const page of pages) {
        if (page.tables.length === 0) continue;
        first ??= page.page;
        last = page.page;
        const written = tablesXml(page, row, styles);
        row = written.nextRow;
        yield written.xml;
      }
      yield SHEET_CLOSE;
    }
    yield { name: 'xl/worksheets/sheet1.xml', chunks: rows() };
    if (first === undefined) throw new Error('no page holds a table, so there is no sheet to write');
    names.push(first === last ? String(first + 1) : `${String(first + 1)}-${String(last + 1)}`);
  } else {
    for await (const page of pages) {
      if (page.tables.length === 0) continue;
      names.push(String(page.page + 1));
      const { xml } = tablesXml(page, 1, styles);
      yield { name: `xl/worksheets/sheet${String(names.length)}.xml`, chunks: [SHEET_OPEN, xml, SHEET_CLOSE] };
    }
    if (names.length === 0) throw new Error('no page holds a table, so there is no sheet to write');
  }

  yield { name: 'xl/styles.xml', chunks: [styles.xml()] };
  yield { name: 'xl/workbook.xml', chunks: [workbook(names)] };
  const sheetRels: [string, string, string][] = names.map((_name, index) => [
    `rId${String(index + 1)}`,
    'worksheet',
    `worksheets/sheet${String(index + 1)}.xml`,
  ]);
  sheetRels.push([`rId${String(names.length + 1)}`, 'styles', 'styles.xml']);
  yield { name: 'xl/_rels/workbook.xml.rels', chunks: [relationships(sheetRels)] };
  yield { name: '_rels/.rels', chunks: [relationships([['rId1', 'officeDocument', 'xl/workbook.xml']])] };
  yield { name: '[Content_Types].xml', chunks: [contentTypes(names.length)] };
}
