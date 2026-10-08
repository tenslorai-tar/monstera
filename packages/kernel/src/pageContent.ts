import type { PDFObject } from './mupdfRaw.js';
import { bufferBytes } from './mupdfWriter.js';

/**
 * A page's content streams, each decoded, read through their INDIRECT references — the one place the kernel reads them
 * from a MuPDF page (`layers.ts` imports a page as a layer through it, ADR-0176's writer edits through it), and
 * `textOperators.ts`' `joinedContent` the one place they are joined.
 *
 * Measured 2026-09-14 (ADR-0064): `readStream` loads through the object number, and called on `.resolve()`'s result it
 * throws `object is not a stream` — the resolved value is the stream's dictionary and no longer names the object. So
 * the resolve is used only to ask whether `/Contents` is an array.
 */
export function pageContentStreams(leaf: PDFObject): readonly Uint8Array[] {
  const reference = leaf.get('Contents');
  if (reference.isNull()) return [];
  const resolved = reference.resolve();
  return resolved.isArray()
    ? Array.from({ length: resolved.length }, (_, at) => bufferBytes(resolved.get(at).readStream()))
    : [bufferBytes(reference.readStream())];
}
