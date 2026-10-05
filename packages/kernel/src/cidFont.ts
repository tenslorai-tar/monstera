import { type PDFDocument, PDFHexString, PDFNumber, type PDFRef, PDFString } from '@cantoo/pdf-lib';

import type { FontEmbedding } from './fontFaces.js';
import { namedSubset, subsetTag } from './fontSubset.js';
import type { ShapingFace } from './textShaping.js';

/**
 * A font embedded as a CID-keyed TrueType font, one code per glyph drawn and the characters it stands for
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
 * Decisions 5 and 8).
 *
 * ## One code per (glyph, characters, width)
 *
 * A shaped run names glyphs, not characters, and a reader recovers text through `ToUnicode`, which maps a CODE to
 * characters. A glyph drawn for two different stretches of text — one glyph a font uses for a letter and for its
 * small-caps form, or the box drawn for two different missing characters — needs two codes, so a code is assigned per
 * pair and `CIDToGIDMap` sends each to its glyph. The width is part of the key because a glyph followed by one drawn
 * as an outline states both advances (`cid`'s `folded`). `Identity-H` makes a code two bytes, so a font holds 65,535 codes;
 * {@link CidFont.cid} answers `null` past that and its caller opens another.
 *
 * ## The widths are the glyph's own, and the shaper's are written as adjustments
 *
 * `W` states each code's advance from the face's `hmtx` at its pin. What HarfBuzz placed differs where the face kerns
 * or positions a mark, and the writer that draws the run puts the difference in `TJ` — so a reader that ignores the
 * adjustments still advances by a width the font really has.
 *
 * ## A subset, named by its bytes, and the whole face only where the subset fails
 *
 * `fontSubset.ts`' rule, with glyph ids kept so the ids HarfBuzz shaped with are the ids the content names. Where the
 * subsetter refuses, the whole file goes in when the licence allows it and the file is one face; that is the owner's
 * answer to Q5, and a face that can be neither subset nor carried whole is a fault, not a document's problem.
 */

/** Where an embedded font's program comes from. */
export interface CidFontSource {
  readonly bytes: Uint8Array;
  readonly faceIndex: number;
  /** The axes the face is pinned at, which the subset is instanced at. */
  readonly axes: Readonly<Record<string, number>>;
  /** The face's PostScript name, which the subset's `TAG+` name is built on. */
  readonly postscript: string;
  readonly embedding: FontEmbedding;
  readonly italic: boolean;
  readonly shaping: ShapingFace;
}

/** The most codes a two-byte encoding holds; code 0 is the missing glyph. */
const MAX_CODE = 0xffff;

/** How many `bfchar` entries one block may hold, by the CMap specification's limit. */
const BFCHAR_BLOCK = 100;

interface Code {
  readonly code: number;
  readonly glyph: number;
  readonly text: string;
  /** The advance `W` states for the code, in thousandths of an em. */
  readonly width: number;
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, '0').toUpperCase();
}

function utf16Hex(text: string): string {
  let out = '';
  for (let at = 0; at < text.length; at += 1) out += hex4(text.charCodeAt(at));
  return out;
}

/** A width or metric in a PDF font's thousandths of an em, to a thousandth. */
function thousandths(units: number, unitsPerEm: number): number {
  return Math.round((units * 1000 * 1000) / unitsPerEm) / 1000;
}

/** One font in a document being written, which codes are assigned in as the text is set. */
export class CidFont {
  readonly ref: PDFRef;
  readonly #codes = new Map<string, Code>();
  #finished = false;

  constructor(
    private readonly document: PDFDocument,
    readonly source: CidFontSource,
  ) {
    // RESERVED NOW and written at the end, so a page can name the font before anyone knows which glyphs it holds.
    this.ref = document.context.nextRef();
  }

  /** How many more codes this font can assign: a piece of at most this many glyphs is sure to fit. */
  get room(): number {
    return MAX_CODE - this.#codes.size;
  }

