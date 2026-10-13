import { copyFile } from 'node:fs/promises';

import { MAX_PDFA_REMOVAL_CHARS, MAX_PDFA_REMOVALS, type PdfaLeftOutKind, type PdfaLevel } from '@monstera/contract';
import type { HeldPassword } from '@monstera/shared';

import { type ConversionFailure, type ConverterPlatform, convertDocument, describeConversionFailure } from './converterSession.js';
import type { ConverterBounds } from './externalConverter.js';
import type { ShellFailureSink } from './shellFailure.js';

/**
 * PDF/A-2b: §3's *PDF/A-2b export* row
 * ([ADR-0075](../../../docs/DECISIONS/0075-pdfa-2b-is-ghostscripts-pdfwrite-and-what-it-removes-is-reported.md)).
 *
 * Ghostscript's `pdfwrite`, run once per export through §8's seam by
 * `converterSession.ts`, with the arguments ADR-0075 fixes.
 *
 * ## What it removed is the report, because its exit code is not
 *
 * Measured 2026-09-17: Ghostscript exits 0 under every compatibility policy on a document
 * whose annotation it cannot carry, and prints what it did. So under policy 1 — convert,
 * removing what PDF/A cannot hold — a line saying it *reverted to normal PDF output*
 * means the file is not PDF/A at all and nothing is written.
 *
 * ## Its words are never shown (the 2026-10-13 correction, the owner's N7)
 *
 * Its line named nothing a person could find: what it dropped was a comment's pop-up, and the
 * comment stayed. So the copy it reads is prepared first in the compose host, which removes what
 * cannot be kept and NAMES it by kind and page; a *not permitted* line Ghostscript still prints is
 * counted, never quoted.
 */

/**
 * `lib/PDFA_def.ps`'s pdfmarks, the sRGB profile read from Ghostscript's own ROM.
 *
 * Without an output intent veraPDF fails the output on 6.2.4.3-2 and 6.2.10-2; with this
 * it passes (ADR-0075 reading 3). Passed as an argument, so no file of ours is written for
 * Ghostscript to read.
 */
export const PDFA_OUTPUT_INTENT = [
  '[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark',
  '[{icc_PDFA} <</N 3>> /PUT pdfmark',
  '[{icc_PDFA} (%rom%iccprofiles/srgb.icc) (r) file /PUT pdfmark',
  '[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark',
  '[{OutputIntent_PDFA} <</Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB)>> /PUT pdfmark',
  '[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark',
].join(' ');

/**
 * Ghostscript's command line for one conversion, as ADR-0075 fixes it; the level the person chose is the one thing
 * that varies (its 2026-10-13 correction), and the output intent is the same for all three.
 */
export function pdfaArguments(input: string, output: string, level: PdfaLevel): readonly string[] {
  return [
    `-dPDFA=${String(level)}`,
    '-dBATCH',
    '-dNOPAUSE',
    '-dSAFER',
    '-sColorConversionStrategy=RGB',
    '-dPDFACompatibilityPolicy=1',
    '-sDEVICE=pdfwrite',
    `-sOutputFile=${output}`,
    '-c',
    PDFA_OUTPUT_INTENT,
    '-f',
    input,
  ];
}

/**
 * The bounds §8 puts on this converter: ceilings against a hung or hostile conversion.
 *
 * Measured 2026-09-17 on this machine with Ghostscript 10.08.0: the eleven-document corpus
 * at most **3.7 s** uncontained, and the H6 fixture **6.1 s** contained.
 *
 * Memory measured 2026-09-30 on this machine by `scripts/research/converterPeaks.mjs`, contained,
 * through this module, as the job's peak: one page **8.6 MiB**, forty pages of 300 dpi scan-sized
 * pictures **17.4 MiB** in 17.6 s, a thousand dense text pages **61.4 MiB** in 14.3 s. pdfwrite
 * streams page by page, so the gibibyte is 16 times the heaviest reading — a ceiling against a
 * hostile file, not near anything a person converts.
 */
export const PDFA_BOUNDS: ConverterBounds = {
  processMemoryLimitBytes: 1024 * 1024 * 1024,
  timeoutMs: 10 * 60 * 1000,
};

