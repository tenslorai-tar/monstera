/**
 * The name of the font Monstera's own recognition writes its invisible text in.
 *
 * **In a module that imports no library**, because the Word export reads it to tell recognised text from typed text and
 * sits in the MuPDF host's start graph, where `@cantoo/pdf-lib` — which `ocrTextLayer.ts` imports — must not be loaded
 * (`hostLoad.proof.mjs`). The layer writer and the readers take the name from here.
 */
export const GLYPHLESS_FONT_NAME = 'MonsteraGlyphless';
