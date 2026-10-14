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
  try {
    bind();
  } catch (error) {
    if (!(error instanceof EngineLibraryUnloadable)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(ENGINE_UNLOADABLE_EXIT);
  }
}
