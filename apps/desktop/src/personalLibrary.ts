import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';

import {
  type LibraryEntry,
  type LibraryId,
  type LibraryKind,
  MAX_LIBRARY_ENTRIES,
  MAX_LIBRARY_NAME,
  libraryEntrySchema,
  type keepableSignatureSchema,
} from '@monstera/contract';
import { z } from 'zod';

import { type HeldPicture, NO_HELD_PICTURE } from './heldPicture.js';
import type { PictureFiles } from './recentPictures.js';
import type { SignaturePictureSource } from './signaturePicture.js';

/**
 * A library folder held in memory — for a graph built with no folder, every unit test's — so the library works for the
 * run and keeps nothing after it.
 */
export function memoryPictureFiles(): PictureFiles {
  const held = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    write: (name, bytes) => {
      held.set(name, new Uint8Array(bytes));
    },
    read: (name) => held.get(name) ?? null,
    remove: (name) => {
      held.delete(name);
    },
    names: () => [...held.keys()],
  };
}

/** The handlers' library surface with a memory folder and a picker nobody answers: every unit test's handler graph. */
export function unusedLibrarySurface(): {
  readonly store: PersonalLibrary;
  readonly pick: () => Promise<string | null>;
  readonly size: (path: string) => Promise<number | null>;
  readonly read: (path: string) => Promise<{ readonly kind: 'unreadable' }>;
  readonly held: HeldPicture;
  readonly signaturePicture: SignaturePictureSource;
} {
  return {
    store: createPersonalLibrary({ files: memoryPictureFiles(), unreadable: () => undefined }),
    pick: () => Promise.resolve(null),
    size: () => Promise.resolve(null),
    read: () => Promise.resolve({ kind: 'unreadable' }),
    held: NO_HELD_PICTURE,
    signaturePicture: { pick: () => Promise.resolve(null), read: () => Promise.resolve({ kind: 'unreadable' }), scan: null },
  };
}

/** A kept picture's type, from its own first bytes. */
export type PictureType = 'image/png' | 'image/jpeg';

/** A kept signature the person typed or drawn, as `library.keepSignature` takes it. */
export type KeepableSignature = z.infer<typeof keepableSignatureSchema>;

/** What adding a picture came to. */
export type AddPictureOutcome =
  | { readonly kind: 'added'; readonly entry: LibraryEntry }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'full'; readonly limit: number };

/** The person's library (Part F's stamp and signature libraries), kept by `main`. */
export interface PersonalLibrary {
  /** Every entry of a kind, oldest first. */
  list(kind: LibraryKind): readonly LibraryEntry[];
  /** One entry by id, or `undefined` for one not kept. */
  lookup(id: LibraryId): LibraryEntry | undefined;
  /** A kept picture's bytes and type, or `null` for an id with no picture. */
  picture(id: LibraryId): { readonly mediaType: PictureType; readonly bytes: Uint8Array } | null;
  /**
   * Keeps a picture a person picked. `fileName` is the picked file's own name, never stored as a path: its base name,
   * without the extension, becomes the entry's name. The bytes decide whether it is a picture at all.
   */
  addPicture(kind: LibraryKind, fileName: string, bytes: Uint8Array): AddPictureOutcome;
  /** Keeps a typed or drawn signature. */
  keepSignature(
    mark: KeepableSignature,
  ): { readonly kind: 'added'; readonly entry: LibraryEntry } | { readonly kind: 'full'; readonly limit: number };
  /** Removes an entry and its picture. Answers whether there was one. */
  remove(id: LibraryId): boolean;
}

/** The index's own file, beside the pictures in the library's folder. */
const INDEX = 'index.json';

/** The index as it is written: a version, so a later shape can be read beside this one, and the entries. */
const indexSchema = z.object({ version: z.literal(1), entries: z.array(libraryEntrySchema) }).strict();

/**
 * A picture's type from its own first bytes — PNG's eight-byte signature, JPEG's start-of-image marker — or `null`.
 * THE BYTES, NEVER THE EXTENSION: a file picked through a filter can still be anything, and a name is a hint to the
 * picker rather than a check (`imagePicker.ts`' rule).
 */
export function pictureTypeOf(bytes: Uint8Array): PictureType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** A picture's file name: its entry's id and its type's extension — never anything the person named. */
function pictureFile(id: LibraryId, type: PictureType): string {
  return `${id}${type === 'image/png' ? '.png' : '.jpg'}`;
}

/** The entry's name from a picked file's name: the base name without its extension, bounded, never empty. */
function nameFrom(fileName: string): string {
  const stem = basename(fileName, extname(fileName)).trim();
  return (stem === '' ? basename(fileName) : stem).slice(0, MAX_LIBRARY_NAME) || 'picture';
}

