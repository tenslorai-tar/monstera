import type { CidFontParts, CidFontSink } from './cidFont.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';

/**
 * Where a font written through MuPDF's object model ends up: filled when the font is written, which is before the
 * writer names it in a page's resources. MuPDF needs no reference reserved ahead, unlike pdf-lib, because the Type 3
 * page writer finishes its fonts before it touches the page.
 */
export interface MupdfFontRef {
  object: PDFObject | null;
}

/**
 * MuPDF's writer of a font's parts ([ADR-0177](../../../docs/DECISIONS/0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md)
 * Decision 3): the dictionaries `pdfLibCidSink` writes, the same keys and values, through the session's own document.
 * It decides nothing; `cidFont.ts` decided all of it.
 */
export function mupdfCidSink(document: PDFDocument): CidFontSink<MupdfFontRef> {
  return {
    reserve: () => ({ object: null }),
    write: (ref, parts: CidFontParts) => {
      const program = document.addStream(parts.program, { Length1: parts.program.length });
      const descriptor = document.addObject({
        Type: 'FontDescriptor',
        FontName: parts.name,
        Flags: parts.flags,
        FontBBox: [...parts.box],
        ItalicAngle: parts.italicAngle,
        Ascent: parts.ascent,
        Descent: parts.descent,
        CapHeight: parts.capHeight,
        StemV: parts.stemV,
        FontFile2: program,
      });
      const descendant = document.addObject({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: parts.name,
        CIDSystemInfo: { Registry: '(Adobe)', Ordering: '(Identity)', Supplement: 0 },
        FontDescriptor: descriptor,
        W: parts.widths.map((entry) => (typeof entry === 'number' ? entry : [...entry])),
        CIDToGIDMap: document.addStream(parts.cidToGid, {}),
      });
      ref.object = document.addObject({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: parts.name,
        Encoding: 'Identity-H',
        DescendantFonts: [descendant],
        ToUnicode: document.addStream(new TextEncoder().encode(parts.toUnicode), {}),
      });
    },
  };
}
