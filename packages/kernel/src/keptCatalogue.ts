import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { z } from 'zod';

import type { Catalogue, CatalogueFace, CatalogueReading, FontFolder } from './fontCatalogue.js';

/**
 * The font catalogue kept as a file ([ADR-0293](../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md)):
 * written by the catalogue host alone, read by the hosts that set text.
 *
 * ## Read as a `CatalogueReading`, so a host binds it where it bound the folders' read
 *
 * Every host that sets text binds its faces through `bindEditFolders(bundled, installed, reading)` or `faceSourceOf`,
 * whose `reading` was `readCatalogueApart`. {@link keptOrRead} is a reading too: the kept file where it is there and
 * passes, else the reading it was given. So which faces a host may choose is decided by the folders it was handed, as
 * before, and the file can only make that answer arrive sooner.
 *
 * ## What a file must pass, and what it cannot be checked for
 *
 * Its name is the fingerprint the host was handed; inside, the same fingerprint and this build's
 * {@link KEPT_CATALOGUE_READING}. Every face must be exactly the face `readCatalogue` would build for a font file
 * DIRECTLY inside the handed folder of its origin: its `id` is `origin:path#index` with that path and index, its path's
 * folder is that folder, its name a font file's. A file that fails any of it is refused WHOLE, never in part, and the
 * folders are read. What it cannot be checked for is what a face's font CONTAINS (its family, its characters), since
 * checking that is parsing the font, which is the cost the file exists to avoid. That residue is why no host a document
 * reaches may write it (ADR-0293 Decision 4).
 */

/**
 * Which READING of the fonts a kept file is: raised whenever what `readCatalogue` builds for a face changes meaning
 * without changing shape. A change of shape needs no raise: {@link KEPT_FACE} is tied to `CatalogueFace` at compile
 * time, and a strict schema refuses a file without the new field. ADR-0237's `FONT_LIST_READING`, for the catalogue.
 */
export const KEPT_CATALOGUE_READING = 1;

/** A fingerprint as ADR-0237 makes it: SHA-256, hex. Anything else names no file, so no path can be built from it. */
const FINGERPRINT = /^[0-9a-f]{64}$/u;

/** The file a fingerprint's catalogue is kept in, inside the area. */
export function keptCatalogueName(fingerprint: string): string {
  if (!FINGERPRINT.test(fingerprint)) throw new Error('a kept catalogue is named by a SHA-256 fingerprint, and this is not one');
  return `${fingerprint}.catalogue.json`;
}

const FONT_FILES = new Set(['.ttf', '.otf', '.ttc', '.otc']);

/** One face, as kept: `CatalogueFace` with its characters as start and end pairs. */
const KEPT_FACE = z.strictObject({
  id: z.string(),
  origin: z.enum(['installed', 'bundled', 'last']),
  family: z.string(),
  weight: z.number(),
  italic: z.boolean(),
  embedding: z.enum(['subset', 'whole', 'never']),
  unicodes: z.array(z.number().int().nonnegative()),
  weights: z.strictObject({ min: z.number(), max: z.number() }).nullable(),
  path: z.string(),
  faceIndex: z.number().int().nonnegative(),
  localNames: z.array(z.string()),
  cff: z.boolean(),
});

/**
 * TIED TO THE FACE AT COMPILE TIME: a field `CatalogueFace` gains, or one this schema keeps that it lost, is a type
 * error here, so the file's shape cannot drift from the face's while every file still parses.
 */
type KeptFace = z.infer<typeof KEPT_FACE>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const FACE_FIELDS_MATCH: Same<keyof KeptFace, keyof CatalogueFace> = true;
void FACE_FIELDS_MATCH;

const KEPT_FILE = z.strictObject({
  reading: z.literal(KEPT_CATALOGUE_READING),
  fingerprint: z.string().regex(FINGERPRINT),
  faces: z.array(KEPT_FACE),
  unreadable: z.array(z.strictObject({ path: z.string(), reason: z.string() })),
});

/** A set of code points as sorted start and end pairs. */
function rangesOf(set: ReadonlySet<number>): number[] {
  const ranges: number[] = [];
  for (const code of [...set].sort((a, b) => a - b)) {
    const last = ranges.length - 1;
    if (last >= 1 && ranges[last] === code - 1) ranges[last] = code;
    else ranges.push(code, code);
  }
  return ranges;
}

