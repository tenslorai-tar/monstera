import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { readFace } from './fontFaces.js';
import type { CandidateFace } from './fontResolver.js';

/**
 * The faces a host can choose from: the bundled set and the installed fonts, read once by HarfBuzz
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
 * Decisions 1 and 2). Host-only, because it imports {@link readFace}.
 *
 * ## A collection is several faces
 *
 * A `.ttc` holds several faces behind one header (Windows ships its Chinese, Japanese and Korean faces that way), and
 * each is a candidate of its own, addressed by its index in the file.
 *
 * ## A file that does not read is reported, never a face
 *
 * An installed folder holds whatever the machine holds. A file HarfBuzz cannot read is named in `unreadable` and left
 * out, so one damaged font neither stops the catalogue nor enters it as a face carrying nothing.
 */

/** A folder the catalogue reads, and what its faces are to the resolver. */
export interface FontFolder {
  readonly path: string;
  readonly origin: 'installed' | 'bundled';
}

/** A candidate with what it takes to read it again. */
export interface CatalogueFace extends CandidateFace {
  readonly path: string;
  readonly faceIndex: number;
}

export interface Catalogue {
  readonly faces: readonly CatalogueFace[];
  /** Files that were fonts by name and not by content, with why. */
  readonly unreadable: readonly { readonly path: string; readonly reason: string }[];
}

const FONT_FILES = new Set(['.ttf', '.otf', '.ttc', '.otc']);

/** How many faces a file holds: a collection's header count, or one. */
export function faceCount(bytes: Uint8Array): number {
  const isCollection = bytes[0] === 0x74 && bytes[1] === 0x74 && bytes[2] === 0x63 && bytes[3] === 0x66; // 'ttcf'
  if (!isCollection) return 1;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
  // A header claiming more faces than its offset table can hold is a damaged file, not a large collection.
  if (count === 0 || 12 + 4 * count > bytes.length) throw new Error(`a collection header claims ${String(count)} faces`);
  return count;
}

/** Reads every font file in `folders` (not their subfolders) into one catalogue. */
export function readCatalogue(folders: readonly FontFolder[]): Catalogue {
  const faces: CatalogueFace[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  for (const folder of folders) {
    let names: string[];
    try {
      names = readdirSync(folder.path).sort();
    } catch (error) {
      unreadable.push({ path: folder.path, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    for (const name of names) {
      if (!FONT_FILES.has(extname(name).toLowerCase())) continue;
      const path = join(folder.path, name);
      try {
        const bytes = new Uint8Array(readFileSync(path));
        const count = faceCount(bytes);
        for (let index = 0; index < count; index += 1) {
          const face = readFace(bytes, index);
          const weight = face.axes.find((axis) => axis.tag === 'wght');
          faces.push({
            id: `${folder.origin}:${path}#${String(index)}`,
            origin: folder.origin,
            family: face.family,
            weight: face.weight,
            italic: face.italic,
            embedding: face.embedding,
            unicodes: face.unicodes,
            weights: weight === undefined ? null : { min: weight.min, max: weight.max },
            path,
            faceIndex: index,
          });
        }
      } catch (error) {
        unreadable.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { faces, unreadable };
}
