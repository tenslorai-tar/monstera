import { PDFDocument, PDFHexString, PDFName, type PDFRef } from '@cantoo/pdf-lib';

import { subsetFont, withTables } from './fontSubset.js';
import { wholeFile } from './pdfLibSession.js';
import { ShapingFace } from './textShaping.js';

/**
 * A page set the way a word processor's PDF export sets one (the owner's N14): embedded SUBSET fonts, a bold lead-in, a
 * regular sentence and a superscript citation marker on one line — built here because the owner's document is theirs.
 *
 * ## The subsets are a producer's, not this application's
 *
 * Each font is a Type 0 font with Identity-H encoding over a CIDFontType2 whose program is a TrueType subset with its
 * glyphs RENUMBERED and its `cmap`, `OS/2`, `name` and `post` tables LEFT OUT — the shape fontkit (pdf-lib's subsetter)
 * and Ghostscript write: only the glyph tables a rasteriser needs travel, and which character a glyph is lives in the
 * PDF's ToUnicode and nowhere in the program. The application's own subsets keep a Unicode `cmap` (`namedSubset`), which
 * is why the run fonts proof never met this shape.
 *
 * ## The superscript is a rise, as Word writes one
 *
 * The marker is set at {@link SUPERSCRIPT_SCALE} of the line's size with a text rise (`Ts`) of {@link SUPERSCRIPT_RISE}
 * of it, in its own text object on the same line.
 */

/** The line's three pieces, in reading order. */
export const PRODUCER_LEAD = 'Results.';
export const PRODUCER_BODY = ' The method holds across every sample';
export const PRODUCER_MARK = '12';
export const PRODUCER_END = ' tested.';
/** The line's type size, in points. */
export const PRODUCER_SIZE = 12;
/** The superscript's size as a fraction of the line's, and its rise as a fraction of the line's size. */
export const SUPERSCRIPT_SCALE = 0.58;
export const SUPERSCRIPT_RISE = 0.33;

/** The tables a producer's subset leaves out. */
const LEFT_OUT = ['cmap', 'OS/2', 'name', 'post'] as const;

/** One embedded font: its PDF object and how to write text in it. */
interface ProducerFont {
  readonly ref: PDFRef;
  /** The hex string of glyph ids that sets `text`. */
  readonly show: (text: string) => string;
  /** How far `text` advances at `size` points, by the widths the font states. */
  readonly width: (text: string, size: number) => number;
}

/**
 * A subset of `program` keeping `text`'s glyphs, renumbered, with the producer's tables left out, embedded as a Type 0
 * font named `ABCDEF+<postscript>`.
 */
