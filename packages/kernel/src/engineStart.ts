/**
 * Whether a process's exit code says a part of Monstera could not START on this computer — the one reading of it
 * that every engine host and every contained converter takes.
 *
 * Why it is its own question: 0.1.15.0 read x2t's `STATUS_DLL_NOT_FOUND` as a conversion that ran out of memory,
 * halved the workbook, and then told the person the file "may be damaged"; and a MuPDF host whose library would not
 * load was waited on twice for ten seconds and then reported as a file that could not be opened. Neither is about
 * the document. Both are about the computer, and the person can only act on it if they are told that.
 *
 * Imports nothing, so `main` can ask without loading an engine (ADR-0026's barrel discipline).
 */

/**
 * The exit code an engine host uses when its engine library could not be loaded (`loadEngineLibrary` threw). Outside
 * Node's own codes (1–14) and the signal range, so nothing else ends a host with it.
 */
export const ENGINE_UNLOADABLE_EXIT = 90;

/**
 * Windows' loader statuses, each meaning the program never reached its first line:
 * `STATUS_DLL_NOT_FOUND`, `STATUS_ENTRYPOINT_NOT_FOUND` (a DLL too old for it), `STATUS_INVALID_IMAGE_FORMAT` and
 * `STATUS_DLL_INIT_FAILED`.
 */
export const LOADER_FAILURES: readonly number[] = Object.freeze([0xc0000135, 0xc0000139, 0xc000007b, 0xc0000142]);

/** Whether `code` says the process could not start on this computer, rather than that its work failed. */
export function couldNotStart(code: number): boolean {
  return code === ENGINE_UNLOADABLE_EXIT || LOADER_FAILURES.includes(code >>> 0);
}
