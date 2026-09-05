import { dialog } from 'electron';

import type { PickImage } from './documentCommands.js';

/**
 * The real image picker: Electron's open dialog, narrowed to what this build
 * can decode.
 *
 * ## `documentPicker.ts`' sibling, and the third of three
 *
 * Everything that file says holds here: the dialog is the one part of inserting
 * an image that genuinely needs Electron, so it is the part that moves out, and
 * {@link PickImage} is the seam it moves across. Everything interesting — the
 * read, the size bound, the decode, the page the image becomes — stays testable
 * with a function that returns a string.
 *
 * Not merged with `documentPicker.ts` into one parameterised picker, for the
 * reason `destinationPicker.ts` gives about itself: a shared one would be a
 * branch on *which dialog* wearing the shape of an abstraction. The filters
 * differ, and so does what the caller does with the answer.
 *
 * ## The extension filter is a CONVENIENCE, not a check
 *
 * `documentPicker.ts`' rule, and it matters more here because there are two
 * decoders. A user may choose *All files* and pick a `.txt`; what refuses that
 * is `embedJpg`/`embedPng` failing on the bytes, which the handler reports as
 * `unreadable`. Reading the extension as validation would be the
 * `available: true` shape — a hint to a human treated as a guarantee about
 * content.
 *
 * The media type the command carries is derived from the same extension, and
 * that is a **routing** decision rather than a validation: it chooses which
 * decoder runs, and the decoder is what decides whether the bytes are what they
 * claim.
 *
 * ## `openFile` alone, and `dontAddToRecent`
 *
 * One image makes one page, so a picker that could return three would offer a
 * shape nothing downstream takes. `dontAddToRecent` keeps the operating
 * system's recent-documents list out of it — a list this application did not
 * ask for and cannot clear.
 *
 * ## Cancellation is `null`, and it is the ordinary case
 *
 * `canceled` is what Electron reports for dismissal; an empty path list is the
 * same thing arriving by a second route, so both are read.
 */
export function createImagePicker(): PickImage {
  return async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  };
}
