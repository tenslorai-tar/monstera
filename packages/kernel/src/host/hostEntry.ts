import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import { accessFor, mupdfWriter } from '../mupdfWriter.js';
import { readSignatures } from '../signatureRead.js';
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
import { recogniseHandwriting } from '../ocrHandwriting.js';
import { recognisePage } from '../ocrRecognise.js';
import { readPageLinks } from '../pageLinks.js';
import { readPageTextJson } from '../pageText.js';
import { cryptoBytes } from '../token.js';
import { probeContainment } from './containment.js';
import { engineChannels } from './engineChannels.js';
import { createEngineHandlers } from './engineHandlers.js';
import { createHostSessions } from './hostSessions.js';
import { startEngineHost } from './hostBody.js';
import { hostFilesystem, hostPipeStream } from './hostNodeSurfaces.js';

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
  access: accessFor,
  signatures: readSignatures,
  files: hostFilesystem,
  probe: probeContainment,
  geometry: readPageGeometry,
  // THE JSON, not a parsed page: `parsePageText` is the one reader of MuPDF's
  // format and it lives main-side, so this process ships no opinion about the
  // structure it computed.
  pageText: readPageTextJson,
  pageLinks: readPageLinks,
  // RUNS HERE, and that is §3's matrix rather than a placement. Recognition
  // consumes a bitmap **we produced**, so the document-parse boundary invariant
  // 25 governs was already crossed by the rasteriser — and that rasteriser is
  // MuPDF's, in this process. Running recognition beside it means no
  // eight-megabyte bitmap crosses a pipe per page and no second rasteriser
  // exists for OCR input (B3a).
  ocr: recognisePage,
  // THE SECOND RECOGNISER, HERE FOR THE SAME REASON AND ONE MORE. Its input is
  // a raster this process produced, and the runtime it loads is WASM — which
  // main may not load at all: ADR-0026's barrel discipline and `proof:kernelload`
  // keep engines out of that process, and ADR-0052 Decision 2 says nothing
  // about ONNX changes the containment argument, since it parses model files
  // that are **ours** rather than document bytes.
  handwriting: recogniseHandwriting,
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
  hostPipeStream(pipeName),
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
