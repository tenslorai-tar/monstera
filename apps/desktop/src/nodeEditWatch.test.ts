import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, watch as nodeWatch } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import koffi from 'koffi';
import { afterEach, describe, expect, it } from 'vitest';

import { watchEdits, type EditWatch, type EditWatchSurface } from './externalEditWatch.js';
import { nodeEditWatchSurface, nodeEditWatchSurfaceWith } from './nodeEditWatch.js';

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

async function pageOut(
  original: string,
  surface: EditWatchSurface = nodeEditWatchSurface,
): Promise<{ readonly path: string; readonly watch: EditWatch }> {
  const directory = mkdtempSync(join(tmpdir(), 'monstera-edit-watch-'));
  directories.push(directory);
  const path = join(directory, 'page.pdf');
  await writeFile(path, original);
  const watch = watchEdits(surface, path, sha256(original));
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
    // cases above. THE LOOK IS COUNTED, not inferred from the bound (audit HHHHHH-8): an
    // `unchanged` is also what a platform that delivered no event for the rewrite produces,
    // and then this case would pass without the digest ever being compared.
    let looks = 0;
    const counting: EditWatchSurface = {
      ...nodeEditWatchSurface,
      digest: (target) => {
        looks += 1;
        return nodeEditWatchSurface.digest(target);
      },
    };
    const { path, watch } = await pageOut('%PDF-original', counting);
    await writeFile(path, '%PDF-original');
    await expect(watch.wait(3_000)).resolves.toBe('unchanged');
    expect(looks).toBeGreaterThanOrEqual(1);
    expect(watch.pending()).toBeNull();
  }, 15_000);
});

/**
 * WHICH PATH reaches `fs.watch`. libuv's Windows watcher aborts the process when the
 * watched directory and the long path it builds for a change disagree in form, so the
 * decision under test is the argument handed to `watch`, never the events that follow: a
 * run that did not abort looks the same whether the path was resolved or merely lucky.
 */
describe('nodeEditWatchSurface — the directory is watched by its real, long path', () => {
  // The recorder watches for real, so the surface's `on('error')` and `close()` meet a real
  // FSWatcher; what it adds is the one fact under test, the path it was handed. The surface
  // takes no resolver — only `watch` is injectable — so every case here runs production's.
  function recording(): { readonly surface: EditWatchSurface; readonly watched: string[] } {
    const watched: string[] = [];
    const surface = nodeEditWatchSurfaceWith({
      watch: (directory, listener) => {
        watched.push(directory);
        return nodeWatch(directory, listener);
      },
    });
    return { surface, watched };
  }

  it('a directory reached through a LINK is watched at its target', () => {
    const target = mkdtempSync(join(tmpdir(), 'monstera-edit-watch-target-'));
    const link = `${target}-link`;
    directories.push(target, link);
    symlinkSync(target, link, 'junction');

    const { surface, watched } = recording();
    const handle = surface.watchDirectory(link, () => undefined, () => undefined);
    handle?.close();

    // Built from something the unresolved path would NOT satisfy: `link` names the
    // directory, so a surface that passed it straight through would watch successfully
    // and record `link` here.
    expect(watched).toStrictEqual([realpathSync.native(target)]);
    expect(watched[0]).not.toBe(link);
  });

  /**
   * A directory's 8.3 short form, from the operating system's own call.
   *
   * `GetShortPathNameW` through koffi, as `win32DirectorySurface.ts` binds kernel32. Until
   * 2026-09-15 this started PowerShell and asked a COM object, which took 4,177–5,295 ms here
   * (three runs) and once exceeded the case's 20 s bound on a GitHub Windows runner, reddening
   * CI on a change that touched nothing this file tests. The fixture's cost was the whole of
   * that run; the call under test takes milliseconds.
   */
  const shortPathOf = (directory: string): string => {
    const kernel = koffi.load('kernel32.dll');
    // C prototype: DWORD GetShortPathNameW(LPCWSTR lpszLongPath, LPWSTR lpszShortPath, DWORD cchBuffer).
    const getShortPathName = kernel.func('uint32 GetShortPathNameW(const char16_t *longPath, void *shortPath, uint32 length)') as (
      longPath: string,
      shortPath: Buffer,
      length: number,
    ) => number;
    const capacity = 1024;
    const buffer = Buffer.alloc(capacity * 2);
    const written = getShortPathName(directory, buffer, capacity);
    // Zero is failure, and a figure at or past the capacity is the size the call NEEDED: both
    // are a broken read, never a short form, so neither is handed to the case as one.
    if (written === 0 || written >= capacity) {
      throw new Error(`GetShortPathNameW answered ${String(written)} for ${directory}`);
    }
    return buffer.toString('utf16le', 0, written * 2);
  };

  it.skipIf(process.platform !== 'win32')(
    'a directory named through an 8.3 SHORT path is watched in its long form (Windows)',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'monstera-edit-watch-a-name-with-a-short-form-'));
      directories.push(directory);
      const short = shortPathOf(directory);
      // A volume with 8.3 generation disabled has no short form to hand over, and then this
      // case would pass on `directory` itself. That is a could-not-look, so it says so
      // rather than passing: the runner this defect lives on has one by construction.
      if (short.toLowerCase() === directory.toLowerCase()) {
        throw new Error(`${directory} has no 8.3 short form on this volume; this case cannot separate anything here`);
      }

      const { surface, watched } = recording();
      const handle = surface.watchDirectory(short, () => undefined, () => undefined);
      handle?.close();

      // `realpathSync` without `.native` returns the short path unchanged (measured), so this
      // is the assertion that separates the two resolvers.
      expect(watched).toHaveLength(1);
      expect(watched[0]?.toLowerCase()).toBe(realpathSync.native(directory).toLowerCase());
      expect(watched[0]?.toLowerCase()).not.toBe(short.toLowerCase());
    },
  );

  it('CONTROL: a directory that cannot be resolved is refused as null, and nothing is watched', () => {
    const { surface, watched } = recording();
    const gone = join(tmpdir(), `monstera-edit-watch-absent-${String(process.pid)}-${String(Date.now())}`);
    expect(surface.watchDirectory(gone, () => undefined, () => undefined)).toBeNull();
    expect(watched).toStrictEqual([]);
  });
});
