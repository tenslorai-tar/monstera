
import { openPdfium } from '../pdfiumBinding.js';
import { bindEngineOrExit, noteStart } from './bindEngine.js';
import { hostPipeStream } from './hostNodeSurfaces.js';

/**
 * The **PDFium** engine host's entry point.
 *
 * ## Bind, connect, then load
 *
 * `hostEntry.ts`' order and reason ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)):
 * the binding comes from `pdfiumBinding.ts`, which imports koffi and the library loader only, so the connect waits on
 * neither the adapter nor the contract; `pdfiumHostServe.ts` is imported once the connect is issued.
 *
 * ## `hostEntry.ts`'s shape, and the parts it does not repeat
 *
 * `docs/ARCHITECTURE.md` §3: *one host body, parameterised by engine*. The
 * body, the framing, the containment check, the failure classification and the
 * shutdown ordering are all `hostBody.ts`'s and are not here. What is here is
 * the same two statements MuPDF's entry makes — compose this engine's channels
 * and handlers, then start the body on the pipe named on the command line — and
 * everything engine-specific is in the composition.
 *
 * **The pipe and the filesystem are `hostNodeSurfaces.ts`'.** They were written
 * twice while there were two entries, because sharing fifteen lines between two
 * statements each would have been an abstraction with a copy on either side of
 * it. The compose host is the third caller
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)),
 * which is the point this paragraph named for sharing them.
 *
 * ## Node mode, and the placement follows from that
 *
 * This runs under `ELECTRON_RUN_AS_NODE=1` in a process `CreateProcessW` made,
 * so `import('electron')` here is either a download or an object with no `app`
 * on it ([ADR-0024](../../../../docs/DECISIONS/0024-execution-mode-is-a-placement-axis.md)).
 * It lives in `packages/kernel` because its subject **is** a document engine.
 *
 * ## It is handed the library path and never resolves one
 *
 * `scripts/provision/pdfium.mjs` owns *where `pdfium.dll` lives*, and the
 * kernel cannot import a script — so the factory passes it in as the second
 * argument, exactly as it passes the pipe name first. A search or a default
 * here would be the B3a defect this project has paid for three times, and a
 * wrong path is then one loud failure rather than a quiet disagreement between
 * two resolvers.
 */

/**
 * The pipe name and the library path, from the command line the factory built.
 *
 * Both refused rather than defaulted, for `hostEntry.ts`'s reason on the first
 * and this file's header on the second: a host that cannot find its pipe has
 * nothing to serve and nobody to tell, and one that guessed at a library would
 * bind whichever `pdfium.dll` it found.
 */
function argumentsFrom(argv: readonly string[]): { pipeName: string; libraryPath: string } {
  const [pipeName, libraryPath] = argv.slice(2);
  if (pipeName === undefined || pipeName.length === 0) {
    throw new Error(
      'the PDFium engine host was started with no pipe name. Its first argument after the ' +
        'entry script is the full `\\\\.\\pipe\\…` name the factory minted; without it there ' +
        'is nothing to connect to.',
    );
  }
  if (libraryPath === undefined || libraryPath.length === 0) {
    throw new Error(
      'the PDFium engine host was started with no library path. Its second argument is the ' +
        'absolute path to `pdfium.dll`, which `scripts/provision/pdfium.mjs` resolves and this ' +
        'process never guesses.',
    );
  }
  return { pipeName, libraryPath };
}

const { pipeName, libraryPath } = argumentsFrom(process.argv);

// BOUND BEFORE ANY HANDLER RUNS. `openPdfium` is idempotent and initialises the
// process rather than a handle, so binding it here — once, at startup — is what
// the C API actually offers. A first call inside a handler would make the first
// document pay for it and would put the failure inside a channel's answer.
bindEngineOrExit(() => {
  openPdfium(libraryPath);
});

const stream = hostPipeStream(pipeName);
noteStart('pipe opened');
// LOADED AFTER THE PIPE IS OPEN (ADR-0251), `hostEntry.ts`' reason.
const { servePdfium } = await import('./pdfiumHostServe.js');
noteStart('handlers loaded');
servePdfium(stream);
