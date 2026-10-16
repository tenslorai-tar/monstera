import { EngineLibraryUnloadable } from '../engineLibrary.js';
import { ENGINE_UNLOADABLE_EXIT } from '../engineStart.js';

/**
 * Binds a host's engine library at startup, or ends the host with {@link ENGINE_UNLOADABLE_EXIT}.
 *
 * A host whose library Windows will not load cannot serve anything, and an uncaught throw would end it with Node's
 * generic code — indistinguishable in `main` from a host that crashed on a bug. The dedicated code is what lets
 * `main` say *a part of Monstera could not start on this computer* rather than *the file could not be opened*. The
 * loader's message goes to stderr first, which the factory points at the host's diagnostic file.
 */
export function bindEngineOrExit(bind: () => void): void {
  // HOW FAR THE START GOT, on the host's diagnostic file, which `main` quotes when a host does not reach its pipe in time:
  // the whole module graph is evaluated before an entry's first statement, and binding loads the native library, so the
  // two times say which of the start's parts a slow one spent its time in. Milliseconds since the process began (Node's
  // `performance.timeOrigin`). A host that connects has its file discarded unread.
  process.stderr.write(
    `started: runtime ready at ${String(Math.round(performance.nodeTiming.bootstrapComplete))} ms, ` +
      `modules evaluated at ${String(Math.round(performance.now()))} ms`,
  );
  try {
    bind();
  } catch (error) {
    if (!(error instanceof EngineLibraryUnloadable)) throw error;
    process.stderr.write(`\n${error.message}\n`);
    process.exit(ENGINE_UNLOADABLE_EXIT);
  }
  process.stderr.write(`, engine bound at ${String(Math.round(performance.now()))} ms.\n`);
}
