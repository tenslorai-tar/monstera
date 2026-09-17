import { MAX_PDFA_REMOVAL_CHARS, MAX_PDFA_REMOVALS } from '@monstera/contract';

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
 * removing what PDF/A cannot hold — each line saying something is *not permitted in
 * PDF/A* is answered to the person, and a line saying it *reverted to normal PDF output*
 * means the file is not PDF/A at all and nothing is written.
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

/** Ghostscript's command line for one conversion, as ADR-0075 fixes it. */
export function pdfaArguments(input: string, output: string): readonly string[] {
  return [
    '-dPDFA=2',
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
 * at most **3.7 s** uncontained, and the H6 fixture **6.1 s** contained. Its memory was not
 * measured; a gibibyte is the layout converter's ceiling and is not a reading of this one.
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

/** A conversion's answer: the removals, and the PDF/A file as it is read. */
export interface PdfaConversion {
  readonly removed: readonly string[];
  readonly output: AsyncIterable<Uint8Array>;
}

export type PdfaSource = (pdf: Uint8Array) => Promise<PdfaConversion>;

/** Why no PDF/A file was produced: the seam's failures, or a conversion that reverted to plain PDF. */
export type PdfaFailure = ConversionFailure | { readonly stage: 'reverted'; readonly said: string };

/** A conversion that produced no PDF/A file, with why — thrown, so the export reports it. */
export class PdfaFailedError extends Error {
  readonly failure: PdfaFailure;

  constructor(failure: PdfaFailure) {
    super(
      `the document could not be converted to PDF/A-2b: ${
        failure.stage === 'reverted' ? `Ghostscript reverted to plain PDF: ${failure.said}` : describeConversionFailure(failure)
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
export function createPdfaSource(platform: ConverterPlatform, report: ShellFailureSink): PdfaSource {
  const failed = (failure: PdfaFailure): PdfaFailedError => {
    const error = new PdfaFailedError(failure);
    report({ event: 'converter-failed', detail: error.message });
    return error;
  };
  return async (pdf) => {
    const converted = await convertDocument(
      platform,
      pdf,
      { input: 'in.pdf', output: 'out.pdf', commandArguments: pdfaArguments },
      failed,
    );
    const said = converted.said ?? '';
    if (said.includes(REVERTED)) {
      // NOT PDF/A, so it is never read: the pair goes with the file in it.
      converted.discard();
      throw failed({ stage: 'reverted', said: said.slice(0, MAX_PDFA_REMOVAL_CHARS) });
    }
    return { removed: removalsOf(converted.said), output: converted.output };
  };
}
