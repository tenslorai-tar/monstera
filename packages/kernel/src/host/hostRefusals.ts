import { PngPixelsRefused } from '../imageDimensions.js';
import { SignatureAppearanceRefusedError } from '../signingRefusals.js';
import type { PICTURE_REFUSALS, PLACEHOLDER_REFUSALS } from './engineChannels.js';

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

/** `engine/applyPdfLib`'s code for `error`, or `undefined` for anything that is not a person's to act on. */
export function pictureRefusalCodeOf(error: unknown): PictureRefusal | undefined {
  return error instanceof PngPixelsRefused && error.reason === 'too-many-pixels' ? 'picture-too-many-pixels' : undefined;
}

/** `engine/prepareSignature`'s code for `error`: a picture's refusal, or one only a signature's appearance meets. */
export function placeholderRefusalCodeOf(error: unknown): PlaceholderRefusal | undefined {
  if (error instanceof SignatureAppearanceRefusedError) {
    return error.reason === 'unencodable-text' ? 'signature-text-unencodable' : 'signature-picture-unreadable';
  }
  return pictureRefusalCodeOf(error);
}

/** The class `main` throws for a refusal a host answered, or `undefined` for any other code. */
export function hostRefusalFor(code: string): Error | undefined {
  switch (code) {
    case 'signature-text-unencodable':
      return new SignatureAppearanceRefusedError(
        'unencodable-text',
        'the engine host could not encode the typed signature in its chosen font',
      );
    case 'signature-picture-unreadable':
      return new SignatureAppearanceRefusedError('unreadable-image', 'the engine host could not decode the signature picture');
    case 'picture-too-many-pixels':
      return new PngPixelsRefused('too-many-pixels', null);
    default:
      return undefined;
  }
}
