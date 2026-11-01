import { documentFontSchema, documentInformationFieldsSchema, documentInformationSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { DOCUMENT_PROPERTIES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const DOCUMENT_PROPERTIES_DIALOG_ID = 'dialog.document-properties';

/** The window's answer: the six as the person left them, which the command sends only where one changed. */
export const DOCUMENT_PROPERTIES_RESULT = z.object({ fields: documentInformationFieldsSchema }).strict();

/** What the window shows: main's reading, the fonts the document names, and the document's size now. */
export const DOCUMENT_PROPERTIES_PROPS = z
  .object({
    information: documentInformationSchema,
    fonts: z.array(documentFontSchema).readonly(),
    fontsTruncated: z.boolean(),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

/**
 * File › Document properties
 * ([ADR-0283](../../../../docs/DECISIONS/0283-document-properties-edits-the-info-dictionary-and-the-xmp-packet-together.md)):
 * the title, author, subject, keywords and the PDF's own dates to edit, and what the document is, read only.
 */
export const DOCUMENT_PROPERTIES_DIALOG = declareDialog({
  id: DOCUMENT_PROPERTIES_DIALOG_ID,
  title: DOCUMENT_PROPERTIES_TITLE,
  props: DOCUMENT_PROPERTIES_PROPS,
  result: DOCUMENT_PROPERTIES_RESULT,
  component: lazy(() => import('./DocumentPropertiesBody.js')),
});

/**
 * A date as the window shows it: the PDF's own wall-clock time and its offset, `2026-10-01 09:30:00 +01:00`, never
 * moved into this computer's zone, since the window shows what the PDF says.
 */
export function shownDate(iso: string | null): string {
  if (iso === null) return '';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})?$/u.exec(iso);
  if (match === null) return iso;
  const [, day, time, zone] = match;
  return `${day ?? ''} ${time ?? ''}${zone === undefined ? '' : zone === 'Z' ? ' UTC' : ` ${zone}`}`;
}

/**
 * What a person typed, as the date the command carries, or `null` for none, or `undefined` for text that is not a
 * date. Seconds and the offset may be left out; `UTC` and `Z` both mean an offset of zero.
 */
export function typedDate(text: string): string | null | undefined {
  const typed = text.trim();
  if (typed === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(Z|UTC|[+-]\d{2}:\d{2}))?$/iu.exec(typed);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second = '00', zone] = match;
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  // A DATE THAT EXISTS: 2026-02-30 is not one, and Date would quietly roll it into March.
  if (at.getUTCMonth() !== Number(month) - 1 || at.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return undefined;
  }
  const offset = zone === undefined ? '' : /^(?:z|utc)$/iu.test(zone) ? 'Z' : zone;
  return `${year ?? ''}-${month ?? ''}-${day ?? ''}T${hour ?? ''}:${minute ?? ''}:${second}${offset}`;
}
