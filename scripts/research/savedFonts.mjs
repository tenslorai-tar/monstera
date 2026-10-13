// @ts-check
import { readFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';

/**
 * The fonts a saved file's pages name, by BaseFont, read by pdf-lib (`pdffonts`' question, without Poppler): the ONE reader
 * every walk takes when a step reads back which face its words were set in, so two walks cannot hold two opinions about
 * where a page's fonts are.
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
