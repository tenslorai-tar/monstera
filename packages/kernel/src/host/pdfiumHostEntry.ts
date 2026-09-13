import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract';

import {
  localPdfiumExecution,
  openPdfium,
  pdfiumWriter,
  pageObjects,
  renderPageBitmap,
  textRuns,
} from '../pdfium.js';
import { cryptoBytes } from '../token.js';
import { probeContainment } from './containment.js';
import type { HostArea } from './engineHandlers.js';
import { createHostSessions } from './hostSessions.js';
import { startEngineHost } from './hostBody.js';
import { hostFilesystem, hostPipeStream } from './hostNodeSurfaces.js';
import { ENGINE_TEXT_OBJECTS_MAX } from './pdfiumChannels.js';
import { pdfiumChannels } from './pdfiumChannels.js';
import { createPdfiumHandlers } from './pdfiumHandlers.js';

/**
 * The **PDFium** engine host's entry point.
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
openPdfium(libraryPath);

/**
 * PDFium's channel set and its handlers
 * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)).
 *
 * Every import at the top of this file is PDFium's, and there are **six**
 * handlers plus one read where MuPDF's entry composes nineteen: a second engine
 * owes the core set and its own reads, and none of MuPDF's twelve
 * document-model ones.
 */
const handlers = createPdfiumHandlers({
  // AREAS, NOT SESSIONS. This host holds no parse between commands (ADR-0047),
  // and it holds the granted directories anyway (ADR-0048 Decision 2) — a
  // `serialise` that carried a directory would be a channel through which a
  // confused main could redirect the document's bytes on every save.
  areas: createHostSessions<HostArea>(cryptoBytes),
  execution: localPdfiumExecution,
  files: hostFilesystem,
  probe: probeContainment,
  // NO PARSE PROBE. `engine/open` registers an area and nothing else
  // (ADR-0048's withdrawn Decision 3), so a document PDFium cannot read is
  // refused by the call that wanted it — `engine-refused` — rather than at a
  // moment when there is no document to speak of.
  textRuns: async (image, page) => {
    const session = await pdfiumWriter.open(image);
    try {
      const found = await textRuns(session, page);
      // THE WALK IS WHAT KNOWS THERE WAS MORE, so the flag is computed here
      // rather than by the handler from the array it is handed — which would
      // answer *you asked for that many* every time.
      return {
        runs: found.runs.slice(0, ENGINE_TEXT_OBJECTS_MAX),
        truncated: found.runs.length > ENGINE_TEXT_OBJECTS_MAX,
        // FORWARDED UNCLIPPED. It counts characters the walk could not place,
        // which the bound above has nothing to do with — clipping it to the
        // run bound would report a page's worth of unreachable text as a page's
        // worth of runs.
        unaddressable: found.unaddressable,
      };
    } finally {
      await pdfiumWriter.close(session);
    }
  },
  renderPage: async (image, page, width, height) => {
    const session = await pdfiumWriter.open(image);
    try {
      // THE BITMAP'S OWN BYTES, unconverted. `renderPageBitmap` answers BGRA
      // because that is what PDFium produces and what main's encoder takes; a
      // conversion here would be one of two, done for a consumer that wants
      // neither.
      return (await renderPageBitmap(session, page, width, height)).bgra;
    } finally {
      await pdfiumWriter.close(session);
    }
  },
  pageObjects: async (image, page) => {
    const session = await pdfiumWriter.open(image);
    try {
      const objects = await pageObjects(session, page);
      return {
        objects: objects.slice(0, ENGINE_TEXT_OBJECTS_MAX),
        truncated: objects.length > ENGINE_TEXT_OBJECTS_MAX,
      };
    } finally {
      await pdfiumWriter.close(session);
    }
  },
});

startEngineHost(
  hostPipeStream(pipeName),
  {
    channels: pdfiumChannels,
    handlers,
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
    // serving, and this process only ever stops because its connection did.
    process.exit(1);
  },
);
