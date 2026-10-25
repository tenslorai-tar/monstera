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
      // THE PROGRAM BY ITS OUTLINES, `pdfLibCidSink`'s rule: a CFF one is `FontFile3 /OpenType` under a `CIDFontType0`.
      const { outlines } = parts;
      const cff = outlines.kind === 'cff';
      const program = document.addStream(parts.program, cff ? { Subtype: 'OpenType' } : { Length1: parts.program.length });
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
        ...(cff ? { FontFile3: program } : { FontFile2: program }),
      });
      const descendant = document.addObject({
        Type: 'Font',
        Subtype: cff ? 'CIDFontType0' : 'CIDFontType2',
        BaseFont: parts.name,
        CIDSystemInfo: { Registry: '(Adobe)', Ordering: '(Identity)', Supplement: 0 },
        FontDescriptor: descriptor,
        W: parts.widths.map((entry) => (typeof entry === 'number' ? entry : [...entry])),
        ...(outlines.kind === 'truetype' ? { CIDToGIDMap: document.addStream(outlines.cidToGid, {}) } : {}),
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
