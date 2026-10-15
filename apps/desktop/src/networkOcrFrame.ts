/**
 * What a network OCR read is framed by, decided once (the stage audit's CCCCCCCC-3): the region a person drew, or the
 * page itself where they chose to send whole pages (ADR-0202), and whether the writing was DRAWN around.
 *
 * `drawn` is the premise of `fittedToRaster` (`ocrClaude.ts`, AAAAAAAA-2): only a region a person drew is one the
 * writing fills, so only then may the model's word frame be stretched over the raster; a page's writing may fill its
 * top half and nothing else. It used to be an inline `rect !== undefined` at the composition root, a choice held by
 * the type alone that no case drove. Named here, it is one decision with its own cases, and the root takes it.
 */
export type NetworkOcrScope =
  | { readonly page: number; readonly wholePage: true }
  | { readonly page: number; readonly region: readonly [number, number, number, number] };

export interface NetworkOcrFrame {
  /** The region in page space, or `undefined` for the page's own box. */
  readonly rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | undefined;
  readonly widthPoints: number;
  readonly heightPoints: number;
  /** Whether a person drew this region around the writing. */
  readonly drawn: boolean;
}

/**
 * The frame of one network read.
 *
 * @param pageSize the page's displayed size, read only for a whole page
 */
export async function networkOcrFrame(
  scope: NetworkOcrScope,
  pageSize: () => Promise<{ readonly width: number; readonly height: number }>,
): Promise<NetworkOcrFrame> {
  if ('wholePage' in scope) {
    const size = await pageSize();
    return { rect: undefined, widthPoints: size.width, heightPoints: size.height, drawn: false };
  }
  const [x0, y0, x1, y1] = scope.region;
  return { rect: { x0, y0, x1, y1 }, widthPoints: Math.abs(x1 - x0), heightPoints: Math.abs(y1 - y0), drawn: true };
}
