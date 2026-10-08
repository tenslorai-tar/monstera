import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract/host';

import { composeCsv } from '../csvCompose.js';
import { type FaceSource, faceSourceOf, fontFoldersOf } from '../fontCatalogue.js';
import { composeImages } from '../imageCompose.js';
import { composeMarkdown } from '../markdownCompose.js';
import { MupdfOpenRefused, keepInlineImages, openMupdfShim, rewriteImages } from '../mupdfRaw.js';
import { signatureFromScan } from '../signatureScan.js';
import { cryptoBytes } from '../token.js';
import { composeChannels } from './composeChannels.js';
import { type ImageOptimizer, type InlineImageKeeper, createComposeHandlers } from './composeHandlers.js';
import { probeContainment } from './containment.js';
import type { HostArea } from './engineHandlers.js';
import { sessionFileAnswers } from './fileAnswers.js';
import { startEngineHost } from './hostBody.js';
import { hostFilesystem, hostPipeStream } from './hostNodeSurfaces.js';
import { createHostSessions } from './hostSessions.js';

/**
 * The **compose** host's entry point
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
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

/**
 * The native MuPDF library's path, when the factory was given one — its second argument, as
 * PDFium's host takes `pdfium.dll`'s. ABSENT is a real state and not a refusal, unlike the pipe:
 * this host composes imports without it, and Optimize answers `unavailable`. Empty is absent, for
 * `pdfiumLibraryPath`'s measured reason — a shell expanding an unset variable passes `''`.
 */
const shimPath = process.argv[3] === undefined || process.argv[3].length === 0 ? null : process.argv[3];

// BOUND AT STARTUP, for `pdfiumHostEntry.ts`' reason: a first bind inside a handler would put a
// load failure inside a person's Optimize answer rather than in this host's start.
if (shimPath !== null) openMupdfShim(shimPath);

/**
 * The bundled fonts' folder (ADR-0172), the factory's THIRD argument, empty where it had none — `shimPath`'s rule.
 */
const fontsPath = process.argv[4] === undefined || process.argv[4].length === 0 ? null : process.argv[4];

/** The machine's installed fonts' folder (ADR-0172 Decision 2), the FOURTH argument, empty where it had none. */
const installedPath = process.argv[5] === undefined || process.argv[5].length === 0 ? null : process.argv[5];

/**
 * The catalogue the composers set text from, READ ON FIRST USE and kept: an Optimize or an image import never needs
 * it, and twenty-one faces read once are cheaper than a read per import. A folder that holds no face is a host started
 * without its fonts — a fault, reported as one, never an answer about the person's file.
 */
let catalogue: FaceSource | null = null;
function faces(): FaceSource {
  if (catalogue === null) {
    if (fontsPath === null) throw new Error('the compose host was started without its fonts folder');
    catalogue = faceSourceOf(fontFoldersOf(fontsPath, installedPath));
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

// AREAS, NOT SESSIONS. This host holds no parse between calls, and it holds the
// granted directories anyway (ADR-0048 Decision 2): a call that carried its own
// directories would be a channel through which a confused main could redirect
// bytes. One table, which the handlers and the file routes both read.
const areas = createHostSessions<HostArea>(cryptoBytes);

const handlers = createComposeHandlers({
  keepInlineImages: keepInlineImagesIn,
  optimize,
  // DRAWN WITH THE BOUND LIBRARY, so it is there exactly when Optimize is.
  signatureFromScan: shimPath === null ? null : signatureFromScan,
  areas,
  files: hostFilesystem,
  probe: probeContainment,
  faces,
  composeMarkdown,
  composeCsv,
  composeImages,
});

startEngineHost(
  hostPipeStream(pipeName),
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
