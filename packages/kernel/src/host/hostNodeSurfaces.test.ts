import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hostFilesystem } from './hostNodeSurfaces.js';

/**
 * The host's real file surface. `readSnapshot` hands the document's bytes to the engine, and the whole point of
 * reading them as a view is that it does not copy them — measured, 210 MB of the 200 MB scan's open peak. What a test
 * can hold it to is the property the view must keep: the array owns exactly what it spans, so its `.buffer` is the
 * document and nothing else (a `ByteImage`'s rule).
 */
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'monstera-host-files-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the host reads a snapshot', () => {
  it.each([
    ['a small file', 37],
    ['a file larger than any pool', 3 * 1024 * 1024],
  ])('%s: the document’s own bytes, in an array that owns exactly what it spans', async (_label, size) => {
    const bytes = Uint8Array.from({ length: size }, (_unused, index) => (index * 31 + 7) & 0xff);
    writeFileSync(join(directory, 'snapshot.pdf'), bytes);

    const read = await hostFilesystem.readSnapshot(directory, 'snapshot.pdf');
    expect(read.byteLength).toBe(size);
    expect(read.byteOffset).toBe(0);
    expect(read.buffer.byteLength).toBe(size);
    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true);
  });
});
