import { sfntTable } from './sfntTables.js';

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

/** `ttcf`, a collection's header, which an embedded program never is. */
const COLLECTION_TAG = 0x74746366;
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
  // A COLLECTION IS NOT AN EMBEDDED PROGRAM: only a plain face's directory is read, as before the one reader took it.
  if (bytes.length < 12 || new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) === COLLECTION_TAG) return undefined;
  if (isType1(bytes)) return type1Face(bytes);
  if (bytes[0] === 1 && bytes[1] === 0) return cffFace(bytes);
  const os2 = sfntTable(bytes, 0, 'OS/2');
  if (os2 === undefined || os2.length < 64) return macStyleFace(bytes);
  const view = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
  const selection = view.getUint16(62);
  return {
    weightClass: view.getUint16(4),
    italic: (selection & (SELECTION_ITALIC | SELECTION_OBLIQUE)) !== 0,
  };
}

/*
 * ## Where a program has no OS/2 (the owner's A1, 2026-10-14)
 *
 * A producer's TrueType subset leaves `OS/2` out, and a Type 1 or bare CFF program never had one; each was answered
 * `undefined`, and the descriptor decided — whose weight, where it states none, PDFium ESTIMATES from `/StemV`. A
 * LibreOffice export's `LiberationSerif-Bold` subset (`/StemV 80`, no `/FontWeight`) read as regular, and a serif page's
 * bold lead-ins were drawn plain while edited. Each program states its face in its own place, and that is read:
 *
 * - TrueType: `head.macStyle`, bit 0 bold and bit 1 italic — read only where a bit is SET, since a font that leaves
 *   both clear may be either and the descriptor is the better witness then;
 * - Type 1: its clear text's `/Weight` string and `/ItalicAngle` (Adobe Type 1 Font Format, 2.3);
 * - bare CFF: its Top DICT's `Weight` and `ItalicAngle` (Adobe TN 5176, Table 9).
 */

/** A weight name as Type 1 and CFF state one, as the `usWeightClass` it stands for. */
function weightOfName(name: string): number | undefined {
  const plain = name.toLowerCase().replace(/[^a-z]/gu, '');
  if (plain === '') return undefined;
  const table: readonly (readonly [RegExp, number])[] = [
    [/^(thin|hairline)/u, 100],
    [/^(extra|ultra)light/u, 200],
    [/^light/u, 300],
    [/^(semi|demi)bold|^demi/u, 600],
    [/^(extra|ultra)bold|^heavy/u, 800],
    [/^black/u, 900],
    [/^bold/u, 700],
    [/^medium/u, 500],
    [/^(regular|normal|book|roman|plain)/u, 400],
  ];
  return table.find(([pattern]) => pattern.test(plain))?.[1];
}

/** Whether `bytes` is a Type 1 program, as text (`%!`) or in PFB segments (`0x80 0x01`, then `%!`). */
function isType1(bytes: Uint8Array): boolean {
  const at = bytes[0] === 0x80 && bytes[1] === 0x01 ? 6 : 0;
  return bytes[at] === 0x25 && bytes[at + 1] === 0x21;
}

/** A Type 1 program's face, from the `/Weight` and `/ItalicAngle` its clear text states; `undefined` without a weight. */
function type1Face(bytes: Uint8Array): ProgramFace | undefined {
  // THE CLEAR TEXT ENDS AT `eexec`; the font info is before it, so the first 64 KB is more than is ever needed.
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 65_536)));
  const clear = text.slice(0, text.includes('eexec') ? text.indexOf('eexec') : text.length);
  const weight = weightOfName(/\/Weight\s*\(([^)]*)\)/u.exec(clear)?.[1] ?? '');
  if (weight === undefined) return undefined;
  const angle = Number(/\/ItalicAngle\s+(-?[\d.]+)/u.exec(clear)?.[1] ?? '0');
  const name = /\/FontName\s*\/(\S+)/u.exec(clear)?.[1] ?? '';
  return { weightClass: weight, italic: (Number.isFinite(angle) && angle !== 0) || SLANTED.test(name) };
}

/**
 * A slant in a program's OWN font name, where it states no angle: measured 2026-10-14, pdf.js' Foxit fixed-pitch italic
 * CFF has no `ItalicAngle` in its Top DICT and is named `ChromFixedOTF-Italic`.
 */
const SLANTED = /italic|oblique/iu;

