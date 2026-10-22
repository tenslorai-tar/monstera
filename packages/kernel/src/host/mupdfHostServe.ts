import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract/host';

import { checkAccessibility } from '../accessibilityCheck.js';
import {
  copyAnnotationData,
  readInterchangeAnnotations,
  readAnnotationImportPlan,
  serialiseAnnotationData,
} from '../annotationInterchange.js';
import { readPageBarcodes } from '../barcodeReader.js';
import { bindEditFolders } from '../editFaces.js';
import { readCatalogueApart } from '../fontCatalogueApart.js';
import { localMupdfExecution } from '../mupdfSpecs.js';
import { accessFor, mupdfWriter, signaturesKeptBySave } from '../mupdfWriter.js';
import { readSignatures } from '../signatureRead.js';
import { readPageGeometry } from '../pageGeometry.js';
import { readDestinations } from '../destinations.js';
import { readLayers } from '../layers.js';
import { readDocumentFonts } from '../documentFonts.js';
import { readPageMarksOf } from '../pageMarks.js';
import { detectFlatFields } from '../flatFields.js';
import { readFormImportPlan } from '../formData.js';
import { readButtonActions, readFieldProperties } from '../formFieldRead.js';
import { chosenFormData, readFormData, serialiseFormData } from '../formData.js';
import { readFormFields } from '../formFields.js';
import { readAnnotationWords, readAnnotations } from '../pageAnnotations.js';
import { findDuplicatePages } from '../pageDuplicates.js';
import { extractPages } from '../pageExtract.js';
import { rasterisePageImage } from '../pageImages.js';
import { snapshotRegion } from '../pageSnapshot.js';
import { recognisePage } from '../ocrRecognise.js';
import { readPageFills } from '../pageFills.js';
import { readScanTables } from '../scanTables.js';
import { readPageAdjustment } from '../pageAdjustment.js';
import { readPageRewrite } from '../pageRewrite.js';
import { readTextFaces } from '../textFaces.js';
import { readPageWordBoxes } from '../wordBoxes.js';
import { readLinkAddress, readPageLinks } from '../pageLinks.js';
import { readPageTextJson } from '../pageText.js';
import { cryptoBytes } from '../token.js';
import { probeContainment } from './containment.js';
import { engineChannels } from './engineChannels.js';
import { createEngineHandlers } from './engineHandlers.js';
import { sessionFileAnswers } from './fileAnswers.js';
import { createHostSessions } from './hostSessions.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';
import { hostFilesystem } from './hostNodeSurfaces.js';

/**
 * The MuPDF host's handlers, composed and served on a pipe its launcher already connected.
 *
 * `hostEntry.ts` is the program `createContainedHost` starts, and it binds the engine and reaches its pipe before it
 * imports this ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)):
 * evaluating this module is the host's slow part, every reader and writer at the top of the file and what they import,
 * and `main`'s connect bound is about whether the host started, not about how long that takes. The statements below
 * were the entry's own until then and are unchanged; they run when the launcher imports this, after the connect.
 */

// THE BUNDLED FONTS' FOLDER THIRD and THE INSTALLED FONTS' FOURTH, each empty where there is none (ADR-0177 Decision
// 1), `pdfiumHostEntry.ts`' arguments: a word a Type 3 page's own fonts cannot draw is set in a face the resolver
// chooses from them. Bound by their folders, so neither the catalogue nor HarfBuzz loads until a word needs a face.
const fontsPath = process.argv[4] === undefined || process.argv[4].length === 0 ? null : process.argv[4];
const installedPath = process.argv[5] === undefined || process.argv[5].length === 0 ? null : process.argv[5];
// READ APART when they are read (`fontCatalogueApart.ts`), which also keeps HarfBuzz's catalogue read out of this
// process: the thread loads its own.
if (fontsPath !== null) bindEditFolders(fontsPath, installedPath, readCatalogueApart);

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
// THE SESSION TABLE, named because a file-routed answer is written into the output directory of the session its
// request names (ADR-0125), and this is the table that knows it.
const sessions = createHostSessions(cryptoBytes);

