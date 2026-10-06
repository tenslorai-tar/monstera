import { mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAnnounced } from './announcedOutput.js';
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
