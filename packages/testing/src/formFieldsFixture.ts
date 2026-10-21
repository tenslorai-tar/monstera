import { PDFDocument } from '@cantoo/pdf-lib';

import type { ShimFormField } from './browserShim.js';

/**
 * A form with a field of every kind the Fields list draws a row for, for a case about how the list LOOKS: the standing
 * check that no side panel scrolls sideways (`panelOverflow.pw.ts`) and the list's baseline (`designBaselines.visual.ts`)
 * read the same rows, so a row the check passes is a row the picture shows (the owner's R16).
 *
 * The names are long and have spaces, so at the panel's narrowest a name that will not wrap is a row wider than the panel.
 */

const LONG = 'Postal address of the person named above, as it appears on their identity document';
const rect = (row: number) => ({ x0: 72, y0: 720 - row * 32, x1: 300, y1: 740 - row * 32 });
const base = { page: 0, values: [], on: null, options: [], readOnly: false, multiline: false } as const;

export const EVERY_FIELD_KIND: readonly ShimFormField[] = [
  { ...base, index: 0, kind: 'text', name: LONG, rect: rect(0) },
  { ...base, index: 1, kind: 'text', name: 'Notes', multiline: true, values: ['A first line\nand a second'], rect: rect(1) },
  { ...base, index: 2, kind: 'checkbox', name: 'Subscribe to the newsletter every month', on: false, rect: rect(2) },
  // A RADIO GROUP AS THE KERNEL ANSWERS ONE: a widget per choice, sharing the field's name.
  { ...base, index: 3, kind: 'radio', name: 'Choice', option: 'Yes, please', on: true, rect: rect(3) },
  { ...base, index: 4, kind: 'radio', name: 'Choice', option: 'No, thank you, not this time', on: false, rect: rect(4) },
  { ...base, index: 5, kind: 'dropdown', name: 'City', options: ['Amsterdam', 'Rotterdam', 'The Hague and its surroundings'], rect: rect(5) },
  { ...base, index: 6, kind: 'listbox', name: 'Language', options: ['English', 'Dutch', 'German', 'French'], rect: rect(6) },
  { ...base, index: 7, kind: 'button', name: 'ResetButton', rect: rect(7) },
  { ...base, index: 8, kind: 'signature', name: 'Signature of the applicant', rect: rect(8) },
];

/** The rows the Fields list draws for them, written out rather than counted (audit item 4c): the group is one card. */
export const EVERY_FIELD_KIND_ROWS = 8;

/** A long comment, for the marks a case lays beside the fields. */
export const LONG_WORDS = LONG;

/** The page the fields are listed on: one blank US Letter page, since the shim answers the fields themselves. */
export async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}
