import { StandardFontEmbedder, StandardFonts, isStandardFont } from '@cantoo/pdf-lib';

/**
 * pdf-lib's tables for the standard fonts and their encodings, the one module of `pageFonts.ts`' reading that loads
 * pdf-lib (ADR-0176's correction of 2026-10-25). Loaded by `loadStandardFonts` and never imported statically: `pageFonts.ts`
 * is in every MuPDF host's start, and pdf-lib there put about 13 MB in the host's fixed cost, over §9.17's 100 MB base —
 * 104.7 MB on CI at `5ef7b84c` against 91.8 MB at `31f790b4`, and 104 MB in three runs of `roleMupdfHost.mjs
 * --no-document` here, 2026-10-25. The same class `editFaces.ts` records for 2026-10-12.
 */

/** A standard 14 font's name (ISO 32000-1 §9.6.2.2), in the type pdf-lib's embedder takes. */
type StandardName = Parameters<typeof StandardFontEmbedder.for>[0];

/** `name` where it is a standard font's, by pdf-lib's own rule (`isStandardFont`, which its `embedStandardFont` asks). */
function standardName(name: string | null): StandardName | null {
  return name !== null && isStandardFont(name) ? name : null;
}

/** The two standard fonts whose built-in encoding is their own rather than a Latin one. */
const SYMBOLIC = new Set<string>([StandardFonts.Symbol, StandardFonts.ZapfDingbats]);

/** pdf-lib's tables for a standard font, read once a process: parsing one is its metrics file decompressed. */
const embedders = new Map<string, StandardFontEmbedder>();
function embedderFor(name: StandardName): StandardFontEmbedder {
  const held = embedders.get(name);
  if (held !== undefined) return held;
  const made = StandardFontEmbedder.for(name);
  embedders.set(name, made);
  return made;
}

/** A simple font read through its encoding: each code's character, and its width in thousandths where known. */
export interface StandardEncoding {
  readonly text: ReadonlyMap<number, string>;
  readonly width: (code: number) => number | null;
}

/**
 * A simple font with no ToUnicode, read through its encoding (ISO 32000-1 §9.10.2): each code's character and glyph
 * name, from pdf-lib's table for the encoding — the WinAnsi encoding named (`named`), or the built-in encoding of Symbol
 * or ZapfDingbats where none is (`absent`) — and, for a standard font (`base`), the font's own AFM widths. `null` for any
 * other encoding (MacRoman, Standard, `/Differences`), which pdf-lib holds no table for: the stated limit.
 */
export function standardEncoding(named: string | null, absent: boolean, base: string | null): StandardEncoding | null {
  const standard = standardName(base);
  let table: StandardFontEmbedder;
  if (named === 'WinAnsiEncoding') {
    // THE WINANSI TABLE is one for every Latin standard font; a symbolic one's own is not it.
    const latin = standard !== null && !SYMBOLIC.has(standard) ? standard : standardName(StandardFonts.Helvetica);
    if (latin === null) return null;
    table = embedderFor(latin);
  } else if (absent && standard !== null && SYMBOLIC.has(standard)) {
    table = embedderFor(standard);
  } else {
    return null;
  }
  const text = new Map<number, string>();
  const glyphs = new Map<number, string>();
  for (const point of table.encoding.supportedCodePoints) {
    const { code, name } = table.encoding.encodeUnicodeCodePoint(point);
    // THE FIRST CHARACTER A CODE IS READ AS keeps it: a code two characters encode to is one glyph.
    if (text.has(code)) continue;
    text.set(code, String.fromCodePoint(point));
    glyphs.set(code, name);
  }
  // A STANDARD FONT'S WIDTHS from its AFM, in thousandths, where the table it is read through is its own.
  const metrics = standard !== null && table === embedderFor(standard) ? table.font : null;
  return {
    text,
    width: (code) => {
      const glyph = glyphs.get(code);
      const width = metrics === null || glyph === undefined ? undefined : metrics.getWidthOfGlyph(glyph);
      return typeof width === 'number' ? width / 1000 : null;
    },
  };
}
