import { noteStart } from './bindEngine.js';
import { hostPipeStream } from './hostNodeSurfaces.js';

/**
 * The **catalogue** host's entry point
 * ([ADR-0293](../../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md)).
 *
 * Connect, then load: `composeHostEntry.ts`' order and its reason
 * ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)), with the
 * handlers in `catalogueHostServe.ts`. It binds no native library: the catalogue is read through HarfBuzz's
 * WebAssembly build, in a thread that ends.
 *
 * ## The fourth entry through the one body
 *
 * A host that holds no document, as the compose host is: its token is a container of its own and its ending affects no
 * open document. It reads the machine's fonts, which every host that sets text reads today, so a hostile installed font
 * reaches nothing here it does not reach there.
 *
 * ## Node mode
 *
 * Under `ELECTRON_RUN_AS_NODE=1` in a process `CreateProcessW` made (ADR-0024).
 */

/** The pipe name, refused rather than defaulted, `composeHostEntry.ts`' reason. */
function pipeNameFrom(argv: readonly string[]): string {
  const [name] = argv.slice(2);
  if (name === undefined || name.length === 0) {
    throw new Error(
      'the catalogue host was started with no pipe name. Its first argument after the entry script is the full ' +
        '`\\\\.\\pipe\\…` name the factory minted; without it there is nothing to connect to.',
    );
  }
  return name;
}

const stream = hostPipeStream(pipeNameFrom(process.argv));
noteStart('pipe opened');
// LOADED AFTER THE PIPE IS OPEN (ADR-0251), `hostEntry.ts`' reason.
const { serveCatalogue } = await import('./catalogueHostServe.js');
noteStart('handlers loaded');
serveCatalogue(stream);
