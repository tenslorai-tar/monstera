import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeRetiredCaches } from './retiredCaches.js';

describe('the retired handwriting cache', () => {
  let userData: string;

  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'monstera-retired-'));
  });

  afterEach(async () => {
    await rm(userData, { recursive: true, force: true });
  });

  it('is removed at start and the log names what went, nested files included', async () => {
    const cache = join(userData, 'handwriting');
    await mkdir(join(cache, 'small'), { recursive: true });
    await writeFile(join(cache, 'tokenizer.json'), Buffer.alloc(7));
    await writeFile(join(cache, 'small', 'encoder.onnx'), Buffer.alloc(13));
    const notes: string[] = [];

    await removeRetiredCaches(userData, (detail) => notes.push(detail));

    expect(existsSync(cache)).toBe(false);
    expect(notes).toStrictEqual([
      'removed handwriting/ (2 files, 20 bytes): the local handwriting engine was removed by ' +
        'ADR-0085 and nothing reads it',
    ]);
  });

  it('says nothing on a start that finds no cache, which is every start after the first', async () => {
    const notes: string[] = [];
    await removeRetiredCaches(userData, (detail) => notes.push(detail));
    await removeRetiredCaches(userData, (detail) => notes.push(detail));
    expect(notes).toStrictEqual([]);
  });

  it('touches nothing else under userData', async () => {
    // THE CONTROL for the one above: a sweep that removed everything would pass
    // "the cache is gone" and fail this.
    await mkdir(join(userData, 'handwriting'));
    await writeFile(join(userData, 'settings.json'), '{}');
    await mkdir(join(userData, 'logs'));

    await removeRetiredCaches(userData, () => undefined);

    expect(existsSync(join(userData, 'settings.json'))).toBe(true);
    expect(existsSync(join(userData, 'logs'))).toBe(true);
  });

  it('reports a cache it could not read rather than calling it absent', async () => {
    // A FILE where the directory should be: `readdir` refuses with ENOTDIR, which is
    // not ENOENT, so the absent branch must not take it.
    await writeFile(join(userData, 'handwriting'), 'not a directory');
    const notes: string[] = [];

    await removeRetiredCaches(userData, (detail) => notes.push(detail));

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^could not remove handwriting\/: /u);
  });
});
