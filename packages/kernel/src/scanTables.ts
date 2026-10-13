import type { MupdfSession } from './engineSeam.js';
import type { ScanTable, ScanTableLine } from './scanTableShape.js';
import { ENGINE_SCAN_TABLE_CELLS_MAX, ENGINE_SCAN_TABLE_TEXT_MAX, ENGINE_SCAN_TABLES_MAX } from './host/engineChannels.js';
import { withDocument } from './mupdfWriter.js';
import { pageInDocument } from './pageScope.js';
import { greyRasterOfPage } from './pageSkew.js';
import { gridsOf, rulingsOf } from './rasterRulings.js';

/**
 * The ruled tables of a scanned page, each cell holding the words the page's text layer has inside it
 * ([ADR-0233](../../../docs/DECISIONS/0233-a-scanned-tables-rulings-are-read-from-its-pixels.md)).
 *
 * The rulings are read from the page's pixels (`rasterRulings.ts`), and the words from MuPDF's structured text character
 * by character, each to the cell its centre is in: a recognised layer is written word by word and MuPDF joins a row's
 * words into one line across the cells' rulings, so a line is not a cell's unit and a character is. Behind `/engine` for
 * `readPageFills`' reason: rasterising a page parses it, which is the engine host's work (invariant 20), and the raster
 * never leaves this function (§9.17).
 */

/** Which of `edges` (ascending) a position falls between, or -1 outside them all. */
function between(edges: readonly number[], at: number): number {
  for (let index = 0; index + 1 < edges.length; index += 1) {
    if (at >= (edges[index] ?? 0) && at < (edges[index + 1] ?? 0)) return index;
  }
  return -1;
}

/** The ruled tables of `page`, at most the channel's bounds of tables and cells; none where the page has no ruled grid. */
export function readScanTables(session: MupdfSession, page: number): Promise<readonly ScanTable[]> {
  return withDocument(session, (document) => {
    pageInDocument(page, document.countPages());
    const loaded = document.loadPage(page);
    const [bx0, by0, bx1] = loaded.getBounds();
    const raster = greyRasterOfPage(loaded);
    // THE RESOLUTION THE RASTER WAS MADE AT, read from it: `greyRasterOfPage` lowers it for a page past the pixel bound.
    const scale = raster.width / Math.max(1, bx1 - bx0);
    const grids = gridsOf(rulingsOf(raster, scale * 72), scale * 72).slice(0, ENGINE_SCAN_TABLES_MAX);
    if (grids.length === 0) return [];
    // EACH GRID IN DISPLAY SPACE, the structured text's.
    const placed = grids.map((grid) => ({
      grid,
      rows: grid.rows.map((at) => at / scale + by0),
      columns: grid.columns.map((at) => at / scale + bx0),
    }));
    let cellsLeft = ENGINE_SCAN_TABLE_CELLS_MAX;
    const kept = placed.filter((each) => {
      const cells = (each.rows.length - 1) * (each.columns.length - 1);
      if (cells > cellsLeft) return false;
      cellsLeft -= cells;
      return true;
    });
    interface OpenLine {
      text: string;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      size: number;
      font: ScanTableLine['font'];
    }
    // EVERY CELL'S LINES, keyed by table, row and column; a cell's line is the run of its characters on one stext line.
    const cells = kept.map((each) => each.rows.slice(0, -1).map(() => each.columns.slice(0, -1).map((): OpenLine[] => [])));
    let lineNumber = 0;
    const lastLineOf = new Map<OpenLine[], number>();
    const structured = loaded.toStructuredText('preserve-whitespace');
    structured.walk({
      beginLine: () => {
        lineNumber += 1;
      },
      onChar: (character, _origin, font, size, quad) => {
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        kept.forEach((each, table) => {
          const row = between(each.rows, cy);
          const column = between(each.columns, cx);
          if (row < 0 || column < 0) return;
          const lines = cells[table]?.[row]?.[column];
          if (lines === undefined) return;
          let line = lines.at(-1);
          if (line === undefined || lastLineOf.get(lines) !== lineNumber) {
            line = {
              text: '',
              x0: Math.min(...xs),
              y0: Math.min(...ys),
              x1: Math.max(...xs),
              y1: Math.max(...ys),
              size,
              font: {
                name: font.getName(),
                family: font.isMono() ? 'monospace' : font.isSerif() ? 'serif' : 'sans-serif',
                bold: font.isBold(),
                italic: font.isItalic(),
              },
            };
            lines.push(line);
            lastLineOf.set(lines, lineNumber);
          }
          if (line.text.length < ENGINE_SCAN_TABLE_TEXT_MAX) line.text += character;
          line.x0 = Math.min(line.x0, ...xs);
          line.y0 = Math.min(line.y0, ...ys);
          line.x1 = Math.max(line.x1, ...xs);
          line.y1 = Math.max(line.y1, ...ys);
        });
      },
    });
    structured.destroy();
    return kept.map((each, table) => ({
      columns: each.columns.length - 1,
      rows: (cells[table] ?? []).map((row) =>
        row.map((lines) =>
          lines
            .map((line) => ({ ...line, text: line.text.trim() }))
            .filter((line) => line.text !== '')
            .map((line) => ({ text: line.text, box: { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 }, size: line.size, font: line.font })),
        ),
      ),
      borders: each.grid.borders.map((row) => row.map((cell) => ({ ...cell }))),
    }));
  });
}
