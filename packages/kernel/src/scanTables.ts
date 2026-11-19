import { type CharacterBox, type DrawnShape, acrossGrids, rulesAcross } from './acrossRulings.js';
import { isPaper } from './cellFills.js';
import type { MupdfSession } from './engineSeam.js';
import type { ScanTable, ScanTableLine } from './scanTableShape.js';
import { STEXT_OPTIONS } from './textStructure.js';
import {
  ENGINE_PAGE_FILLS_MAX,
  ENGINE_SCAN_TABLE_CELLS_MAX,
  ENGINE_SCAN_TABLE_TEXT_MAX,
  ENGINE_SCAN_TABLES_MAX,
} from './host/engineChannels.js';
import { withDocument } from './mupdfWriter.js';
import { pageInDocument } from './pageScope.js';
import { greyRasterOfPage } from './pageSkew.js';
import { gridsOf, rulingsOf } from './rasterRulings.js';

/**
 * The tables this build reads from a page's RULINGS, each cell holding the words the page's text has inside it: a scan's
 * ruled grids read from its pixels ([ADR-0233](../../../docs/DECISIONS/0233-a-scanned-tables-rulings-are-read-from-its-pixels.md)),
 * and a table the drawing rules only across, read from its own rules
 * ([ADR-0297](../../../docs/DECISIONS/0297-a-table-ruled-only-across-is-read-from-its-drawn-rules.md)).
 *
 * The words come from MuPDF's structured text character by character, each to the cell its centre is in: a recognised
 * layer is written word by word and MuPDF joins a row's words into one line across the cells' rulings, so a line is not a
 * cell's unit and a character is. Behind `/engine` for `readPageFills`' reason: drawing a page parses it, which is the
 * engine host's work (invariant 20), and the raster never leaves this function (§9.17).
 */

/** Which of `edges` (ascending) a position falls between, or -1 outside them all. */
function between(edges: readonly number[], at: number): number {
  for (let index = 0; index + 1 < edges.length; index += 1) {
    if (at >= (edges[index] ?? 0) && at < (edges[index + 1] ?? 0)) return index;
  }
  return -1;
}

/** One grid in display space: its row and column edges, and which sides of each cell are ruled. */
interface PlacedGrid {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  readonly borders: readonly (readonly { top: boolean; left: boolean; bottom: boolean; right: boolean }[])[];
}

/** One character of the page's structured text, with the line it is on. */
interface PageCharacter {
  readonly text: string;
  readonly box: CharacterBox;
  readonly line: number;
  readonly size: number;
  readonly font: ScanTableLine['font'];
}

/** Whether two grids cover any of the same page. */
function overlaps(a: PlacedGrid, b: PlacedGrid): boolean {
  const [ax0, ax1, ay0, ay1] = [a.columns[0] ?? 0, a.columns.at(-1) ?? 0, a.rows[0] ?? 0, a.rows.at(-1) ?? 0];
  const [bx0, bx1, by0, by1] = [b.columns[0] ?? 0, b.columns.at(-1) ?? 0, b.rows[0] ?? 0, b.rows.at(-1) ?? 0];
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}