  /**
   * The code for `glyph` drawn for `text`, its stated width `folded` font units past the glyph's own advance, assigned
   * the first time it is asked; `null` once this font is full.
   *
   * @param folded the advance of glyphs drawn after this one that carry no text and are drawn as outlines: stated as
   *   part of this code's width, so a reader sees this character reach the next one rather than a gap it reads as a
   *   space (`composeFonts.ts`)
   */
  cid(glyph: number, text: string, folded = 0): { readonly code: number; readonly width: number } | null {
    if (this.#finished) throw new Error('a code was asked of a font already written');
    const { shaping } = this.source;
    const width = thousandths(shaping.nominalAdvance(glyph) + folded, shaping.unitsPerEm);
    const key = `${String(glyph)}|${String(width)}|${text}`;
    const known = this.#codes.get(key);
    if (known !== undefined) return known;
    if (this.#codes.size >= MAX_CODE) return null;
    const entry = { code: this.#codes.size + 1, glyph, text, width };
    this.#codes.set(key, entry);
    return entry;
  }

  /** Writes the font into the document. Nothing more can be drawn in it afterwards. */
  finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    const { context } = this.document;
    const { shaping } = this.source;
    const codes = [...this.#codes.values()];
    const program = this.#program(codes);

    const map = new Uint8Array(2 * (codes.length + 1));
    for (const { code, glyph } of codes) {
      map[2 * code] = glyph >> 8;
      map[2 * code + 1] = glyph & 0xff;
    }
    const widths: (number | number[])[] = [];
    for (const { code, width } of codes) widths.push(code, [width]);

    const mapped = codes.filter((entry) => entry.text !== '');
    const blocks: string[] = [];
    for (let at = 0; at < mapped.length; at += BFCHAR_BLOCK) {
      const block = mapped.slice(at, at + BFCHAR_BLOCK);
      blocks.push(
        `${String(block.length)} beginbfchar`,
        ...block.map((entry) => `<${hex4(entry.code)}> <${utf16Hex(entry.text)}>`),
        'endbfchar',
      );
    }
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');

    const metrics = shaping.metrics();
    const scale = (value: number): number => thousandths(value, shaping.unitsPerEm);
    const descriptor = context.obj({
      Type: 'FontDescriptor',
      FontName: program.name,
      // SYMBOLIC (bit 3), which a CID font's descriptor states because its glyphs are reached by code, not by a
      // standard encoding; ITALIC (bit 7) where the face is.
      Flags: 4 | (this.source.italic ? 64 : 0),
      FontBBox: metrics.box.map(scale),
      ItalicAngle: metrics.italicAngle,
      Ascent: scale(metrics.ascender),
      Descent: scale(metrics.descender),
      CapHeight: scale(metrics.capHeight),
      StemV: 80,
      FontFile2: context.register(context.flateStream(program.bytes, { Length1: program.bytes.length })),
    });
    const descendant = context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: program.name,
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: context.register(descriptor),
      W: widths,
      CIDToGIDMap: context.register(context.flateStream(map)),
    });
    context.assign(
      this.ref,
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: program.name,
        Encoding: 'Identity-H',
        DescendantFonts: [context.register(descendant)],
        ToUnicode: context.register(context.flateStream(new TextEncoder().encode(cmap))),
      }),
    );
  }

  /** The font program to embed and its name: a subset where the licence and the subsetter allow, else the whole file. */
  #program(codes: readonly Code[]): { readonly bytes: Uint8Array; readonly name: string } {
    const { bytes, faceIndex, axes, postscript, embedding } = this.source;
    const base = postscript === '' ? 'Font' : postscript;
    // A CFF FACE IS NOT A CIDFontType2 program: its codes reach glyphs through the CFF's charset, never through
    // `CIDToGIDMap`, so writing one here would draw the wrong glyphs. Every bundled face is TrueType; installed CFF
    // faces join the catalogue only once their own writer exists.
    if (bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) {
      throw new Error(`the face ${base} has CFF outlines, which this writer does not embed`);
    }
    if (embedding === 'subset') {
      const subset = namedSubset(bytes, base, {
        glyphs: [0, ...codes.map((entry) => entry.glyph)],
        retainGlyphIds: true,
        faceIndex,
        axes,
      });
      if (subset !== null) return subset;
    }
    const collection = bytes[0] === 0x74 && bytes[1] === 0x74 && bytes[2] === 0x63 && bytes[3] === 0x66;
    if (embedding === 'never' || collection) {
      throw new Error(
        `the face ${base} (index ${String(faceIndex)}) could not be subset and cannot be carried whole ` +
          `(${embedding === 'never' ? 'its licence forbids embedding' : 'it is one face of a collection'})`,
      );
    }
    return { bytes, name: `${subsetTag(bytes)}+${base}` };
  }
}

/** A run's codes as one `TJ` string. */
export function codeString(codes: readonly number[]): PDFHexString {
  return PDFHexString.of(codes.map(hex4).join(''));
}

/** A `TJ` adjustment, in thousandths of an em, to a thousandth. */
export function adjustment(thousandthsOfAnEm: number): PDFNumber {
  return PDFNumber.of(Math.round(thousandthsOfAnEm * 1000) / 1000);
}
