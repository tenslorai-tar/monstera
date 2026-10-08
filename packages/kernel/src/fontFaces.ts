import { Blob as HarfBuzzBlob, Face } from 'harfbuzzjs';

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

/**
 * Reads one face of a font file.
 *
 * @throws when HarfBuzz finds no glyphs in it, which is what it answers for bytes that are not a font: a reading of
 * nothing must not reach the resolver as a face carrying nothing.
 */
export function readFace(bytes: Uint8Array, index = 0): FaceReading {
  const face = new Face(new HarfBuzzBlob(bytes), index);
  if (face.upem === 0 || face.referenceTable('maxp') === undefined) {
    throw new Error('the bytes hold no font face HarfBuzz can read');
  }
  const os2 = face.referenceTable('OS/2');
  const fsType = os2 === undefined ? null : u16(os2, 8);
  const selection = os2 === undefined ? 0 : (u16(os2, 62) ?? 0);
  const named = (preferred: number, fallback: number): string => {
    const value = face.getName(preferred, 'en');
    return value === '' ? face.getName(fallback, 'en') : value;
  };
  return {
    family: named(16, 1),
    style: named(17, 2),
    postscript: face.getName(6, 'en'),
    weight: os2 === undefined ? 400 : (u16(os2, 4) ?? 400),
    italic: (selection & 0x0001) !== 0 || (selection & 0x0200) !== 0,
    fsType,
    embedding: embeddingOf(fsType),
    unicodes: new Set(face.collectUnicodes()),
    axes: Object.entries(face.getAxisInfos()).map(([tag, axis]) => ({
      tag,
      min: axis.min,
      default: axis.default,
      max: axis.max,
    })),
    unitsPerEm: face.upem,
  };
}