/** The ruled tables of `page`, at most the channel's bounds of tables and cells; none where the page has no ruled grid. */
export function readScanTables(session: MupdfSession, page: number): Promise<readonly ScanTable[]> {
  return withDocument(session, (document) => {
    pageInDocument(page, document.countPages());
    const loaded = document.loadPage(page);
    const [bx0, by0, bx1] = loaded.getBounds();

    // ONE WALK OF THE PAGE'S STRUCTURED TEXT gives all three: every character, every painted shape (`vectors`, a vector
    // block's box, whether it is stroked and its colour), and whether the page holds a picture (`preserve-images`). No
    // drawing device is run: a callback device crashed the native binding on a damaged corpus document where this walk
    // reads it whole (measured 2026-11-19, `_review/crashProbe.mjs`, any device callback against the walk). At most
    // ENGINE_PAGE_FILLS_MAX shapes, the fills read's own bound, so a page of hatching costs a bounded list.
    const shapes: DrawnShape[] = [];
    let pictures = 0;
    const characters: PageCharacter[] = [];
    let lineNumber = 0;
    const structured = loaded.toStructuredText(
      ['preserve-whitespace', STEXT_OPTIONS.vectors, STEXT_OPTIONS.preserveImages].join(','),
    );
    try {
      structured.walk({
        onImageBlock: () => {
          pictures += 1;
        },
        onVector: (bbox, flags: { readonly isStroked: boolean }, colour) => {
          if (shapes.length >= ENGINE_PAGE_FILLS_MAX) return;
          const [x0, y0, x1, y1] = bbox;
          if (![x0, y0, x1, y1].every(Number.isFinite)) return;
          shapes.push({ box: { x0, y0, x1, y1 }, kind: flags.isStroked ? 'stroke' : 'fill', paper: isPaper(Array.from(colour)) });
        },
        beginLine: () => {
          lineNumber += 1;
        },
        onChar: (character, _origin, font, size, quad) => {
          const xs = [quad[0], quad[2], quad[4], quad[6]];
          const ys = [quad[1], quad[3], quad[5], quad[7]];
          characters.push({
            text: character,
            box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
            line: lineNumber,
            size,
            font: {
              name: font.getName(),
              family: font.isMono() ? 'monospace' : font.isSerif() ? 'serif' : 'sans-serif',
              bold: font.isBold(),
              italic: font.isItalic(),
            },
          });
        },
      });
    } finally {
      structured.destroy();
    }

    // A SCAN'S GRIDS from its pixels, only where the page draws a picture (ADR-0233), placed in display space.
    const grids: PlacedGrid[] = [];
    if (pictures > 0) {
      const raster = greyRasterOfPage(loaded);
      // THE RESOLUTION THE RASTER WAS MADE AT, read from it: `greyRasterOfPage` lowers it for a page past the pixel bound.
      const scale = raster.width / Math.max(1, bx1 - bx0);
      for (const grid of gridsOf(rulingsOf(raster, scale * 72), scale * 72)) {
        grids.push({ rows: grid.rows.map((at) => at / scale + by0), columns: grid.columns.map((at) => at / scale + bx0), borders: grid.borders });
      }
    }
    // A TABLE RULED ONLY ACROSS from the drawing's own rules (ADR-0297), where no pixel grid already covers it.
    for (const grid of acrossGrids(rulesAcross(shapes), characters.map((each) => each.box))) {
      if (!grids.some((other) => overlaps(other, grid))) grids.push(grid);
    }
    grids.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));

    let cellsLeft = ENGINE_SCAN_TABLE_CELLS_MAX;
    const kept = grids.slice(0, ENGINE_SCAN_TABLES_MAX).filter((each) => {
      const cells = (each.rows.length - 1) * (each.columns.length - 1);
      if (cells > cellsLeft) return false;
      cellsLeft -= cells;
      return true;
    });
    if (kept.length === 0) return [];

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
    const lastLineOf = new Map<OpenLine[], number>();
    for (const character of characters) {
      const { box } = character;
      const cx = (box.x0 + box.x1) / 2;
      const cy = (box.y0 + box.y1) / 2;
      kept.forEach((each, table) => {
        const row = between(each.rows, cy);
        const column = between(each.columns, cx);
        if (row < 0 || column < 0) return;
        const lines = cells[table]?.[row]?.[column];
        if (lines === undefined) return;
        let line = lines.at(-1);
        if (line === undefined || lastLineOf.get(lines) !== character.line) {
          line = { text: '', ...box, size: character.size, font: character.font };
          lines.push(line);
          lastLineOf.set(lines, character.line);
        }
        if (line.text.length < ENGINE_SCAN_TABLE_TEXT_MAX) line.text += character.text;
        line.x0 = Math.min(line.x0, box.x0);
        line.y0 = Math.min(line.y0, box.y0);
        line.x1 = Math.max(line.x1, box.x1);
        line.y1 = Math.max(line.y1, box.y1);
      });
    }
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
      borders: each.borders.map((row) => row.map((cell) => ({ ...cell }))),
    }));
  });
}
