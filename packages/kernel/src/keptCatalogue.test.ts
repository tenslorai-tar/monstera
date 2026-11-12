import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Catalogue, CatalogueFace, FontFolder } from './fontCatalogue.js';
import { KEPT_CATALOGUE_READING, catalogueFromKept, keepCatalogue, keptCatalogueName, keptCatalogueText, keptOrRead } from './keptCatalogue.js';

/**
 * The kept catalogue (ADR-0293): a host takes the file only where every face is one `readCatalogue` would build for a font
 * file directly inside the folder of its origin that this host was handed, and reads the folders otherwise. The folders
 * here exist nowhere: the loader never opens a font file, which is the point of it.
 */
const BUNDLED = join(tmpdir(), 'kept-fixture', 'bundled');
const INSTALLED = join(tmpdir(), 'kept-fixture', 'installed');
const FOLDERS: readonly FontFolder[] = [
  { path: BUNDLED, origin: 'bundled' },
  { path: INSTALLED, origin: 'installed' },
];
const FINGERPRINT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function face(folder: FontFolder, name: string, index: number, origin: CatalogueFace['origin'] = folder.origin): CatalogueFace {
  const path = join(folder.path, name);
  return {
    id: `${folder.origin}:${path}#${String(index)}`,
    origin,
    family: name.replace(/\..*$/u, ''),
    weight: 400,
    italic: false,
    embedding: 'subset',
    unicodes: new Set([0x41, 0x42, 0x43, 0x61, 0x4e2d]),
    weights: null,
    path,
    faceIndex: index,
    localNames: [name.replace(/\..*$/u, '')],
    cff: false,
  };
}
const [BUNDLED_FOLDER, INSTALLED_FOLDER] = FOLDERS as [FontFolder, FontFolder];
const CATALOGUE: Catalogue = {
  faces: [face(BUNDLED_FOLDER, 'Arimo.ttf', 0), face(BUNDLED_FOLDER, 'unifont.otf', 0, 'last'), face(INSTALLED_FOLDER, 'msgothic.ttc', 1)],
  unreadable: [],
};

/** The kept file's object form, changed by `change`: every refusal below is a valid file changed in ONE way. */
function keptWith(change: (kept: { reading: number; fingerprint: string; faces: Record<string, unknown>[] }) => void): string {
  const kept = JSON.parse(keptCatalogueText(CATALOGUE, FINGERPRINT)) as { reading: number; fingerprint: string; faces: Record<string, unknown>[] };
  change(kept);
  return JSON.stringify(kept);
}

const areas: string[] = [];
function area(): string {
  const made = mkdtempSync(join(tmpdir(), 'kept-catalogue-'));
  areas.push(made);
  return made;
}
afterEach(() => {
  for (const made of areas.splice(0)) rmSync(made, { recursive: true, force: true });
});

