import { dialog } from 'electron';

import type { FormDataFormat } from '@monstera/contract';

import {
  FORM_DATA_FILES,
  type FormDataSource,
  type PickDestination,
  suggestedFormDataName,
} from './documentCommands.js';

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

/**
 * The save picker for a snapshot: the same dialog, narrowed to one PNG.
 *
 * ## A SIBLING rather than a parameter, which is this file's own argument
 *
 * The paragraph above says the copy picker and the open picker are not merged
 * because "a shared one would be a branch on *which dialog* wearing the shape
 * of an abstraction". That reasoning applies to a format parameter just as it
 * does to a direction one, and it is taken at its word here — the two differ in
 * exactly one property today and there is nothing to stop them differing in a
 * second tomorrow, at which point a parameterised picker grows a branch.
 *
 * Everything the paragraphs above say about `dontAddToRecent`,
 * `showOverwriteConfirmation`, `createDirectory`, the bare filename and the two
 * routes to a dismissal holds here unchanged, which is why none of it is
 * restated: a snapshot is a file the user wrote, and it is as much their
 * business as a copy.
 */
export function createSnapshotPicker(): PickDestination {
  return async (suggestedName: string): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      properties: ['dontAddToRecent', 'createDirectory', 'showOverwriteConfirmation'],
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (result.canceled) return null;
    return result.filePath.length === 0 ? null : result.filePath;
  };
}

/**
 * The save picker for a form-data export: the same dialog, narrowed to the
 * format the user asked for.
 *
 * ## A PARAMETER HERE, and the paragraph above is what decides it
 *
 * That argument is about two different dialogs — a copy and a snapshot —
 * sharing one function, where a shared one is "a branch on *which dialog*
 * wearing the shape of an abstraction". This is one dialog, and the parameter
 * is not a choice between features: it is the user's own choice of format,
 * already made, already on the wire. Three siblings differing in one literal
 * each would be `FORM_DATA_FILES` written three times.
 *
 * **It takes the DOCUMENT'S name and derives the suggested one**, so there is
 * no pair of arguments that can disagree: the extension in the filename and
 * the extension in the filter come from the same table entry. A dialog whose
 * filter and default name name different extensions appends one to the other
 * silently, and the user gets `form data.json.fdf`.
 *
 * Everything the paragraphs above say about `dontAddToRecent`,
 * `showOverwriteConfirmation`, `createDirectory` and the two routes to a
 * dismissal holds here unchanged.
 */
export function createFormDataPicker(): FormDataSource['pick'] {
  return async (sourceName: string, format: FormDataFormat): Promise<string | null> => {
    const file = FORM_DATA_FILES[format];
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedFormDataName(sourceName, format),
      properties: ['dontAddToRecent', 'createDirectory', 'showOverwriteConfirmation'],
      filters: [{ name: file.label, extensions: [file.extension] }],
    });
    if (result.canceled) return null;
    return result.filePath.length === 0 ? null : result.filePath;
  };
}
