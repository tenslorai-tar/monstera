import { describe, expect, it } from 'vitest';

import { FIELD_EDIT_REASONS } from '@monstera/shared';

import { FieldEditRefusedError } from '../fieldEditRefusal.js';
import { ImageDecodeRefused, PngPixelsRefused } from '../imageDimensions.js';
import { FIELD_EDIT_REFUSALS, PICTURE_REFUSALS } from './engineChannels.js';
import { hostRefusalFor, pdfLibRefusalCodeOf, placeholderRefusalCodeOf } from './hostRefusals.js';

/**
 * A change to a form field that was refused keeps its reason across the engine host's boundary.
 *
 * An apply's thrown refusal becomes `internal` and an incident id at that boundary, so a person who named a field
 * another already holds was told only that something went wrong. Each reason is its own wire code, and the table is
 * read in both directions here so a code the host sends is a code main reads.
 */
describe('a change to a form field keeps its reason across the host', () => {
  it('every reason has a wire code the channel declares, and comes back as the same reason', () => {
    expect(FIELD_EDIT_REFUSALS.length).toBe(FIELD_EDIT_REASONS.length);
    for (const reason of FIELD_EDIT_REASONS) {
      const code = pdfLibRefusalCodeOf(new FieldEditRefusedError(reason, 'x'));
      expect(code, reason).toBe(`field-edit-${reason}`);
      expect(FIELD_EDIT_REFUSALS as readonly string[]).toContain(code);
      const back = hostRefusalFor(code ?? '');
      expect(back).toBeInstanceOf(FieldEditRefusedError);
      expect((back as FieldEditRefusedError).reason).toBe(reason);
    }
  });

  it('CONTROL: an ordinary failure, and a code nobody declared, stay what they were', () => {
    expect(pdfLibRefusalCodeOf(new Error('boom'))).toBeUndefined();
    expect(hostRefusalFor('field-edit-nonsense')).toBeUndefined();
    expect(hostRefusalFor('apply-failed')).toBeUndefined();
  });

  it('a picture is not a pdf-lib command’s refusal: none decodes one since insertImagePage was removed', () => {
    expect(pdfLibRefusalCodeOf(new PngPixelsRefused('too-many-pixels', null))).toBeUndefined();
    expect(pdfLibRefusalCodeOf(new ImageDecodeRefused('x'))).toBeUndefined();
  });

  it('a signature’s picture past the pixel bound is named on its channel', () => {
    expect(placeholderRefusalCodeOf(new PngPixelsRefused('too-many-pixels', null))).toBe('picture-too-many-pixels');
  });

  it('a signature’s picture the decoder refuses, or a PNG with no header, crosses as unreadable and comes back as the decoder’s refusal', () => {
    for (const refused of [new ImageDecodeRefused('x'), new PngPixelsRefused('no-header', null)]) {
      const code = placeholderRefusalCodeOf(refused);
      expect(code).toBe('picture-unreadable');
      expect(PICTURE_REFUSALS as readonly string[]).toContain(code);
      expect(hostRefusalFor(code ?? '')).toBeInstanceOf(ImageDecodeRefused);
    }
    // CONTROL: a TypeError from after the decode is not the picture's, and keeps no code (it crosses as `apply-failed`).
    expect(placeholderRefusalCodeOf(new TypeError('cannot read properties of undefined'))).toBeUndefined();
  });
});
