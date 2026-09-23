/**
 * Why an in-place text edit was refused because of what the PAGE can carry.
 *
 * **In a module that imports nothing**, `signingRefusals.ts`' reason: main's
 * barrel exports this class so the shell can turn it into a sentence, and the
 * code that throws it lives in `pdfiumFfi.ts`, which binds a native library and
 * must never be reached from the barrel (ADR-0026, `proof:kernelload`).
 *
 * ## The fact it carries is measured, and so is its detector
 *
 * A new text object in a font the page already uses round-trips for 426 of 457
 * corpus runs; the others are fonts whose encoding cannot express a character
 * that was typed. Reading the written object back from the LIVE text page
 * agrees with reopened bytes exactly, and the control — a character no Latin
 * font carries — reads back 0 of 642
 * ([ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md),
 * `scripts/research/pdfiumReflow.mjs`). So the edit is refused before the
 * page's content is generated, and nothing about the document changes.
 */
export class TextNotWritableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'the page’s font cannot carry the text that was typed, so the edit was refused before anything was written',
      options,
    );
    this.name = 'TextNotWritableError';
  }
}
