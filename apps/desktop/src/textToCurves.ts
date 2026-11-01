import { copyFile } from 'node:fs/promises';

import type { KeptKind } from '@monstera/contract';
import type { HeldPassword } from '@monstera/shared';

import { type ConversionFailure, type ConverterPlatform, convertDocument, describeConversionFailure } from './converterSession.js';
import type { ShellFailureSink } from './shellFailure.js';

/**
 * *Convert text to curves*: a copy of the document whose every letter is drawn as a shape
 * ([ADR-0282](../../../docs/DECISIONS/0282-text-to-curves-saves-a-new-copy-whose-letters-are-shapes.md)).
 *
 * Ghostscript's `pdfwrite` with `-dNoOutputFonts`, run once per copy through §8's seam by `converterSession.ts` on the
 * PDF/A converter's own platform, so it is contained exactly as PDF/A is (Decision 5). The arguments are fixed and
 * nothing of the document's choosing is among them.
 *
 * ## What it dropped is counted, because it says nothing
 *
 * Measured 2026-11-01 (`scripts/research/textToCurves.mjs`, the Linux build of Ghostscript 10.08.0): it printed its
 * banner and the page count alone on every fixture, the one whose three fields it removed included. So the compose
 * host counts the document before and the copy after (`keptCensus.ts`), and the command names every count that fell.
 */

/** Ghostscript's command line for one copy, as ADR-0282 Decision 5 fixes it. */
export function curvesArguments(input: string, output: string): readonly string[] {
  return ['-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=pdfwrite', '-dNoOutputFonts', `-sOutputFile=${output}`, '-f', input];
}

/** One document's census, as the compose host answers it: `KeptCensus` across the wire. */
export interface CountedKept {
  readonly kept: Readonly<Record<KeptKind, number>>;
  readonly fonts: number;
}

/**
 * How main has the compose host count a document (`engine/count-kept`). `source` is the flush's bytes or a FILE main
 * wrote, which is copied into the host's area file to file, so `main` never reads the copy back in. With `unencrypted`
 * the host also writes the document with its encryption off, and `path` names it for the converter, which is how a
 * document that opens with a password is converted with the password kept off Ghostscript's command line.
 */
export type KeptCounter = (
  source: { readonly bytes: Uint8Array } | { readonly file: string },
  opensWith: HeldPassword | undefined,
  unencrypted: boolean,
) => Promise<
  | {
      readonly kind: 'counted';
      readonly census: CountedKept;
      /** The unencrypted copy, where one was asked for; `null` otherwise. */
      readonly path: string | null;
      /** Removes the unencrypted copy; never rejects, since it runs in a `finally`. */
      readonly discard: () => Promise<void>;
    }
  | { readonly kind: 'unreadable' | 'unavailable' }
>;

/** A conversion's answer: the document's census before, where it could be read, and the copy as it is read. */
export interface CurvesConversion {
  readonly before: CountedKept | null;
  readonly output: AsyncIterable<Uint8Array>;
}

export type CurvesSource = (pdf: Uint8Array, opensWith: HeldPassword | undefined) => Promise<CurvesConversion>;

/** A conversion that produced no copy, with why: thrown, so the command reports it. */
export class CurvesFailedError extends Error {
  readonly failure: ConversionFailure;

  constructor(failure: ConversionFailure) {
    super(`the document could not be converted to curves: ${describeConversionFailure(failure)}`);
    this.name = 'CurvesFailedError';
    this.failure = failure;
  }
}

/**
 * @param report where a failed conversion's reason goes; the command answers the renderer *failed*, and Ghostscript's
 *   own words land in the shell log
 */
export function createCurvesSource(platform: ConverterPlatform, report: ShellFailureSink, count: KeptCounter): CurvesSource {
  const failed = (failure: ConversionFailure): CurvesFailedError => {
    const error = new CurvesFailedError(failure);
    report({ event: 'converter-failed', detail: error.message });
    return error;
  };
  return async (pdf, opensWith) => {
    const counted = await count({ bytes: pdf }, opensWith, opensWith !== undefined);
    if (counted.kind !== 'counted') {
      // CONVERTED AS IT IS, and said in the log: a build without the native library, or a document MuPDF cannot open,
      // still gets its copy; with no census before, the command says it could not compare rather than that nothing went.
      report({ event: 'converter-failed', detail: `the document was not counted before its curves copy (${counted.kind})` });
    }
    try {
      const unencrypted = counted.kind === 'counted' ? counted.path : null;
      const converted = await convertDocument(
        platform,
        // FILE TO FILE when the host wrote an unencrypted copy, so it never sits in `main` beside the flush.
        unencrypted === null ? pdf : (input: string) => copyFile(unencrypted, input),
        { kind: 'arguments', input: 'in.pdf', output: 'out.pdf', commandArguments: curvesArguments },
        failed,
      );
      return { before: counted.kind === 'counted' ? counted.census : null, output: converted.output };
    } finally {
      if (counted.kind === 'counted') await counted.discard();
    }
  };
}