/** A TrueType program's face from `head.macStyle`, where it sets the bold or italic bit; `undefined` where it sets neither. */
function macStyleFace(bytes: Uint8Array): ProgramFace | undefined {
  const head = sfntTable(bytes, 0, 'head');
  if (head === undefined || head.length < 46) return undefined;
  const style = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(44);
  if ((style & 3) === 0) return undefined;
  return { weightClass: (style & 1) !== 0 ? 700 : 400, italic: (style & 2) !== 0 };
}

/** CFF's standard strings from 383, the weights among them (TN 5176, Appendix A). */
const CFF_WEIGHT_STRINGS: Readonly<Record<number, string>> = {
  383: 'Black',
  384: 'Bold',
  385: 'Book',
  386: 'Light',
  387: 'Medium',
  388: 'Regular',
  389: 'Roman',
  390: 'Semibold',
};

/** A bare CFF program's face, from its Top DICT's `Weight` and `ItalicAngle`; `undefined` where it states no weight. */
function cffFace(bytes: Uint8Array): ProgramFace | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** An INDEX at `at`: its entries' bounds, and where it ends. */
  const index = (at: number): { readonly items: [number, number][]; readonly end: number } | undefined => {
    if (at + 2 > bytes.length) return undefined;
    const count = view.getUint16(at);
    if (count === 0) return { items: [], end: at + 2 };
    const size = bytes[at + 2] ?? 0;
    if (size < 1 || size > 4 || at + 3 + (count + 1) * size > bytes.length) return undefined;
    const offset = (n: number): number => {
      let value = 0;
      for (let byte = 0; byte < size; byte += 1) value = value * 256 + (bytes[at + 3 + n * size + byte] ?? 0);
      return value;
    };
    const base = at + 2 + (count + 1) * size;
    const items: [number, number][] = [];
    for (let n = 0; n < count; n += 1) items.push([base + offset(n), base + offset(n + 1)]);
    const end = base + offset(count);
    return end > bytes.length ? undefined : { items, end };
  };
  const names = index(bytes[2] ?? 0);
  const tops = names === undefined ? undefined : index(names.end);
  const strings = tops === undefined ? undefined : index(tops.end);
  const top = tops?.items[0];
  if (top === undefined || strings === undefined) return undefined;
  // THE TOP DICT: operands, then an operator that takes them (TN 5176, 4).
  const operands: number[] = [];
  let weight: number | undefined;
  let angle = 0;
  for (let at = top[0]; at < top[1]; ) {
    const b0 = bytes[at] ?? 0;
    if (b0 <= 21) {
      const operator = b0 === 12 ? 1200 + (bytes[at + 1] ?? 0) : b0;
      at += b0 === 12 ? 2 : 1;
      if (operator === 4) weight = operands.at(-1);
      if (operator === 1202) angle = operands.at(-1) ?? 0;
      operands.length = 0;
    } else if (b0 === 28) {
      operands.push(view.getInt16(at + 1));
      at += 3;
    } else if (b0 === 29) {
      operands.push(view.getInt32(at + 1));
      at += 5;
    } else if (b0 === 30) {
      // A REAL, nibbles to an end nibble: read as its sign alone, which is all an italic angle is asked for.
      let negative = false;
      at += 1;
      for (let done = false; !done && at < top[1]; at += 1) {
        for (const nibble of [(bytes[at] ?? 0) >> 4, (bytes[at] ?? 0) & 15]) {
          if (nibble === 14) negative = true;
          if (nibble === 15) done = true;
        }
      }
      operands.push(negative ? -1 : 1);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      at += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + (bytes[at + 1] ?? 0) + 108);
      at += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - (bytes[at + 1] ?? 0) - 108);
      at += 2;
    } else {
      return undefined;
    }
  }
  if (weight === undefined) return undefined;
  const custom = strings.items[weight - 391];
  const name = weight < 391 ? CFF_WEIGHT_STRINGS[weight] : custom === undefined ? undefined : new TextDecoder('latin1').decode(bytes.subarray(custom[0], custom[1]));
  const weightClass = weightOfName(name ?? '');
  const fontName = names?.items[0];
  const own = fontName === undefined ? '' : new TextDecoder('latin1').decode(bytes.subarray(fontName[0], fontName[1]));
  return weightClass === undefined ? undefined : { weightClass, italic: angle !== 0 || SLANTED.test(own) };
}
