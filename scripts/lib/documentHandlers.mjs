// @ts-check
/**
 * The document formats this application will open, and nothing else.
 *
 * ## What this replaces
 *
 * `fz_register_document_handlers` registers **fourteen** handlers. Every
 * `FZ_ENABLE_*` gate in MuPDF's `config.h` defaults to 1, this build overrode
 * none, and `gz_document_handler` carries no gate at all — so the set was
 * inherited from someone else's build defaults rather than chosen here.
 *
 * That is not a theoretical exposure. `fz_open_document` scores every registered
 * handler against the stream's CONTENT as well as against the filename and takes
 * the best, and the shim's "not a PDF" rejection comes from `pdf_specifics`
 * AFTER `fz_open_document` returns. A file that content-scores as EPUB was
 * already opened and parsed by the EPUB handler before it was refused.
 *
 * ## Three mechanisms, deliberately overlapping
 *
 * 1. **Build-time.** `-DFZ_ENABLE_<FORMAT>=0` stops `document-all.c` referencing
 *    the handler at all. Preferred, because an unreferenced object is a
 *    candidate for the linker to discard, and code that is not in the binary
 *    cannot be argued about. **What it does NOT do on its own:** every
 *    `FZ_ENABLE_*` is referenced from exactly two files — `document-all.c` and
 *    `config.h` — and nothing inside `epub-doc.c` or its siblings sits in an
 *    `#if`. So the flag removes the REGISTRATION, and only the linker removes
 *    the code. Whether it does is measured by
 *    `scripts/security/handlerFootprint.mjs` against the built DLL, never
 *    assumed from the flag.
 * 2. **Runtime.** The shim registers `pdf_document_handler` by name instead of
 *    calling `fz_register_document_handlers`. This is what covers
 *    `gz_document_handler`, which has no build flag to turn off, and it holds
 *    even if a future MuPDF adds a handler this list has never heard of.
 * 3. **Post-hoc.** `mz_open` still refuses anything `pdf_specifics` does not
 *    recognise. Kept, belt and braces — it was never sufficient on its own,
 *    which is the whole finding, but it costs nothing and catches a PDF-shaped
 *    file the parser opens and then cannot use.
 *
 * ## Adding a format later
 *
 * Add it here, and write an ADR saying which feature needs it and what its
 * parser is now exposed to. That is the point: it was a default, and it becomes
 * a decision.
 */

/**
 * Formats the shim will open. One entry, because every stage through SHIP 1.0
 * is PDF.
 *
 * @type {readonly string[]}
 */
export const PERMITTED_HANDLERS = ['pdf'];

/**
 * Every format MuPDF's `fz_register_document_handlers` would otherwise register,
 * with the `FZ_ENABLE_*` suffix that gates it.
 *
 * `gz` is deliberately absent: it is registered unconditionally, with no flag,
 * and is therefore reachable only through mechanism 2.
 *
 * @type {readonly { format: string, flag: string }[]}
 */
export const GATED_HANDLERS = [
  { format: 'pdf', flag: 'FZ_ENABLE_PDF' },
  { format: 'xps', flag: 'FZ_ENABLE_XPS' },
  { format: 'svg', flag: 'FZ_ENABLE_SVG' },
  { format: 'cbz', flag: 'FZ_ENABLE_CBZ' },
  { format: 'img', flag: 'FZ_ENABLE_IMG' },
  { format: 'html', flag: 'FZ_ENABLE_HTML' },
  { format: 'md', flag: 'FZ_ENABLE_MD' },
  { format: 'fb2', flag: 'FZ_ENABLE_FB2' },
  { format: 'mobi', flag: 'FZ_ENABLE_MOBI' },
  { format: 'epub', flag: 'FZ_ENABLE_EPUB' },
  { format: 'txt', flag: 'FZ_ENABLE_TXT' },
  { format: 'office', flag: 'FZ_ENABLE_OFFICE' },
];

/**
 * `/D` options that disable every handler this application does not permit.
 *
 * Derived from the two lists above rather than written out, so permitting a
 * format is one edit and cannot leave a stale disable behind.
 *
 * @returns {string[]}
 */
export function handlerDisableFlags() {
  const disabled = GATED_HANDLERS.filter((entry) => !PERMITTED_HANDLERS.includes(entry.format));

  if (disabled.length === 0) {
    throw new Error(
      'Every gated handler is permitted, so this build disables nothing. That is almost certainly ' +
        'a mistake in PERMITTED_HANDLERS — and a disable list that comes back empty reads exactly ' +
        'like one that was applied.',
    );
  }

  return disabled.map((entry) => `/D${entry.flag}=0`);
}