const NOT_PERMITTED = 'not permitted in PDF/A';
const REVERTED = 'reverting to normal PDF output';

/**
 * The lines in what Ghostscript printed that report something removed, each once, in
 * order, within the bounds.
 */
export function removalsOf(said: string | null): readonly string[] {
  if (said === null) return [];
  const seen = new Set<string>();
  for (const raw of said.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line.includes(NOT_PERMITTED) || line.includes(REVERTED)) continue;
    seen.add(line.slice(0, MAX_PDFA_REMOVAL_CHARS));
    if (seen.size === MAX_PDFA_REMOVALS) break;
  }
  return [...seen];
}

/** What a PDF/A copy left out of one page, of one kind, named for the person (`pdfaPreparation.ts`). */
export interface PdfaLeftOut {
  readonly page: number;
  readonly kind: PdfaLeftOutKind;
  readonly count: number;
}

/**
 * How the copy Ghostscript reads is prepared — the compose host's `engine/prepare-pdfa` — from the save's flush and
 * the key the document opens with. `prepared` names a FILE, which is copied into the converter's area file to file, so
 * `main` never holds the prepared copy beside the flush (§4, *main never holds two images*). `unreadable` and
 * `unavailable` are the host's answers, after which the flush is converted as it is.
 */
export type PdfaPreparer = (
  pdf: Uint8Array,
  opensWith: HeldPassword | undefined,
) => Promise<
  | {
      readonly kind: 'prepared';
      readonly path: string;
      readonly leftOut: readonly PdfaLeftOut[];
      /** Items left out past the named entries' bound, counted. */
      readonly leftOutMore: number;
      /** Removes the prepared copy; never rejects, since it runs in a `finally`. */
      readonly discard: () => Promise<void>;
    }
  | { readonly kind: 'unreadable' | 'unavailable' }
>;

/**
 * A conversion's answer: what the copy left out, named; how many further things Ghostscript said it removed, COUNTED
 * because its words are never shown (ADR-0075's 2026-10-13 correction); and the PDF/A file as it is read, checked for
 * its own declarations as it streams.
 */
export interface PdfaConversion {
  readonly leftOut: readonly PdfaLeftOut[];
  /** Items the preparation left out past the named entries' bound, counted. */
  readonly leftOutMore: number;
  readonly otherLeftOut: number;
  readonly output: AsyncIterable<Uint8Array>;
}

export type PdfaSource = (pdf: Uint8Array, level: PdfaLevel, opensWith: HeldPassword | undefined) => Promise<PdfaConversion>;

/**
 * Why no PDF/A file was produced: the seam's failures, a conversion that reverted to plain PDF, or an output that does
 * not declare the level asked for.
 */
export type PdfaFailure =
  | ConversionFailure
  | { readonly stage: 'reverted'; readonly said: string }
  | { readonly stage: 'undeclared'; readonly missing: string };

/**
 * The output's own declarations, read as it streams (ADR-0075's 2026-10-13 correction, reading 4): its XMP
 * `pdfaid:part` must be `level` and its `pdfaid:conformance` B, and its catalogue must carry `/OutputIntents`.
 *
 * A FIXED SUBSTRING MATCH over bytes our converter wrote, never a parse — nothing about the file's structure is read in
 * `main` (threat model §2). The metadata stream is written uncompressed (measured at all three levels), which is what
 * makes the text findable; a window kept across chunk edges keeps a declaration split between two chunks found. Both
 * attribute (`pdfaid:part='2'`) and element (`<pdfaid:part>2</pdfaid:part>`) spellings are read.
 *
 * @returns what is missing, or `null` when everything is declared
 */
