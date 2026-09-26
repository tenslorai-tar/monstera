import { releaseVersionSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SECURITY_UPDATE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the notice opens, and the registry's key. */
export const SECURITY_UPDATE_DIALOG_ID = 'dialog.security-update';

/**
 * The notice's two answers. Named actions rather than a boolean, for `DONATE_RESULT`'s reason; a dismissal answers
 * nothing, and `offerSecurityNotice` reads that as *not yet acknowledged*.
 */
export const SECURITY_UPDATE_RESULT = z.enum(['store', 'understood']);

export type SecurityUpdateAnswer = z.infer<typeof SECURITY_UPDATE_RESULT>;

/**
 * *Important security update* — the notice ADR-0018 requires for a `security` release (ADR-0110).
 *
 * A dialog and not the rating prompt's banner, deliberately: E3 forbids interrupting for a rating, and ADR-0018 asks
 * for acknowledgement here, which a banner a person can work around does not collect. The version is main's, shown
 * so the person can match it to what the Store offers.
 */
export const SECURITY_UPDATE_DIALOG = declareDialog({
  id: SECURITY_UPDATE_DIALOG_ID,
  title: SECURITY_UPDATE_TITLE,
  props: z.object({ version: releaseVersionSchema }).strict(),
  result: SECURITY_UPDATE_RESULT,
  component: lazy(() => import('./SecurityUpdateBody.js')),
});
