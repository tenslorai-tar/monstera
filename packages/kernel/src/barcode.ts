/**
 * `@monstera/kernel/barcode` — the barcode WRITER, and only it
 * ([ADR-0076](../../../docs/DECISIONS/0076-barcodes-are-zxing-cpps-read-in-the-engine-host-written-for-the-place-image-command.md)).
 *
 * A subpath rather than the barrel, `compose.ts`' reason one step on: importing the barrel must
 * not load zxing-cpp's glue into `main`, so `main` reaches this by a dynamic import the first
 * time a person places a barcode. The READER is not exported here at all; it runs in the engine
 * host, which imports it directly.
 */
export {
  type BarcodeImage,
  type BarcodeWriteFormat,
  BARCODE_WRITE_FORMATS,
  BarcodeTextRefusedError,
  writeBarcodePng,
} from './barcodeWriter.js';
