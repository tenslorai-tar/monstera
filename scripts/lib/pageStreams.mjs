// @ts-check
/**
 * One page's content streams, decoded, for a script that compares an engine's reading with the bytes it read.
 *
 * Read with pdf-lib and inflated, so a script needs no engine to see them. The application reads the same streams
 * through MuPDF (`pageContent.ts`); this is the scripts' one reader, so a research instrument and the proof that pins
 * what it measured cannot read a page two ways. Only `FlateDecode` and unfiltered streams: a page filtered any other way
 * throws rather than answering bytes that are not its content.
 */

import { inflateSync } from 'node:zlib';

import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';

/**
 * @param {Uint8Array} bytes the document
 * @param {number} page zero-based
 * @returns {Promise<Uint8Array[]>}
 */
export async function pageStreams(bytes, page) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const contents = doc.getPage(page).node.get(PDFName.of('Contents'));
  /** @type {unknown[]} */
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(stream instanceof PDFRawStream)) throw new Error(`page ${String(page)}'s content is not a raw stream`);
    const filter = stream.dict.get(PDFName.of('Filter'));
    if (filter === undefined) return stream.contents;
    if (filter !== PDFName.of('FlateDecode')) throw new Error(`page ${String(page)}'s content is filtered by ${String(filter)}`);
    return new Uint8Array(inflateSync(stream.contents));
  });
}
