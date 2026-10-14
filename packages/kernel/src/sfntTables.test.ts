import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

/**
 * The one `sfnt` table reader (`sfntTables.ts`), and the leak it closes: harfbuzzjs 1.6.2's `Face.referenceTable` pins
 * a whole copy of the font in HarfBuzz's memory per call, and `ShapingFace.readable` made two faces where one is kept.
 * Every HarfBuzz call that matters here is COUNTED by wrapping the library's own classes, so each case asserts the calls
 * made, not a memory figure.
 */
const made = vi.hoisted(() => ({ blobs: 0, tables: 0 }));
vi.mock('harfbuzzjs', async (original) => {
  const real = await original<typeof import('harfbuzzjs')>();
  class CountedBlob extends real.Blob {
    constructor(...args: ConstructorParameters<typeof real.Blob>) {
      super(...args);
      made.blobs += 1;
    }
  }
  class CountedFace extends real.Face {
    override referenceTable(table: string): Uint8Array | undefined {
      made.tables += 1;
      return super.referenceTable(table);
    }
  }
  return { ...real, Blob: CountedBlob, Face: CountedFace };
});

const { Blob, Face } = await import('harfbuzzjs');
const { sfntTable, sfntTableEntry } = await import('./sfntTables.js');
const { ShapingFace } = await import('./textShaping.js');
const { readFace } = await import('./fontFaces.js');

/** A bundled face; ABSENT IS A FAILURE, never a skip, `fontSubset.test.ts`' rule. */
function bundled(file: string): Uint8Array {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  const path = join(folder, file);
  if (folder === '' || !existsSync(path)) throw new Error(`${file} is not provisioned at ${path}. Run: npm run provision:fonts`);
  return new Uint8Array(readFileSync(path));
}

const ARIMO = bundled('Arimo[wght].ttf');

/** A one-face file holding the given tables, by hand: directory then each table, offsets from the file's start. */
function face(tables: Record<string, Uint8Array>, base = 0): Uint8Array {
  const tags = Object.keys(tables);
  const header = 12 + 16 * tags.length;
  const size = header + tags.reduce((sum, tag) => sum + (tables[tag]?.length ?? 0), 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tags.length);
  let at = header;
  tags.forEach((tag, index) => {
    const table = tables[tag] ?? new Uint8Array(0);
    const record = 12 + 16 * index;
    for (let character = 0; character < 4; character += 1) view.setUint8(record + character, tag.charCodeAt(character));
    view.setUint32(record + 8, base + at);
    view.setUint32(record + 12, table.length);
    bytes.set(table, at);
    at += table.length;
  });
  return bytes;
}

describe('sfntTable', () => {
  it('reads the same bytes HarfBuzz does for every table the kernel reads, from a real face', () => {
    const harfbuzz = new Face(new Blob(ARIMO), 0);
    for (const tag of ['head', 'maxp', 'post', 'OS/2', 'name']) {
      const theirs = harfbuzz.referenceTable(tag);
      expect(theirs, tag).toBeDefined();
      expect(sfntTable(ARIMO, 0, tag), tag).toStrictEqual(theirs);
    }
    // CONTROL: a table the face does not have is absent to both.
    expect(sfntTable(ARIMO, 0, 'CBDT')).toBeUndefined();
  });

  it('reads the face a collection names, and only a face that exists', () => {
    const one = face({ test: Uint8Array.of(1, 2, 3) });
    const two = face({ test: Uint8Array.of(7, 8) });
    // A COLLECTION OF THE TWO: header, two offsets, then each face, with its tables' offsets made the file's.
    const firstAt = 20;
    const first = face({ test: Uint8Array.of(1, 2, 3) }, firstAt);
    const secondAt = firstAt + first.length;
    const second = face({ test: Uint8Array.of(7, 8) }, secondAt);
    const collection = new Uint8Array(secondAt + second.length);
    const view = new DataView(collection.buffer);
    view.setUint32(0, 0x74746366);
    view.setUint32(4, 0x00010000);
    view.setUint32(8, 2);
    view.setUint32(12, firstAt);
    view.setUint32(16, secondAt);
    collection.set(first, firstAt);
    collection.set(second, secondAt);
    expect(sfntTable(one, 0, 'test')).toStrictEqual(Uint8Array.of(1, 2, 3));
    expect(sfntTable(two, 0, 'test')).toStrictEqual(Uint8Array.of(7, 8));
    expect(sfntTable(collection, 0, 'test')).toStrictEqual(Uint8Array.of(1, 2, 3));
    expect(sfntTable(collection, 1, 'test')).toStrictEqual(Uint8Array.of(7, 8));
    expect(sfntTable(collection, 2, 'test')).toBeUndefined();
  });

  it('says a table that runs past the file is damaged, and the fact reader reads it as absent', () => {
    const damaged = face({ name: Uint8Array.of(0, 0, 0, 0, 0, 6) }).slice(0, -2);
    expect(sfntTableEntry(damaged, 0, 'name')).toBe('past-end');
    expect(sfntTable(damaged, 0, 'name')).toBeUndefined();
    expect(sfntTable(Uint8Array.of(1, 2, 3), 0, 'name')).toBeUndefined();
  });
});

describe('nothing reads a table through HarfBuzz', () => {
  it('a face made, measured and counted asks HarfBuzz for no table, and readable() makes ONE blob', () => {
    const blobs = made.blobs;
    const tables = made.tables;
    const shaping = ShapingFace.readable(ARIMO);
    if (shaping === null) throw new Error('Arimo is readable');
    expect(made.blobs - blobs).toBe(1);
    shaping.metrics();
    expect(shaping.glyphCount()).toBeGreaterThan(0);
    readFace(ARIMO);
    expect(made.tables - tables).toBe(0);
  });

  // CONTROL: the counter sees a table read through HarfBuzz, so the zero above is the code's and not a blind wrapper's.
  it('CONTROL: a table read through HarfBuzz is counted', () => {
    const tables = made.tables;
    new Face(new Blob(ARIMO), 0).referenceTable('head');
    expect(made.tables - tables).toBe(1);
  });

  /** The class, by the source: no shipped kernel module calls `referenceTable`; the one reader is `sfntTables.ts`. */
  it('no shipped kernel module calls referenceTable', () => {
    const root = fileURLToPath(new URL('./', import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(100);
    const calling = files.filter((name) => readFileSync(join(root, name), 'utf8').includes('.referenceTable('));
    expect(calling).toStrictEqual([]);
  });
});
