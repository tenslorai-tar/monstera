import { type PDFDocument, PDFHexString, PDFNumber, type PDFRef, PDFString } from '@cantoo/pdf-lib';

import type { FontEmbedding } from './fontFaces.js';
import { namedSubset, subsetTag } from './fontSubset.js';
import { cffProgram, stepsOfOutline } from './pathFont.js';
import { hasCffOutlines } from './sfntTables.js';
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

/**
 * A finished font, whatever document model writes it: everything this module DECIDES, as data
 * ([ADR-0177](../../../docs/DECISIONS/0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md)
 * Decision 3). The composers write it through pdf-lib and the Type 3 page writer through MuPDF's object model, so the
 * codes, `W`, `CIDToGIDMap` and `ToUnicode` a page reads are one opinion whichever engine holds the page.
 */
export interface CidFontParts {
  /** The `BaseFont` and `FontName`: the subset's `TAG+Name`, or the whole file's. */
  readonly name: string;
  readonly program: Uint8Array;
  /**
   * The program's outlines, which decide how the font is written under `Identity-H`, each code its own CID (the class
   * header of {@link CidFont}): TrueType as a `CIDFontType2` whose `CIDToGIDMap`, two bytes per code from 0, sends each to
   * its glyph id; CFF as a `CIDFontType0` with `FontFile3 /OpenType`, whose program holds each code's glyph AT the code.
   */
  readonly outlines: { readonly kind: 'truetype'; readonly cidToGid: Uint8Array } | { readonly kind: 'cff' };
  /** `W`: each code followed by a one-element array of its width. */
  readonly widths: readonly (number | readonly number[])[];
  /** The `ToUnicode` CMap's text. */
  readonly toUnicode: string;
  readonly flags: number;
  readonly box: readonly number[];
  readonly italicAngle: number;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly stemV: number;
}

/**
 * How one document model reserves a font's object and writes its {@link CidFontParts} into it. The only thing that
 * differs between pdf-lib and MuPDF here: neither decides anything about the font.
 */
export interface CidFontSink<R> {
  reserve(): R;
  write(ref: R, parts: CidFontParts): void;
}

/**
 * One font in a document being written, which codes are assigned in as the text is set.
 *
 * ## A CFF face's program is built in code order, each code its own glyph
 *
 * A TrueType face is written as a `CIDFontType2` under `Identity-H`: each code is its own CID, and `CIDToGIDMap` sends
 * the CID to its glyph, so one glyph can stand for two texts or two widths under two codes. A CFF face is written as a
 * `CIDFontType0` over an OpenType program (`FontFile3 /OpenType`), and a CFF that is not CID-keyed selects its glyph BY
 * the CID (ISO 32000-2, 9.7.4.2) — there is no map. So the program embedded is BUILT, glyph n drawing code n's glyph from
 * the face's own outline at its pin (`pathFont.ts`' `cffProgram`): each code its own CID and its own glyph, as for
 * TrueType, and it holds only the glyphs the text draws.
 *
 * Neither shortcut holds, both measured 2026-10-25 on GNU Unifont, whose Thai SARA AM is shaped as NIKHAHIT and SARA AA,
 * so SARA AA's glyph stands for "ำ" and for "า" in one paragraph. The face's own program with each code its glyph id
 * cannot give one glyph two codes; an embedded encoding CMap sending two codes to one glyph's CID is legal, and MuPDF
 * then reads both codes as whichever text it mapped last — "าำาำ" did not read back — because its `ToUnicode` is held
 * per CID, and `W` is per CID too.
 */
export class CidFont<R = PDFRef> {
  readonly ref: R;
  readonly #codes = new Map<string, Code>();
  readonly #cff: boolean;
  #finished = false;

