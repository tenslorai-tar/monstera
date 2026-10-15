import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { copyAnnounced, readAnnounced } from './announcedOutput.js';
import { EngineSerialiseMismatch } from './remoteLifecycle.js';

/**
 * A host's output read back against the count it announced (CR-SEC-08). The host is hostile by invariant 25's premise,
 * so the property is what `main` READS, not only what it answers: a file of another size is never read at all.
 */

const made: string[] = [];
afterEach(async () => {
  for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function output(bytes: Uint8Array): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'monstera-announced-'));
  made.push(directory);
  const path = join(directory, 'out');
  await writeFile(path, bytes);
  return { directory, path };
}

/**
 * The real file system, with every read's position and length recorded. `statedSize`, where given, is the size `stat`
 * answers in place of the file's: a file that grew between the host's write being sized and being read.
 */
function recordingFiles(statedSize?: number): {
  readonly files: { open: typeof open; rm: typeof rm };
  readonly reads: { at: number; length: number }[];
} {
  const reads: { at: number; length: number }[] = [];
  const opening = (async (path: string, flags: string) => {
    const handle = await open(path, flags);
    const read = handle.read.bind(handle) as (buffer: Uint8Array, offset: number, length: number, position: number) => ReturnType<typeof handle.read>;
    const stat = handle.stat.bind(handle);
    return Object.assign(handle, {
      read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
        reads.push({ at: position, length });
        return read(buffer, offset, length, position);
      },
      stat: async () => {
        const facts = await stat();
        return statedSize === undefined ? facts : Object.assign(facts, { size: statedSize });
      },
    });
  }) as unknown as typeof open;
  return { files: { open: opening, rm }, reads };
}

describe('readAnnounced', () => {
  it('answers exactly the announced bytes, in their own allocation, and removes the file', async () => {
    const { directory, path } = await output(Uint8Array.of(1, 2, 3, 4, 5));
    const bytes = await readAnnounced(path, 5);
    expect([...bytes]).toStrictEqual([1, 2, 3, 4, 5]);
    expect(bytes.buffer.byteLength).toBe(5);
    expect(await readdir(directory)).toStrictEqual([]);
  });

  it('reads NOTHING from a file larger than announced, refuses it, and removes it', async () => {
    // THE DECISION, not the end state: refusing after reading the whole file also ends in a refusal, so the case
    // asserts the reads that were made — none.
    const { directory, path } = await output(new Uint8Array(4096).fill(9));
    const { files, reads } = recordingFiles();
    await expect(readAnnounced(path, 10, files)).rejects.toBeInstanceOf(EngineSerialiseMismatch);
    expect(reads).toStrictEqual([]);
    expect(await readdir(directory)).toStrictEqual([]);
  });

  it('reads nothing from a file SMALLER than announced either', async () => {
    const { path } = await output(Uint8Array.of(1, 2));
    const { files, reads } = recordingFiles();
    await expect(readAnnounced(path, 99, files)).rejects.toBeInstanceOf(EngineSerialiseMismatch);
    expect(reads).toStrictEqual([]);
  });

  it('never asks for more than the count and one byte past it', async () => {
    const { path } = await output(new Uint8Array(1000).fill(3));
    const { files, reads } = recordingFiles();
    await readAnnounced(path, 1000, files);
    const asked = Math.max(...reads.map((read) => read.at + read.length));
    expect(asked).toBe(1001);
  });

  it('refuses a file that GREW after it was sized, reading one byte past the count and no further', async () => {
    // THE BRANCH NOTHING ELSE REACHES: `stat` said 10, the file holds 20. The count's 10 are read, the one past them
    // shows the growth, and nothing beyond that is asked for.
    const { directory, path } = await output(new Uint8Array(20).fill(5));
    const { files, reads } = recordingFiles(10);
    await expect(readAnnounced(path, 10, files)).rejects.toBeInstanceOf(EngineSerialiseMismatch);
    expect(Math.max(...reads.map((read) => read.at + read.length))).toBe(11);
    expect(await readdir(directory)).toStrictEqual([]);
  });

  it('refuses a directory where the file was named, and leaves nothing behind', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'monstera-announced-'));
    made.push(directory);
    const path = join(directory, 'out');
    await mkdir(path);
    await writeFile(join(path, 'inside'), 'x');
    // REFUSED EITHER WAY the platform answers: Linux opens a directory and its size is not a file's; Windows refuses
    // the open. Both end with the name gone.
    await expect(readAnnounced(path, 0)).rejects.toThrow();
    expect(await readdir(directory)).toStrictEqual([]);
  });
});

