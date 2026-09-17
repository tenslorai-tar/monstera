import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

import type { MupdfSession } from './engineSeam.js';
import { readPageGeometry } from './pageGeometry.js';
import { rasterisePageRgba } from './pageImages.js';
import { rasterScale } from './rasterScale.js';

/**
 * The barcodes on a page — §3's *Reading and generating barcodes* row, its reading half
 * ([ADR-0076](../../../docs/DECISIONS/0076-barcodes-are-zxing-cpps-read-in-the-engine-host-written-for-the-place-image-command.md)).
 *
 * zxing-cpp compiled to WASM, run where the page's raster is made: the engine host. The raster
 * is a document's pixels, and a crafted image is input to a C++ decoder, so it is decoded inside
 * invariant 25's containment rather than in `main`.
 *
 * ## The WASM arrives as BYTES
 *
 * `webpEncoder.ts`' reason: the glue would locate its `.wasm` by URL and fetch it, and the host
 * has no network. Emscripten's `wasmBinary` hands it the package's own bytes.
 */

/** One barcode found on a page: its symbology as zxing-cpp names it, and its text. */
export interface FoundBarcode {
  readonly format: string;
  readonly text: string;
}

/**
 * The raster a page is read at: 200 dpi. Measured 2026-09-17: QR, Data Matrix and a Code 128
 * printed at their natural size read exactly from 150 dpi rasters, so 200 leaves room for smaller
 * symbols without approaching the engine's pixel bound on a Letter page (1,700 × 2,200).
 */
export const BARCODE_READ_DPI = 200;

/**
 * The most pixels one page is decoded at: 16 megapixels, below the engine's 32, because the
 * DECODE is what a large page costs. Measured 2026-09-17 on an A0 page carrying one QR code
 * (`rasterisePageRgba` then zxing-cpp, this machine): 32 MP rastered in 275 ms and decoded in
 * 2,807 ms; 16 MP in 173 and 1,271; 8 MP in 64 and 559 — so the decode is linear in pixels and
 * the raster is not the cost. At 16 MP every page up to A2 is still read at 200 dpi, and an A0
 * poster at about 100 dpi, where its symbols are printed at poster size too.
 */
export const BARCODE_READ_PIXELS = 16_000_000;

let preparing: Promise<unknown> | undefined;

/** Loads the reader once per process; a failed load is retried by the next call. */
function prepared(): Promise<unknown> {
  preparing ??= Promise.resolve()
    .then(() => {
      const require = createRequire(import.meta.url);
      const wasmBinary = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
      return prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
    })
    .catch((cause: unknown) => {
      preparing = undefined;
      throw cause;
    });
  return preparing;
}

/**
 * The barcodes zxing-cpp finds on one page, in the order it reports them.
 *
 * @throws `RangeError` for a page the document does not have or that displays no region, as the
 *   raster does
 */
export async function readPageBarcodes(session: MupdfSession, page: number): Promise<readonly FoundBarcode[]> {
  await prepared();
  // FITTED UNDER THE READ'S PIXEL BUDGET by the one rule the slide picture and the print take:
  // a poster-sized page is read at less than 200 dpi rather than refused or decoded for seconds.
  const [size] = (await readPageGeometry(session, [page])).sizes;
  if (size === undefined) throw new Error(`the page geometry read answered no size for page ${String(page)}`);
  const scale = rasterScale(size, BARCODE_READ_DPI, BARCODE_READ_PIXELS);
  // RAW PIXELS: zxing-wasm reads `{ data, width, height }` as RGBA directly, so no file format
  // stands between the engine's raster and the decoder.
  const { rgba, width, height } = await rasterisePageRgba(session, page, scale);
  const results = await readBarcodes({ data: rgba, width, height, colorSpace: 'srgb' }, { formats: [] });
  return results.filter((result) => result.isValid).map((result) => ({ format: result.format, text: result.text }));
}
