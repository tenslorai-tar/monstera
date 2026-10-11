import { hasRightToLeftLetter } from './bidiOrder.js';

/**
 * How a mark's drawings and rises are set on a page, in fractions of the size the words are drawn at: the ONE set of
 * figures both page-text writers take, the PDFium writer (`pdfiumFfi.ts`) and the Type 3 one (`operatorEdit.ts`), so a
 * word underlined, struck or highlighted on either page kind is drawn the same (B3a). These are design figures, the ones
 * word processors use, not measurements; the one measured bound, {@link JUSTIFY_CAP}, says where it was read.
 */

/** A superscript or subscript is set at this fraction of the size the words would have (ADR-0180 Decision 4). */
export const RISE_SCALE = 0.65;
/** How far a superscript is raised and a subscript dropped, as fractions of the size. */
export const SUPERSCRIPT_RISE = 0.33;
export const SUBSCRIPT_DROP = 0.12;

/** The rule under underlined words, and the one through struck words: this fraction of the size thick. */
export const UNDERLINE_THICKNESS = 0.06;
/** How far below the baseline the underline's top sits. */
export const UNDERLINE_DROP = 0.12;
/** How far above the baseline the line through struck words sits: about half a lower-case letter's height. */
export const STRIKE_RISE = 0.26;

/** A highlight reaches from this far below the baseline, under the descenders, to this far above it, over the capitals. */
export const HIGHLIGHT_BELOW = 0.24;
export const HIGHLIGHT_ABOVE = 0.9;

/**
 * The widest a justified line's space is stretched, as a fraction of its words' size. Measured 2026-10-11 with
 * `scripts/research/pdfiumPositions.mjs` (PDFium 155, MuPDF 1.28) on Helvetica 20: a space 6 and 12 points wider read as
 * one space in both readers, and 30 points wider made MuPDF read the line as two. 0.6 is the 12-point reading.
 */
export const JUSTIFY_CAP = 0.6;

/**
 * What character spacing adds to `text`: `spacing` after each character, and nothing for words in a joined right-to-left
 * script, which are never letter-spaced — a gap inside a joined word breaks the joins a reader draws (ADR-0228 Decision 1).
 * The one rule both writers' measures and drawings take, so the line that is planned is the line drawn.
 */
export function spacedBy(text: string, spacing: number): number {
  return spacing === 0 || !spaceable(text) ? 0 : spacing * Array.from(text).length;
}

/** Whether `text` may be letter-spaced or have its spaces stretched: not where it holds a right-to-left letter. */
export function spaceable(text: string): boolean {
  return !hasRightToLeftLetter(text);
}
