import { MIN_PAGE_PICTURE_SCALE } from '@monstera/contract';
import {
  AZURE_RASTER_SCALE,
  CLAUDE_STANDARD_RESOLUTION,
  claudeAcceptsBytes,
  claudeRasterScale,
} from '@monstera/kernel';

import { PageTooLargeToPicture } from './documentCommands.js';
import { rasterWithinLimit } from './rasterWithinLimit.js';

/** What a picture of one page needs from the engine host: the page's size, and the page drawn at a scale. */
export interface PictureEngine {
  readonly size: (page: number) => Promise<{ readonly width: number; readonly height: number } | undefined>;
  readonly draw: (page: number, scale: number) => Promise<Uint8Array>;
}

/**
 * A page as a picture for a vision ask (ADR-0090): the host draws the whole page and main weighs it. CLAUDE'S IMAGE
 * LIMITS FOR EVERY PROVIDER — the tightest the three adapter shapes document — so one picture serves whichever the
 * person chose.
 *
 * Drawn down to the whole page's floor, {@link MIN_PAGE_PICTURE_SCALE}, never the snapshot's: a page too large for the
 * image limit at 72 dpi is drawn smaller, as the provider would scale it anyway. At the snapshot's floor every A0
 * drawing was refused (JOURNAL, *No document-size refusals*, table A row 11).
 *
 * @throws {@link PageTooLargeToPicture} when even that floor is over the limits, which no page PDF allows reaches
 */
export async function pictureForAsk(engine: PictureEngine, page: number): Promise<Uint8Array> {
  const size = await engine.size(page);
  if (size === undefined) throw new Error(`the engine reported no size for page ${String(page + 1)}`);
  // THE STANDARD TIER, the tighter of the two (`ocrClaude.ts`' table): one picture serves whichever model the person chose,
  // so it is sized for the one every model reads unresized.
  const scale = claudeRasterScale(
    size.width,
    size.height,
    AZURE_RASTER_SCALE,
    MIN_PAGE_PICTURE_SCALE,
    CLAUDE_STANDARD_RESOLUTION,
  );
  if (scale === null) throw new PageTooLargeToPicture(page);
  const { raster } = await rasterWithinLimit(scale, MIN_PAGE_PICTURE_SCALE, claudeAcceptsBytes, async (at) => ({
    png: await engine.draw(page, at),
  }));
  return raster.png;
}
