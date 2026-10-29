import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract/host';

import { composerApart } from '../composeApart.js';
import { type FaceSource, faceSourceOf, fontFoldersOf } from '../fontCatalogue.js';
import { readCatalogueApart } from '../fontCatalogueApart.js';
import { composeImages } from '../imageCompose.js';
import { Document, MupdfOpenRefused, PDFDocument, keepInlineImages, rewriteImages } from '../mupdfRaw.js';
import { prepareForPdfa } from '../pdfaPreparation.js';
import { savedBuffer } from '../saveDepth.js';
import { signatureFromScan } from '../signatureScan.js';
import { cryptoBytes } from '../token.js';
import { composeChannels } from './composeChannels.js';
import { type ImageOptimizer, type InlineImageKeeper, type PdfaPreparer, createComposeHandlers } from './composeHandlers.js';
import { probeContainment } from './containment.js';
import type { HostArea } from './engineHandlers.js';
import { sessionFileAnswers } from './fileAnswers.js';
import { composeShimPathOf } from './composeArguments.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';
import { hostFilesystem } from './hostNodeSurfaces.js';
import { createHostSessions } from './hostSessions.js';

/**
 * The compose host's handlers, composed and served on a pipe its launcher already connected.
 *
 * `composeHostEntry.ts` binds MuPDF where it was given it and reaches its pipe before it imports this, `hostEntry.ts`'
 * order and its reason ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)).
 * The statements below were the entry's own until then and are unchanged.
 */

/** Where the launcher bound MuPDF, by the one reading of its argument it bound by: `null` where it was given none. */
const shimPath = composeShimPathOf(process.argv);

/**
 * The bundled fonts' folder (ADR-0172), the factory's THIRD argument, empty where it had none — `shimPath`'s rule.
 */
const fontsPath = process.argv[4] === undefined || process.argv[4].length === 0 ? null : process.argv[4];

/** The machine's installed fonts' folder (ADR-0172 Decision 2), the FOURTH argument, empty where it had none. */
const installedPath = process.argv[5] === undefined || process.argv[5].length === 0 ? null : process.argv[5];

/**
 * The catalogue the composers set text from, READ ON FIRST USE and kept: an Optimize or an image import never needs
 * it, and the bundled faces read once are cheaper than a read per import. A folder that holds no face is a host started
 * without its fonts — a fault, reported as one, never an answer about the person's file.
 */
let catalogue: FaceSource | null = null;
function faces(): FaceSource {
  if (catalogue === null) {
    if (fontsPath === null) throw new Error('the compose host was started without its fonts folder');
    catalogue = faceSourceOf(fontFoldersOf(fontsPath, installedPath), readCatalogueApart);
  }
  return catalogue;
}

/**
 * The native rewriter over one area, or `null` where no library was bound.
 *
 * The paths are the area's directories and two names the channel's schema validated, so this
 * opens nothing the area does not hold. MuPDF failing to OPEN the document is the document's
 * answer; a failure at any later step is a fault and propagates.
 */
const optimize: ImageOptimizer | null =
  shimPath === null
    ? null
    : async (area, from, into, setting, password) => {
        const input = join(area.snapshotDirectory, from);
        const output = join(area.outputDirectory, into);
        if (!existsSync(input)) return { kind: 'missing' };
        try {
          rewriteImages(input, output, setting, password);
        } catch (error) {
          if (error instanceof MupdfOpenRefused) return { kind: 'unreadable' };
          throw error;
        }
        return { kind: 'optimized', bytes: (await stat(output)).size };
      };

/**
 * The inline-image keeper over one area (ADR-0126), `optimize`'s shape: the area's directories and two validated
 * names, MuPDF failing to OPEN the document is the document's answer, any later failure is a fault.
 */
const keepInlineImagesIn: InlineImageKeeper | null =
  shimPath === null
    ? null
    : async (area, from, into, scope, password) => {
        const input = join(area.snapshotDirectory, from);
        const output = join(area.outputDirectory, into);
        if (!existsSync(input)) return { kind: 'missing' };
        let kept;
        try {
          kept = keepInlineImages(input, output, scope, password);
        } catch (error) {
          if (error instanceof MupdfOpenRefused) return { kind: 'unreadable' };
          throw error;
        }
        return kept.converted === 0
          ? { kind: 'unchanged', left: kept.left }
          : { kind: 'kept', bytes: (await stat(output)).size, converted: kept.converted, left: kept.left };
      };

/**
 * The PDF/A preparation over one area (ADR-0075's 2026-10-13 correction), `optimize`'s shape: MuPDF failing to OPEN
 * the document, or refusing its password, is the document's answer; any later failure is a fault. Written with its
 * encryption off, because PDF/A forbids encryption and the converter would otherwise read a document it cannot open.
 */
const preparePdfaIn: PdfaPreparer | null =
  shimPath === null
    ? null
    : async (area, from, into, password) => {
        const input = join(area.snapshotDirectory, from);
        if (!existsSync(input)) return { kind: 'missing' };
        let document: Document;
        try {
          document = Document.openDocument(await readFile(input), 'application/pdf');
        } catch {
          return { kind: 'unreadable' };
        }
        try {
          if (!(document instanceof PDFDocument) || document.authenticatePassword(password ?? '') === 0) return { kind: 'unreadable' };
          const preparation = prepareForPdfa(document);
          const saved = savedBuffer(document, 'garbage,encrypt=none');
          try {
            const output = join(area.outputDirectory, into);
            await writeFile(output, saved.asUint8Array());
            return { kind: 'prepared', bytes: (await stat(output)).size, ...preparation };
          } finally {
            saved.destroy();
          }
        } finally {
          document.destroy();
        }
      };

// AREAS, NOT SESSIONS. This host holds no parse between calls, and it holds the
// granted directories anyway (ADR-0048 Decision 2): a call that carried its own
// directories would be a channel through which a confused main could redirect
// bytes. One table, which the handlers and the file routes both read.
const areas = createHostSessions<HostArea>(cryptoBytes);

const handlers = createComposeHandlers({
  keepInlineImages: keepInlineImagesIn,
  preparePdfa: preparePdfaIn,
  optimize,
  // DRAWN WITH THE BOUND LIBRARY, so it is there exactly when Optimize is.
  signatureFromScan: shimPath === null ? null : signatureFromScan,
  areas,
  files: hostFilesystem,
  probe: probeContainment,
  faces,
  // EACH COMPOSITION IN A THREAD THAT ENDS WITH IT (ADR-0239 Decision 3): what HarfBuzz and pdf-lib kept goes with it.
  composeMarkdown: composerApart('markdown'),
  composeCsv: composerApart('csv'),
  composeImages,
});

/** Serves the compose channels on `stream`, the pipe the launcher connected. Called once. */
export function serveCompose(stream: HostByteStream): void {
  startEngineHost(
    stream,
    {
      channels: composeChannels,
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
      // A WORKBOOK'S OUTLINE AND A JOIN'S LIST cross in files (ADR-0125): the area's own directories, the PDFium host's rule.
      fileAnswers: sessionFileAnswers(areas, hostFilesystem),
    },
    (reason) => {
      process.stderr.write(`MONSTERA_HOST_ENDED ${reason.code}: ${reason.detail}\n`);
      // A NON-ZERO EXIT for every ending, including the ordinary one, for
      // `hostEntry.ts`' reason: this process only ever stops because its
      // connection did.
      process.exit(1);
    },
  );
}

