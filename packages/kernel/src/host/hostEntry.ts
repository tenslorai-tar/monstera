import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract/host';

import { checkAccessibility } from '../accessibilityCheck.js';
import {
  copyAnnotationData,
  readInterchangeAnnotations,
  serialiseAnnotationData,
} from '../annotationInterchange.js';
import { readPageBarcodes } from '../barcodeReader.js';
import { localMupdfExecution } from '../mupdfSpecs.js';
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
import { rasterisePageImage } from '../pageImages.js';
import { snapshotRegion } from '../pageSnapshot.js';
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
  // AND A FOURTH, the snapshot's reason for a whole page: §3 assigns export
  // rasterisation to MuPDF, which is here.
  pageImage: rasterisePageImage,
  // AND A READ OF A DOCUMENT'S PIXELS BY A C++ DECODER, which is the whole reason it is here
  // rather than in main (ADR-0076).
  barcodes: readPageBarcodes,
  // AND THE ANNOTATIONS OUT, the form data's reason: reading them reaches MuPDF (ADR-0077).
  exportAnnotationData: async (session, format) =>
    serialiseAnnotationData(await readInterchangeAnnotations(session), format),
  // AND THE PDF/UA-1 OBJECT RULES, a walk of MuPDF's objects (ADR-0078).
  accessibility: checkAccessibility,
  // AND THE CLIPBOARD'S COPY, through the interchange's one reader of entries: the records go to
  // main and stay there, so a paste can be minted where the importer is allowed to be.
  annotationRecords: copyAnnotationData,
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
