import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BUNDLED_FAMILIES, type BundledFamily } from '@monstera/contract';

/**
 * Each bundled family's upright face, by the file the provisioner pins for it
 * ([ADR-0250](../../../docs/DECISIONS/0250-the-font-picker-draws-each-family-in-itself.md) Decision 2): what
 * `app.bundledFace` answers.
 *
 * ## A TABLE KEYED BY THE CONTRACT'S ENUM, and never a path made from a name
 *
 * The request's family is a member of `BUNDLED_FAMILIES`, which the channel's schema enforces; this table has one entry
 * per member (a `Record` over the enum, so a member added there without a file here is a compile error), and the file
 * read is the table's, joined to the bundled folder. Nothing the renderer sends becomes part of a path. Every file named
 * here is one `scripts/provision/fonts.mjs` pins, which `bundledFaces.test.ts` holds.
 */
export const BUNDLED_FACE_FILES: Readonly<Record<BundledFamily, string>> = {
  Arimo: 'Arimo[wght].ttf',
  Tinos: 'Tinos-Regular.ttf',
  Cousine: 'Cousine-Regular.ttf',
  Carlito: 'Carlito-Regular.ttf',
  Caladea: 'Caladea-Regular.ttf',
  'Noto Sans Arabic': 'NotoSansArabic[wdth,wght].ttf',
  'Noto Naskh Arabic': 'NotoNaskhArabic[wght].ttf',
  'Noto Sans Symbols 2': 'NotoSansSymbols2-Regular.ttf',
};

/** A request for a family that is not bundled: the schema refuses it first, and this is `main` holding the same rule. */
export class NotBundledError extends Error {
  constructor() {
    super('a bundled face was asked for a family Monstera does not bundle');
    this.name = 'NotBundledError';
  }
}

/**
 * The upright face of `family`, read from `folder`, the bundled fonts' folder.
 *
 * @throws {NotBundledError} for a family outside `BUNDLED_FAMILIES`, which a validated request cannot be
 * @throws where the bundled folder is absent or the file cannot be read: an install that is broken
 */
export async function readBundledFace(folder: string | null, family: string): Promise<Uint8Array<ArrayBuffer>> {
  // VALIDATED AGAINST THE ENUM HERE TOO, by membership and never by the string's shape (the owner's locked decision 8).
  if (!(BUNDLED_FAMILIES as readonly string[]).includes(family)) throw new NotBundledError();
  if (folder === null) throw new Error('this build has no bundled fonts folder');
  return new Uint8Array(await readFile(join(folder, BUNDLED_FACE_FILES[family as BundledFamily])));
}
