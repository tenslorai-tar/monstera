import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract/host';

import {
  localPdfiumExecution,
  onImage,
  pageContent,
  pageObjects,
  pageRuns,
  renderPageBitmap,
  renderPageBitmapWithoutText,
  textRuns,
  unpackedIfAsked,
} from '../pdfium.js';
import { bindEditFaces } from '../editFaces.js';
import { faceSourceOf, fontFoldersOf } from '../fontCatalogue.js';
import { readCatalogueApart } from '../fontCatalogueApart.js';
import { cryptoBytes } from '../token.js';
import { probeContainment } from './containment.js';
import type { HostArea } from './engineHandlers.js';
import { sessionFileAnswers } from './fileAnswers.js';
import { createHostSessions } from './hostSessions.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';
import { hostFilesystem } from './hostNodeSurfaces.js';
import { pdfiumChannels } from './pdfiumChannels.js';
import { boundedToAnswer, createPdfiumHandlers } from './pdfiumHandlers.js';

/**
 * The PDFium host's handlers, composed and served on a pipe its launcher already connected.
 *
 * `pdfiumHostEntry.ts` binds `pdfium.dll` and reaches its pipe before it imports this, `hostEntry.ts`' order and its
 * reason ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)). The
 * statements below were the entry's own until then and are unchanged.
 */

// THE BUNDLED FONTS' FOLDER, the factory's THIRD argument, empty where it had none (ADR-0173 Decision 4): a word an
// edit's own font cannot carry is set in a face the resolver chooses from it. Read on first use, as the compose host's.
const fontsPath = process.argv[4] === undefined || process.argv[4].length === 0 ? null : process.argv[4];
// AND THE MACHINE'S INSTALLED FONTS, the FOURTH argument (ADR-0172 Decision 2): read beside the bundled set, so a
// character no bundled face carries goes to an installed face whose licence allows editing before it is drawn as a box.
const installedPath = process.argv[5] === undefined || process.argv[5].length === 0 ? null : process.argv[5];
// READ APART, so what HarfBuzz keeps from reading every installed font ends with the thread that read it.
if (fontsPath !== null) bindEditFaces(() => faceSourceOf(fontFoldersOf(fontsPath, installedPath), readCatalogueApart));

/**
 * PDFium's channel set and its handlers
 * ([ADR-0048](../../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)).
 *
 * Every import at the top of this file is PDFium's, and there are **six**
 * handlers plus one read where MuPDF's entry composes nineteen: a second engine
 * owes the core set and its own reads, and none of MuPDF's twelve
 * document-model ones.
 */
// AREAS, NOT SESSIONS. This host holds no parse between commands (ADR-0047),
// and it holds the granted directories anyway (ADR-0048 Decision 2) — a
// `serialise` that carried a directory would be a channel through which a
// confused main could redirect the document's bytes on every save. Named, because
// a file-routed answer is written into the same directories (ADR-0125).
const areas = createHostSessions<HostArea>(cryptoBytes);

const handlers = createPdfiumHandlers({
  areas,
  execution: localPdfiumExecution,
  files: hostFilesystem,
  probe: probeContainment,
  // NO PARSE PROBE. `engine/open` registers an area and nothing else
  // (ADR-0048's withdrawn Decision 3), so a document PDFium cannot read is
  // refused by the call that wanted it — `engine-refused` — rather than at a
  // moment when there is no document to speak of.
  // EACH READ OPENS THROUGH `onImage`, the one opener that takes the key the frame carried (ADR-0171's addendum).
  textRuns: (image, page, unpack) =>
    onImage(image, async (session) => {
      // UNPACKED IN THIS PROCESS'S MEMORY ONLY (ADR-0232): the session is never serialised from a read, and the promotion is
      // the one an edit sent with `unpack` makes, so the indices answered here are the ones that edit writes.
      await unpackedIfAsked(session, page, unpack);
      const found = await textRuns(session, page);
      const { kept, truncated } = boundedToAnswer(found.runs);
      // `unaddressable` FORWARDED UNCLIPPED: it counts characters the walk could not place, which the run bound has
      // nothing to do with.
      return { runs: kept, truncated, unaddressable: found.unaddressable, box: found.box, markers: found.markers };
    }),
  // THE BITMAP'S OWN BYTES, unconverted. `renderPageBitmap` answers BGRA
  // because that is what PDFium produces and what main's encoder takes; a
  // conversion here would be one of two, done for a consumer that wants
  // neither.
  renderPage: (image, page, width, height, withoutText) =>
    onImage(image, async (session) =>
      (withoutText
        ? await renderPageBitmapWithoutText(session, page, width, height)
        : await renderPageBitmap(session, page, width, height)
      ).bgra,
    ),
  // ADR-0210: one page's own content. `pageContent` flattens forms in this process's in-memory page and reads.
  pageContent: (image, page) => onImage(image, (session) => pageContent(session, page)),
  pageObjects: (image, page) =>
    onImage(image, async (session) => {
      const { kept, truncated } = boundedToAnswer(await pageObjects(session, page));
      return { objects: kept, truncated };
    }),
  pageRuns: (image, page) => onImage(image, (session) => pageRuns(session, page)),
});

/** Serves PDFium's channels on `stream`, the pipe the launcher connected. Called once. */
export function servePdfium(stream: HostByteStream): void {
  startEngineHost(
    stream,
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
      fileAnswers: sessionFileAnswers(areas, hostFilesystem),
    },
    (reason) => {
      process.stderr.write(`MONSTERA_HOST_ENDED ${reason.code}: ${reason.detail}\n`);
      // A NON-ZERO EXIT for every ending, including the ordinary one. The factory
      // reads a host's exit as news about a process that was supposed to be
      // serving, and this process only ever stops because its connection did.
      process.exit(1);
    },
  );
}