  constructor(
    private readonly sink: CidFontSink<R>,
    readonly source: CidFontSource,
  ) {
    // RESERVED NOW and written at the end, so a page can name the font before anyone knows which glyphs it holds.
    this.ref = sink.reserve();
    this.#cff = hasCffOutlines(source.bytes, source.faceIndex);
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
    this.sink.write(this.ref, this.#parts());
  }

  /** What the font is, from the codes assigned: the decision, before any document model writes it. */
  #parts(): CidFontParts {
    const { shaping } = this.source;
    const codes = [...this.#codes.values()];
    const program = this.#program(codes);

    // A CFF PROGRAM HOLDS EACH CODE'S GLYPH AT THE CODE, so it has no map to write.
    let outlines: CidFontParts['outlines'] = { kind: 'cff' };
    if (!this.#cff) {
      const map = new Uint8Array(2 * (codes.length + 1));
      for (const { code, glyph } of codes) {
        map[2 * code] = glyph >> 8;
        map[2 * code + 1] = glyph & 0xff;
      }
      outlines = { kind: 'truetype', cidToGid: map };
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
    return {
      name: program.name,
      program: program.bytes,
      outlines,
      widths,
      toUnicode: cmap,
      // SYMBOLIC (bit 3), which a CID font's descriptor states because its glyphs are reached by code, not by a
      // standard encoding; ITALIC (bit 7) where the face is.
      flags: 4 | (this.source.italic ? 64 : 0),
      box: metrics.box.map(scale),
      italicAngle: metrics.italicAngle,
      ascent: scale(metrics.ascender),
      descent: scale(metrics.descender),
      capHeight: scale(metrics.capHeight),
      stemV: 80,
    };
  }

  /** The font program to embed and its name: a subset where the licence and the subsetter allow, else the whole file. */
  #program(codes: readonly Code[]): { readonly bytes: Uint8Array; readonly name: string } {
    const { bytes, faceIndex, axes, postscript, embedding, shaping } = this.source;
    const base = postscript === '' ? 'Font' : postscript;
    if (this.#cff) {
      // BUILT, each code's glyph at the code (the class header), from the outline at the face's pin: only the glyphs
      // drawn, so it is a subset by construction. A face whose licence forbids embedding is refused here as below.
      if (embedding === 'never') throw new Error(`the face ${base} (index ${String(faceIndex)}) cannot be embedded: its licence forbids it`);
      const scale = 1000 / shaping.unitsPerEm;
      const metrics = shaping.metrics();
      const program = cffProgram(
        [{ advance: 0, steps: [] }, ...codes.map((entry) => ({ advance: entry.width, steps: stepsOfOutline(shaping.outline(entry.glyph), scale) }))],
        { ascender: Math.round(metrics.ascender * scale), descender: Math.round(metrics.descender * scale) },
        base,
      );
      return { bytes: program, name: `${subsetTag(program)}+${base}` };
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

/** pdf-lib's writer of a font's parts, the composers': a reference reserved now, the dictionaries assigned at the end. */
export function pdfLibCidSink(document: PDFDocument): CidFontSink<PDFRef> {
  const { context } = document;
  return {
    reserve: () => context.nextRef(),
    write: (ref, parts) => {
      const { outlines } = parts;
      const cff = outlines.kind === 'cff';
      const descriptor = context.obj({
        Type: 'FontDescriptor',
        FontName: parts.name,
        Flags: parts.flags,
        FontBBox: [...parts.box],
        ItalicAngle: parts.italicAngle,
        Ascent: parts.ascent,
        Descent: parts.descent,
        CapHeight: parts.capHeight,
        StemV: parts.stemV,
        // THE PROGRAM BY ITS OUTLINES (`CidFontParts.outlines`): an OpenType CFF program is `FontFile3 /OpenType`.
        ...(cff
          ? { FontFile3: context.register(context.flateStream(parts.program, { Subtype: 'OpenType' })) }
          : { FontFile2: context.register(context.flateStream(parts.program, { Length1: parts.program.length })) }),
      });
      const descendant = context.obj({
        Type: 'Font',
        Subtype: cff ? 'CIDFontType0' : 'CIDFontType2',
        BaseFont: parts.name,
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: context.register(descriptor),
        W: parts.widths.map((entry) => (typeof entry === 'number' ? entry : [...entry])),
        ...(outlines.kind === 'truetype' ? { CIDToGIDMap: context.register(context.flateStream(outlines.cidToGid)) } : {}),
      });
      context.assign(
        ref,
        context.obj({
          Type: 'Font',
          Subtype: 'Type0',
          BaseFont: parts.name,
          Encoding: 'Identity-H',
          DescendantFonts: [context.register(descendant)],
          ToUnicode: context.register(context.flateStream(new TextEncoder().encode(parts.toUnicode))),
        }),
      );
    },
  };
}

/** A run's codes as one `TJ` string. */
export function codeString(codes: readonly number[]): PDFHexString {
  return PDFHexString.of(codes.map(hex4).join(''));
}

/** A `TJ` adjustment, in thousandths of an em, to a thousandth. */
export function adjustment(thousandthsOfAnEm: number): PDFNumber {
  return PDFNumber.of(Math.round(thousandthsOfAnEm * 1000) / 1000);
}
