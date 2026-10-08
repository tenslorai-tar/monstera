import { describe, expect, it } from 'vitest';

import { FIELD_EDIT_REASONS } from '@monstera/shared';

import { FieldEditRefusedError } from '../fieldEditRefusal.js';
import { PngPixelsRefused } from '../imageDimensions.js';
import { FIELD_EDIT_REFUSALS } from './engineChannels.js';
import { hostRefusalFor, pdfLibRefusalCodeOf } from './hostRefusals.js';

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

  it('a picture past the pixel bound is still named on the same channel', () => {
    expect(pdfLibRefusalCodeOf(new PngPixelsRefused('too-many-pixels', null))).toBe('picture-too-many-pixels');
  });
});