describe('a kept catalogue (ADR-0293)', () => {
  it('reads back the faces it was written from, characters and all', () => {
    const kept = catalogueFromKept(keptCatalogueText(CATALOGUE, FINGERPRINT), FINGERPRINT, FOLDERS);
    if (!('catalogue' in kept)) throw new Error(`refused: ${kept.refused}`);
    expect(kept.catalogue.faces.map(({ unicodes, ...rest }) => ({ ...rest, unicodes: [...unicodes] }))).toStrictEqual(
      CATALOGUE.faces.map(({ unicodes, ...rest }) => ({ ...rest, unicodes: [...unicodes] })),
    );
  });

  it('is taken by the reading, and the folders are not read', () => {
    const made = area();
    writeFileSync(join(made, keptCatalogueName(FINGERPRINT)), keptCatalogueText(CATALOGUE, FINGERPRINT));
    let read = 0;
    const reading = keptOrRead(made, FINGERPRINT, () => {
      read += 1;
      return { faces: [], unreadable: [] };
    });
    expect(reading(FOLDERS).faces).toHaveLength(3);
    expect(read).toBe(0);
  });

  it('CONTROL: with no file the reading reads the folders, so the case above could see a reading that always read', () => {
    let read = 0;
    const reading = keptOrRead(area(), FINGERPRINT, () => {
      read += 1;
      return { faces: [], unreadable: [] };
    });
    reading(FOLDERS);
    expect(read).toBe(1);
  });

  const REFUSED: readonly [string, () => string, string][] = [
    ['kept for other fonts', () => keptWith((kept) => (kept.fingerprint = OTHER)), 'other fonts'],
    ['read by another reading', () => keptWith((kept) => (kept.reading = KEPT_CATALOGUE_READING + 1)), 'shape'],
    ['a face with a field this build does not know', () => keptWith((kept) => (kept.faces[0] = { ...kept.faces[0], extra: true })), 'shape'],
    [
      'a face outside every handed folder',
      () => keptWith((kept) => (kept.faces[0] = { ...kept.faces[0], path: join(tmpdir(), 'elsewhere', 'Arimo.ttf'), id: `bundled:${join(tmpdir(), 'elsewhere', 'Arimo.ttf')}#0` })),
      'directly inside',
    ],
    [
      'a face in a folder below the handed one',
      () => keptWith((kept) => (kept.faces[0] = { ...kept.faces[0], path: join(BUNDLED, 'sub', 'Arimo.ttf'), id: `bundled:${join(BUNDLED, 'sub', 'Arimo.ttf')}#0` })),
      'directly inside',
    ],
    [
      // A LITERAL `..`, joined by the separator: `join` would resolve it away and leave a file inside the folder.
      'a face whose path climbs out of its folder',
      () => keptWith((kept) => (kept.faces[0] = { ...kept.faces[0], path: [BUNDLED, '..', 'x.ttf'].join(sep), id: `bundled:${[BUNDLED, '..', 'x.ttf'].join(sep)}#0` })),
      'directly inside',
    ],
    ['an installed face placed in the bundled folder', () => keptWith((kept) => (kept.faces[2] = { ...kept.faces[2], origin: 'bundled' })), 'directly inside'],
    ['a face that is not a font file', () => keptWith((kept) => (kept.faces[0] = { ...kept.faces[0], path: join(BUNDLED, 'Arimo.dll'), id: `bundled:${join(BUNDLED, 'Arimo.dll')}#0` })), 'directly inside'],
    ['a face whose id is not its path and index', () => keptWith((kept) => (kept.faces[0] = { ...kept.faces[0], faceIndex: 3 })), 'id'],
    ['a face whose characters are not ordered ranges', () => keptWith((kept) => (kept.faces[0] = { ...kept.faces[0], unicodes: [0x61, 0x61, 0x41, 0x41] })), 'ordered'],
    ['text that is not JSON', () => '{', 'JSON'],
    ['no face at all', () => keptWith((kept) => (kept.faces = [])), 'no face'],
  ];

  for (const [name, text, why] of REFUSED) {
    it(`refuses a file with ${name}, whole, and the folders are read`, () => {
      const kept = catalogueFromKept(text(), FINGERPRINT, FOLDERS);
      expect('refused' in kept ? kept.refused : 'taken').toContain(why);
      const made = area();
      writeFileSync(join(made, keptCatalogueName(FINGERPRINT)), text());
      const heard: string[] = [];
      let read = 0;
      keptOrRead(
        made,
        FINGERPRINT,
        () => {
          read += 1;
          return { faces: [], unreadable: [] };
        },
        (reason) => heard.push(reason),
      )(FOLDERS);
      expect(read).toBe(1);
      expect(heard).toHaveLength(1);
    });
  }

  it('names a file by a SHA-256 fingerprint and by nothing else, so no fingerprint is a path', () => {
    expect(keptCatalogueName(FINGERPRINT)).toBe(`${FINGERPRINT}.catalogue.json`);
    for (const bad of ['..', `..${'a'.repeat(62)}`, 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}/`]) expect(() => keptCatalogueName(bad)).toThrow(/SHA-256/u);
  });

  it('writes nothing for a read that found no face, and answers 0', () => {
    const made = area();
    expect(keepCatalogue(made, FINGERPRINT, FOLDERS, () => ({ faces: [], unreadable: [{ path: INSTALLED, reason: 'denied' }] }))).toBe(0);
    expect(readdirSync(made)).toStrictEqual([]);
  });

  it('is written whole under its name, and the files of other fingerprints are removed', () => {
    const made = area();
    writeFileSync(join(made, keptCatalogueName(OTHER)), 'an older fonts’ catalogue');
    writeFileSync(join(made, 'unrelated.txt'), 'kept');
    expect(keepCatalogue(made, FINGERPRINT, FOLDERS, () => CATALOGUE)).toBe(3);
    expect(readdirSync(made).sort()).toStrictEqual([keptCatalogueName(FINGERPRINT), 'unrelated.txt'].sort());
    expect(existsSync(join(made, `${keptCatalogueName(FINGERPRINT)}.partial`))).toBe(false);
    expect(keptOrRead(made, FINGERPRINT, () => ({ faces: [], unreadable: [] }))(FOLDERS).faces).toHaveLength(3);
  });
});
