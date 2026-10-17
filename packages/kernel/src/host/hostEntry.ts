import { openMupdfShim } from '../mupdfRaw.js';
import { bindEngineOrExit, noteStart } from './bindEngine.js';
import { hostPipeStream } from './hostNodeSurfaces.js';

/**
 * The engine host's entry point: the program `createContainedHost` starts.
 *
 * ## Bind, connect, then load — in that order
 *
 * ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md).) This file
 * imports the engine binding and the pipe and nothing else — ten files, where the handlers' graph is 293 (measured
 * 2026-10-17 with a load counter on the pinned Electron in Node mode). It binds MuPDF first, so a library Windows will
 * not load ends this host before it connects and `main` reads *could not start*, never a death. It connects second,
 * which is what `main`'s ten-second bound waits for. Only then does it import `mupdfHostServe.ts`, whose evaluation
 * is the slow part of a start; a request `main` sends meanwhile waits in the socket.
 *
 * Everything else is in `hostBody.ts`, which touches no socket and no engine and
 * is driven by cases in milliseconds. This is the same split `entry.ts` and
 * `composition.ts` make in the shell, for the same reason — an entry point that
 * also assembled would put the whole program behind a real pipe and a real
 * container, and nothing would be decidable without one.
 *
 * ## Node mode, and the placement follows from that rather than from the subject
 *
 * This runs under `ELECTRON_RUN_AS_NODE=1` in a process `CreateProcessW` made,
 * so `import('electron')` here is either a download or an object with no `app`
 * on it ([ADR-0024](../../../../docs/DECISIONS/0024-execution-mode-is-a-placement-axis.md)).
 * It lives in `packages/kernel` because its subject **is** the document engine;
 * `packages/nodemode` holds the Node-mode code whose subject is not. Ask which
 * mode a file runs in, then which subject it is about — in that order.
 *
 * ## The pipe is a plain Node stream, and that was measured
 *
 * `enginePipeFactory.ts` records that main's end cannot be handed to node — an
 * fd from `_open_osfhandle` is `EBADF` to node's statically linked CRT. That is
 * about **adopting** a handle Win32 created. This end is libuv issuing its own
 * `CreateFileW`, which is a different call, and it connects and carries bytes
 * (ADR-0023, addition of 2026-08-27, with both controls). The stream itself is
 * `hostNodeSurfaces.ts`', which every host entry takes.
 *
 * ## Nothing here decides anything
 *
 * Not the containment verdict — this side attempts two paths and reports; main
 * classifies. Not whether to rebuild — that is the supervisor's, and this
 * process has no opinion about whether another one should exist. What this file
 * decides is when to **stop**, and the answer is always: as soon as the body
 * says it has stopped serving.
 */

/**
 * The pipe name, from the command line the factory built.
 *
 * Refused rather than defaulted. A host that cannot find its pipe has nothing
 * to serve and nobody to tell, so the only honest outcome is to fail at once
 * with a message in whatever the factory pointed stderr at — a default here
 * would be a process that starts, connects to something else, and looks alive.
 */
function pipeNameFrom(argv: readonly string[]): string {
  const [name] = argv.slice(2);
  if (name === undefined || name.length === 0) {
    throw new Error(
      'the engine host was started with no pipe name. Its first argument after the entry ' +
        'script is the full `\\\\.\\pipe\\…` name the factory minted; without it there is ' +
        'nothing to connect to.',
    );
  }
  return name;
}

const pipeName = pipeNameFrom(process.argv);

/**
 * The native MuPDF library — the engine itself since ADR-0124 — from the second argument, as PDFium's host takes
 * `pdfium.dll`'s. Refused rather than defaulted, for the pipe's reason: the path is resolved by the one resolver in
 * `main` (ADR-0122) and this process never guesses one.
 */
function libraryPathFrom(argv: readonly string[]): string {
  const [, path] = argv.slice(2);
  if (path === undefined || path.length === 0) {
    throw new Error(
      'the engine host was started with no MuPDF library path. Its second argument is the absolute path to ' +
        '`monstera_mupdf.dll`, which the native-components resolver answers and this process never guesses.',
    );
  }
  return path;
}

// BOUND BEFORE ANY HANDLER RUNS, for `pdfiumHostEntry.ts`' reason: a first bind inside a handler would put a load
// failure inside a document's first answer rather than in this host's start. AND BEFORE THE PIPE, so that failure is
// an exit before connecting, which `main` reads as *could not start* (ADR-0251 Decision 2).
bindEngineOrExit(() => {
  openMupdfShim(libraryPathFrom(process.argv));
});

const stream = hostPipeStream(pipeName);
noteStart('pipe opened');
// LOADED AFTER THE PIPE IS OPEN (ADR-0251): the handlers' module graph is the slow part of a start, and `main` has seen
// the connection by now (`noteStart`'s measurement).
const { serveMupdf } = await import('./mupdfHostServe.js');
noteStart('handlers loaded');
serveMupdf(stream);
