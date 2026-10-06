import type { CommandOfKind } from '@monstera/contract';

import { declaredCommands } from './commandDeclarations.js';
import {
  captureSignDocument,
  invertSignDocument,
  NO_TIMESTAMPS,
  type RequestTimestamp,
  signPrepared,
} from './documentSign.js';
import type { Apply, ByteImage } from './engineSeam.js';
import { placeholderRequestOf } from './signatureHole.js';

/**
 * `@signpdf` as a writer of record — hosted on the MuPDF host since
 * [ADR-0148](../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md).
 *
 * ## The spec's apply is the WHOLE signature, in one process
 *
 * `pdfLibSpecs`' shape: a hosted writer's spec still takes the image, because the spec table is what a single process
 * runs end to end — a unit case, and the probe that signs against a live authority. In the application the two halves
 * run apart: the placeholder in the host (`signaturePlaceholder.ts`, loaded here on demand by a literal `import()`) and
 * the signature in `main` (`documentSign.ts`' `signpdfExecutionWith`). Both compose the same two functions, so the cases
 * that run this apply test the code the application runs.
 */

/**
 * The signing apply, over a timestamp port: the placeholder prepared and the signature made, in this process.
 *
 * `applySignDocument` is this with {@link NO_TIMESTAMPS}, so the spec table keeps one apply per kind and a caller with
 * a real port passes it — one function, parameterised, rather than two bodies that could drift.
 */
export function signDocumentWith(requestTimestamp: RequestTimestamp): Apply<'signpdf', 'signDocument'> {
  return async (image: ByteImage, command: CommandOfKind<'signDocument'>) => {
    const { prepareSignature } = await import('./signaturePlaceholder.js');
    return signPrepared(await prepareSignature(image, placeholderRequestOf(command)), command, requestTimestamp);
  };
}

/** The spec table's apply, with no timestamp port: a command asking for one is refused as unreachable. */
export const applySignDocument: Apply<'signpdf', 'signDocument'> = signDocumentWith(NO_TIMESTAMPS);

/**
 * The signpdf half of the routing table.
 *
 * Unannotated for `pdfLibSpecs`' reason: an annotation would widen `writer` to
 * the whole union and lose the binding of `apply` to this writer's session
 * type. It is checked where it is used.
 */
export const signpdfSpecs = {
  signDocument: {
    ...declaredCommands.signDocument,
    apply: applySignDocument,
    capture: captureSignDocument,
    // UNREACHABLE BY THE TYPE and required by the table's shape:
    // `CommandPrior['signDocument']` is `never`, so nothing can build an
    // argument for it.
    invert: invertSignDocument,
  },
};
