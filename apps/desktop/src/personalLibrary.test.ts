import { MAX_LIBRARY_ENTRIES } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { createPersonalLibrary, memoryPictureFiles, pictureTypeOf } from './personalLibrary.js';

/** A PNG's eight signature bytes and a little more — the store reads the type from the bytes, nothing else. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

/** A library over a memory folder, with ids handed out in order so a case can name them. */
function library(): {
  readonly store: ReturnType<typeof createPersonalLibrary>;
  readonly files: ReturnType<typeof memoryPictureFiles>;
  readonly reported: string[];
} {
  const files = memoryPictureFiles();
  const reported: string[] = [];
  let next = 0;
  const store = createPersonalLibrary({
    files,
    unreadable: (detail) => reported.push(detail),
    newId: () => {
      next += 1;
      return `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
    },
  });
  return { store, files, reported };
}

describe('the person’s library', () => {
  it('reads a picture’s TYPE from its bytes — a PNG, a JPEG, and CONTROL: text named .png is neither', () => {
    expect(pictureTypeOf(PNG)).toBe('image/png');
    expect(pictureTypeOf(JPEG)).toBe('image/jpeg');
    expect(pictureTypeOf(new TextEncoder().encode('not a picture'))).toBeNull();
  });

  it('keeps a picture under its entry’s id, named from the file’s own name, and reads it back', () => {
    const { store, files } = library();
    const added = store.addPicture('stamp', 'Paid in full.png', PNG);
    expect(added.kind).toBe('added');
    const id = added.kind === 'added' ? added.entry.id : '';
    expect(store.list('stamp')).toStrictEqual([{ id, kind: 'stamp', look: { kind: 'picture', name: 'Paid in full' } }]);
    // THE FILE IS NAMED BY THE ID, never by what the person called theirs.
    expect([...files.names()].sort()).toStrictEqual([`${id}.png`, 'index.json']);
    expect(store.picture(id)).toStrictEqual({ mediaType: 'image/png', bytes: PNG });
    // AND A KIND KEEPS ITS OWN: a stamp is not among the signatures.
    expect(store.list('signature')).toStrictEqual([]);
  });

  it('REFUSES bytes that are not a picture, and keeps nothing for them', () => {
    const { store, files } = library();
    expect(store.addPicture('stamp', 'notes.png', new TextEncoder().encode('hello'))).toStrictEqual({ kind: 'unreadable' });
    expect(files.names()).toStrictEqual([]);
  });

  it('keeps a typed or drawn signature as it was made, and a picture signature beside them', () => {
    const { store } = library();
    const typed = store.keepSignature({ kind: 'typed', text: 'A. Tester', font: 'garamond-italic' });
    const drawn = store.keepSignature({ kind: 'drawn', strokes: [[[0.1, 0.1], [0.5, 0.2]]] });
    store.addPicture('signature', 'ink.jpg', JPEG);
    expect(store.list('signature').map((entry) => entry.look.kind)).toStrictEqual(['typed', 'drawn', 'picture']);
    expect(typed.kind === 'added' ? store.lookup(typed.entry.id)?.look : undefined).toStrictEqual({
      kind: 'typed',
      text: 'A. Tester',
      font: 'garamond-italic',
    });
    expect(drawn.kind).toBe('added');
  });

  it('READS a library kept before ADR-0150, whose typed signatures name a retired face — nothing is dropped', () => {
    // THE FILE AS AN EARLIER BUILD WROTE IT: one typed signature in each of the four base-14 faces. A library is read
    // whole and refused whole, so a schema that took only the fifteen faces would answer it damaged and lose all four.
    const { store, files, reported } = library();
    const entries = (['helvetica', 'times-roman', 'times-italic', 'courier'] as const).map((font, at) => ({
      id: `00000000-0000-4000-8000-00000000000${String(at + 1)}`,
      kind: 'signature',
      look: { kind: 'typed', text: 'A. Tester', font },
    }));
    files.write('index.json', new TextEncoder().encode(JSON.stringify({ version: 1, entries })));
    expect(store.list('signature').map((entry) => entry.look)).toStrictEqual(entries.map((entry) => entry.look));
    expect(reported).toStrictEqual([]);
  });

  it('holds at most the bound of each kind — the next is FULL and keeps nothing, while the other kind still has room', () => {
    const { store } = library();
    for (let index = 0; index < MAX_LIBRARY_ENTRIES; index += 1) store.addPicture('stamp', `s${String(index)}.png`, PNG);
    expect(store.addPicture('stamp', 'one-more.png', PNG)).toStrictEqual({ kind: 'full', limit: MAX_LIBRARY_ENTRIES });
    expect(store.list('stamp')).toHaveLength(MAX_LIBRARY_ENTRIES);
    expect(store.addPicture('signature', 'ink.png', PNG).kind).toBe('added');
  });

  it('REMOVES an entry and its file; a second removal answers that there was none', () => {
    const { store, files } = library();
    const added = store.addPicture('stamp', 'paid.png', PNG);
    const id = added.kind === 'added' ? added.entry.id : '';
    expect(store.remove(id)).toBe(true);
    expect(store.list('stamp')).toStrictEqual([]);
    expect(files.names()).toStrictEqual(['index.json']);
    expect(store.picture(id)).toBeNull();
    expect(store.remove(id)).toBe(false);
  });

  it('never lists a file the index does not name — a stray file in the folder is not a stamp', () => {
    const { store, files } = library();
    files.write('00000000-0000-4000-8000-00000000abcd.png', PNG);
    expect(store.list('stamp')).toStrictEqual([]);
    expect(store.picture('00000000-0000-4000-8000-00000000abcd')).toBeNull();
  });

  it('SETS ASIDE an index it cannot read before writing a new one — CONTROL: a readable index is not copied', () => {
    const { store, files, reported } = library();
    files.write('index.json', new TextEncoder().encode('{ not json'));
    expect(store.list('stamp')).toStrictEqual([]);
    expect(reported).toStrictEqual(['SyntaxError']);
    store.addPicture('stamp', 'paid.png', PNG);
    expect(new TextDecoder().decode(files.read('index.unreadable.json') ?? new Uint8Array())).toBe('{ not json');
    expect(store.list('stamp')).toHaveLength(1);

    const clean = library();
    clean.store.addPicture('stamp', 'a.png', PNG);
    clean.store.addPicture('stamp', 'b.png', PNG);
    expect(clean.files.read('index.unreadable.json')).toBeNull();
    expect(clean.reported).toStrictEqual([]);
  });
});
