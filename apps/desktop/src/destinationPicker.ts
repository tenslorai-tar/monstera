import { dialog } from 'electron';

import type { PickDestination } from './documentCommands.js';

/**
 * The real save picker: Electron's save dialog, narrowed to one PDF.
 *
 * ## `documentPicker.ts`'s sibling, and deliberately its mirror
 *
 * Everything that file says about why it exists holds here word for word: the
 * dialog is the one part of writing a copy that genuinely needs Electron, so it
 * is the part that moves out, and {@link PickDestination} is the seam it moves
 * across. Everything interesting — the contested check, the flush, the atomic
 * write, the four outcomes — stays testable with a function that returns a
 * string.
 *
 * The two are not merged into one parameterised picker. They take different
 * arguments, return different things on cancellation for different reasons, and
 * differ in every dialog property below; a shared one would be a branch on
 * *which dialog* wearing the shape of an abstraction.
 *
 * ## The dialog's properties are the security-relevant part
 *
 * `dontAddToRecent` for `documentPicker.ts`'s reason: the operating system's
 * recent-documents list is one this application did not ask for and cannot
 * clear, and a copy the user wrote is as much their business as one they
 * opened.
 *
 * `showOverwriteConfirmation` is the **user's** decision about their own
 * filesystem, and it is left to the platform deliberately. This application
 * refuses one overwrite of its own — a destination another open document
 * reaches, which the user cannot see and the OS cannot know about. Everything
 * else is theirs.
 *
 * `createDirectory` is on: a person writing a copy somewhere new should not
 * have to leave the dialog to make the folder.
 *
 * ## The suggested name is a NAME, never a path
 *
 * `defaultPath` is given a bare filename, so the dialog opens wherever the
 * platform last left the user rather than beside the original. Handing it a
 * full path would put the source document's directory on screen, which is a
 * disclosure the caller never asked for — and the caller cannot supply one
 * anyway: it holds no path, by invariant L2.
 *
 * ## Cancellation is `null`, and it is the ordinary case
 *
 * `canceled` is what Electron reports for dismissal; an empty `filePath` is the
 * same thing arriving by a second route, so both are read. A user who changes
 * their mind is not an error and never becomes one.
 */
export function createDestinationPicker(): PickDestination {
  return async (suggestedName: string): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      properties: ['dontAddToRecent', 'createDirectory', 'showOverwriteConfirmation'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled) return null;
    // AN EMPTY STRING IS THE SECOND ROUTE TO A DISMISSAL, and the only one left:
    // `filePath` is typed `string`, so the `undefined` check this used to carry
    // was a branch the types say cannot run — lint said so, and a check that
    // cannot fire reads as coverage of a case nobody has.
    return result.filePath.length === 0 ? null : result.filePath;
  };
}
