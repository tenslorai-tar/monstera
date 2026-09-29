import { channels } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { COMPONENTS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const COMPONENTS_DIALOG_ID = 'dialog.components';

/**
 * What Components answers: *Verify files*, or nothing. The dialog makes no call — the command asks main to hash and
 * opens it again with the answer (ADR-0038) — so a dismissal and *Close* are the same answer.
 */
export const COMPONENTS_RESULT = z.enum(['verify']);

export type ComponentsAnswer = z.infer<typeof COMPONENTS_RESULT>;

/**
 * The native components this build runs, and whether their files match the manifest it was packaged with
 * ([ADR-0122](../../../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
 *
 * **Status only.** Every component ships inside the package, so there is nothing to download and no control offers
 * to; the one action is to hash what is installed. The component list is the channel's own schema rather than a
 * restatement of it — two schemas for one list is how a dialog comes to accept a state main never sends (B3a).
 */
export const COMPONENTS_DIALOG = declareDialog({
  id: COMPONENTS_DIALOG_ID,
  title: COMPONENTS_TITLE,
  props: z.object({
    components: channels['app.components'].result.shape.components,
    /** Whether the list is the answer to *Verify files* — every file hashed — rather than the cheap first look. */
    verified: z.boolean(),
  }),
  result: COMPONENTS_RESULT,
  component: lazy(() => import('./ComponentsBody.js')),
});
