import { FIELD_EDIT_REASONS } from '@monstera/shared';

import { FieldEditRefusedError } from '../formFieldEdit.js';
import { PngPixelsRefused } from '../imageDimensions.js';
import { SignatureAppearanceRefusedError } from '../signingRefusals.js';
import type { FIELD_EDIT_REFUSALS, PICTURE_REFUSALS, PLACEHOLDER_REFUSALS } from './engineChannels.js';

/**
 * A hosted command's refusals, across the pipe and back: the ONE table both directions read.
 *
 * A throw crossing the host's boundary becomes `internal` with its diagnostic withheld, which is right for a defect and
 * wrong for a picture a person can replace. While pdf-lib and the signature's placeholder ran in `main`,
 * `documentCommands` chose its outcomes by the class thrown; since they run in the MuPDF host (ADR-0121 Decision 3,
 * [ADR-0148](../../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md)) the
 * host returns each of these under its own code and `main` throws the same class again, so those outcomes are the ones
 * they were. One module holds both halves, so a code the host sends is a code `main` reads.
 */

type PictureRefusal = (typeof PICTURE_REFUSALS)[number];
type PlaceholderRefusal = (typeof PLACEHOLDER_REFUSALS)[number];

type FieldEditRefusalCode = (typeof FIELD_EDIT_REFUSALS)[number];

/** A picture's code for `error`, or `undefined` for anything that is not a person's to act on. */
export function pictureRefusalCodeOf(error: unknown): PictureRefusal | undefined {
  return error instanceof PngPixelsRefused && error.reason === 'too-many-pixels' ? 'picture-too-many-pixels' : undefined;
}

/** `engine/applyPdfLib`'s code for `error`: a picture's, or a change to a form field's (ADR-0193). */
export function pdfLibRefusalCodeOf(error: unknown): PictureRefusal | FieldEditRefusalCode | undefined {
  if (error instanceof FieldEditRefusedError) return `field-edit-${error.reason}`;
  return pictureRefusalCodeOf(error);
}

/** `engine/prepareSignature`'s code for `error`: a picture's refusal, or one only a signature's appearance meets. */
export function placeholderRefusalCodeOf(error: unknown): PlaceholderRefusal | undefined {
  if (error instanceof SignatureAppearanceRefusedError) return 'signature-picture-unreadable';
  return pictureRefusalCodeOf(error);
}

/** The class `main` throws for a refusal a host answered, or `undefined` for any other code. */
export function hostRefusalFor(code: string): Error | undefined {
  switch (code) {
    case 'signature-picture-unreadable':
      return new SignatureAppearanceRefusedError('unreadable-image', 'the engine host could not decode the signature picture');
    case 'picture-too-many-pixels':
      return new PngPixelsRefused('too-many-pixels', null);
    default: {
      // A CHANGE TO A FORM FIELD (ADR-0193): the reason is the code's tail, and only a listed code is one.
      const reason = FIELD_EDIT_REASONS.find((each) => `field-edit-${each}` === code);
      return reason === undefined ? undefined : new FieldEditRefusedError(reason, `the engine host refused the change: ${reason}`);
    }
  }
}
