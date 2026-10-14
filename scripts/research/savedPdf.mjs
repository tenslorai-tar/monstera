// @ts-check
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';

/**
 * What a walk reads back from a file the application saved, by readers that are not the writer: the ONE place each such
 * reading is spelt, so two walks cannot hold two opinions about where a page's fonts are or what its words say.
 */

/**
 * The fonts a saved file's pages name, by BaseFont, read by pdf-lib (`pdffonts`' question, without Poppler).
 *
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function savedFonts(path) {
  const loaded = await PDFDocument.load(await readFile(path), { updateMetadata: false, ignoreEncryption: true });
  const names = new Set();
  for (const each of loaded.getPages()) {
    const resources = each.node.Resources();
    const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, ref] of fonts?.entries() ?? []) {
      const font = loaded.context.lookup(ref, PDFDict);
      const base = font.lookupMaybe(PDFName.of('BaseFont'), PDFName);
      if (base !== undefined) names.add(base.decodeText());
    }
  }
  return [...names].sort();
}

/**
 * A saved page's content, its streams decoded and joined, read by pdf-lib: what a mark written into the content (a tab's
 * `/ActualText`, a decoration's tag) is counted in.
 *
 * @param {string} path
 * @param {number} [pageIndex] zero-based
 * @returns {Promise<string>}
 */
export async function savedContent(path, pageIndex = 0) {
  const loaded = await PDFDocument.load(await readFile(path), { updateMetadata: false, ignoreEncryption: true });
  const contents = loaded.getPages()[pageIndex]?.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((each) => loaded.context.lookup(each)) : [contents];
  let text = '';
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) text += new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
  }
  return text;
}

/**
 * The words of a saved file's pages, one string per page, read by PDF.js rather than by the app that wrote them.
 *
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function savedWords(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: false });
  const loaded = await task.promise;
  const pages = [];
  for (let at = 1; at <= loaded.numPages; at += 1) {
    const content = await (await loaded.getPage(at)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return pages;
}
