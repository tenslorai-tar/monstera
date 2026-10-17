import { ClaudeRecognitionRefused, type RecognisedPage } from '@monstera/kernel';
import { type Box, pageTransform } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type TileRaster, readTablesInBands, recogniseInTiles } from './claudeTiledRead.js';

/** Haiku's tier (`CLAUDE_STANDARD_RESOLUTION`), written here so a change to the table is a change to this case too. */
const LIMITS = { edge: 1568, visualTokens: 1568 };
const accepts = (): { readonly ok: true } => ({ ok: true });

/** Which rect each fake raster was a snapshot of, keyed by its own bytes, which every snapshot makes afresh. */
const askedFor = new WeakMap<Uint8Array, Box>();

/** A raster standing for a snapshot of `rect`: the frame fields the readers take. */
const rasterOf = (rect: Box): TileRaster => {
  const png = new Uint8Array([1]);
  askedFor.set(png, rect);
  return { png, crop: [0, 0, 0, 0], rotation: 0, origin: [0, 0] };
};

/** The rect a raster the reader was handed was taken of. */
const rectOf = (raster: TileRaster): Box => {
  const rect = askedFor.get(raster.png);
  if (rect === undefined) throw new Error('a raster no snapshot made');
  return rect;
};

describe('a region too large for Claude is read in tiles (ADR-0255)', () => {
  // A 2000 × 1500 pt page, upright: more than one Haiku tile at scale 2 both ways.
  const page = { box: { x0: 0, y0: 0, x1: 2000, y1: 1500 }, rotation: 0 as const };

  it('reads every tile as NOT drawn, in user space, and joins one word per tile into the page', async () => {
    const asked: Box[] = [];
    const drawn: boolean[] = [];
    const joined = await recogniseInTiles(page, undefined, {
      limits: LIMITS,
      scale: 2,
      floor: 1,
      accepts,
      snapshot: (rect) => {
        asked.push(rect);
        return Promise.resolve(rasterOf(rect));
      },
      // EACH TILE READS ONE WORD AT ITS OWN CENTRE, in user space: so every word is in its own tile's core, once.
      recognise: (raster): Promise<RecognisedPage> => {
        drawn.push(raster.drawn);
        const rect = rectOf(raster);
        const x = (rect.x0 + rect.x1) / 2;
        const y = (rect.y0 + rect.y1) / 2;
        const box = [x - 5, y - 5, x + 5, y + 5] as const;
        return Promise.resolve({ lines: [{ text: 'w', box, words: [{ text: 'w', box, confidence: 50 }] }], confidence: 50, languages: ['eng'] });
      },
    });
    expect(asked.length).toBeGreaterThan(4);
    expect(drawn.every((value) => !value)).toBe(true);
    // ONE LINE PER TILE: the centres are far apart, so nothing is joined, and nothing read twice.
    expect(joined.lines).toHaveLength(asked.length);
    // EVERY TILE IS INSIDE THE PAGE'S BOX, in user space.
    for (const rect of asked) {
      expect(rect.x0).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.y1).toBeLessThanOrEqual(1500 + 1e-9);
    }
  });

  it('on a TURNED page the tiles are cut as displayed and asked for in user space', async () => {
    const turned = { box: { x0: 0, y0: 0, x1: 2000, y1: 600 }, rotation: 90 as const };
    const asked: Box[] = [];
    await recogniseInTiles(turned, undefined, {
      limits: LIMITS,
      scale: 2,
      floor: 1,
      accepts,
      snapshot: (rect) => {
        asked.push(rect);
        return Promise.resolve(rasterOf(rect));
      },
      recognise: () => Promise.resolve({ lines: [], confidence: 0, languages: [] }),
    });
    // THE DISPLAYED PAGE IS 600 WIDE AND 2000 TALL, so the tiles stack down the display — which is along user x.
    const transform = pageTransform(turned.box, 90, 1);
    expect(transform.viewport).toStrictEqual({ width: 600, height: 2000 });
    const spanX = Math.max(...asked.map((rect) => rect.x1)) - Math.min(...asked.map((rect) => rect.x0));
    expect(spanX).toBeCloseTo(2000, 6);
    expect(asked.every((rect) => rect.y1 - rect.y0 <= 600 + 1e-9)).toBe(true);
  });

  it('a tile refused refuses the read, NAMING THE PART, and nothing is answered', async () => {
    let calls = 0;
    await expect(
      recogniseInTiles(page, undefined, {
        limits: LIMITS,
        scale: 2,
        floor: 1,
        accepts,
        snapshot: (rect) => Promise.resolve(rasterOf(rect)),
        recognise: () => {
          calls += 1;
          return calls === 2
            ? Promise.reject(new ClaudeRecognitionRefused('unavailable', 'the Claude API is not taking requests right now (529)'))
            : Promise.resolve({ lines: [], confidence: 0, languages: [] });
        },
      }),
    ).rejects.toThrow(/^part 2 of \d+: the Claude API is not taking requests/u);
    // AND NO TILE AFTER IT WAS SENT: one at a time, the refusal ends the read.
    expect(calls).toBe(2);
  });

  it('a page’s tables are read in full-width bands, and a table continuing across one is joined', async () => {
    const tall = { box: { x0: 0, y0: 0, x1: 612, y1: 3000 }, rotation: 0 as const };
    const bands: Box[] = [];
    const tables = await readTablesInBands(tall, {
      limits: LIMITS,
      scale: 2,
      floor: 1,
      accepts,
      bounds: { maxCells: 1000, maxText: 1000 },
      snapshot: (rect) => {
        bands.push(rect);
        return Promise.resolve(rasterOf(rect));
      },
      // EVERY BAND ANSWERS ONE TWO-COLUMN TABLE: the rows of ONE page-wide 20-point grid that lie wholly inside it,
      // displayed (y down from the top). So each grid row is read by every band it lies in, and kept by one.
      readBand: (raster) => {
        const rect = rectOf(raster);
        const top = 3000 - rect.y1;
        const bottom = 3000 - rect.y0;
        const grid = Array.from({ length: 150 }, (_, line) => line * 20).filter((at) => at >= top && at + 20 <= bottom);
        return Promise.resolve([
          {
            cells: grid.flatMap((at, row) => [
              { row, column: 0, rowSpan: 1, columnSpan: 1, text: `r${String(at)}` },
              { row, column: 1, rowSpan: 1, columnSpan: 1, text: 'v' },
            ]),
            rows: new Map(grid.map((at, row) => [row, { top: at, bottom: at + 20 }])),
          },
        ]);
      },
    });
    expect(bands.length).toBeGreaterThan(1);
    expect(bands.every((rect) => rect.x0 === 0 && rect.x1 === 612)).toBe(true);
    // ONE TABLE, and every row of the page once: 3000 / 20 rows, each read in exactly one band's core.
    expect(tables.tables).toHaveLength(1);
    const table = tables.tables[0];
    const texts = table === undefined ? [] : JSON.stringify(table).match(/"r\d+"/gu) ?? [];
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.length).toBe(150);
  });
});
