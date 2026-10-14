import { MAX_FIELD_LOOK_SIZE, MAX_FIELD_LOOK_TOP } from '@monstera/contract/host';
import type { AnnotationColour, FieldLook } from '@monstera/contract';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';

import { parseDefaultAppearance, textColourOf } from './fieldActions.js';
import { nearest } from './fieldRules.js';

/**
 * How a field is drawn: its type size, its text colour and its background, read once for the Properties pane and for
 * the page's choice control alike (B3a), so a list box the page draws over the document's own drawing is drawn in the
 * same size and colours (the owner's F1) rather than in the application's theme.
 */

/** A colour array as red, green and blue: a grey, a red-green-blue or a cyan-magenta-yellow-black, or `null` for none. */
export function colourOf(array: PDFObject): AnnotationColour | null {
  if (!array.isArray()) return null;
  const parts: number[] = [];
  for (let at = 0; at < array.length; at += 1) {
    const part = array.get(at);
    parts.push(part.isNumber() ? Math.min(1, Math.max(0, part.asNumber())) : 0);
  }
  if (parts.length === 1) return [parts[0] ?? 0, parts[0] ?? 0, parts[0] ?? 0];
  if (parts.length === 3) return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (parts.length === 4) {
    const k = parts[3] ?? 0;
    return [(1 - (parts[0] ?? 0)) * (1 - k), (1 - (parts[1] ?? 0)) * (1 - k), (1 - (parts[2] ?? 0)) * (1 - k)];
  }
  return null;
}

/** The field's default appearance string: its own or an ancestor's `/DA`, else the form's, else none. */
export function defaultAppearanceOf(document: PDFDocument, object: PDFObject): string | undefined {
  const own = nearest(object, 'DA');
  if (own.isString()) return own.asString();
  const form = document.getTrailer().get('Root', 'AcroForm', 'DA');
  return form.isString() ? form.asString() : undefined;
}

/**
 * What the page's choice control draws a dropdown or a list box with ({@link FieldLook}): the type size `/DA` sets (0 is
 * the format's *automatic*), its text colour (black where it sets none), the background `/MK /BG` sets (`null` where the
 * paper shows through), and the first option a list shows (`/TI`). Clamped to the wire's bounds, since every number here
 * is the document's to choose.
 */
export function choiceLookOf(document: PDFDocument, object: PDFObject): FieldLook {
  const da = defaultAppearanceOf(document, object);
  const top = nearest(object, 'TI');
  const size = parseDefaultAppearance(da)?.size ?? 0;
  return {
    size: Number.isFinite(size) ? Math.min(MAX_FIELD_LOOK_SIZE, Math.max(0, size)) : 0,
    text: textColourOf(da) ?? [0, 0, 0],
    fill: colourOf(object.get('MK', 'BG')),
    top: top.isNumber() ? Math.min(MAX_FIELD_LOOK_TOP, Math.max(0, Math.trunc(top.asNumber()))) : 0,
  };
}
