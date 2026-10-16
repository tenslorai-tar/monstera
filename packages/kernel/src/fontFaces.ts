import { Blob as HarfBuzzBlob, Face } from 'harfbuzzjs';

import { sfntTable } from './sfntTables.js';

/**
 * What a font file says about itself, read by HarfBuzz inside an engine host
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
 * Decision 2).
 *
 * ## Only in a host
 *
 * A font file is hostile input: a document carries its own, and an installed one is whatever the machine holds. This
 * module loads HarfBuzz's WebAssembly at import, so `proof:kernelload` keeps it off the barrel and out of `main`; the
 * hosts import it by path.
 */

/** How a face may be put into a document Monstera writes: as a subset, only whole, or not at all. */
export type FontEmbedding = 'subset' | 'whole' | 'never';

/** One variation axis of a variable face. */
export interface FontAxis {
  readonly tag: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

/** A face, as the resolver needs it. */
export interface FaceReading {
  /** The typographic family (name 16), else the family (name 1). */
  readonly family: string;
  /** The typographic style (name 17), else the style (name 2). */
  readonly style: string;
  /** The PostScript name (name 6), `''` where the face has none. */
  readonly postscript: string;
  /**
   * For a variable face, the family Windows draws its default instance as by name ({@link instanceFamily}), `''` for a
   * static face and where the face's `STAT` names nothing past its typographic family.
   */
  readonly instanceFamily: string;
  /** `OS/2` `usWeightClass`, 400 where the face has no `OS/2` table. */
  readonly weight: number;
  /** `OS/2` `fsSelection` ITALIC or OBLIQUE. */
  readonly italic: boolean;
  /** `OS/2` `fsType`, `null` where the face has no `OS/2` table. */
  readonly fsType: number | null;
  /** What the licence allows, by {@link embeddingOf}. */
  readonly embedding: FontEmbedding;
  /** Every code point the face's `cmap` maps. */
  readonly unicodes: ReadonlySet<number>;
  /** The variation axes, empty for a static face. */
  readonly axes: readonly FontAxis[];
  readonly unitsPerEm: number;
}

/**
 * THE LICENCE RULE, the one place it is written (ADR-0172 Decision 3, the owner's Q2).
 *
 * `fsType` bits 1 to 3 are usage permissions: restricted (0x0002), preview and print (0x0004), editable (0x0008), and
 * none of them is installable. The OpenType specification says that where more than one is set the LEAST restrictive
 * applies, so a face marked both preview-and-print and editable is editable. Preview and print is skipped by the owner's
 * answer, because a document carrying it is locked against editing in other programs. 0x0100 forbids subsetting, so
 * such a face goes in whole; 0x0200 allows only bitmaps, which a PDF font cannot be, so it is never used. A face with
 * no `OS/2` table states no permission and is never used.
 */
export function embeddingOf(fsType: number | null): FontEmbedding {
  if (fsType === null) return 'never';
  if ((fsType & 0x0200) !== 0) return 'never';
  const permission = fsType & 0x000e;
  const usable = permission === 0 || (permission & 0x0008) !== 0;
  if (!usable) return 'never';
  return (fsType & 0x0100) !== 0 ? 'whole' : 'subset';
}

function u16(table: Uint8Array, at: number): number | null {
  const high = table[at];
  const low = table[at + 1];
  return high === undefined || low === undefined ? null : (high << 8) | low;
}

/** A 32-bit field of a table, or `null` past its end. */
function u32(table: Uint8Array, at: number): number | null {
  const high = u16(table, at);
  const low = u16(table, at + 2);
  return high === null || low === null ? null : high * 65536 + low;
}

/** A 16.16 fixed value of a table, or `null` past its end. */
function fixed(table: Uint8Array, at: number): number | null {
  const raw = u32(table, at);
  return raw === null ? null : (raw >= 0x80000000 ? raw - 0x100000000 : raw) / 65536;
}

/** The axes DirectWrite's weight, width and slope family model keeps out of a family's name. */
const WWS_AXES = new Set(['wght', 'wdth', 'ital', 'slnt']);

/**
 * The family a variable face is drawn as by name on Windows, or `''` where it is the typographic family alone: the
 * typographic family and, after it, the `STAT` name of each axis outside weight, width and slope at its default value,
 * unless that value is elidable (OpenType `STAT`, axis value tables formats 1 to 3; DirectWrite's WWS family model).
 * *Segoe UI Variable* at an optical size of 10.5 is *Segoe UI Variable Text*, which Chromium's `local()` matches where
 * the face's PostScript name, *SegoeUIVariable*, is not (measured 2026-10-16 in Chromium on this project's Windows
 * machine: `local("Segoe UI Variable Text")` loads, `local("SegoeUIVariable")` does not; *Sitka* is *Sitka Text* alike).
 */
function instanceFamily(bytes: Uint8Array, index: number, family: string, axes: readonly FontAxis[], name: (id: number) => string): string {
  const stat = sfntTable(bytes, index, 'STAT');
  if (stat === undefined) return '';
  const axisSize = u16(stat, 4);
  const axisCount = u16(stat, 6);
  const axesOffset = u32(stat, 8);
  const valueCount = u16(stat, 12);
  const valuesOffset = u32(stat, 14);
  if (axisSize === null || axisCount === null || axesOffset === null || valueCount === null || valuesOffset === null) return '';
  const tags = Array.from({ length: axisCount }, (_, at) => {
    const start = axesOffset + at * axisSize;
    return String.fromCharCode(...[0, 1, 2, 3].map((byte) => stat[start + byte] ?? 32));
  });
  const parts: string[] = [];
  for (let at = 0; at < valueCount; at += 1) {
    const offset = u16(stat, valuesOffset + at * 2);
    if (offset === null) return '';
    const table = valuesOffset + offset;
    const format = u16(stat, table);
    const axis = u16(stat, table + 2);
    const flags = u16(stat, table + 4);
    const nameId = u16(stat, table + 6);
    if (format === null || axis === null || flags === null || nameId === null || format < 1 || format > 3) continue;
    const tag = tags[axis];
    // ELIDABLE (flag 2) IS LEFT OUT of a name, by the format's own rule; an axis in the WWS model never enters one.
    if (tag === undefined || WWS_AXES.has(tag) || (flags & 0x0002) !== 0) continue;
    const at0 = axes.find((each) => each.tag === tag)?.default;
    if (at0 === undefined) continue;
    const value = fixed(stat, table + 8);
    const holds =
      format === 2
        ? (fixed(stat, table + 12) ?? Number.POSITIVE_INFINITY) <= at0 && at0 <= (fixed(stat, table + 16) ?? Number.NEGATIVE_INFINITY)
        : value === at0;
    if (holds) parts.push(name(nameId));
  }
  const suffix = parts.filter((part) => part !== '').join(' ');
  return suffix === '' ? '' : `${family} ${suffix}`;
}

/**
 * Reads one face of a font file.
 *
 * @throws when HarfBuzz finds no glyphs in it, which is what it answers for bytes that are not a font: a reading of
 * nothing must not reach the resolver as a face carrying nothing.
 */
export function readFace(bytes: Uint8Array, index = 0): FaceReading {
  const face = new Face(new HarfBuzzBlob(bytes), index);
  // THE TABLES FROM THE BYTES (`sfntTables.ts`): HarfBuzz's `referenceTable` pins the whole face in its memory per call.
  if (face.upem === 0 || sfntTable(bytes, index, 'maxp') === undefined) {
    throw new Error('the bytes hold no font face HarfBuzz can read');
  }
  const os2 = sfntTable(bytes, index, 'OS/2');
  const fsType = os2 === undefined ? null : u16(os2, 8);
  const selection = os2 === undefined ? 0 : (u16(os2, 62) ?? 0);
  const named = (preferred: number, fallback: number): string => {
    const value = face.getName(preferred, 'en');
    return value === '' ? face.getName(fallback, 'en') : value;
  };
  const family = named(16, 1);
  const axes = Object.entries(face.getAxisInfos()).map(([tag, axis]) => ({
    tag,
    min: axis.min,
    default: axis.default,
    max: axis.max,
  }));
  return {
    family,
    style: named(17, 2),
    postscript: face.getName(6, 'en'),
    instanceFamily: axes.length === 0 ? '' : instanceFamily(bytes, index, family, axes, (id) => face.getName(id, 'en')),
    weight: os2 === undefined ? 400 : (u16(os2, 4) ?? 400),
    italic: (selection & 0x0001) !== 0 || (selection & 0x0200) !== 0,
    fsType,
    embedding: embeddingOf(fsType),
    unicodes: new Set(face.collectUnicodes()),
    axes,
    unitsPerEm: face.upem,
  };
}
