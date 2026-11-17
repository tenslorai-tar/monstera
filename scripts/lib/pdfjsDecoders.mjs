// @ts-check
/**
 * Where the renderer build puts PDF.js's JavaScript decoders, and which they are: ONE statement, read by the build that
 * emits them and by the renderer that names their folder to PDF.js
 * ([ADR-0296](../../docs/DECISIONS/0296-the-renderer-is-served-from-its-own-scheme-and-a-picture-is-never-dropped-silently.md)).
 * The names are PDF.js's own: its worker imports `${wasmUrl}jbig2_nowasm_fallback.js` for CCITT and JBIG2 and
 * `${wasmUrl}openjpeg_nowasm_fallback.js` for JPEG 2000.
 */

/** The folder, relative to the renderer's page. */
export const PDFJS_DECODERS_DIR = 'pdfjs-decoders';

/** The decoders, by the names PDF.js imports them by. */
export const PDFJS_DECODERS = /** @type {const} */ (['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']);
