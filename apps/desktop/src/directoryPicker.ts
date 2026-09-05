import { dialog } from 'electron';

import type { PickDirectory } from './documentCommands.js';

/**
 * The real folder picker: Electron's open dialog in directory mode.
 *
 * ## `destinationPicker.ts`'s sibling, and NOT a parameterisation of it
 *
 * That file states the rule this follows: the two pickers *"take different
 * arguments, return different things on cancellation for different reasons, and
 * differ in every dialog property"*, so a shared one would be a branch on
 * *which dialog* wearing the shape of an abstraction. This is the third, and
 * the rule holds harder — it is `showOpenDialog` rather than `showSaveDialog`,
 * answers an array, and offers no overwrite confirmation because the thing
 * chosen is not a file.
 *
 * ## Why split picks a FOLDER where extract picks a file
 *
 * A split writes several documents, and there is no such thing as a save dialog
 * for several files. The two candidate designs were a folder, or the save
 * dialog repeated once per output — and repeating it is unusable the moment a
 * reader splits a hundred-page document one page per file, which is the case
 * the feature exists for. The row records the choice.
 *
 * ## `showOverwriteConfirmation` is ABSENT, and that is a gap this build closes
 *
 * The platform confirms an overwrite when the user names a file. It cannot here,
 * because they name a directory and this application derives the filenames — so
 * nothing the user saw tells them a file is about to be replaced. Every derived
 * target therefore goes through the same contested check a copy does, and the
 * split refuses **before writing anything** rather than partway through.
 *
 * `dontAddToRecent` for `documentPicker.ts`'s reason: the operating system's
 * recent list is one this application did not ask for and cannot clear.
 *
 * `createDirectory` is on, so a reader splitting into a new folder does not
 * have to leave the dialog to make it.
 *
 * ## Cancellation is `null`, as everywhere else
 *
 * `canceled` is Electron's dismissal, and an empty `filePaths` is the same
 * thing by a second route — `showOpenDialog` answers an array, so the empty
 * case is real rather than defensive.
 */
export function createDirectoryPicker(): PickDirectory {
  return async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (result.canceled) return null;
    const [chosen] = result.filePaths;
    return chosen === undefined || chosen.length === 0 ? null : chosen;
  };
}
