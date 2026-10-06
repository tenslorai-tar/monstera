// THE HOST ENTRY, never the root: the PDFium host loads this module, and the root builds the renderer's channel map
// (`proof:hostload`).
import { UNWRITABLE_CHARACTERS_MAX, UNWRITABLE_CHARACTERS_MAX_UNITS } from '@monstera/contract/host';
import type { EditStep } from '@monstera/shared';

/**
 * Why an in-place text edit was refused because of what the PAGE can carry.
 *
 * **In a module that imports no implementation**, `signingRefusals.ts`' reason: main's
 * barrel exports this class so the shell can turn it into a sentence, and the
 * code that throws it lives in `pdfiumFfi.ts`, which binds a native library and
 * must never be reached from the barrel (ADR-0026, `proof:kernelload`). The two
 * bounds come from the contract, which is schemas and binds nothing.
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

/**
 * Why a replacement made no new version: nothing it was asked to replace was found in a text object, or every match
 * already reads as its replacement (ADR-0169 Decision 6).
 *
 * Thrown before anything is generated or serialised, so the bus records no entry and the document keeps its version.
 * The find bar matches through MuPDF's reading of the page and the replacement through PDFium's text objects, so a
 * word the find bar shows can still be one no object holds whole — split across two objects — and this is what the
 * person reads then.
 */
export class NothingToReplaceError extends Error {
  constructor(options?: ErrorOptions) {
    super('no text object holds a match the replacement would change, so nothing was written', options);
    this.name = 'NothingToReplaceError';
  }
}

/**
 * Why a Replace wrote nothing: it changes a text object's width and other text follows that object on its line, which
 * would have to move (`replaceLineRule.ts`, the owner's answer of 2026-10-05). Moving it needs the line, which a
 * Replace does not have; Edit text does. Thrown before anything is generated or serialised, so there is no new version.
 */
export class ReplaceMovesLineError extends Error {
  constructor(options?: ErrorOptions) {
    super('the replacement changes its text’s width and text follows it on its line, so nothing was written', options);
    this.name = 'ReplaceMovesLineError';
  }
}

export class TextNotWritableError extends Error {
  /**
   * The characters the font cannot show, as {@link unwritableCharacters} chose them; empty where the comparison found
   * none to name, and the person is then told without a list.
   */
  readonly characters: string;

  constructor(characters: string, options?: ErrorOptions) {
    super(
      'the page’s font cannot carry the text that was typed, so the edit was refused before anything was written',
      options,
    );
    this.name = 'TextNotWritableError';
    this.characters = characters;
  }
}

/**
 * The characters a refusal names: those of what was WRITTEN that the read-back does not contain, each once, in the
 * order typed, whitespace aside — ADR-0169 Decision 4.
 *
 * Graphemes rather than code points, so an accent typed as a combining mark is named with its letter. Bounded twice,
 * by {@link UNWRITABLE_CHARACTERS_MAX} characters and {@link UNWRITABLE_CHARACTERS_MAX_UNITS} UTF-16 units, the wire's
 * own bounds; past either, the first ones typed are named.
 *
 * @param pairs each write and what it read back as
 */
export function unwritableCharacters(pairs: readonly { readonly written: string; readonly read: string }[]): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const named: string[] = [];
  let units = 0;
  for (const { written, read } of pairs) {
    if (written === read) continue;
    const present = new Set(Array.from(segmenter.segment(read), (part) => part.segment));
    for (const { segment } of segmenter.segment(written)) {
      if (segment.trim() === '' || present.has(segment) || named.includes(segment)) continue;
      if (named.length === UNWRITABLE_CHARACTERS_MAX || units + segment.length > UNWRITABLE_CHARACTERS_MAX_UNITS) {
        return named.join('');
      }
      named.push(segment);
      units += segment.length;
    }
  }
  return named.join('');
}

/**
 * Why a PDFium rewrite refused, naming the step from ADR-0169 Decision 3's fixed set and the number PDFium answered.
 *
 * Thrown where a native call refuses, with `FPDF_GetLastError` read at that moment; `engineError` is 0 where PDFium
 * kept no error, which several of its calls do (a refused `FPDFText_SetText` answers 0). The step and the number are
 * this application's reading of the refusal; PDFium's own words about the file never travel.
 */
export class EditRefusedError extends Error {
  readonly step: EditStep;
  readonly engineError: number;

  constructor(step: EditStep, engineError: number, what: string, options?: ErrorOptions) {
    super(`${what} (step ${step}, FPDF_GetLastError ${String(engineError)}), so nothing was changed`, options);
    this.name = 'EditRefusedError';
    this.step = step;
    this.engineError = engineError;
  }
}
