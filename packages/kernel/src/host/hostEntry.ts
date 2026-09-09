import { connect } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { readPageGeometry } from '../pageGeometry.js';
import { readDestinations } from '../destinations.js';
import { readLayers } from '../layers.js';
import { detectFlatFields } from '../flatFields.js';
import { readFormData, serialiseFormData } from '../formData.js';
import { readFormFields } from '../formFields.js';
import { readAnnotations } from '../pageAnnotations.js';
import { findDuplicatePages } from '../pageDuplicates.js';
import { extractPages } from '../pageExtract.js';
import { snapshotRegion } from '../pageSnapshot.js';
import { readPageLinks } from '../pageLinks.js';
import { readPageTextJson } from '../pageText.js';
import { cryptoBytes } from '../token.js';
import { probeContainment } from './containment.js';
import { engineChannels } from './engineChannels.js';
import { createEngineHandlers } from './engineHandlers.js';
import { createHostSessions } from './hostSessions.js';
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

/**
 * MuPDF's channel set and its handlers, composed HERE rather than in the body
 * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)).
 *
 * This is the engine-specific statement — every import at the top of this file
 * is MuPDF's writer or one of MuPDF's twelve document-model readers, and a
 * PDFium entry brings its own seven-channel set instead. `hostBody.ts` takes
 * the pair and knows neither, which is what *one host body, parameterised by
 * engine* means once it is built rather than specified.
 */
const engineHandlers = createEngineHandlers({
  sessions: createHostSessions(cryptoBytes),
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
  annotations: readAnnotations,
  formFields: readFormFields,
  duplicates: findDuplicatePages,
  // RUNS HERE, which is the whole reason `engine/extract` is a channel:
  // `extractPages` reaches MuPDF, and invariant 20 keeps that out of `main`.
  extract: extractPages,
  // AND FOR THE SAME REASON, with a second one on top: a raster is the one
  // payload that scales with what the user dragged, so it is built here and
  // written into the granted directory rather than crossing the pipe.
  snapshot: snapshotRegion,
  // AND A THIRD, for the first's reason: reading the fields reaches MuPDF.
  // The bounds on `engine/form-fields` exist for a panel a person reads, so
  // an export built from that answer would be silently truncated at both.
  // A READ, and it runs here for the field list's reason: the walk reaches
  // MuPDF, which invariant 20 keeps out of main.
  flatFields: detectFlatFields,
  exportFormData: async (session, format) =>
    serialiseFormData(await readFormData(session), format),
});

startEngineHost(
  pipeStream(pipeName),
  {
    channels: engineChannels,
    handlers: engineHandlers,
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
