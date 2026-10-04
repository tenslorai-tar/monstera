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
/**
 * Why a replacement of ONE occurrence, named by its point on the page, was refused (ADR-0156 Decision 4).
 *
 * The word was found in one engine's reading of the page and is written through the other's text objects, and the
 * two readings agree on a page's lines about half the time (`proof:lineagreement`, 52.9%). So the occurrence is named
 * by where it is, and the edit happens only when exactly one text object holds the word at that point exactly once.
 * Anything else — no object there, an object without the word, the word twice in it, a word split across two objects
 * — is this refusal, and nothing is written: replacing a guess would change a word the person did not choose.
 */
export class TextNotInPlaceError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'no single text object holds the word at that point on the page, so it was not replaced there and nothing was written',
      options,
    );
    this.name = 'TextNotInPlaceError';
  }
}

export class TextNotWritableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'the page’s font cannot carry the text that was typed, so the edit was refused before anything was written',
      options,
    );
    this.name = 'TextNotWritableError';
  }
}
