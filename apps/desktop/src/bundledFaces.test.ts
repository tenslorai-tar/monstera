import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUNDLED_FAMILIES, MAX_BUNDLED_FACE_BYTES, channels } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { BUNDLED_FACE_FILES, NotBundledError, readBundledFace } from './bundledFaces.js';

/**
 * The provisioner's pins, the one list of what the bundled folder holds: loaded by path, since a script module carries no
 * declarations a test can import, and its shape stated here once.
 */
const PROVISIONER = new URL('../../../scripts/provision/fonts.mjs', import.meta.url).href;
const { BUNDLED_FONTS } = (await import(PROVISIONER)) as { readonly BUNDLED_FONTS: readonly { readonly file: string; readonly bytes: number }[] };

/**
 * `app.bundledFace` (ADR-0250 Decision 2): a closed family, `main`'s own table, and a pinned file — and a request for any
 * other family refused twice, by the channel's schema and by `main`.
 */
describe('the bundled face a renderer may ask for', () => {
  it('names a file the provisioner pins for every bundled family, each within the answer’s bound', () => {
    const pinned = new Map(BUNDLED_FONTS.map((font) => [font.file, font.bytes]));
    for (const family of BUNDLED_FAMILIES) {
      const file = BUNDLED_FACE_FILES[family];
      expect(pinned.has(file), `${family}: ${file}`).toBe(true);
      expect(pinned.get(file) ?? Number.POSITIVE_INFINITY, family).toBeLessThanOrEqual(MAX_BUNDLED_FACE_BYTES);
    }
  });

  it('REFUSES a family that is not bundled, at the schema, so a renderer cannot express the request', () => {
    const request = channels['app.bundledFace'].params;
    expect(request.safeParse({ family: 'Tinos' }).success).toBe(true);
    // A FILE NAME, A PATH, AND A REAL FAMILY THAT IS NOT BUNDLED: none is a member.
    for (const family of ['Tinos-Regular.ttf', '../../secrets', 'Arial']) {
      expect(request.safeParse({ family }).success, family).toBe(false);
    }
  });

  it('REFUSES one in main too, by membership, before any file is named', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'monstera-bundled-'));
    try {
      // A FILE THAT WOULD BE READ if the name became a path: `main` must refuse before it gets there.
      writeFileSync(join(folder, 'Arial'), new Uint8Array([1, 2, 3]));
      await expect(readBundledFace(folder, 'Arial')).rejects.toBeInstanceOf(NotBundledError);
      // CONTROL: a bundled family is read from the table's own file.
      writeFileSync(join(folder, BUNDLED_FACE_FILES.Tinos), new Uint8Array([7, 8, 9]));
      expect([...(await readBundledFace(folder, 'Tinos'))]).toStrictEqual([7, 8, 9]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