function embedProducerFont(
  document: PDFDocument,
  program: Uint8Array,
  postscript: string,
  text: string,
  bold: boolean,
  rewritten: { readonly swap: readonly [string, string] | null } | null = null,
): ProducerFont {
  const subset = subsetFont(program, { unicodes: Array.from(text, (character) => character.codePointAt(0) ?? 0) });
  if (subset === null) throw new Error(`HarfBuzz would not subset ${postscript}`);
  const face = new ShapingFace(subset, 0, {});
  const glyphs = new Map<string, number>();
  for (const character of new Set(text)) {
    const glyph = face.glyphFor(character.codePointAt(0) ?? 0);
    if (glyph === undefined || glyph === 0) throw new Error(`${postscript} has no glyph for ${character}`);
    glyphs.set(character, glyph);
  }
  // A PRODUCER THAT REWROTE ITS CODES (`buildRewrittenCodesPdf`): the two characters are drawn with each other's
  // glyphs and the ToUnicode names them as themselves, while the program keeps its own `cmap`, which still names the
  // glyphs by their true characters — so the `cmap` and what the page draws disagree.
  if (rewritten?.swap != null) {
    const [first, second] = rewritten.swap;
    const one = glyphs.get(first);
    const two = glyphs.get(second);
    if (one === undefined || two === undefined) throw new Error(`${postscript} was not subset for ${first} and ${second}`);
    glyphs.set(first, two);
    glyphs.set(second, one);
  }
  const bare = withTables(
    subset,
    new Map(LEFT_OUT.filter((tag) => rewritten === null || tag !== 'cmap').map((tag) => [tag, null])),
  );
  const scale = 1000 / face.unitsPerEm;
  const metrics = face.metrics();
  const context = document.context;
  const name = `ABCDEF+${postscript}`;
  const program2 = context.register(context.flateStream(bare, { Length1: bare.length }));
  const descriptor = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: PDFName.of(name),
      // A SYMBOLIC NONSYMBOLIC FLAG as Word writes it (32), and a declared weight beside the stem width.
      Flags: 32,
      FontBBox: metrics.box.map((value) => Math.round(value * scale)),
      ItalicAngle: 0,
      Ascent: Math.round(metrics.ascender * scale),
      Descent: Math.round(metrics.descender * scale),
      CapHeight: Math.round(metrics.capHeight * scale),
      StemV: bold ? 136 : 80,
      FontWeight: bold ? 700 : 400,
      FontFile2: program2,
    }),
  );
  const widths: (number | number[])[] = [];
  for (const glyph of [...new Set(glyphs.values())].sort((left, right) => left - right)) {
    widths.push(glyph, [Math.round(face.nominalAdvance(glyph) * scale)]);
  }
  const cid = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: PDFName.of(name),
      CIDSystemInfo: { Registry: PDFHexString.fromText('Adobe'), Ordering: PDFHexString.fromText('Identity'), Supplement: 0 },
      FontDescriptor: descriptor,
      CIDToGIDMap: 'Identity',
      W: widths,
    }),
  );
  const entries = [...glyphs].map(([character, glyph]) => `<${hex4(glyph)}> <${hex4(character.codePointAt(0) ?? 0)}>`);
  const toUnicode = context.register(
    context.flateStream(
      new TextEncoder().encode(
        [
          '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
          '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
          '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
          '1 begincodespacerange <0000> <FFFF> endcodespacerange',
          `${String(entries.length)} beginbfchar`,
          ...entries,
          'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
        ].join('\n'),
      ),
    ),
  );
  const ref = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: PDFName.of(name),
      Encoding: 'Identity-H',
      DescendantFonts: [cid],
      ToUnicode: toUnicode,
    }),
  );
  return {
    ref,
    show: (shown) =>
      Array.from(shown, (character) => {
        const glyph = glyphs.get(character);
        if (glyph === undefined) throw new Error(`${postscript} was not subset for ${character}`);
        return hex4(glyph);
      }).join(''),
    width: (shown, size) =>
      Array.from(shown).reduce((total, character) => total + Math.round(face.nominalAdvance(glyphs.get(character) ?? 0) * scale), 0) * (size / 1000),
  };
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * The page: one line, a bold lead-in, a regular sentence, a superscript marker and the sentence's end.
 *
 * @param regular the regular face's program (Carlito-Regular in the cases)
 * @param bold the bold face's program (Carlito-Bold)
 * @param names the two faces' PostScript names, so a page set in another family (a serif's, in the text regression
 *   walk) names its own faces rather than Carlito's
 */
