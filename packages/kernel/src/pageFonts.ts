import type { PDFObject } from './mupdfRaw.js';
import { bufferBytes } from './mupdfWriter.js';
import { withoutSubsetTag } from './subsetName.js';
import { type ToUnicode, readToUnicode } from './toUnicode.js';

/**
 * A page's fonts as ADR-0176's writer needs them, read from the page's resources through MuPDF
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)
 * Decisions 1 and 5): which kind each is, which characters it draws and by which codes, how far each code advances, and
 * which face it is, so a word can stay in the run's own font or a sibling's.
 *
 * ## Widths are the font's OWN, and a font without them says so
 *
 * A simple font's `/Widths` and `/FirstChar`, a Type 3 font's scaled by its `/FontMatrix`, a Type0 font's descendant
 * `/W` and `/DW`. A standard font written with no `/Widths` has its widths in the reader's built-in metrics, which this
 * module does not hold: `width` answers `null` for it, and the writer refuses an edit that needs an advance it cannot
 * know rather than guess one and move every glyph after it.
 */

/** One font resource of a page. */
export interface PageFont {
  /** Its name in the page's `/Font` resources, without the slash. */
  readonly resource: string;
  /** `Type3`, `Type1`, `TrueType`, `Type0`, `MMType1`, or empty where it names none. */
  readonly subtype: string;
  /** Its ToUnicode, or `null` where it has none or one that does not read. */
  readonly toUnicode: ToUnicode | null;
  /** How many bytes one of its codes is: 2 for a Type0 font, 1 for every other. */
  readonly codeBytes: 1 | 2;
  /**
   * How far `code` advances, in text space units at a font size of 1, before character and word spacing: the font's
   * own widths, or `null` where it states none for that code.
   */
  readonly width: (code: number) => number | null;
  /** Whether it has a glyph for `code`: a Type 3 font's `/CharProcs` holds the glyph its encoding names. */
  readonly draws: (code: number) => boolean;
  /** Which face it is: its descriptor's (or base) font name with any subset tag removed, `null` where it names none. */
  readonly face: string | null;
  /** Its descriptor's weight, `null` where none is stated. */
  readonly weight: number | null;
}

/**
 * `object` resolved, or the null object where it is null. MuPDF's null object answers every `is…` question with no and
 * cannot be resolved, so a field a dictionary lacks is read through this rather than resolved directly.
 */
function resolved(object: PDFObject): PDFObject {
  return object.isNull() ? object : object.resolve();
}

/** The numbers of an array object, `null` where it is not one. */
function numbers(object: PDFObject): number[] | null {
  const array = resolved(object);
  if (!array.isArray()) return null;
  return Array.from({ length: array.length }, (_, at) => resolved(array.get(at)).asNumber());
}

/** The name an object is, or `null`. */
function nameOf(object: PDFObject): string | null {
  const value = resolved(object);
  return value.isName() ? value.asName() : null;
}

/** A simple font's widths: `/FirstChar` and `/Widths`, each scaled by `scale`. */
function simpleWidths(font: PDFObject, scale: number): (code: number) => number | null {
  const widths = numbers(font.get('Widths'));
  const first = resolved(font.get('FirstChar')).asNumber();
  if (widths === null) return () => null;
  return (code) => {
    const width = widths[code - first];
    return width === undefined ? null : width * scale;
  };
}

/** A CIDFont's widths, `/W` and `/DW`, in thousandths: §9.7.4.3's two forms of `/W`. */
function cidWidths(descendant: PDFObject): (code: number) => number | null {
  const fallback = resolved(descendant.get('DW'));
  const standard = fallback.isNumber() ? fallback.asNumber() : 1000;
  const widths = new Map<number, number>();
  const list = resolved(descendant.get('W'));
  if (list.isArray()) {
    let at = 0;
    while (at < list.length) {
      const first = resolved(list.get(at)).asNumber();
      const next = resolved(list.get(at + 1));
      if (next.isArray()) {
        for (let step = 0; step < next.length; step += 1) widths.set(first + step, resolved(next.get(step)).asNumber());
        at += 2;
      } else {
        const last = next.asNumber();
        const width = resolved(list.get(at + 2)).asNumber();
        for (let code = first; code <= last && code - first < 0x10000; code += 1) widths.set(code, width);
        at += 3;
      }
    }
  }
  return (code) => (widths.get(code) ?? standard) / 1000;
}

