import { connect } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { readPageGeometry } from '../pageGeometry.js';
import { readDestinations } from '../destinations.js';
import { readLayers } from '../layers.js';
import { findDuplicatePages } from '../pageDuplicates.js';
import { readPageLinks } from '../pageLinks.js';
import { readPageTextJson } from '../pageText.js';
import { cryptoBytes } from '../token.js';
import { probeContainment } from './containment.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';

/**
 * The engine host's entry point: the program `createContainedHost` starts.
 *
 * ## Two statements, on purpose
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
 * (ADR-0023, addition of 2026-08-27, with both controls).
 *
 * ## Nothing here decides anything
 *
 * Not the containment verdict — this side attempts two paths and reports; main
 * classifies. Not whether to rebuild — that is the supervisor's, and this
 * process has no opinion about whether another one should exist. What this file
 * decides is when to **stop**, and the answer is always: as soon as the body
 * says it has stopped serving.
 */

/** The host's end of the pipe, as {@link HostByteStream}. */
function pipeStream(pipeName: string): HostByteStream {
  const socket = connect({ path: pipeName });
  // NAGLE OFF. Frames here are small and request/response — a delayed ACK
  // waiting for a second frame that only arrives after this one is answered is
  // latency added to every call, and it would look like a slow engine.
  socket.setNoDelay(true);

  return {
    write: (bytes) => {
      socket.write(bytes);
    },
    onData: (sink) => {
      socket.on('data', (chunk: Buffer) => {
        sink(new Uint8Array(chunk));
      });
    },
    onEnd: (sink) => {
      // BOTH, and once. A pipe that closes cleanly emits `close` with no
      // `error`; one that breaks emits `error` then `close`. Listening to only
      // the first would hang this process on the ordinary ending, and to only
      // the second would lose the reason on the broken one.
      let reason = 'the pipe closed';
      socket.on('error', (error: NodeJS.ErrnoException) => {
        reason = `the pipe failed: ${error.code ?? error.message}`;
      });
      socket.once('close', () => {
        sink(reason);
      });
    },
    close: () => {
      socket.destroy();
    },
  };
}

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

startEngineHost(
  pipeStream(pipeName),
  {
    execution: localMupdfExecution,
    writer: mupdfWriter,
    files: {
      readSnapshot: async (directory, name) => new Uint8Array(await readFile(join(directory, name))),
      writeOutput: async (directory, name, bytes) => {
        await writeFile(join(directory, name), bytes);
        return bytes.length;
      },
    },
    probe: probeContainment,
    geometry: readPageGeometry,
    // THE JSON, not a parsed page: `parsePageText` is the one reader of MuPDF's
    // format and it lives main-side, so this process ships no opinion about the
    // structure it computed.
    pageText: readPageTextJson,
    pageLinks: readPageLinks,
    destinations: readDestinations,
    layers: readLayers,
    duplicates: findDuplicatePages,
    tokens: cryptoBytes,
    // Where a handler's thrown diagnostic goes. Never the pipe: main gets
    // `internal` and an id, and the text stays on this side — which is the
    // inherited stderr handle, the one channel a container cannot close.
    incidents: (incident) => {
      process.stderr.write(
        `MONSTERA_HOST_INCIDENT ${incident.id} on ${incident.channel}: ` +
          `${JSON.stringify(incident.diagnostic)}\n`,
      );
    },
    maxInFlight: ENGINE_HOST_MAX_IN_FLIGHT,
  },
  (reason) => {
    process.stderr.write(`MONSTERA_HOST_ENDED ${reason.code}: ${reason.detail}\n`);
    // A NON-ZERO EXIT for every ending, including the ordinary one. The factory
    // reads a host's exit as news about a process that was supposed to be
    // serving, and this process only ever stops because its connection did —
    // there is no path here that finishes its work and returns.
    process.exit(1);
  },
);
