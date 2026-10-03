import type { CommandKind } from '@monstera/contract';

import { declaredCommands, type WriterOfRecord } from './commandDeclarations.js';

/**
 * Which commands break a digital signature, derived in ONE place from what already decides it
 * ([ADR-0149](../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)).
 *
 * A signature covers the exact bytes of the file it was made in. A command keeps it when what it writes is an
 * incremental update over those bytes, and breaks it when what it writes is the whole document again. That is a
 * property of the command's WRITER and its PURPOSE, both of which a command declares anyway, so a command added tomorrow
 * is classified without a third declaration that could disagree with them.
 */

/**
 * Whether a writer's result is the whole document rewritten, rather than an update appended to it.
 *
 * - **PDFium**: `FPDF_SaveAsCopy` with flags `0`, a full rewrite (`pdfiumFfi.ts`' serialise, and the measurement it
 *   records). Each of its commands answers a whole document.
 * - **MuPDF**: its save of a signed document appends (ADR-0008's second row), so a live-session command keeps one.
 * - **pdf-lib**: a command's result is its input with one revision appended (ADR-0127).
 * - **the signer**: its placeholder is appended (ADR-0149 Decision 1).
 *
 * Keyed on every writer, so a writer added without an answer here is a compile error rather than a silent *keeps*.
 */
const REWRITES_WHOLE: Readonly<Record<WriterOfRecord, boolean>> = {
  mupdf: false,
  pdfium: true,
  'pdf-lib': false,
  signpdf: false,
};

/**
 * Whether running `kind` on a document breaks the signatures in it: its writer rewrites the whole document, or its
 * purpose is a removal, which ADR-0008's first row saves whole with no prior revisions.
 */
export function breaksSignatures(kind: CommandKind): boolean {
  const declared = declaredCommands[kind];
  return REWRITES_WHOLE[declared.writer] || declared.purpose === 'removal';
}
