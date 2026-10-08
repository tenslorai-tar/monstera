/**
 * Who reads the pages of a handwritten or scanned document for an export (ADR-0202): this computer's recogniser for printed
 * text, or a service the person has a key for. ONE list for the Word dialog, the Excel dialog and the walk that reads, so a
 * reader added here arrives owing every one of them its words.
 *
 * `built-in` is Tesseract (printed text, never leaves this computer); `claude` and `azure` read handwriting too, and send the
 * pages to Anthropic or to Microsoft — which the dialogs say beside the choice, before anything is sent.
 */
export const SCAN_READERS = ['built-in', 'claude', 'azure'] as const;

/** See {@link SCAN_READERS}. */
export type ScanReader = (typeof SCAN_READERS)[number];

/** Whether a reader sends the pages away from this computer — what a dialog must say before it is chosen. */
export function sendsPages(reader: ScanReader): boolean {
  return reader !== 'built-in';
}
