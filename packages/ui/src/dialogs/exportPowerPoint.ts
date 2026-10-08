import { POWERPOINT_FALLBACK_LISTED_MAX, POWERPOINT_MODES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_POWERPOINT_TITLE, POWERPOINT_OUTCOME_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const EXPORT_POWERPOINT_DIALOG_ID = 'dialog.export-powerpoint';
export const POWERPOINT_OUTCOME_DIALOG_ID = 'dialog.powerpoint-outcome';

/**
 * What the PowerPoint dialog answers: how the slides are made, and the pages
 * ([ADR-0210](../../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md),
 * ADR-0161).
 *
 * The mode is the channel's own list (`POWERPOINT_MODES`), so the answer is the field and nothing translates between them.
 * The pages are already parsed, for the page-image export's reason.
 */
export const EXPORT_POWERPOINT_RESULT = z
  .object({ mode: z.enum(POWERPOINT_MODES), pages: z.array(z.number().int().nonnegative()).min(1) })
  .strict();

export type ExportPowerPointAnswer = z.infer<typeof EXPORT_POWERPOINT_RESULT>;

/**
 * ITS OWN DIALOG, not the shared pages body (ADR-0161): this one asks a second question, and the shared body serves two
 * exports that ask only which pages. The id is the one the shared declaration held, so a person's habits and the gallery's
 * states carry over.
 */
export const EXPORT_POWERPOINT_DIALOG = declareDialog({
  id: EXPORT_POWERPOINT_DIALOG_ID,
  title: EXPORT_POWERPOINT_TITLE,
  props: z.object({ pageCount: z.number().int().positive() }).strict(),
  result: EXPORT_POWERPOINT_RESULT,
  component: lazy(() => import('./ExportPowerPointBody.js')),
});

/**
 * What the export has to say once the file is written, when it has anything to say: which pages are pictures because they
 * could not be made editable, and that recognising scanned pages added words to the open document. Informational, so it
 * answers nothing (ADR-0038).
 *
 * Opened only where there is a sentence to read. A deck whose every page was written editable, from a document with no scans,
 * is told by the toast alone.
 */
export const POWERPOINT_OUTCOME_PROPS = z
  .object({
    /** The first of the one-based pages written as pictures. */
    fellBack: z.array(z.number().int().positive()).max(POWERPOINT_FALLBACK_LISTED_MAX),
    /** How many there were, which may exceed what `fellBack` lists. */
    fellBackCount: z.number().int().nonnegative(),
    /** How many scanned pages were recognised first, and so gained text in the open document. */
    recognised: z.number().int().nonnegative(),
    /** Whether recognising was impossible on this computer: no language is installed. */
    noModel: z.boolean(),
  })
  .strict();

export type PowerPointOutcome = z.infer<typeof POWERPOINT_OUTCOME_PROPS>;

export const POWERPOINT_OUTCOME_DIALOG = declareDialog({
  id: POWERPOINT_OUTCOME_DIALOG_ID,
  title: POWERPOINT_OUTCOME_TITLE,
  informs: 'message',
  props: POWERPOINT_OUTCOME_PROPS,
  component: lazy(() => import('./PowerPointOutcomeBody.js')),
});
