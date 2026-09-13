import { MAX_LINK_URI } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { OPEN_FROM_URL_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Open from web address* asks. */
export const OPEN_FROM_URL_DIALOG_ID = 'dialog.open-from-url';

/**
 * The web address of a PDF to open
 * ([ADR-0061](../../../../docs/DECISIONS/0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)).
 *
 * `annotationLink.ts`' shape: the dialog collects a string, bounded by `MAX_LINK_URI` as
 * the channel is, and what the address MEANS is main's. The body shows the one rule a
 * person can meet before sending — `https:` — and every other rule is the guard's,
 * answered by name after the fetch is tried.
 */
export const OPEN_FROM_URL_RESULT = z.object({ text: z.string().trim().min(1).max(MAX_LINK_URI) }).strict();

/** What the dialog answers with. */
export type OpenFromUrlAnswer = z.infer<typeof OPEN_FROM_URL_RESULT>;

export const OPEN_FROM_URL_DIALOG = declareDialog({
  id: OPEN_FROM_URL_DIALOG_ID,
  title: OPEN_FROM_URL_TITLE,
  props: z.object({}).strict(),
  result: OPEN_FROM_URL_RESULT,
  component: lazy(() => import('./OpenFromUrlBody.js')),
});