/** A Type 3 font's codes that name a glyph its `/CharProcs` holds, by its `/Encoding /Differences`. */
function type3Glyphs(font: PDFObject): ReadonlySet<number> {
  const procs = resolved(font.get('CharProcs'));
  const encoding = resolved(font.get('Encoding'));
  const differences = encoding.isDictionary() ? resolved(encoding.get('Differences')) : encoding;
  const drawn = new Set<number>();
  if (!differences.isArray() || !procs.isDictionary()) return drawn;
  let code = 0;
  for (let at = 0; at < differences.length; at += 1) {
    const item = resolved(differences.get(at));
    if (item.isNumber()) {
      code = item.asNumber();
      continue;
    }
    if (item.isName() && !procs.get(item.asName()).isNull()) drawn.add(code);
    code += 1;
  }
  return drawn;
}

/**
 * The font's ToUnicode, or `null`. A ToUnicode that does not read is a font with no known characters: the writer keeps
 * no word in it and sets the word in the next face, as it does for a font with no ToUnicode at all, so nothing is drawn
 * wrongly and `readToUnicode` answers that as a result rather than a throw.
 */
function toUnicodeOf(font: PDFObject): ToUnicode | null {
  const reference = font.get('ToUnicode');
  // ASKED OF THE REFERENCE: measured 2026-10-06, an indirect stream's `resolve()` answers its dictionary, which says it
  // is no stream, as `pageContent.ts` records for `readStream`.
  if (reference.isNull() || !reference.isStream()) return null;
  const read = readToUnicode(bufferBytes(reference.readStream()));
  return read.ok ? read.value : null;
}

/** One font resource, read. */
function read(resource: string, font: PDFObject): PageFont {
  const subtype = nameOf(font.get('Subtype')) ?? '';
  const descendants = resolved(font.get('DescendantFonts'));
  const descendant = subtype === 'Type0' && descendants.isArray() ? resolved(descendants.get(0)) : null;
  const descriptor = resolved((descendant ?? font).get('FontDescriptor'));
  const named = descriptor.isDictionary() ? nameOf(descriptor.get('FontName')) : null;
  const face = named ?? nameOf(font.get('BaseFont'));
  const weightObject = descriptor.isDictionary() ? resolved(descriptor.get('FontWeight')) : null;
  let width: PageFont['width'];
  let draws: PageFont['draws'];
  if (subtype === 'Type3') {
    const matrix = numbers(font.get('FontMatrix')) ?? [0.001];
    width = simpleWidths(font, matrix[0] ?? 0.001);
    const glyphs = type3Glyphs(font);
    draws = (code) => glyphs.has(code);
  } else if (descendant !== null) {
    width = cidWidths(descendant);
    draws = () => true;
  } else {
    width = simpleWidths(font, 0.001);
    draws = () => true;
  }
  return {
    resource,
    subtype,
    toUnicode: toUnicodeOf(font),
    codeBytes: subtype === 'Type0' ? 2 : 1,
    width,
    draws,
    face: face === null ? null : withoutSubsetTag(face),
    weight: weightObject?.isNumber() === true ? weightObject.asNumber() : null,
  };
}

/** Every font resource the page's own content can name: its `/Resources /Font`, inherited where the page has none. */
export function pageFonts(leaf: PDFObject): ReadonlyMap<string, PageFont> {
  const fonts = new Map<string, PageFont>();
  const resources = resolved(leaf.getInheritable('Resources'));
  if (!resources.isDictionary()) return fonts;
  const dictionary = resolved(resources.get('Font'));
  if (!dictionary.isDictionary()) return fonts;
  dictionary.forEach((value, key) => {
    if (typeof key === 'string') fonts.set(key, read(key, resolved(value)));
  });
  return fonts;
}