/**
 * The person's library of image stamps and kept signatures, in one folder under the application's data.
 *
 * ## One index and a file per picture, and the index is the writer of record
 *
 * `index.json` says what is kept; a picture file is named by its entry's UUID and read only through an entry, so a
 * stray file in the folder is never listed and a name a person gave a file never becomes a path. The index is read
 * from disk at every call rather than cached, so two windows never hold two opinions about the library.
 *
 * ## An index this build cannot read is SET ASIDE, never overwritten
 *
 * A damaged index lists nothing — and the next keep would write a fresh one over whatever it held. So before the first
 * write after a failed read the old file is moved to `index.unreadable.json`, where a person or a later build can still
 * recover it, and `unreadable` reports it. A library that silently lost its entries would be the reassuring answer.
 */
export function createPersonalLibrary(deps: {
  readonly files: PictureFiles;
  /** Where an index that could not be read is reported: the shell log, with the reason's name only. */
  readonly unreadable: (detail: string) => void;
  readonly newId?: () => LibraryId;
}): PersonalLibrary {
  const newId = deps.newId ?? ((): LibraryId => randomUUID());

  const read = (): { readonly entries: LibraryEntry[]; readonly damaged: boolean } => {
    const bytes = deps.files.read(INDEX);
    if (bytes === null) return { entries: [], damaged: false };
    try {
      const parsed = indexSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (parsed.success) return { entries: parsed.data.entries, damaged: false };
      deps.unreadable('schema');
    } catch (thrown) {
      deps.unreadable(thrown instanceof Error ? thrown.name : 'unknown');
    }
    return { entries: [], damaged: true };
  };

  const write = (entries: readonly LibraryEntry[], damaged: boolean): void => {
    if (damaged) {
      const old = deps.files.read(INDEX);
      if (old !== null) deps.files.write('index.unreadable.json', old);
    }
    deps.files.write(INDEX, new TextEncoder().encode(JSON.stringify({ version: 1, entries })));
  };

  const typeOfEntry = (entry: LibraryEntry): PictureType | null => {
    if (entry.look.kind !== 'picture') return null;
    for (const type of ['image/png', 'image/jpeg'] as const) {
      if (deps.files.read(pictureFile(entry.id, type)) !== null) return type;
    }
    return null;
  };

  return {
    list: (kind) => read().entries.filter((entry) => entry.kind === kind),
    lookup: (id) => read().entries.find((entry) => entry.id === id),
    picture: (id) => {
      const entry = read().entries.find((each) => each.id === id);
      if (entry === undefined) return null;
      const type = typeOfEntry(entry);
      if (type === null) return null;
      const bytes = deps.files.read(pictureFile(entry.id, type));
      return bytes === null ? null : { mediaType: type, bytes };
    },
    addPicture: (kind, fileName, bytes) => {
      const type = pictureTypeOf(bytes);
      if (type === null) return { kind: 'unreadable' };
      const { entries, damaged } = read();
      if (entries.filter((entry) => entry.kind === kind).length >= MAX_LIBRARY_ENTRIES) {
        return { kind: 'full', limit: MAX_LIBRARY_ENTRIES };
      }
      const id = newId();
      const look = { kind: 'picture' as const, name: nameFrom(fileName) };
      const entry: LibraryEntry = kind === 'stamp' ? { id, kind, look } : { id, kind, look };
      // THE PICTURE BEFORE THE INDEX: an index naming a file that was never written would list a picture nothing can
      // show, where a file with no entry is simply never read.
      deps.files.write(pictureFile(id, type), bytes);
      write([...entries, entry], damaged);
      return { kind: 'added', entry };
    },
    keepSignature: (mark) => {
      const { entries, damaged } = read();
      if (entries.filter((entry) => entry.kind === 'signature').length >= MAX_LIBRARY_ENTRIES) {
        return { kind: 'full', limit: MAX_LIBRARY_ENTRIES };
      }
      const entry: LibraryEntry = { id: newId(), kind: 'signature', look: mark };
      write([...entries, entry], damaged);
      return { kind: 'added', entry };
    },
    remove: (id) => {
      const { entries, damaged } = read();
      const entry = entries.find((each) => each.id === id);
      if (entry === undefined) return false;
      write(
        entries.filter((each) => each.id !== id),
        damaged,
      );
      // THE INDEX FIRST, the reverse of adding and for its reason: an entry whose file is gone would list a picture
      // nothing can show, where a file with no entry is never read.
      for (const type of ['image/png', 'image/jpeg'] as const) deps.files.remove(pictureFile(id, type));
      return true;
    },
  };
}
