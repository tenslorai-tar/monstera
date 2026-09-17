import { type ConversionFailure, type ConverterPlatform, convertDocument, describeConversionFailure } from './converterSession.js';
import type { ConverterBounds } from './externalConverter.js';
import type { ShellFailureSink } from './shellFailure.js';

/**
 * Layout-preserving text: §3's *Text extraction* row, its layout half
 * ([ADR-0071](../../../docs/DECISIONS/0071-layout-preserving-text-is-popplers-pdftotext-in-a-contained-process.md)).
 *
 * Poppler's `pdftotext -layout`, run once per export through §8's external-converter
 * seam by `converterSession.ts`, which owns the session pair, the fixed names, the run
 * and the streamed output every converter of a document shares.
 *
 * ## The text is never resident in `main`, which is ADR-0035
 *
 * The answer is an async iterable over the output file's chunks, which
 * `writeStreamedDocument` pulls as it writes — so `main` holds one read buffer's worth
 * of text at a time, as the plain export holds one page's.
 */
export type LayoutTextSource = (pdf: Uint8Array) => Promise<AsyncIterable<Uint8Array>>;

/** A conversion that produced no text, with why — thrown, so the export reports it. */
export class LayoutTextFailedError extends Error {
  readonly failure: ConversionFailure;

  constructor(failure: ConversionFailure) {
    super(`layout-preserving text could not be extracted: ${describeConversionFailure(failure)}`);
    this.name = 'LayoutTextFailedError';
    this.failure = failure;
  }
}

/**
 * The bounds §8 puts on this converter.
 *
 * **Ceilings against a hung or hostile conversion, not performance budgets.**
 * Measured 2026-09-17 on this machine with `pdftotext -layout` 26.09.0, uncontained:
 * the eleven-document corpus at most **1,090 ms and 11.8 MB peak working set**,
 * and a generated 2,000-page text-dense document (6.4 MB) **9,021 ms and
 * 41.2 MB**, writing 10.3 MB of text. Ten minutes is 66 times the larger reading
 * and a gibibyte 25 times its memory: nothing a person would wait for is cut
 * off, and a parser spinning on a crafted file is.
 */
export const LAYOUT_TEXT_BOUNDS: ConverterBounds = {
  processMemoryLimitBytes: 1024 * 1024 * 1024,
  timeoutMs: 10 * 60 * 1000,
};

/**
 * @param report where a failed conversion's reason goes. The export answers the
 *   renderer only *failed*; the converter's own words land in the shell log.
 */
export function createLayoutTextSource(platform: ConverterPlatform, report: ShellFailureSink): LayoutTextSource {
  const failed = (failure: ConversionFailure): LayoutTextFailedError => {
    const error = new LayoutTextFailedError(failure);
    report({ event: 'converter-failed', detail: error.message });
    return error;
  };
  return async (pdf) =>
    (
      await convertDocument(
        platform,
        pdf,
        {
          input: 'in.pdf',
          output: 'out.txt',
          commandArguments: (input, output) => ['-layout', '-enc', 'UTF-8', input, output],
        },
        failed,
      )
    ).output;
}