const engineHandlers = createEngineHandlers({
  sessions,
  execution: localMupdfExecution,
  writer: mupdfWriter,
  access: accessFor,
  signatures: readSignatures,
  signaturesKept: signaturesKeptBySave,
  files: hostFilesystem,
  probe: probeContainment,
  geometry: readPageGeometry,
  // THE JSON, not a parsed page: `parsePageText` is the one reader of MuPDF's
  // format, and re-serialising a parsed shape here would be a second format for
  // the same answer. The Word export below calls that same reader in this process.
  pageText: readPageTextJson,
  pageLinks: readPageLinks,
  linkAddress: readLinkAddress,
  pageFills: readPageFills,
  scanTables: readScanTables,
  pageAdjustment: readPageAdjustment,
  pageRewrite: readPageRewrite,
  textFaces: readTextFaces,
  wordBoxes: readPageWordBoxes,
  // RUNS HERE, and that is §3's matrix rather than a placement. Recognition
  // consumes a bitmap **we produced**, so the document-parse boundary invariant
  // 25 governs was already crossed by the rasteriser — and that rasteriser is
  // MuPDF's, in this process. Running recognition beside it means no
  // eight-megabyte bitmap crosses a pipe per page and no second rasteriser
  // exists for OCR input (B3a).
  ocr: recognisePage,
  destinations: readDestinations,
  layers: readLayers,
  fonts: readDocumentFonts,
  pageMarks: readPageMarksOf,
  annotations: readAnnotations,
  formFields: readFormFields,
  duplicates: findDuplicatePages,
  // RUNS HERE, which is the whole reason `engine/extract` is a channel:
  // `extractPages` reaches MuPDF, and invariant 20 keeps that out of `main`.
  extract: extractPages,
  // pdf-lib, RUN HERE beside the session it rewrites (ADR-0121 Decision 3): pure JavaScript, in the process that
  // already holds the document, so `main` neither receives the image nor parses it. LOADED ON THE FIRST pdf-lib
  // command, never at start: a static import charges every MuPDF host pdf-lib's library whether or not the document
  // ever meets a pdf-lib command, and that fixed cost is what §9.17's host budget and `proof:hostload` hold.
  // A FIELD IN A REAL FAMILY is drawn again after pdf-lib's edit of it, in this process and this command (ADR-0229).
  applyPdfLib: async (image, command, reads) => {
    const { applyPdfLibWithFaces } = await import('../pdfLibFieldFaces.js');
    return applyPdfLibWithFaces(image, command, reads);
  },
  // A PROTECTED DOCUMENT'S pdf-lib COMMAND is read plain and written protected again in this process (ADR-0220), loaded
  // with the first pdf-lib command for the reason above.
  protectedWriting: async (session) => {
    const { protectedWritingOf } = await import('../documentProtection.js');
    return protectedWritingOf(session);
  },
  // A SIGNATURE'S PLACEHOLDER, here for the same reason and loaded the same way (ADR-0148): it parses the whole
  // document and decodes the picture. The key half is `main`'s and this process never loads it.
  // A PROTECTED DOCUMENT'S SIGNATURE is appended under its own key (ADR-0227), loaded with the first signature.
  protectedImage: async (session) => {
    const { protectedImageOf } = await import('../documentProtection.js');
    return protectedImageOf(session);
  },
  prepareSignature: async (image, request, protectedBy) => {
    const { prepareSignature } = await import('../signaturePlaceholder.js');
    return prepareSignature(image, request, protectedBy);
  },
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
  // THE PROPERTIES PANE'S READ (ADR-0193), here for the field list's reason: it walks the document through MuPDF.
  fieldProperties: readFieldProperties,
  // ONE BUTTON'S ACTIONS (ADR-0259), here for the Properties read's reason.
  buttonActions: readButtonActions,
  // WHAT AN IMPORT WOULD DO, planned here for the field list's reason: the file is hostile input and the plan walks the form.
  formImportPlan: readFormImportPlan,
  annotationImportPlan: readAnnotationImportPlan,
  exportFormData: async (session, format, fields) =>
    serialiseFormData(chosenFormData(await readFormData(session), fields), format),
  // AND A FOURTH, the snapshot's reason for a whole page: §3 assigns export
  // rasterisation to MuPDF, which is here.
  pageImage: rasterisePageImage,
  // AND THE WORD EXPORT, which draws the page's pictures (ADR-0072's amendment of 2026-10-01). LOADED ON FIRST USE,
  // pdf-lib's reason above: the composer and its zip library are a cost only a Word export should pay.
  word: (session, mode, pages) => {
    let pictures = (): number => 0;
    async function* chunks(): AsyncIterable<Uint8Array> {
      const { composeWordDocument } = await import('../wordPictures.js');
      const composed = composeWordDocument(session, mode, pages);
      pictures = composed.pictures;
      yield* composed.chunks;
    }
    return { chunks: chunks(), pictures: () => pictures() };
  },
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
  // AND ONE MARK'S WHOLE WORDS, for an editor whose listing was cut: read where the mark is, beside the walk.
  annotationWords: readAnnotationWords,
});

/** Serves MuPDF's channels on `stream`, the pipe the launcher connected. Called once. */
export function serveMupdf(stream: HostByteStream): void {
  startEngineHost(
    stream,
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
      fileAnswers: sessionFileAnswers(sessions, hostFilesystem),
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
}

