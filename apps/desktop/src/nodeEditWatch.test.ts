import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { watchEdits, type EditWatch } from './externalEditWatch.js';
import { nodeEditWatchSurface } from './nodeEditWatch.js';

/**
 * The REAL surface on a REAL directory, through every save pattern ADR-0062's table
 * measured — the half of the watch a fake cannot answer for.
 *
 * Each case writes the page, starts the watch with that page's digest, saves the way an
 * editor does, and waits a bounded time. The control writes identical bytes: that is an
 * event and must not be an edit.
 */

const WAIT_MS = 8_000;

const directories: string[] = [];
const watches: EditWatch[] = [];

afterEach(() => {
  for (const watch of watches.splice(0)) watch.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');

async function pageOut(original: string): Promise<{ readonly path: string; readonly watch: EditWatch }> {
  const directory = mkdtempSync(join(tmpdir(), 'monstera-edit-watch-'));
  directories.push(directory);
  const path = join(directory, 'page.pdf');
  await writeFile(path, original);
  const watch = watchEdits(nodeEditWatchSurface, path, sha256(original));
  if (watch === null) throw new Error('the platform refused to watch a directory this case just made');
  watches.push(watch);
  return { path, watch };
}

describe('nodeEditWatchSurface — every save pattern in ADR-0062’s table', () => {
  it('written IN PLACE is an edit', async () => {
    const { path, watch } = await pageOut('%PDF-original');
    await writeFile(path, '%PDF-edited-in-place');
    await expect(watch.wait(WAIT_MS)).resolves.toBe('changed');
    expect(watch.pending()).toBe(sha256('%PDF-edited-in-place'));
  }, 15_000);

  it('written to a TEMPORARY file and RENAMED over it is an edit', async () => {
    const { path, watch } = await pageOut('%PDF-original');
    const temporary = `${path}.tmp`;
    await writeFile(temporary, '%PDF-saved-through-a-temporary');
    await rename(temporary, path);
    await expect(watch.wait(WAIT_MS)).resolves.toBe('changed');
    expect(watch.pending()).toBe(sha256('%PDF-saved-through-a-temporary'));
  }, 15_000);

  it('DELETED and then RECREATED is an edit', async () => {
    const { path, watch } = await pageOut('%PDF-original');
    await rm(path);
    await writeFile(path, '%PDF-recreated');
    await expect(watch.wait(WAIT_MS)).resolves.toBe('changed');
    expect(watch.pending()).toBe(sha256('%PDF-recreated'));
  }, 15_000);

  it('TWO temp-and-rename saves in a row are one edit, of the SECOND save’s bytes', async () => {
    const { path, watch } = await pageOut('%PDF-original');
    for (const content of ['%PDF-first-save', '%PDF-second-save']) {
      const temporary = `${path}.tmp`;
      await writeFile(temporary, content);
      await rename(temporary, path);
    }
    await expect(watch.wait(WAIT_MS)).resolves.toBe('changed');
    expect(watch.pending()).toBe(sha256('%PDF-second-save'));
  }, 15_000);

  it('CONTROL: rewriting the SAME bytes is an event and not an edit', async () => {
    // Without this, a surface that answered `changed` for every event would pass the four
    // cases above. The bound is past the quiet second, so a look did happen.
    const { path, watch } = await pageOut('%PDF-original');
    await writeFile(path, '%PDF-original');
    await expect(watch.wait(3_000)).resolves.toBe('unchanged');
    expect(watch.pending()).toBeNull();
  }, 15_000);
});
