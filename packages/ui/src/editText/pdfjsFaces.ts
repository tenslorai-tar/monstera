import type { DocVersion } from '@monstera/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { TextBlock } from '../textBlock.js';

/**
 * The faces PDF.js already loaded for a page's fonts, which the editor draws a block's unchanged words in
 * ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3, the
 * owner's font rule). Drawing a page, PDF.js adds a `FontFace` for each font it can turn into one to the document's
 * `FontFaceSet` under the font's `loadedName`, and a text item names that font by the same name. A Type 3 font and a
 * standard font the page does not embed get no face (measured on PDF.js 6.2.108, 2026-10-26), so such a run is drawn in
 * the chain's face instead. No font program crosses for this and nothing is built.
 */

/** One piece of text PDF.js shows: where it starts in PDF user space, what it says, and the face drawing it, if any. */
export interface ShownText {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** The family of the face PDF.js loaded for the item's font, or `undefined` where it loaded none. */
  readonly family: string | undefined;
}

/** A page's shown text, and the version PDF.js read it from: an editor takes it only over a read of that version. */
export interface ShownPage {
  readonly version: DocVersion;
  readonly items: readonly ShownText[];
}

/** A page's shown text as PDF.js reads it, and whether each font has a loaded face in `faces`. */
export async function shownTextOf(document: PDFDocumentProxy, pageNumber: number, faces: FontFaceSet): Promise<ShownText[]> {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  const loaded = new Set<string>();
  for (const face of faces) if (face.status === 'loaded') loaded.add(face.family.replaceAll('"', ''));
  return content.items.flatMap((item) => {
    if (!('str' in item) || item.str.trim() === '') return [];
    const [, , , , x, y] = item.transform as number[];
    if (x === undefined || y === undefined) return [];
    return [{ x, y, text: item.str, family: loaded.has(item.fontName) ? item.fontName : undefined }];
  });
}

/** Text without its spaces, which PDFium infers between words and PDF.js may not. */
const bare = (text: string): string => text.replace(/\s+/gu, '');

/**
 * The PDF.js face of each of `block`'s runs, by run index: matched BY WHERE THE WORDS STAND, never by name, since two
 * subsets of one font may share a name. A run takes the first item whose start lies on the run's line (inside the line's
 * box, widened by a point) and whose words are part of the run's or hold them. A run no item matches, or whose item has
 * no face, is absent.
 */
export function runFamiliesOf(block: TextBlock, shown: readonly ShownText[]): Map<number, string> {
  const families = new Map<number, string>();
  for (const line of block.lines) {
    const onLine = shown.filter(
      (item) => item.x >= line.box.x0 - 1 && item.x <= line.box.x1 + 1 && item.y >= line.box.y0 - 1 && item.y <= line.box.y1 + 1,
    );
    for (const run of line.runs) {
      const words = bare(run.text);
      if (words === '') continue;
      const item = onLine.find((each) => {
        const said = bare(each.text);
        return said !== '' && (words.includes(said) || said.includes(words));
      });
      if (item?.family !== undefined) families.set(run.index, item.family);
    }
  }
  return families;
}
