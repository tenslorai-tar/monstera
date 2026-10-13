import { lazy } from 'react';
import { z } from 'zod';

import { PDFA_LEVEL_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const PDFA_LEVEL_DIALOG_ID = 'dialog.pdfa-level';

/** The levels offered, as the dialog's radio values; `2b` first, the default (ADR-0075's 2026-10-13 correction). */
export const PDFA_LEVEL_CHOICES = ['2b', '1b', '3b'] as const;
export type PdfaLevelChoice = (typeof PDFA_LEVEL_CHOICES)[number];

/** Each choice as the level `document.exportPdfa` takes: the one place the two spellings meet. */
export const PDFA_LEVEL_OF: Readonly<Record<PdfaLevelChoice, 1 | 2 | 3>> = { '1b': 1, '2b': 2, '3b': 3 };

export const PDFA_LEVEL_RESULT = z.object({ level: z.enum(PDFA_LEVEL_CHOICES) }).strict();

/**
 * Which PDF/A level to save as, asked before the file is picked (the owner's N7): one choice, one line each, PDF/A-2b
 * selected. Nothing else is asked, since PDF/A is the whole document in an archival form.
 */
export const PDFA_LEVEL_DIALOG = declareDialog({
  id: PDFA_LEVEL_DIALOG_ID,
  title: PDFA_LEVEL_TITLE,
  props: z.object({}).strict(),
  result: PDFA_LEVEL_RESULT,
  component: lazy(() => import('./PdfaLevelBody.js')),
});
