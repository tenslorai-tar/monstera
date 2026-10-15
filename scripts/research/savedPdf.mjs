// @ts-check
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import forge from 'node-forge';

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

/**
 * What a signed file says about its LAST signature, read from its bytes by a reader that is not the signer: whether the
 * file is still protected, how many signatures it carries, whether the last `/ByteRange` covers the whole file around
 * one hole, and the common name of the first certificate in that hole's PKCS #7. `/Contents` is written in clear on a
 * protected file (ADR-0227), which is what lets this read it with no password.
 *
 * @param {string} path
 * @returns {Promise<{ protectedStill: boolean, signatures: number, coversFile?: boolean, signer?: string | null }>}
 */
export async function savedSignature(path) {
  const bytes = await readFile(path);
  const text = bytes.toString('latin1');
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/gu)];
  const last = ranges.at(-1);
  if (last === undefined) return { protectedStill: text.includes('/Encrypt'), signatures: 0 };
  const [a = -1, b = 0, c = 0, d = 0] = last.slice(1, 5).map(Number);
  // THE HOLE is between the two ranges: `<`, the hex, `>`. Its trailing zeros are the placeholder's unused room.
  const hole = text.slice(a + b + 1, c - 1).replace(/(?:00)+$/u, '');
  const message = /** @type {{ certificates: { subject: { getField: (name: string) => { value: string } | null } }[] }} */ (
    /** @type {unknown} */ (forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.hexToBytes(hole))))
  );
  return {
    protectedStill: text.includes('/Encrypt'),
    signatures: ranges.length,
    coversFile: a === 0 && c + d === bytes.length,
    signer: message.certificates[0]?.subject.getField('CN')?.value ?? null,
  };
}
