import { LOCAL_FONT_NAME, MAX_FONT_FAMILIES, MAX_FONT_FAMILY_NAME } from '@monstera/contract/host';

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
  /**
   * For an installed family, the names of its face nearest an upright regular a renderer may draw it by, `local()` each
   * in turn, where the family's own name is one the browser does not resolve (ADR-0250 Decision 1): its PostScript name,
   * and for a variable face the family Windows draws it as. Absent for a bundled family, which crosses as bytes, and for
   * one whose faces state no name the wire takes.
   */
  readonly locals?: string[];
}

const EMBEDDING_RANK: Readonly<Record<FontEmbedding, number>> = { subset: 2, whole: 1, never: 0 };

/** What a catalogue lists: the families a picker can hold, and how many it could not, which the picker says. */
export interface ListedFamilies {
  readonly families: FontFamily[];
  /** The families past `MAX_FONT_FAMILIES`, the last by name: counted, never dropped without a word (BBBBBBBB-8). */
  readonly more: number;
}

/**
 * The families `faces` make, by name, sorted as a person reads them; a face with no family name is left out. Past
 * `MAX_FONT_FAMILIES` the rest are counted in `more`, since the bound is the frame's and a computer may hold more.
 */
export function fontFamiliesOf(
  faces: readonly (Pick<CandidateFace, 'family' | 'origin' | 'embedding' | 'weight' | 'italic' | 'weights'> & {
    readonly localNames?: readonly string[];
  })[],
): ListedFamilies {
  const byName = new Map<
    string,
    {
      name: string;
      origin: 'installed' | 'bundled';
      embedding: FontEmbedding;
      bold: boolean;
      italic: boolean;
      /** The installed face nearest an upright regular so far, and how far it is: its names name the family. */
      local: { readonly names: readonly string[]; readonly distance: number } | undefined;
    }
  >();
  /** How far a face is from an upright regular: its weight's distance from 400, an italic one past every upright. */
  const fromRegular = (face: { readonly weight: number; readonly italic: boolean }): number => Math.abs(face.weight - 400) + (face.italic ? 1000 : 0);
  for (const face of faces) {
    const name = face.family.trim();
    if (name === '' || (face.origin !== 'installed' && face.origin !== 'bundled')) continue;
    const key = name.toLowerCase();
    const bold = face.weight >= 600 || (face.weights !== null && face.weights.max >= 600);
    // NAMES THE WIRE TAKES, or none: a name outside `LOCAL_FONT_NAME` is not offered, and a family with none is drawn by
    // another of its faces or not previewed, never a list the schema refuses whole.
    const names = (face.localNames ?? []).filter((each) => LOCAL_FONT_NAME.test(each) && each.length <= MAX_FONT_FAMILY_NAME);
    const local = face.origin === 'installed' && names.length > 0 ? { names, distance: fromRegular(face) } : undefined;
    const held = byName.get(key);
    if (held === undefined) {
      byName.set(key, { name, origin: face.origin, embedding: face.embedding, bold, italic: face.italic, local });
      continue;
    }
    if (face.origin === 'installed') held.origin = 'installed';
    if (EMBEDDING_RANK[face.embedding] > EMBEDDING_RANK[held.embedding]) held.embedding = face.embedding;
    held.bold ||= bold;
    held.italic ||= face.italic;
    if (local !== undefined && (held.local === undefined || local.distance < held.local.distance)) held.local = local;
  }
  const sorted = [...byName.values()]
    .map(({ local, ...family }): FontFamily => {
      // ONLY A BUNDLED ONE looks like another: an installed Carlito is a font the person put there, and is listed as itself.
      const like = family.origin === 'bundled' ? LOOKS_LIKE[family.name] : undefined;
      // ONLY AN INSTALLED ONE is named for `local()`: a bundled family crosses as bytes (ADR-0250 Decision 2).
      const named = family.origin === 'installed' && local !== undefined ? { locals: [...local.names] } : {};
      return like === undefined ? { ...family, ...named } : { ...family, ...named, looksLike: like };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { families: sorted.slice(0, MAX_FONT_FAMILIES), more: Math.max(0, sorted.length - MAX_FONT_FAMILIES) };
}
