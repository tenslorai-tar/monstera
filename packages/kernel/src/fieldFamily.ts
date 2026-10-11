import { FIELD_FONTS, MAX_FONT_FAMILY_NAME, REAL_FONT_FIELD_KINDS } from '@monstera/contract/host';

import { familyClass } from './fontResolver.js';
import { base14Of, nearestBase14 } from './textBoxStyle.js';

/**
 * A form field's real family ([ADR-0229](../../../docs/DECISIONS/0229-a-form-field-in-a-real-font-has-an-appearance-monstera-draws.md)):
 * the private key that holds it, the kinds whose value Monstera draws in it, and the standard face its `/DA` falls back to.
 *
 * Pure, and imports neither engine: pdf-lib's field writer writes the key and MuPDF's side reads it and draws, so both take
 * the name and the rules from here rather than spelling them twice (B3a).
 */

/** The private key on the field dictionary that holds the family: harmless to every other reader, `/MonsteraStyle`'s way. */
export const FIELD_FAMILY_MARKER = 'MonsteraFamily';

/** Whether Monstera draws a field of this kind in a real family (ADR-0229 Decision 4). */
export function drawsFieldFamily(kind: string): boolean {
  return (REAL_FONT_FIELD_KINDS as readonly string[]).includes(kind);
}

/**
 * The family a field's marker names, or `null` where it names none Monstera draws: no marker, not a string, empty, a kind
 * this writer does not draw, or a standard face, which `/DA` already says.
 */
export function familyOfMarker(text: string | null, kind: string): string | null {
  if (text === null || !drawsFieldFamily(kind)) return null;
  const family = text.trim().slice(0, MAX_FONT_FAMILY_NAME);
  return family === '' || base14Of(family) !== undefined ? null : family;
}

/**
 * The standard face a family falls back to in `/DA`, for a reader that draws the field itself: the base 14 nearest the
 * family's class, `daFaceOf`'s rule (ADR-0228 Decision 3) in the field writer's three names.
 */
export function fieldFontOf(family: string): (typeof FIELD_FONTS)[number] {
  const base = nearestBase14(family, familyClass);
  return base === 'Times' ? 'times' : base === 'Courier' ? 'courier' : 'helvetica';
}
