import { PngPixelsRefused } from '../imageDimensions.js';
import { ProtectionNotReproducible } from '../protectionRefusal.js';
import { SignatureAppearanceRefusedError, SignatureProtectedDocumentError } from '../signingRefusals.js';
import type { PICTURE_REFUSALS, PLACEHOLDER_REFUSALS, PROTECTION_REFUSALS } from './engineChannels.js';

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
type ProtectionRefusal = (typeof PROTECTION_REFUSALS)[number];
type PlaceholderRefusal = (typeof PLACEHOLDER_REFUSALS)[number];

/** `engine/applyPdfLib`'s code for `error`, or `undefined` for anything that is not a person's to act on. */
export function pictureRefusalCodeOf(error: unknown): PictureRefusal | undefined {
  return error instanceof PngPixelsRefused && error.reason === 'too-many-pixels' ? 'picture-too-many-pixels' : undefined;
}

/** The code for a protected document whose protection cannot be written again (ADR-0220), or `undefined`. */
export function protectionRefusalCodeOf(error: unknown): ProtectionRefusal | undefined {
  return error instanceof ProtectionNotReproducible ? 'protection-not-reproducible' : undefined;
}

/** `engine/prepareSignature`'s code for `error`: a picture's refusal, a protection's, or one only a signature's appearance meets. */
export function placeholderRefusalCodeOf(error: unknown): PlaceholderRefusal | undefined {
  if (error instanceof SignatureAppearanceRefusedError) return 'signature-picture-unreadable';
  // A PROTECTED DOCUMENT, by either door: one this build knows it cannot sign, and one whose protection it could not write
  // again anyway (ADR-0220). The person is told the same thing, which is what to do about the password.
  if (error instanceof SignatureProtectedDocumentError || error instanceof ProtectionNotReproducible) {
    return 'signature-document-protected';
  }
  return pictureRefusalCodeOf(error);
}

/** The class `main` throws for a refusal a host answered, or `undefined` for any other code. */
export function hostRefusalFor(code: string): Error | undefined {
  switch (code) {
    case 'signature-picture-unreadable':
      return new SignatureAppearanceRefusedError('unreadable-image', 'the engine host could not decode the signature picture');
    case 'picture-too-many-pixels':
      return new PngPixelsRefused('too-many-pixels', null);
    case 'protection-not-reproducible':
      return new ProtectionNotReproducible('the engine host could not write the document protected as it was');
    case 'signature-document-protected':
      return new SignatureProtectedDocumentError();
    default:
      return undefined;
  }
}
