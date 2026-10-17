import { openMupdfShim } from '../mupdfRaw.js';
import { bindEngineOrExit, noteStart } from './bindEngine.js';
import { composeShimPathOf } from './composeArguments.js';
import { hostPipeStream } from './hostNodeSurfaces.js';

/**
 * The **compose** host's entry point
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * Bind, connect, then load: `hostEntry.ts`' order and its reason
 * ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)), with the
 * handlers in `composeHostServe.ts`.
 *
 * ## The third entry through the one body
 *
 * `hostEntry.ts`' two statements, and PDFium's: compose this host's channels and
 * handlers, then start the body on the pipe named on the command line. The body,
 * the framing, the failure classification and the shutdown ordering are
 * `hostBody.ts`'s; the pipe and the filesystem are `hostNodeSurfaces.ts`'.
 *
 * ## What it runs, and why here
 *
 * A Markdown file a person picked is input its author chose (threat model §1.9),
 * and §2 keeps document parsing of any kind out of `main`. So `markdown-it` and the
 * layout that follows it run in this process, whose token is a container of its own
 * and whose ending affects no open document.
 *
 * ## Node mode
 *
 * Under `ELECTRON_RUN_AS_NODE=1` in a process `CreateProcessW` made (ADR-0024). It
 * lives in `packages/kernel` because its subject is document composition.
 */

/**
 * The pipe name, from the command line the factory built.
 *
 * Refused rather than defaulted, for `hostEntry.ts`' reason: a host that cannot find
 * its pipe has nothing to serve and nobody to tell, and a default would be a process
 * that starts, connects to something else, and looks alive.
 */
function pipeNameFrom(argv: readonly string[]): string {
  const [name] = argv.slice(2);
  if (name === undefined || name.length === 0) {
    throw new Error(
      'the compose host was started with no pipe name. Its first argument after the entry ' +
        'script is the full `\\\\.\\pipe\\…` name the factory minted; without it there is ' +
        'nothing to connect to.',
    );
  }
  return name;
}

const pipeName = pipeNameFrom(process.argv);

/** The native MuPDF library's path, or `null` where the factory gave none (`composeShimPathOf`). */
const shimPath = composeShimPathOf(process.argv);

// BOUND AT STARTUP, for `pdfiumHostEntry.ts`' reason: a first bind inside a handler would put a
// load failure inside a person's Optimize answer rather than in this host's start. AND BEFORE THE
// PIPE, so that failure is *could not start* (ADR-0251 Decision 2).
if (shimPath !== null) {
  bindEngineOrExit(() => {
    openMupdfShim(shimPath);
  });
}

const stream = hostPipeStream(pipeName);
noteStart('pipe opened');
// LOADED AFTER THE PIPE IS OPEN (ADR-0251), `hostEntry.ts`' reason.
const { serveCompose } = await import('./composeHostServe.js');
noteStart('handlers loaded');
serveCompose(stream);
