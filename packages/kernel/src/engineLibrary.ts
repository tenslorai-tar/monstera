import koffi, { type LibraryHandle } from 'koffi';

/**
 * Loads an engine library by its absolute path with its own folder searched FIRST for what it imports.
 *
 * ## Why koffi's own load is not enough
 *
 * `koffi.load` calls `LoadLibraryW(path)` and only on failure retries with
 * `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR`. The first call resolves a library's imports through the standard search order:
 * the application directory, then `System32` — never the library's own folder. So with the Visual C++ runtime
 * shipped beside the MuPDF shim (`scripts/release/dllClosure.mjs`), a PC whose `System32` holds an OLDER runtime
 * succeeds on that first call and binds the shim to it; a 14.44 build in a runtime older than 14.40 can crash
 * (Microsoft's 17.10 `std::mutex` change). The retry would have found the right copy, and never runs.
 *
 * ## The mechanism
 *
 * `LoadLibraryExW` with `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS` (0x1100) searches the
 * library's own folder before the application directory and `System32`, so every import that ships beside it binds to
 * the shipped copy. The module is then mapped, and `koffi.load` of the same path takes the loaded module instead of
 * resolving anything again. The handle is held for the process's life: the engine is never unloaded.
 */

/** `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS`, from `libloaderapi.h`. */
export const SEARCH_BESIDE_FIRST = 0x00000100 | 0x00001000;

/** What loading needs from the machine, injectable so the order is testable without Windows. */
export interface EngineLibrarySurface {
  readonly platform: NodeJS.Platform;
  /** `LoadLibraryExW(path, NULL, flags)`: the module, or the Win32 error that refused it. */
  readonly loadWithFlags: (path: string, flags: number) => { readonly ok: true } | { readonly ok: false; readonly error: number };
  readonly load: (path: string) => LibraryHandle;
}

/**
 * A library Windows' loader refused, with the Win32 error — 126 is a missing import, 127 a missing entry point (a
 * runtime too old for the library), 193 an image built for another machine.
 */
export class EngineLibraryUnloadable extends Error {
  readonly win32Error: number;

  constructor(path: string, win32Error: number) {
    super(`Windows could not load ${path}: error ${String(win32Error)}`);
    this.name = 'EngineLibraryUnloadable';
    this.win32Error = win32Error;
  }
}

const held: unknown[] = [];

/** The machine's own surface. Binds kernel32 on first use, only on Windows. */
function windowsSurface(): EngineLibrarySurface {
  return {
    platform: process.platform,
    loadWithFlags(path, flags) {
      const kernel = koffi.load('kernel32.dll');
      const loadLibraryEx = kernel.func('void *__stdcall LoadLibraryExW(const char16_t *name, void *file, uint32_t flags)');
      const lastError = kernel.func('uint32_t __stdcall GetLastError(void)');
      const module: unknown = loadLibraryEx(path, null, flags);
      if (module === null) return { ok: false, error: Number(lastError()) };
      held.push(module);
      return { ok: true };
    },
    load: (path) => koffi.load(path),
  };
}

/**
 * The engine library at `path`, its imports bound from its own folder first.
 *
 * @throws {EngineLibraryUnloadable} where Windows' loader refuses it
 */
export function loadEngineLibrary(path: string, surface: EngineLibrarySurface = windowsSurface()): LibraryHandle {
  if (surface.platform === 'win32') {
    const loaded = surface.loadWithFlags(path, SEARCH_BESIDE_FIRST);
    if (!loaded.ok) throw new EngineLibraryUnloadable(path, loaded.error);
  }
  return surface.load(path);
}