export function undeclared(text: string, level: PdfaLevel): string | null {
  const part = /pdfaid:part(?:=['"]|>)\s*(\d)/u.exec(text)?.[1];
  const conformance = /pdfaid:conformance(?:=['"]|>)\s*([A-Za-z])/u.exec(text)?.[1];
  if (part !== String(level)) return `pdfaid:part is ${part ?? 'absent'}, where ${String(level)} was asked for`;
  if (conformance?.toUpperCase() !== 'B') return `pdfaid:conformance is ${conformance ?? 'absent'}, where B was asked for`;
  if (!text.includes('/OutputIntents')) return 'no /OutputIntents';
  return null;
}

/** The longest span a declaration this reads can occupy, so the window kept across chunks always holds one whole. */
const DECLARATION_WINDOW = 64;

/** `output`, passed through unchanged, failing at its end when {@link undeclared} finds something missing. */
export async function* checkedAs(
  output: AsyncIterable<Uint8Array>,
  level: PdfaLevel,
  failed: (failure: PdfaFailure) => PdfaFailedError,
): AsyncIterable<Uint8Array> {
  const found = { part: '', conformance: '', intents: false };
  let tail = '';
  for await (const chunk of output) {
    const text = tail + Buffer.from(chunk).toString('latin1');
    found.part ||= /pdfaid:part(?:=['"]|>)\s*\d/u.exec(text)?.[0] ?? '';
    found.conformance ||= /pdfaid:conformance(?:=['"]|>)\s*[A-Za-z]/u.exec(text)?.[0] ?? '';
    found.intents ||= text.includes('/OutputIntents');
    tail = text.slice(-DECLARATION_WINDOW);
    yield chunk;
  }
  const missing = undeclared(`${found.part} ${found.conformance} ${found.intents ? '/OutputIntents' : ''}`, level);
  if (missing !== null) throw failed({ stage: 'undeclared', missing });
}

/** A conversion that produced no PDF/A file, with why — thrown, so the export reports it. */
export class PdfaFailedError extends Error {
  readonly failure: PdfaFailure;

  constructor(failure: PdfaFailure) {
    super(
      `the document could not be converted to PDF/A: ${
        failure.stage === 'reverted'
          ? `Ghostscript reverted to plain PDF: ${failure.said}`
          : failure.stage === 'undeclared'
            ? `the output does not declare what was asked: ${failure.missing}`
            : describeConversionFailure(failure)
      }`,
    );
    this.name = 'PdfaFailedError';
    this.failure = failure;
  }
}

/**
 * @param report where a failed conversion's reason goes; the export answers the renderer
 *   *failed*, and Ghostscript's own words land in the shell log
 */
export function createPdfaSource(platform: ConverterPlatform, report: ShellFailureSink, prepare: PdfaPreparer): PdfaSource {
  const failed = (failure: PdfaFailure): PdfaFailedError => {
    const error = new PdfaFailedError(failure);
    report({ event: 'converter-failed', detail: error.message });
    return error;
  };
  return async (pdf, level, opensWith) => {
    const prepared = await prepare(pdf, opensWith);
    if (prepared.kind !== 'prepared') {
      // CONVERTED AS IT IS, and said in the log: a build without the native library, or a document MuPDF cannot open,
      // still gets the converter's own pass, and what it removes is counted below.
      report({ event: 'converter-failed', detail: `the PDF/A copy was not prepared (${prepared.kind}); converting the document as it is` });
    }
    try {
      const converted = await convertDocument(
        platform,
        // FILE TO FILE when prepared, so the prepared copy never sits in `main` beside the flush.
        prepared.kind === 'prepared' ? (input: string) => copyFile(prepared.path, input) : pdf,
        {
          kind: 'arguments',
          input: 'in.pdf',
          output: 'out.pdf',
          commandArguments: (input, output) => pdfaArguments(input, output, level),
        },
        failed,
      );
      const said = converted.said ?? '';
      if (said.includes(REVERTED)) {
        // NOT PDF/A, so it is never read: the pair goes with the file in it.
        converted.discard();
        throw failed({ stage: 'reverted', said: said.slice(0, MAX_PDFA_REMOVAL_CHARS) });
      }
      return {
        leftOut: prepared.kind === 'prepared' ? prepared.leftOut : [],
        leftOutMore: prepared.kind === 'prepared' ? prepared.leftOutMore : 0,
        otherLeftOut: removalsOf(converted.said).length,
        output: checkedAs(converted.output, level, failed),
      };
    } finally {
      if (prepared.kind === 'prepared') await prepared.discard();
    }
  };
}
