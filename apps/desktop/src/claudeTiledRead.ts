import {
  type BandTable,
  type ClaudeImageLimits,
  ClaudeRecognitionRefused,
  type PlacedTables,
  type RecognisedPage,
  joinBandTables,
  joinRecognised,
  placedTables,
  squareTiles,
  tableBands,
  toDisplayed,
  toUserSpace,
} from '@monstera/kernel';
import { type Box, type Rotation, pageTransform } from '@monstera/shared';

import { type ByteVerdict, rasterWithinLimit } from './rasterWithinLimit.js';

/**
 * A Claude read of a region too large for one request, run as tiles and joined
 * ([ADR-0255](../../../docs/DECISIONS/0255-a-region-too-large-for-claude-is-read-in-tiles-and-joined.md)).
 *
 * Its own module with every effect injected, so the sequence — cut, rasterise each tile in user space, read it, join —
 * is driven by a case rather than only by the composition root that wires it. The geometry and the joins are the
 * kernel's (`claudeTiles.ts`); this is the order they run in.
 */

/** A snapshot's raster and the frame it sits in — `RegionSnapshot`'s fields the readers take. */
export interface TileRaster {
  readonly png: Uint8Array;
  readonly crop: readonly [number, number, number, number];
  readonly rotation: Rotation;
  readonly origin: readonly [number, number];
}

/** The page, from the geometry read: its displayed box in user space, and its quarter turn. */
export interface TiledPage {
  readonly box: Box;
  readonly rotation: Rotation;
}

interface Plan {
  readonly limits: ClaudeImageLimits;
  /** The scale each tile is read at: the route's ceiling, the scale a region that fit would have had. */
  readonly scale: number;
  /** The lowest scale a raster may be retaken at for the service's byte limit. */
  readonly floor: number;
  readonly accepts: (pngBytes: number) => ByteVerdict;
  /** Rasterises a user-space rectangle of the page at a scale. */
  readonly snapshot: (rect: Box, scale: number) => Promise<TileRaster>;
}

/** A refusal of one tile, named, as the read's refusal: the person is told which part, and nothing part-read is kept. */
function tileRefused(thrown: unknown, index: number, count: number): unknown {
  if (!(thrown instanceof ClaudeRecognitionRefused)) return thrown;
  return new ClaudeRecognitionRefused(thrown.reason, `part ${String(index + 1)} of ${String(count)}: ${thrown.message}`, {
    cause: thrown,
  });
}

/**
 * Recognises `region` (user space; the whole page where absent) in square tiles, one request each, and joins the text.
 *
 * Each tile is sent as NOT drawn: the recogniser stretches a drawn region's words to fill it (`fittedToRaster`), whose
 * premise — the writing fills the box a person drew — is false of a tile.
 */
export async function recogniseInTiles(
  page: TiledPage,
  region: Box | undefined,
  plan: Plan & {
    readonly recognise: (raster: TileRaster & { readonly scale: number; readonly drawn: false }) => Promise<RecognisedPage>;
  },
): Promise<RecognisedPage> {
  const transform = pageTransform(page.box, page.rotation, 1);
  const area =
    region === undefined
      ? { x0: 0, y0: 0, x1: transform.viewport.width, y1: transform.viewport.height }
      : toDisplayed([region.x0, region.y0, region.x1, region.y1], transform);
  const tiles = squareTiles(area, plan.limits, plan.scale);
  if (tiles === null) {
    throw new ClaudeRecognitionRefused('too-large', 'this region would take more parts than one read is made of');
  }
  const parts: { core: Box; page: RecognisedPage }[] = [];
  for (const [index, tile] of tiles.entries()) {
    const rect = toUserSpace(tile.rect, transform);
    const { raster, scale } = await rasterWithinLimit(plan.scale, plan.floor, plan.accepts, (at) => plan.snapshot(rect, at));
    try {
      parts.push({ core: tile.core, page: await plan.recognise({ ...raster, scale, drawn: false }) });
    } catch (thrown) {
      throw tileRefused(thrown, index, tiles.length);
    }
  }
  return joinRecognised(parts, transform);
}

/**
 * Reads a page's tables in full-width bands, one request each, and joins a table that continues across a band.
 */
export async function readTablesInBands(
  page: TiledPage,
  plan: Plan & {
    readonly readBand: (raster: TileRaster & { readonly scale: number }) => Promise<readonly BandTable[]>;
    readonly bounds: { readonly maxCells: number; readonly maxText: number };
  },
): Promise<PlacedTables> {
  const transform = pageTransform(page.box, page.rotation, 1);
  const cut = tableBands(
    { x0: 0, y0: 0, x1: transform.viewport.width, y1: transform.viewport.height },
    plan.limits,
    plan.scale,
    plan.floor,
  );
  if (cut === null) {
    throw new ClaudeRecognitionRefused(
      'too-large',
      'this page is too wide for Claude to read its tables in one band, even at the smallest snapshot scale',
    );
  }
  const parts: { core: Box; tables: readonly BandTable[] }[] = [];
  for (const [index, band] of cut.bands.entries()) {
    const rect = toUserSpace(band.rect, transform);
    const { raster, scale } = await rasterWithinLimit(cut.scale, plan.floor, plan.accepts, (at) => plan.snapshot(rect, at));
    try {
      parts.push({ core: band.core, tables: await plan.readBand({ ...raster, scale }) });
    } catch (thrown) {
      throw tileRefused(thrown, index, cut.bands.length);
    }
  }
  return placedTables(joinBandTables(parts), plan.bounds.maxCells, plan.bounds.maxText);
}
