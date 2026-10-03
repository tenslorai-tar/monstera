import { PngPixelsRefused } from '../imageDimensions.js';
import { SignatureAppearanceRefusedError } from '../signingRefusals.js';
import type { PLACEHOLDER_REFUSALS } from './engineChannels.js';

/**
 * A signature placeholder's refusals, across the pipe and back: the ONE table both directions read
 * ([ADR-0148](../../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md)).
 *
 * A throw crossing the host's boundary becomes `internal` with its diagnostic withheld, which is right for a defect and
 * wrong for a picture a person can replace. While the placeholder was written in `main`, `documentCommands.sign` chose
 * its outcomes by the class thrown; the host returns each of these under its own code, and `main` throws the same class
 * again, so those outcomes are unchanged. One module holds both halves, so a code the host sends is a code `main` reads.
 */

type PlaceholderRefusal = (typeof PLACEHOLDER_REFUSALS)[number];

/** The code a host answers for `error`, or `undefined` for anything that is not a person's to act on. */
export function placeholderRefusalCodeOf(error: unknown): PlaceholderRefusal | undefined {
  if (error instanceof SignatureAppearanceRefusedError) {
    return error.reason === 'unencodable-text' ? 'signature-text-unencodable' : 'signature-picture-unreadable';
  }
  if (error instanceof PngPixelsRefused && error.reason === 'too-many-pixels') return 'signature-picture-too-many-pixels';
  return undefined;
}

/** The class `main` throws for a refusal the host answered, or `undefined` for any other code. */
export function placeholderRefusalFor(code: string): Error | undefined {
  switch (code) {
    case 'signature-text-unencodable':
      return new SignatureAppearanceRefusedError(
        'unencodable-text',
        'the engine host could not encode the typed signature in its chosen font',
      );
    case 'signature-picture-unreadable':
      return new SignatureAppearanceRefusedError('unreadable-image', 'the engine host could not decode the signature picture');
    case 'signature-picture-too-many-pixels':
      return new PngPixelsRefused('too-many-pixels', null);
    default:
      return undefined;
  }
}