describe('copyAnnounced (ADR-0248)', () => {
  /** A directory standing for `main`'s own storage, which no area names. */
  async function owned(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'monstera-taken-'));
    made.push(directory);
    return directory;
  }

  it('copies exactly the announced bytes into main’s storage, removes the host’s file, and works on the copy in place', async () => {
    const bytes = Uint8Array.from({ length: 40 }, (_, at) => at);
    const { directory, path } = await output(bytes);
    const mine = join(await owned(), 'working');

    const file = await copyAnnounced(path, bytes.byteLength, mine);

    expect(await readdir(directory)).toStrictEqual([]);
    expect(file.byteLength).toBe(40);
    expect(Array.from(await file.read(10, 14))).toStrictEqual([10, 11, 12, 13]);
    await file.write(10, Uint8Array.of(0xaa, 0xbb));
    expect(Array.from(await file.read(9, 13))).toStrictEqual([9, 0xaa, 0xbb, 12]);
    // GIVEN UP AS A STAGED IMAGE: placed by a move, so the working file is gone and the destination holds the edit.
    const placed = join(await owned(), 'placed');
    await file.staged().place(placed);
    expect((await readFile(placed))[11]).toBe(0xbb);
    await expect(readFile(mine)).rejects.toThrow();
    await expect(file.read(0, 1)).rejects.toThrow('given up');
  });

  it('A HOST WRITING THROUGH A HANDLE IT KEPT reaches nothing main works on, since the file was copied', async () => {
    const { path } = await output(new Uint8Array(16).fill(0x30));
    const kept = await open(path, 'r+');
    try {
      const file = await copyAnnounced(path, 16, join(await owned(), 'working'));
      await kept.write(Uint8Array.of(0x58), 0, 1, 5);
      expect((await file.read(5, 6))[0]).toBe(0x30);
      await file.staged().discard();
    } finally {
      await kept.close();
    }
  });

  it('CONTROL: through a MOVE, the same kept handle writes into the file main would sign', async () => {
    const { path } = await output(new Uint8Array(16).fill(0x30));
    const kept = await open(path, 'r+');
    try {
      const moved = join(await owned(), 'moved');
      await rename(path, moved);
      await kept.write(Uint8Array.of(0x58), 0, 1, 5);
      expect((await readFile(moved))[5]).toBe(0x58);
    } finally {
      await kept.close();
    }
  });

  it('refuses a file of another size, copying nothing and leaving nothing on either side', async () => {
    const { directory, path } = await output(new Uint8Array(12));
    const mine = await owned();
    await expect(copyAnnounced(path, 10, join(mine, 'working'))).rejects.toBeInstanceOf(EngineSerialiseMismatch);
    expect(await readdir(directory)).toStrictEqual([]);
    expect(await readdir(mine)).toStrictEqual([]);
  });

  it('refuses a read or a write outside the file', async () => {
    const { path } = await output(new Uint8Array(8));
    const file = await copyAnnounced(path, 8, join(await owned(), 'working'));
    await expect(file.read(4, 9)).rejects.toThrow('no range');
    await expect(file.write(6, new Uint8Array(3))).rejects.toThrow('runs past');
    await file.staged().discard();
  });
});
