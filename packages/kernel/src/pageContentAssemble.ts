import { zlibSync } from 'fflate';

import type { ContentImage, ContentImageHeader, PageContent } from './presentationContent.js';

/**
 * The host's page-content answer and the bytes it wrote beside it, as a {@link PageContent}
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * The host is hostile by invariant 25's premise, so every claim it makes about those bytes is checked here before anything
 * is sliced: an offset or length outside what was written, a bitmap whose size is not its width times its height, a JPEG
 * that does not begin as one. A refusal is the page being written as Exact look, never a slide built from bytes nobody
 * checked.
 */

/** The host named bytes it did not write, or described an image its bytes are not. */
export class PageContentRefused extends Error {
  constructor(detail: string) {
    super(`the page-content answer was refused: ${detail}`);
    this.name = 'PageContentRefused';
  }
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A PNG of BGRA pixels: RGB where every pixel is opaque (a third smaller), RGBA where any is not. Filter 0 on every row,
 * which is the encoder with nothing to get wrong; the pixels are the page's own and size is the slide's to spend (ADR-0072).
 */
export function encodePng(width: number, height: number, bgra: Uint8Array): Uint8Array {
  if (width <= 0 || height <= 0 || bgra.length !== width * height * 4) {
    throw new PageContentRefused(`a ${String(width)}x${String(height)} bitmap is not ${String(bgra.length)} bytes of BGRA`);
  }
  let opaque = true;
  for (let at = 3; at < bgra.length; at += 4) {
    if (bgra[at] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const row = 1 + width * channels;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y += 1) {
    let out = y * row + 1;
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      raw[out] = bgra[at + 2] ?? 0;
      raw[out + 1] = bgra[at + 1] ?? 0;
      raw[out + 2] = bgra[at] ?? 0;
      if (!opaque) raw[out + 3] = bgra[at + 3] ?? 0;
      out += channels;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** What the host answered about a page, with its images still as headers into the blob. */
export type PageContentAnswer = Omit<PageContent, 'images'> & { readonly images: readonly ContentImageHeader[] };

/** The answer and its blob, checked, as the content the slide model reads. */
export function assemblePageContent(answer: PageContentAnswer, blob: Uint8Array): PageContent {
  const images = answer.images.map((header): ContentImage => {
    const end = header.offset + header.length;
    if (end > blob.length) {
      throw new PageContentRefused(`image ${String(header.index)} names bytes up to ${String(end)} of ${String(blob.length)} written`);
    }
    const bytes = blob.subarray(header.offset, end);
    const { offset: _offset, length: _length, format, ...rest } = header;
    if (format === 'jpeg') {
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw new PageContentRefused(`image ${String(header.index)} is not a JPEG stream`);
      }
      return { ...rest, format: 'jpeg', bytes };
    }
    return { ...rest, format: 'png', bytes: encodePng(header.width, header.height, bytes) };
  });
  return { ...answer, images };
}
