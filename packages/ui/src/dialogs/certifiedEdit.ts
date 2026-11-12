import { FAILURE_DETAIL_SCHEMAS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { CERTIFIED_EDIT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the one dispatcher opens when main answers that a certified document's certifier does not allow a change. */
export const CERTIFIED_EDIT_DIALOG_ID = 'dialog.certified-edit';

/**
 * The one way forward. Leaving the document as it is the dismissal; there is no *Change this document*, because the
 * certifier's lock is not a warning a person agrees past
 * ([ADR-0291](../../../../docs/DECISIONS/0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)
 * Decision 4, the owner's decision of 2026-11-06).
 */
export const CERTIFIED_EDIT_RESULT = z.literal('copy');

/**
 * Asked when a change to a certified document is one its certifier's level does not allow. Nothing has changed when it
 * opens: main refused the change in the document's lane. It says what the certifier allows and who they are, and offers
 * the copy, which is written where the person chooses, opened with the change made, and no longer certified.
 */
export const CERTIFIED_EDIT_DIALOG = declareDialog({
  id: CERTIFIED_EDIT_DIALOG_ID,
  title: CERTIFIED_EDIT_TITLE,
  props: FAILURE_DETAIL_SCHEMAS.certified,
  result: CERTIFIED_EDIT_RESULT,
  component: lazy(() => import('./CertifiedEditBody.js')),
});