export async function buildProducerSubsetPdf(
  regular: Uint8Array,
  bold: Uint8Array,
  names: { readonly regular: string; readonly bold: string } = { regular: 'Carlito', bold: 'Carlito-Bold' },
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const lead = embedProducerFont(document, bold, names.bold, PRODUCER_LEAD, true);
  const body = embedProducerFont(document, regular, names.regular, `${PRODUCER_BODY}${PRODUCER_MARK}${PRODUCER_END}`, false);
  page.node.setFontDictionary(PDFName.of('F1'), lead.ref);
  page.node.setFontDictionary(PDFName.of('F2'), body.ref);
  const size = PRODUCER_SIZE;
  const mark = size * SUPERSCRIPT_SCALE;
  // FOUR TEXT OBJECTS ON ONE LINE, each starting where the last ends by the widths its own font states, as a producer
  // that writes a run per style does; the superscript raised by `Ts`.
  const x0 = 72;
  const x1 = x0 + lead.width(PRODUCER_LEAD, size);
  const x2 = x1 + body.width(PRODUCER_BODY, size);
  const x3 = x2 + body.width(PRODUCER_MARK, mark);
  const at = (x: number): string => `${x.toFixed(2)} 700 Td`;
  const content = [
    ...['BT', `/F1 ${String(size)} Tf`, at(x0), `<${lead.show(PRODUCER_LEAD)}> Tj`, 'ET'],
    ...['BT', `/F2 ${String(size)} Tf`, at(x1), `<${body.show(PRODUCER_BODY)}> Tj`, 'ET'],
    ...['BT', `/F2 ${mark.toFixed(2)} Tf`, `${(size * SUPERSCRIPT_RISE).toFixed(2)} Ts`, at(x2), `<${body.show(PRODUCER_MARK)}> Tj`, 'ET'],
    // THE RISE IS GRAPHICS STATE and outlives `ET`, so the sentence's end sets it back to the line, as a producer does.
    ...['BT', `/F2 ${String(size)} Tf`, '0 Ts', at(x3), `<${body.show(PRODUCER_END)}> Tj`, 'ET'],
  ].join('\n');
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream(new TextEncoder().encode(content))));
  return wholeFile(document, { useObjectStreams: false });
}

/**
 * A page whose embedded subset KEEPS its `cmap` and draws `swap`'s two characters with each other's glyphs, its
 * ToUnicode naming each as itself: a producer that rewrote its codes (SSSSSSS-14). `runFont.ts`' decision is the
 * comparison of the `cmap`'s glyph with what PDFium draws, which a subset with no `cmap` never reaches. One line of
 * `text`, 12 points, at 72, 700.
 *
 * @param program the face's program (Carlito-Regular in the cases)
 * @param swap two characters `text` holds
 */
export async function buildRewrittenCodesPdf(program: Uint8Array, text: string, swap: readonly [string, string] | null): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = embedProducerFont(document, program, 'Carlito', text, false, { swap });
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  const content = ['BT', '/F1 12 Tf', '72 700 Td', `<${font.show(text)}> Tj`, 'ET'].join('\n');
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream(new TextEncoder().encode(content))));
  return wholeFile(document, { useObjectStreams: false });
}

/** How far a word gap moves the pen on a {@link buildGapSpacedPdf} page, in thousandths of the size: a quarter em. */
export const GAP_SPACING = 250;

/**
 * A page whose producer's subset has NO SPACE GLYPH: every word gap is a `TJ` offset of {@link GAP_SPACING}, as pdfTeX
 * and some print drivers set a line (the owner's A2a, 2026-10-14). One text object per line, 11 points, a line pitch of
 * 14, at x 72 from y 300 down.
 *
 * @param program the face's program (Carlito-Regular in the cases)
 * @param lines the page's lines; their spaces are the gaps
 */
export async function buildGapSpacedPdf(program: Uint8Array, lines: readonly string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([500, 400]);
  const font = embedProducerFont(document, program, 'Carlito', lines.join('').replaceAll(' ', ''), false);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  const content = lines
    .flatMap((line, at) => [
      'BT',
      '/F1 11 Tf',
      `72 ${String(300 - at * 14)} Td`,
      `[${line
        .split(' ')
        .map((word) => `<${font.show(word)}>`)
        .join(` -${String(GAP_SPACING)} `)}] TJ`,
      'ET',
    ])
    .join('\n');
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream(new TextEncoder().encode(content))));
  return wholeFile(document, { useObjectStreams: false });
}
