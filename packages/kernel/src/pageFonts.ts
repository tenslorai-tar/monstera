import { glyphProcedureContours } from './drawnWeight.js';
import { Font, type PDFObject } from './mupdfRaw.js';
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
 * `/W` and `/DW`. A standard font written with no `/Widths` is measured by its AFM widths, which ISO 32000-1 §9.6.2.2
 * gives every reader, from pdf-lib's tables; any other font that states none answers `null`, and the writer sets the word
 * in another face rather than guess an advance that would move every glyph after it.
 *
 * ## A font the file does not carry, with no ToUnicode, is read through its encoding where pdf-lib holds its table
 *
 * ISO 32000-1 §9.10.2: the WinAnsi encoding, or Symbol's and ZapfDingbats' own (ADR-0176's correction of 2026-10-25). An
 * embedded Type 1 or CFF program with no ToUnicode is read through the same encoding, each code asked of the program
 * ({@link namedGlyphs}). An embedded TrueType program, or any font in another encoding, with no ToUnicode has no known
 * characters, as before.
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
  /**
   * A font whose letters are DRAWN (`/Type3`): its glyph for `code` as filled contours, in text space at a size of 1,
   * from its glyph procedure's paths; `null` where that glyph draws a picture or a stroke (ADR-0176's corrections of
   * 2026-10-26, which measure a new word's weight from it). Absent for a font with a program, whose weight is its program's.
   */
  readonly outline?: (code: number) => readonly (readonly (readonly [number, number])[])[] | null;
  /**
   * The codes whose text in `toUnicode` is PDFium's READING of the page and not the font's own statement
   * (`pageFontsAsRead`, ADR-0270): a glyph the font names nothing for, which another reader is free to name otherwise.
   * Absent where none were learned.
   */
  readonly readByPdfium?: ReadonlySet<number>;
  /**
   * Present where a simple font states no widths, carries no program MuPDF can load, and is not a standard font, whose AFM
   * would give them:
   * its widths are the closest normal font's (the owner's answer of 2026-11-01, ADR-0270's addition of that date), which
   * only the writer's faces can say, by each code's character in {@link toUnicode}. `width` answers `null` here until
   * the writer gives it those (`OperatorFaceSet.withClosestWidths`).
   */
  readonly widthsUnstated?: true;
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

/**
 * pdf-lib's standard-font tables, as `loadStandardFonts` answers them: what a font the file does not carry is read
 * through. A required argument of {@link pageFonts}, so a caller cannot read a page's fonts without having loaded them,
 * and the module is never in a host's start (`standardFontTables.ts` says what that cost).
 */
export type StandardFontTables = typeof import('./standardFontTables.js');

let standardTables: StandardFontTables | null = null;

/** The standard-font tables, loaded on the first read of a page's fonts and kept for the process. */
export async function loadStandardFonts(): Promise<StandardFontTables> {
  standardTables ??= await import('./standardFontTables.js');
  return standardTables;
}

/**
 * A simple font with no ToUnicode, read through its encoding (ISO 32000-1 §9.10.2, ADR-0176's correction of 2026-10-25):
 * the encoding object read here, its table and the standard font's widths from `standard`.
 */
function encodedAs(
  font: PDFObject,
  base: string | null,
  standard: StandardFontTables,
): { readonly toUnicode: ToUnicode; readonly width: (code: number) => number | null; readonly measured: boolean } | null {
  const encoding = resolved(font.get('Encoding'));
  const differences = encoding.isDictionary() ? resolved(encoding.get('Differences')) : null;
  const named = encoding.isName() ? encoding.asName() : encoding.isDictionary() && differences?.isNull() === true ? nameOf(encoding.get('BaseEncoding')) : null;
  const table = standard.standardEncoding(named, encoding.isNull(), base);
  return table === null ? null : { toUnicode: { text: table.text, bytes: 1 }, width: table.width, measured: table.measured };
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

/** A font program as MuPDF loads it, or `undefined` where it cannot. */
function loadedProgram(stream: PDFObject): Font | undefined {
  try {
    return new Font('embedded', bufferBytes(stream.readStream()));
  } catch {
    return undefined;
  }
}

/**
 * WHICH OF ITS ENCODING'S CODES AN EMBEDDED TYPE 1 OR CFF PROGRAM CAN DRAW, for a simple font with no ToUnicode. Such a
 * program names its glyphs, and a subset holds exactly the ones its producer kept, so asking it for a character's glyph
 * says whether the code draws. A TrueType subset is not asked: it keeps a glyph's number with nothing in it, so the same
 * lookup answers yes for a letter that draws nothing (ADR-0176's narrowing, documents 6 and 8, 0 pixels changed).
 * `undefined` where there is no such program, or MuPDF cannot load it.
 */
function namedGlyphs(descriptor: PDFObject, characterOf: (code: number) => string | undefined): ((code: number) => boolean) | undefined {
  const type1 = descriptor.get('FontFile');
  const compact = descriptor.get('FontFile3');
  const compactSubtype = compact.isNull() ? null : nameOf(resolved(compact).get('Subtype'));
  const stream = !type1.isNull() ? type1 : compactSubtype === 'Type1C' ? compact : null;
  if (stream === null) return undefined;
  const font = loadedProgram(stream);
  if (font === undefined) return undefined;
  return (code) => {
    const point = characterOf(code)?.codePointAt(0);
    return point !== undefined && font.encodeCharacter(point) > 0;
  };
}

/**
 * AN EMBEDDED PROGRAM'S OWN ADVANCES, for a simple font that states no `/Widths` (ADR-0270's addition of 2026-11-01): the
 * glyph each code's character names in the program, by MuPDF's own lookup (`encodeCharacter`), and that glyph's advance
 * (`advanceGlyph`), in ems, which is text space at a size of 1. The program is what draws the letters, so its advances
 * are where they stand. `null` for a code whose character is unknown or that the program has no glyph for; `undefined`
 * where there is no program MuPDF can load.
 */
function programWidths(descriptor: PDFObject, characterOf: (code: number) => string | undefined): ((code: number) => number | null) | undefined {
  const stream = ['FontFile2', 'FontFile', 'FontFile3'].map((key) => descriptor.get(key)).find((each) => !each.isNull());
  if (stream === undefined) return undefined;
  // A PROGRAM MUPDF CANNOT LOAD is one it draws in a substitute, so its letters stand by no advance of the program's:
  // `undefined` sends the font to the closest normal font's widths, as one not embedded is.
  const font = loadedProgram(stream);
  if (font === undefined) return undefined;
  const advances = new Map<number, number | null>();
  return (code) => {
    if (advances.has(code)) return advances.get(code) ?? null;
    const character = characterOf(code);
    const point = character === undefined ? undefined : character.codePointAt(0);
    const glyph = point === undefined ? 0 : font.encodeCharacter(point);
    const advance = glyph > 0 ? font.advanceGlyph(glyph) : null;
    advances.set(code, advance);
    return advance;
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

/** A Type 3 font's codes that name a glyph its `/CharProcs` holds, by its `/Encoding /Differences`, with each glyph's name. */
function type3Glyphs(font: PDFObject): ReadonlyMap<number, string> {
  const procs = resolved(font.get('CharProcs'));
  const encoding = resolved(font.get('Encoding'));
  const differences = encoding.isDictionary() ? resolved(encoding.get('Differences')) : encoding;
  const drawn = new Map<number, string>();
  if (!differences.isArray() || !procs.isDictionary()) return drawn;
  let code = 0;
  for (let at = 0; at < differences.length; at += 1) {
    const item = resolved(differences.get(at));
    if (item.isNumber()) {
      code = item.asNumber();
      continue;
    }
    if (item.isName() && !procs.get(item.asName()).isNull()) drawn.set(code, item.asName());
    code += 1;
  }
  return drawn;
}

/**
 * A Type 3 font's drawn glyphs as outlines (ADR-0176's corrections of 2026-10-26): each glyph procedure's filled contours
 * through the font's matrix, in text space at a size of 1. Read on first asking and kept, since a font is measured once.
 */
function type3Outlines(font: PDFObject, glyphs: ReadonlyMap<number, string>, matrix: readonly number[]): NonNullable<PageFont['outline']> {
  const procs = resolved(font.get('CharProcs'));
  const [a = 0.001, b = 0, c = 0, d = 0.001] = matrix;
  const known = new Map<number, ReturnType<NonNullable<PageFont['outline']>>>();
  return (code) => {
    const kept = known.get(code);
    if (kept !== undefined || known.has(code)) return kept ?? null;
    const name = glyphs.get(code);
    // ASKED OF THE REFERENCE, `toUnicodeOf`'s reason: an indirect stream's `resolve()` answers its dictionary.
    const procedure = name === undefined || !procs.isDictionary() ? null : procs.get(name);
    const contours = procedure === null || procedure.isNull() || !procedure.isStream() ? null : glyphProcedureContours(bufferBytes(procedure.readStream()));
    const mapped = contours === null ? null : contours.map((contour) => contour.map(([x, y]) => [x * a + y * c, x * b + y * d] as const));
    known.set(code, mapped);
    return mapped;
  };
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
function read(resource: string, font: PDFObject, standard: StandardFontTables): PageFont {
  const subtype = nameOf(font.get('Subtype')) ?? '';
  const descendants = resolved(font.get('DescendantFonts'));
  const descendant = subtype === 'Type0' && descendants.isArray() ? resolved(descendants.get(0)) : null;
  const descriptor = resolved((descendant ?? font).get('FontDescriptor'));
  const named = descriptor.isDictionary() ? nameOf(descriptor.get('FontName')) : null;
  const face = named ?? nameOf(font.get('BaseFont'));
  const weightObject = descriptor.isDictionary() ? resolved(descriptor.get('FontWeight')) : null;
  let width: PageFont['width'];
  let draws: PageFont['draws'];
  let outline: PageFont['outline'];
  if (subtype === 'Type3') {
    const matrix = numbers(font.get('FontMatrix')) ?? [0.001];
    width = simpleWidths(font, matrix[0] ?? 0.001);
    const glyphs = type3Glyphs(font);
    draws = (code) => glyphs.has(code);
    outline = type3Outlines(font, glyphs, matrix);
  } else if (descendant !== null) {
    width = cidWidths(descendant);
    draws = () => true;
  } else {
    width = simpleWidths(font, 0.001);
    draws = () => true;
  }
  // A SIMPLE FONT THE FILE DOES NOT CARRY, with no ToUnicode, is read through its encoding, and a standard one with no
  // `/Widths` measured by its AFM. An embedded program may be a subset holding only the glyphs its producer used, so its
  // encoding promises no glyph: measured in the owner's documents 6 and 8, words written so drew nothing.
  const own = toUnicodeOf(font);
  const carried = descriptor.isDictionary() && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => !descriptor.get(key).isNull());
  const simple = subtype !== 'Type3' && descendant === null;
  const encoded = own === null && !carried && simple ? encodedAs(font, nameOf(font.get('BaseFont')), standard) : null;
  if (encoded !== null) {
    const stated = width;
    width = (code) => stated(code) ?? encoded.width(code);
  }
  // A SIMPLE FONT THAT STATES NO WIDTHS AT ALL (ADR-0270's addition of 2026-11-01): an embedded one is measured by its
  // own program, its codes read as characters through its ToUnicode or else its encoding; one that is not embedded and
  // not standard takes the closest normal font's, which the writer's faces give it. A program MuPDF cannot load is drawn
  // in a substitute, as a font not embedded is, so it takes that same rule.
  const unstated = simple && numbers(font.get('Widths')) === null;
  let fromProgram: ((code: number) => number | null) | undefined;
  if (unstated && carried) {
    const characters = own ?? encodedAs(font, nameOf(font.get('BaseFont')), standard)?.toUnicode ?? null;
    fromProgram = programWidths(descriptor, (code) => characters?.text.get(code));
    if (fromProgram !== undefined) width = fromProgram;
  }
  const closest = unstated && fromProgram === undefined && encoded?.measured !== true;
  // AN EMBEDDED TYPE 1 OR CFF SUBSET WITH NO TOUNICODE: its encoding says each code's character and its program says
  // which it holds, so its own letters stay in it. Without this the page's Helvetica was no font at all to the writer,
  // and every line an edit touched was set in another face (the owner's video of 2026-11-05, measured on that page).
  let readThrough: ToUnicode | null = null;
  if (own === null && carried && simple && descriptor.isDictionary()) {
    const through = encodedAs(font, nameOf(font.get('BaseFont')), standard);
    const holds = through === null ? undefined : namedGlyphs(descriptor, (code) => through.toUnicode.text.get(code));
    if (through !== null && holds !== undefined) {
      readThrough = through.toUnicode;
      draws = holds;
    }
  }
  return {
    resource,
    subtype,
    toUnicode: own ?? encoded?.toUnicode ?? readThrough,
    codeBytes: subtype === 'Type0' ? 2 : 1,
    width,
    draws,
    face: face === null ? null : withoutSubsetTag(face),
    weight: weightObject?.isNumber() === true ? weightObject.asNumber() : null,
    ...(outline === undefined ? {} : { outline }),
    ...(closest ? { widthsUnstated: true as const } : {}),
  };
}

/**
 * Every font resource the page's own content can name: its `/Resources /Font`, inherited where the page has none.
 *
 * @param standard the standard-font tables (`loadStandardFonts`), which a font the file does not carry is read through
 */
export function pageFonts(leaf: PDFObject, standard: StandardFontTables): ReadonlyMap<string, PageFont> {
  const fonts = new Map<string, PageFont>();
  const resources = resolved(leaf.getInheritable('Resources'));
  if (!resources.isDictionary()) return fonts;
  const dictionary = resolved(resources.get('Font'));
  if (!dictionary.isDictionary()) return fonts;
  // EACH FONT OBJECT READ ONCE, whatever number of names the page gives it: a page pdf-lib wrote names its font afresh
  // for every line drawn, and the text walk's dense page (L6) named one Helvetica 39,201 times, each read again — its
  // encoding, widths and ToUnicode — which was 5.1 of a heading edit's 14.7 seconds (measured 2026-10-27, the operator
  // writer's write alone on that page in Node on Linux, commit ffb388f1). A name is still its own entry, read from the
  // same object.
  const once = new Map<number, PageFont>();
  dictionary.forEach((value, key) => {
    if (typeof key !== 'string') return;
    const number = value.isIndirect() ? value.asIndirect() : undefined;
    const known = number === undefined ? undefined : once.get(number);
    if (known !== undefined) {
      fonts.set(key, { ...known, resource: key });
      return;
    }
    const font = read(key, resolved(value), standard);
    if (number !== undefined) once.set(number, font);
    fonts.set(key, font);
  });
  return fonts;
}
