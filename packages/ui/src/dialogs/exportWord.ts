import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_WORD_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { SCAN_READERS } from './scanReader.js';

export const EXPORT_WORD_DIALOG_ID = 'dialog.export-word';

/**
 * Where the words come from (ADR-0202): `typed` is the PDF's own text, as before; the others are who reads the pages of a
 * handwritten or scanned document first. One value rather than two fields, so *typed* beside a reader cannot be said.
 */
export const EXPORT_WORD_READING = z.enum(['typed', ...SCAN_READERS]);

/**
 * What the Word export dialog answers: the mode, the pages (ADR-0161) and where the words come from (ADR-0202).
 *
 * The same three mode names `document.exportWord` takes, so the dialog's answer is the channel's field and nothing
 * translates between them. The pages are already parsed, for the page-image export's reason: *every page* and *these
 * pages* both produce a list, so the row's option does not travel.
 *
 * For a handwritten or scanned document the mode is `text` — the words and nothing else, which is what a read page has to
 * give — and the dialog says so by not offering the others.
 */
export const EXPORT_WORD_RESULT = z
  .object({
    mode: z.enum(['text', 'layout', 'rich']),
    pages: z.array(z.number().int().nonnegative()).min(1),
    reading: EXPORT_WORD_READING,
  })
  .strict();

export type ExportWordAnswer = z.infer<typeof EXPORT_WORD_RESULT>;

export const EXPORT_WORD_DIALOG = declareDialog({
  id: EXPORT_WORD_DIALOG_ID,
  title: EXPORT_WORD_TITLE,
  // THE PAGE COUNT GOES IN, the page-image dialog's reason: *every page* builds the list from it, and *Select pages*
  // refuses a page the document lacks. THE READERS THIS MACHINE HAS go in with it (ADR-0202): this computer's recogniser
  // where its models are provisioned, and a service only where its key is stored — the rule every network feature follows.
  props: z
    .object({
      pageCount: z.number().int().positive(),
      readers: z.array(z.enum(SCAN_READERS)).max(SCAN_READERS.length).readonly(),
    })
    .strict(),
  result: EXPORT_WORD_RESULT,
  component: lazy(() => import('./ExportWordBody.js')),
});