/** Start and end pairs as a set, refusing pairs out of order or overlapping, which no written file holds. */
function setOf(ranges: readonly number[]): Set<number> {
  if (ranges.length % 2 !== 0) throw new Error('an odd count of range ends');
  const set = new Set<number>();
  let floor = -1;
  for (let at = 0; at < ranges.length; at += 2) {
    const start = ranges[at] ?? -1;
    const end = ranges[at + 1] ?? -1;
    if (start <= floor || end < start || end > 0x10ffff) throw new Error('ranges out of order');
    for (let code = start; code <= end; code += 1) set.add(code);
    floor = end;
  }
  return set;
}

/** `catalogue` as the text of a kept file for `fingerprint`. */
export function keptCatalogueText(catalogue: Catalogue, fingerprint: string): string {
  keptCatalogueName(fingerprint);
  return JSON.stringify({
    reading: KEPT_CATALOGUE_READING,
    fingerprint,
    faces: catalogue.faces.map((face) => ({ ...face, unicodes: rangesOf(face.unicodes) })),
    unreadable: catalogue.unreadable,
  });
}

/** Paths compared as Windows compares them: the hosts run only there, and its file system ignores case. */
const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/**
 * The catalogue a kept file holds, or the reason it is refused. Each face must be what `readCatalogue` builds for a font
 * file directly inside the handed folder of its origin (this module's header).
 */
export function catalogueFromKept(text: string, fingerprint: string, folders: readonly FontFolder[]): { catalogue: Catalogue } | { refused: string } {
  let parsed: z.infer<typeof KEPT_FILE>;
  try {
    const result = KEPT_FILE.safeParse(JSON.parse(text));
    if (!result.success) return { refused: 'its shape is not this build’s' };
    parsed = result.data;
  } catch {
    return { refused: 'it is not JSON' };
  }
  if (parsed.fingerprint !== fingerprint) return { refused: 'it was kept for other fonts' };
  // NO FACE IS NEVER A CATALOGUE: taken, it would leave a host choosing among nothing where the folders hold faces.
  if (parsed.faces.length === 0) return { refused: 'it holds no face' };
  const faces: CatalogueFace[] = [];
  for (const face of parsed.faces) {
    const folder = folders.find((each) => each.origin === (face.origin === 'last' ? 'bundled' : face.origin));
    if (folder === undefined) return { refused: 'a face names a folder this host was not handed' };
    const name = face.path.slice(folder.path.length + 1);
    if (!same(face.path, join(folder.path, name)) || name === '' || /[\\/]/u.test(name) || !FONT_FILES.has(extname(name).toLowerCase())) {
      return { refused: 'a face is not a font file directly inside its handed folder' };
    }
    if (face.id !== `${folder.origin}:${face.path}#${String(face.faceIndex)}`) return { refused: 'a face’s id is not its path and index' };
    let unicodes: Set<number>;
    try {
      unicodes = setOf(face.unicodes);
    } catch {
      return { refused: 'a face’s characters are not ordered ranges' };
    }
    faces.push({ ...face, unicodes });
  }
  return { catalogue: { faces, unreadable: parsed.unreadable } };
}

/**
 * A reading that answers from the kept file in `area` for `fingerprint` where it is there and passes, and from `read`
 * otherwise (ADR-0293 Decision 6). `refused` hears why a file present was not taken, for the host's diagnostics log.
 */
export function keptOrRead(area: string, fingerprint: string, read: CatalogueReading, refused: (why: string) => void = () => undefined): CatalogueReading {
  return (folders) => {
    let text: string;
    try {
      text = readFileSync(join(area, keptCatalogueName(fingerprint)), 'utf8');
    } catch {
      return read(folders);
    }
    const kept = catalogueFromKept(text, fingerprint, folders);
    if ('catalogue' in kept) return kept.catalogue;
    refused(kept.refused);
    return read(folders);
  };
}

/**
 * The catalogue host's one job (ADR-0293, its correction of 2026-11-12): `read` the folders, write the file whole beside
 * its name in `area`, the host's own output directory, and rename it into place, then remove every other fingerprint's
 * file there. Answers how many faces it kept; a read that found none writes nothing and answers 0.
 */
export function keepCatalogue(area: string, fingerprint: string, folders: readonly FontFolder[], read: CatalogueReading): number {
  const name = keptCatalogueName(fingerprint);
  const catalogue = read(folders);
  if (catalogue.faces.length === 0) return 0;
  const partial = join(area, `${name}.partial`);
  writeFileSync(partial, keptCatalogueText(catalogue, fingerprint));
  renameSync(partial, join(area, name));
  for (const other of readdirSync(area)) {
    if (other !== name && other.endsWith('.catalogue.json')) rmSync(join(area, other), { force: true });
  }
  return catalogue.faces.length;
}
