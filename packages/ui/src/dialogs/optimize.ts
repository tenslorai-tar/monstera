import { OPTIMIZE_SETTING_NAMES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { OPTIMIZE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/**
 * The *Save a smaller copy* dialog
 * ([ADR-0087](../../../../docs/DECISIONS/0087-optimize-is-mupdfs-native-image-rewriter-in-the-compose-host.md)):
 * the image quality, the sizes a copy would have, and the way to save it.
 *
 * ## It answers, and the command asks main
 *
 * ADR-0038's shape, as the Excel dialog's: *check the size* and *save* are answers, and the
 * command makes each call and opens the dialog again with what came back. So a dialog cannot save
 * sizes it was never shown — *save* is offered only beside a measurement of the setting chosen.
 */

export const OPTIMIZE_DIALOG_ID = 'dialog.optimize';

const SETTING = z.enum(OPTIMIZE_SETTING_NAMES);

export const OPTIMIZE_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('measure'), setting: SETTING }).strict(),
  z.object({ kind: z.literal('save'), setting: SETTING }).strict(),
]);

export type OptimizeAnswer = z.infer<typeof OPTIMIZE_RESULT>;

export const OPTIMIZE_PROPS = z
  .object({
    /** The setting shown as chosen — *high* first, then whatever was last measured. */
    setting: SETTING,
    /** What a copy at `setting` would weigh, or `null` before it was checked. */
    measured: z
      .object({ before: z.number().int().nonnegative(), after: z.number().int().nonnegative() })
      .strict()
      .nullable(),
  })
  .strict();

export type OptimizeProps = z.infer<typeof OPTIMIZE_PROPS>;

export const OPTIMIZE_DIALOG = declareDialog({
  id: OPTIMIZE_DIALOG_ID,
  title: OPTIMIZE_TITLE,
  props: OPTIMIZE_PROPS,
  result: OPTIMIZE_RESULT,
  component: lazy(() => import('./OptimizeBody.js')),
});
