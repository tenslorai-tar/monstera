import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer';

/**
 * A barcode as PNG bytes — §3's *Reading and generating barcodes* row, its generating half
 * ([ADR-0076](../../../docs/DECISIONS/0076-barcodes-are-zxing-cpps-read-in-the-engine-host-written-for-the-place-image-command.md)).
 *
 * zxing-cpp's writer, in `main`: its input is the text a person typed, not a document, and the
 * PNG it makes is the place-image command's bytes. Reached through `@monstera/kernel/barcode`
 * and loaded on first use, so it is never part of `main`'s startup graph.
 */

/**
 * The symbologies a person may generate: two-dimensional codes for text and links, Code 128
 * for general linear labels, and EAN-13 for retail numbers. zxing-cpp names them this way.
 */
export const BARCODE_WRITE_FORMATS = ['QRCode', 'DataMatrix', 'Aztec', 'PDF417', 'Code128', 'EAN13'] as const;

export type BarcodeWriteFormat = (typeof BARCODE_WRITE_FORMATS)[number];

/** The symbology cannot carry the text — digits for EAN-13, length for Code 128 — in zxing-cpp's words. */
export class BarcodeTextRefusedError extends Error {
  constructor(format: BarcodeWriteFormat, said: string) {
    super(`${format} cannot carry this text: ${said}`);
    this.name = 'BarcodeTextRefusedError';
  }
}

/** Module pixels per symbol module: large enough to print and read, small enough to place. */
const MODULE_PIXELS = 4;

let preparing: Promise<unknown> | undefined;

/** Loads the writer once per process; a failed load is retried by the next call. */
function prepared(): Promise<unknown> {
  preparing ??= Promise.resolve()
    .then(() => {
      const require = createRequire(import.meta.url);
      const wasmBinary = readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm'));
      return prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
    })
    .catch((cause: unknown) => {
      preparing = undefined;
      throw cause;
    });
  return preparing;
}

/** A written barcode: the PNG, and its size in pixels, which is the symbol's proportions. */
export interface BarcodeImage {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * `text` as a `format` barcode, PNG.
 *
 * The size is read from the PNG's own header (width and height as the first eight bytes of the
 * IHDR chunk, which the format requires to come first), so it is the size of the bytes placed
 * rather than a second statement of it.
 *
 * @throws {@link BarcodeTextRefusedError} where the symbology cannot carry the text
 */
export async function writeBarcodePng(text: string, format: BarcodeWriteFormat): Promise<BarcodeImage> {
  await prepared();
  const written = await writeBarcode(text, { format, scale: MODULE_PIXELS });
  if (written.error !== '' || written.image === null) {
    throw new BarcodeTextRefusedError(format, written.error === '' ? 'no image was produced' : written.error);
  }
  const png = new Uint8Array(await written.image.arrayBuffer());
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { png, width: header.getUint32(16), height: header.getUint32(20) };
}
