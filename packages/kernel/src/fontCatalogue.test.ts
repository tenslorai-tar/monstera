import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { faceCount, readCatalogue } from './fontCatalogue.js';
import { readFace } from './fontFaces.js';
import { subsetFont } from './fontSubset.js';

/**
 * The catalogue a host chooses faces from (ADR-0172 Decisions 1 and 2), read from the bundled folder `vitest.config.mjs`
 * passes and from folders built here. ABSENT IS A FAILURE, never a skip.
 */
function bundledFolder(): string {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  if (folder === '' || !existsSync(join(folder, 'Tinos-Regular.ttf'))) {
    throw new Error(`the bundled fonts are not provisioned at ${folder}. Run: npm run provision:fonts`);
  }
  return folder;
}

/**
 * A TrueType collection of `fonts`, written as the specification lays one out: a `ttcf` header, one table directory per
 * face, and each face's tables after them with offsets from the start of the file.
 */
function collection(fonts: readonly Uint8Array[]): Uint8Array {
  const directories = fonts.map((font) => {
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const count = view.getUint16(4);
    return { font, view, count, size: 12 + 16 * count };
  });
  const header = 12 + 4 * fonts.length;
  let at = header + directories.reduce((total, directory) => total + directory.size, 0);
  const tableBytes = directories.map(({ font, view, count }) =>
    Array.from({ length: count }, (_, index) => {
      const length = view.getUint32(12 + 16 * index + 12);
      const offset = view.getUint32(12 + 16 * index + 8);
      const placed = at;
      at += (length + 3) & ~3;
      return { placed, data: font.subarray(offset, offset + length) };
    }),
  );
  const out = new Uint8Array(at);
  const writer = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0);
  writer.setUint32(4, 0x00010000);
  writer.setUint32(8, fonts.length);
  let directoryAt = header;
  directories.forEach(({ font, count, size }, face) => {
    writer.setUint32(12 + 4 * face, directoryAt);
    out.set(font.subarray(0, size), directoryAt);
    for (let index = 0; index < count; index += 1) {
      const table = tableBytes[face]?.[index];
      if (table === undefined) continue;
      writer.setUint32(directoryAt + 12 + 16 * index + 8, table.placed);
      out.set(table.data, table.placed);
    }
    directoryAt += size;
  });
  return out;
}

let scratch = '';
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'monstera-catalogue-'));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('readCatalogue', () => {
  it('reads all twenty-one bundled faces, each with its family, weight, slope and range', () => {
    const { faces, unreadable } = readCatalogue([{ path: bundledFolder(), origin: 'bundled' }]);
    expect(unreadable).toStrictEqual([]);
    expect(faces).toHaveLength(21);
    const arimo = faces.find((face) => face.family === 'Arimo' && !face.italic);
    expect(arimo).toMatchObject({ origin: 'bundled', weights: { min: 400, max: 700 }, embedding: 'subset', faceIndex: 0 });
    expect(faces.find((face) => face.path.endsWith('Tinos-BoldItalic.ttf'))).toMatchObject({ weight: 700, italic: true, weights: null });
    expect(new Set(faces.map((face) => face.id)).size).toBe(21);
  });

  it('reads every face of a collection, by its index', () => {
    const folder = bundledFolder();
    const regular = new Uint8Array(readFileSync(join(folder, 'Tinos-Regular.ttf')));
    const bold = new Uint8Array(readFileSync(join(folder, 'Tinos-Bold.ttf')));
    const both = collection([regular, bold]);
    writeFileSync(join(scratch, 'Tinos.ttc'), both);
    expect(faceCount(both)).toBe(2);
    // CONTROL: a single face is one face, so the count is the header's and not a constant.
    expect(faceCount(regular)).toBe(1);
    const { faces } = readCatalogue([{ path: scratch, origin: 'installed' }]);
    expect(faces.map((face) => [face.faceIndex, face.weight])).toStrictEqual([
      [0, 400],
      [1, 700],
    ]);
    // The subsetter reaches the second face by the same index.
    const subset = subsetFont(both, { unicodes: [0x41], faceIndex: 1 });
    expect(readFace(subset ?? new Uint8Array()).weight).toBe(700);
  });

  it('names a damaged file and a lying collection header as unreadable, and reads the rest', () => {
    copyFileSync(join(bundledFolder(), 'Cousine-Regular.ttf'), join(scratch, 'Cousine-Regular.ttf'));
    writeFileSync(join(scratch, 'broken.ttf'), 'not a font');
    const lying = new Uint8Array(16);
    lying.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0xff, 0xff, 0xff, 0xff], 0);
    writeFileSync(join(scratch, 'lying.ttc'), lying);
    writeFileSync(join(scratch, 'notes.txt'), 'not a font file by name, so not read');
    const { faces, unreadable } = readCatalogue([{ path: scratch, origin: 'installed' }]);
    expect(faces.map((face) => face.family)).toStrictEqual(['Cousine']);
    expect(unreadable.map((entry) => entry.path.slice(scratch.length + 1)).sort()).toStrictEqual(['broken.ttf', 'lying.ttc']);
  });

  it('reports a folder it cannot read rather than answering an empty catalogue', () => {
    const { faces, unreadable } = readCatalogue([{ path: join(scratch, 'absent'), origin: 'installed' }]);
    expect(faces).toStrictEqual([]);
    expect(unreadable).toHaveLength(1);
  });
});
