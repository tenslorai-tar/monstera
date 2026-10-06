import { dialog } from 'electron';

import type { PickDocuments } from './contractHandlers.js';

/**
 * The Open command's dialog with a multiple selection (ADR-0182): every file the person chose, in the order the dialog
 * lists them, and an empty list for a dismissal.
 *
 * ## Its own module, and not an edit of `documentPicker.ts`
 *
 * `documentPicker.ts` is the subject of `proof:pickerprobe`'s record — a picker edited after a person drove it is, by
 * that record's own rule, a picker nobody has driven — and it still answers ONE path for the callers that take exactly
 * one file. This is the same dialog with `multiSelections` added, which is a different call: **it has not been driven
 * by a person**, and the installed build is where it first is.
 *
 * The properties are `documentPicker.ts`' with the one addition: `dontAddToRecent` keeps the operating system's recent
 * list out of it, and the extension filter is a hint and not a check — what refuses a file that is not a PDF is the
 * engine failing to parse it, which is then reported under that file's name and does not stop the others.
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
