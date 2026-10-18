import { lazy } from 'react';
import { z } from 'zod';

import { FORM_SCRIPTS_NOTICE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a document opens once to say which of its fields carry scripts that are never run. */
export const FORM_SCRIPTS_NOTICE_DIALOG_ID = 'dialog.form-scripts-notice';

/** The most field names the notice names before it says how many more there are. */
export const FORM_SCRIPTS_NAMED = 8;

/**
 * Which fields of a form carry scripts Monstera never runs (invariant 24; the owner's decision of 2026-10-18): one calm
 * notice per document, naming up to {@link FORM_SCRIPTS_NAMED} fields and then how many more, with the reason. A field
 * whose calculation or format is one of the standard calls is not named: it works.
 *
 * It ANSWERS NOTHING: `declareDialog` gives an entry no result unless it declares one (ADR-0038).
 */
export const FORM_SCRIPTS_NOTICE_DIALOG = declareDialog({
  id: FORM_SCRIPTS_NOTICE_DIALOG_ID,
  title: FORM_SCRIPTS_NOTICE_TITLE,
  informs: 'report',
  props: z
    .object({
      /** The fields named, in the form's order, each once. */
      names: z.array(z.string().max(200)).min(1).max(FORM_SCRIPTS_NAMED),
      /** How many more fields carry one. */
      more: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./FormScriptsNoticeBody.js')),
});
