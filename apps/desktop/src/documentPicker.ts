import { dialog } from 'electron';

import type { PickDocument, PickDocuments } from './contractHandlers.js';

/**
 * The real picker: Electron's open dialog, narrowed to one PDF.
 *
 * ## Why this is its own module
 *
 * `contractHandlers.ts` states the rule it lives by — *nothing here imports
 * Electron, which keeps the assembly unit-testable in milliseconds*. The picker
 * is the one part of opening that genuinely needs Electron, so it is the part
 * that moves out, and `PickDocument` is the seam it moves across. Everything
 * interesting about opening — mint, open, the handle's lifetime across four
 * outcomes — stays testable with a function that returns a string.
 *
 * ## The dialog's own properties are the security-relevant part
 *
 * `openFile` and not `openDirectory`, and no `multiSelections` HERE: this picker
 * answers ONE path, for the callers that take exactly one file (a second document
 * for a merge, a half of side by side). {@link createDocumentsPicker} is the same
 * dialog with the multiple selection, for the Open command, which opens each file
 * as its own tab. `dontAddToRecent` keeps the
 * operating system's recent-documents list out of it — a list this application
 * did not ask for and cannot clear, holding the names of files a user opened.
 *
 * The extension filter is a **convenience, not a check.** A user may still
 * choose *All files* and pick something that is not a PDF; what refuses that is
 * the engine failing to parse it, which is where the refusal belongs. Treating
 * the filter as validation is the `available: true` shape — a dialog's filter
 * is a hint to a human, and no part of it survives into what this function
 * returns.
 *
 * ## Cancellation is `null`, and it is the ordinary case
 *
 * `canceled` is what Electron reports for dismissal; an empty path list is the
 * same thing arriving by a second route, so both are read. A user who changes
 * their mind is not an error and never becomes one.
 */
export function createDocumentPicker(): PickDocument {
  return async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  };
}

/**
 * The same dialog with a multiple selection: every file the person chose, in the order the dialog lists them, and an
 * empty list for a dismissal. The properties are {@link createDocumentPicker}'s with `multiSelections` added — the
 * filter is still a hint and not a check, and what refuses a file that is not a PDF is the engine failing to parse it,
 * which is then reported under that file's name and does not stop the others.
 */
export function createDocumentsPicker(): PickDocuments {
  return async (): Promise<readonly string[]> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    return result.canceled ? [] : result.filePaths;
  };
}
