import { optimizeTargetSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { OPTIMIZE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/**
 * The *Save a smaller copy* dialog
 * ([ADR-0087](../../../../docs/DECISIONS/0087-optimize-is-mupdfs-native-image-rewriter-in-the-compose-host.md),
 * [ADR-0298](../../../../docs/DECISIONS/0298-a-smaller-copy-may-be-asked-for-by-size.md)):
 * the image quality or a size, the sizes a copy would have, and the way to save it.
 *
 * ## It answers, and the command asks main
 *
 * ADR-0038's shape, as the Excel dialog's: *check the size* and *save* are answers, and the
 * command makes each call and opens the dialog again with what came back. So a dialog cannot save
 * sizes it was never shown — *save* is offered only beside a measurement of the choice on screen,
 * and it names no step: the command writes the step that measurement answered (ADR-0298 Decision 4).
 */

export const OPTIMIZE_DIALOG_ID = 'dialog.optimize';

export const OPTIMIZE_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('measure'), target: optimizeTargetSchema }).strict(),
  z.object({ kind: z.literal('save') }).strict(),
]);

export type OptimizeAnswer = z.infer<typeof OPTIMIZE_RESULT>;

export const OPTIMIZE_PROPS = z
  .object({
    /** The choice shown — *high* first, then whatever was last measured. */
    target: optimizeTargetSchema,
    /** The size the box starts at when *A size I choose* is picked: the last one typed (ADR-0298 Decision 5). */
    size: z.number().int().positive(),
    /** What a copy for `target` would weigh, and whether it fits a size asked for, or `null` before it was checked. */
    measured: z
      .object({ before: z.number().int().nonnegative(), after: z.number().int().nonnegative(), fits: z.boolean() })
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
