import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LibraryHandle } from 'koffi';
import { describe, expect, it } from 'vitest';

import { EngineLibraryUnloadable, SEARCH_BESIDE_FIRST, type EngineLibrarySurface, loadEngineLibrary } from './engineLibrary.js';

const SHIM = 'C:\\Program Files\\WindowsApps\\Monstera\\resources\\native\\mupdf-shim\\monstera_mupdf.dll';

/** A surface that records each call in order. */
function recording(platform: NodeJS.Platform, refuse: number | null = null) {
  const calls: string[] = [];
  const handle = {} as LibraryHandle;
  const surface: EngineLibrarySurface = {
    platform,
    loadWithFlags(path, flags) {
      calls.push(`flags ${path} 0x${flags.toString(16)}`);
      return refuse === null ? { ok: true } : { ok: false, error: refuse };
    },
    load(path) {
      calls.push(`load ${path}`);
      return handle;
    },
  };
  return { calls, surface, handle };
}

describe('loadEngineLibrary', () => {
  it("on Windows maps the library with its own folder searched first, BEFORE koffi resolves anything", () => {
    const { calls, surface, handle } = recording('win32');
    expect(loadEngineLibrary(SHIM, surface)).toBe(handle);
    expect(calls).toEqual([`flags ${SHIM} 0x1100`, `load ${SHIM}`]);
  });

  it('the flags are LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR and LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, nothing else', () => {
    // 0x100 puts the library's folder first; 0x1000 keeps the application directory and System32 after it. Without
    // 0x100 the search is koffi's first attempt's, which never looks beside the library.
    expect(SEARCH_BESIDE_FIRST).toBe(0x100 | 0x1000);
  });

  it("a loader refusal is named with Windows' error and koffi is never asked", () => {
    const { calls, surface } = recording('win32', 126);
    let thrown: unknown;
    try {
      loadEngineLibrary(SHIM, surface);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EngineLibraryUnloadable);
    expect((thrown as EngineLibraryUnloadable).win32Error).toBe(126);
    expect(calls).toEqual([`flags ${SHIM} 0x1100`]);
  });

  it('on the machine’s own surface, the error a refusal names is the loader’s, read after koffi’s call (GGGGGGGG-12)', () => {
    // `GetLastError` is read through koffi in a second call after `LoadLibraryExW` returned NULL, so anything that ran a
    // Win32 call in between would replace it — read as 0, or as whatever that call set. Measured 2026-10-16: 18 of 18
    // refusals named their own error under Node and under the Electron binary in Node mode (126 missing, 193 not an
    // image). This holds it: a file that is not an image must be refused as 193, which an overwritten error cannot be.
    const folder = mkdtempSync(join(tmpdir(), 'engine-library-'));
    const notImage = join(folder, 'notimage.dll');
    writeFileSync(notImage, 'this is not a portable executable');
    try {
      let thrown: unknown;
      try {
        loadEngineLibrary(notImage);
      } catch (error) {
        thrown = error;
      }
      // OFF WINDOWS the library loader is the system's and names no Win32 error; refused all the same.
      if (process.platform !== 'win32') {
        expect(thrown).toBeInstanceOf(Error);
        return;
      }
      expect(thrown).toBeInstanceOf(EngineLibraryUnloadable);
      expect((thrown as EngineLibraryUnloadable).win32Error).toBe(193);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('CONTROL: off Windows there is no search order to set, and the library is loaded as it is', () => {
    const { calls, surface } = recording('linux');
    loadEngineLibrary('/opt/libmonstera_mupdf.so', surface);
    expect(calls).toEqual(['load /opt/libmonstera_mupdf.so']);
  });
});
