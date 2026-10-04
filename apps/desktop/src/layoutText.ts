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
export type LayoutTextSource = (pdf: Uint8Array, pages: readonly number[] | 'all') => Promise<AsyncIterable<Uint8Array>>;

/** The form feed `pdftotext` writes at the end of every page, and the only boundary its output carries. */
const PAGE_END = 0x0c;

/**
 * The chosen pages of `pdftotext`'s output, each still ended by its form feed (ADR-0161).
 *
 * One run reads from the first chosen page to the last, so this keeps the pages between that were not chosen out of
 * the file. A page is counted at each form feed, which UTF-8 never carries inside a character, so a chunk boundary
 * inside a page or a character cannot move the count.
 *
 * @param first the zero-based page the run began at
 */
export async function* keptPages(chunks: AsyncIterable<Uint8Array>, first: number, keep: ReadonlySet<number>): AsyncIterable<Uint8Array> {
  let page = first;
  for await (const chunk of chunks) {
    let from = 0;
    for (let at = 0; at < chunk.length; at += 1) {
      if (chunk[at] !== PAGE_END) continue;
      if (keep.has(page)) yield chunk.subarray(from, at + 1);
      page += 1;
      from = at + 1;
    }
    if (from < chunk.length && keep.has(page)) yield chunk.subarray(from);
  }
}

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
  return async (pdf, pages) => {
    // ONE RUN FROM THE FIRST CHOSEN PAGE TO THE LAST (ADR-0161, as corrected): a process per run of pages would start
    // thousands for a scattered choice. `pdftotext` counts pages from 1.
    // A LOOP, never a spread into Math.min: a document of a million pages is a million arguments, past the stack.
    const span =
      pages === 'all' || pages.length === 0
        ? null
        : pages.reduce((range, page) => ({ first: Math.min(range.first, page), last: Math.max(range.last, page) }), {
            first: Number.POSITIVE_INFINITY,
            last: Number.NEGATIVE_INFINITY,
          });
    const range = span === null ? [] : ['-f', String(span.first + 1), '-l', String(span.last + 1)];
    const { output } = await convertDocument(
      platform,
      pdf,
      {
        kind: 'arguments',
        input: 'in.pdf',
        output: 'out.txt',
        commandArguments: (input, output) => [...range, '-layout', '-enc', 'UTF-8', input, output],
      },
      failed,
    );
    return span === null || pages === 'all' ? output : keptPages(output, span.first, new Set(pages));
  };
}
