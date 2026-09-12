import { MAX_FIND_TEXT } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { REDACT_MATCHES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the Protect ribbon's find-and-redact command opens. */
export const REDACT_MATCHES_DIALOG_ID = 'dialog.redact-matches';

/**
 * The term to mark for redaction, and where to look.
 *
 * ## It MARKS, and the burn-in is still the other command
 *
 * *Find and redact* in one irreversible step removes content on a guess: the
 * thing a person cannot check before pressing it is what else matched. So this
 * creates marks — visible, movable, erasable — and *Apply redactions* is what
 * removes anything, behind its own confirm. The dialog says so, because a
 * control labelled with the row's own name would otherwise promise removal.
 *
 * ## No *match case*
 *
 * Measured 2026-09-12: MuPDF's page search is case-insensitive and its binding
 * takes no option to change that. A control for it would render and do nothing.
 */
export const REDACT_MATCHES_RESULT = z
  .object({
    query: z.string().min(1).max(MAX_FIND_TEXT),
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  })
  .strict();

/** What the find-and-redact dialog answers with. */
export type RedactMatchesAnswer = z.infer<typeof REDACT_MATCHES_RESULT>;

export const REDACT_MATCHES_DIALOG = declareDialog({
  id: REDACT_MATCHES_DIALOG_ID,
  title: REDACT_MATCHES_TITLE,
  props: z.object({
    /** The page the reader is on, so *this page* can be offered by number. */
    page: z.number().int().nonnegative(),
  }),
  result: REDACT_MATCHES_RESULT,
  component: lazy(() => import('./RedactMatchesBody.js')),
});
