import { lazy } from 'react';
import { z } from 'zod';

import { PERMISSION_PASSWORD_REPLACED_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the document-notice subscription opens when a protected document's permissions password was replaced. */
export const PERMISSION_PASSWORD_REPLACED_DIALOG_ID = 'dialog.permission-password-replaced';

/**
 * What the person is told, once, when a change to a protected document was written with a permissions password made up
 * and kept nowhere ([ADR-0220](../../../../docs/DECISIONS/0220-a-pdf-lib-command-on-a-protected-document-runs-on-its-readable-bytes-and-is-written-protected.md)).
 *
 * ## Why a dialog and not a toast
 *
 * It is a fact about the person's own file that they cannot see anywhere else, and a toast leaves by itself in a few
 * seconds. `dialog.history-trimmed` is the precedent and says the same about a shortened undo history.
 *
 * ## It carries nothing
 *
 * The password was never known, so there is nothing to show, and the document is the one being worked on. The command that
 * caused it SUCCEEDED, so the first sentence of the body says so.
 */
export const PERMISSION_PASSWORD_REPLACED_DIALOG = declareDialog({
  id: PERMISSION_PASSWORD_REPLACED_DIALOG_ID,
  title: PERMISSION_PASSWORD_REPLACED_TITLE,
  informs: 'message',
  props: z.object({}).strict(),
  component: lazy(() => import('./PermissionPasswordReplacedBody.js')),
});
