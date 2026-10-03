/**
 * Whether a run's face is bold and italic, decided from the most authoritative witness the page offers.
 *
 * ## Three witnesses, in the order they can be trusted
 *
 * 1. **The embedded font program's own `OS/2` table**: its weight class and its italic and oblique bits. It is the
 *    font's statement about itself, and the only one a producer cannot get wrong by writing a descriptor.
 * 2. **The PDF's font descriptor**, as PDFium answers it: the italic and force-bold flags, and a weight. That weight
 *    is `/FontWeight` where the descriptor has one and an ESTIMATE from `/StemV` where it does not — measured
 *    2026-10-03 on PDFium 155.0.8044.0 with hand-made descriptors: `/FontWeight 700` with `/StemV 83` answers 700,
 *    `/FontWeight 400` with `/StemV 156` answers 400, and no `/FontWeight` with `/StemV 94` answers 470. The owner's
 *    document read 415, 764 and 470 (83 × 5, 156 × 4 + 140, 94 × 5), so its descriptors stated no weight, and a
 *    Roboto-Bold whose stems estimate 415 is bold all the same — which is why the program, where there is one, comes
 *    first.
 * 3. **The base name**, last: `Helvetica-Bold` says it in its name and nowhere else. Measured the same day, the
 *    standard fonts — Helvetica, Helvetica-Bold, Helvetica-Oblique, Times-BoldItalic — all answer weight 0 and flags
 *    32: no descriptor speaks for them, so the name is the only witness there is, and it is read ONLY then.
 *
 * Reading the name beside a descriptor that answers made a name the deciding witness wherever it said more than the
 * descriptor did, which is the owner's finding on 2026-10-02.
 */

/** What the embedded program says about itself: `OS/2`'s weight class and whether it is italic or oblique. */
export interface ProgramFace {
  readonly weightClass: number;
  readonly italic: boolean;
}

/** What a run's font offers to decide its face from. */
export interface FontFacts {
  /** The embedded program's own statement, or `undefined` where the font is not embedded or carries no `OS/2`. */
  readonly program: ProgramFace | undefined;
  /** PDFium's weight: `/FontWeight`, else estimated from `/StemV`; 0 where the font has no descriptor to read. */
  readonly weight: number;
  /** The descriptor's flags, or `undefined` where PDFium could not read them. */
  readonly flags: number | undefined;
  /** The base font name, as PDFium answers it. */
  readonly name: string;
}

/** ISO 32000 §9.8.2: bit 7 italic, bit 19 force bold. */
const ITALIC_FLAG = 64;
const FORCE_BOLD_FLAG = 262_144;
/** The weight a face is bold from: 600, semibold, the first weight a type designer calls bold. */
const BOLD_WEIGHT = 600;

/**
 * Bold and italic, from the first witness that speaks.
 *
 * @param facts what the font offers
 */
export function faceOf(facts: FontFacts): { readonly bold: boolean; readonly italic: boolean } {
  if (facts.program !== undefined) {
    return { bold: facts.program.weightClass >= BOLD_WEIGHT, italic: facts.program.italic };
  }
  const flags = facts.flags ?? 0;
  // A DESCRIPTOR SPEAKS when PDFium has a weight from it: every standard font measured answers 0.
  if (facts.weight > 0) {
    return {
      bold: facts.weight >= BOLD_WEIGHT || (flags & FORCE_BOLD_FLAG) !== 0,
      italic: (flags & ITALIC_FLAG) !== 0,
    };
  }
  return {
    bold: (flags & FORCE_BOLD_FLAG) !== 0 || /bold|black|heavy/iu.test(facts.name),
    italic: (flags & ITALIC_FLAG) !== 0 || /italic|oblique/iu.test(facts.name),
  };
}

/** The `sfnt` versions a TrueType or OpenType program begins with: 1.0, Apple's `true`, and CFF-flavoured `OTTO`. */
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);
/** `OS/2`, as the table directory spells the tag. */
const OS2_TAG = 0x4f532f32;
/** `fsSelection`'s bits: 0 italic, 9 oblique. */
const SELECTION_ITALIC = 1;
const SELECTION_OBLIQUE = 512;

/**
 * The face an embedded TrueType or OpenType program states in its `OS/2` table, or `undefined` where the bytes are
 * not such a program or carry no readable `OS/2` — a Type 1 or bare CFF program, a collection, or a truncated table.
 *
 * Reads the table directory and two fields, `usWeightClass` (offset 4) and `fsSelection` (offset 62), bounds-checked
 * against the bytes given, so a malformed program answers `undefined` rather than a weight read from somewhere else.
 *
 * @param bytes the font program, as `FPDFFont_GetFontData` answers it for an embedded font
 */
export function programFace(bytes: Uint8Array): ProgramFace | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!SFNT_VERSIONS.has(view.getUint32(0))) return undefined;
  const tables = view.getUint16(4);
  for (let at = 0; at < tables; at += 1) {
    const record = 12 + at * 16;
    if (record + 16 > bytes.length) return undefined;
    if (view.getUint32(record) !== OS2_TAG) continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (length < 64 || offset + 64 > bytes.length) return undefined;
    const selection = view.getUint16(offset + 62);
    return {
      weightClass: view.getUint16(offset + 4),
      italic: (selection & (SELECTION_ITALIC | SELECTION_OBLIQUE)) !== 0,
    };
  }
  return undefined;
}
