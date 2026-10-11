import { MAX_FONT_FAMILIES } from '@monstera/contract/host';

import type { FontEmbedding } from './fontFaces.js';
import { type CandidateFace, LOOKS_LIKE } from './fontResolver.js';

/**
 * The font families a person may choose from, made from the faces a host's catalogue read (the owner's D2: *one real font
 * list for the whole app*). The catalogue is the resolver's own reading of the installed fonts and the bundled set
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)),
 * so a family the picker lists is a family the resolver can set, by the same reading (B3a).
 *
 * Pure, with no font reader of its own, so it is tested on plain face records and the host's catalogue feeds it.
 */

/** One family as a picker lists it. */
export interface FontFamily {
  /** The typographic family name, as the face states it. */
  readonly name: string;
  /** Where its faces are: installed on this computer, or bundled with Monstera. Installed wins where both hold it. */
  readonly origin: 'installed' | 'bundled';
  /**
   * What the licence allows for the family as a whole: the least restricted of its faces, since a person choosing it
   * gets a face that can be embedded wherever one can. `never` is said in the picker, in words.
   */
  readonly embedding: FontEmbedding;
  /** Whether it has a bold face and an italic face of its own (a variable face's `wght` range counts for bold). */
  readonly bold: boolean;
  readonly italic: boolean;
  /** For a bundled family drawn to another's measure, that family's name (`LOOKS_LIKE`): never shown AS that family. */
  readonly looksLike?: string;
}

const EMBEDDING_RANK: Readonly<Record<FontEmbedding, number>> = { subset: 2, whole: 1, never: 0 };

/** The families `faces` make, by name, sorted as a person reads them; a face with no family name is left out. */
export function fontFamiliesOf(faces: readonly Pick<CandidateFace, 'family' | 'origin' | 'embedding' | 'weight' | 'italic' | 'weights'>[]): FontFamily[] {
  const byName = new Map<string, { name: string; origin: 'installed' | 'bundled'; embedding: FontEmbedding; bold: boolean; italic: boolean }>();
  for (const face of faces) {
    const name = face.family.trim();
    if (name === '' || (face.origin !== 'installed' && face.origin !== 'bundled')) continue;
    const key = name.toLowerCase();
    const bold = face.weight >= 600 || (face.weights !== null && face.weights.max >= 600);
    const held = byName.get(key);
    if (held === undefined) {
      byName.set(key, { name, origin: face.origin, embedding: face.embedding, bold, italic: face.italic });
      continue;
    }
    if (face.origin === 'installed') held.origin = 'installed';
    if (EMBEDDING_RANK[face.embedding] > EMBEDDING_RANK[held.embedding]) held.embedding = face.embedding;
    held.bold ||= bold;
    held.italic ||= face.italic;
  }
  return [...byName.values()]
    .map((family): FontFamily => {
      // ONLY A BUNDLED ONE looks like another: an installed Carlito is a font the person put there, and is listed as itself.
      const like = family.origin === 'bundled' ? LOOKS_LIKE[family.name] : undefined;
      return like === undefined ? family : { ...family, looksLike: like };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    .slice(0, MAX_FONT_FAMILIES);
}
