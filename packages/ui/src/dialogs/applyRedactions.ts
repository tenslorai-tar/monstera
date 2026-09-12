import { PDF_REDACT_COVERS, PDF_REDACT_IMAGES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { APPLY_REDACTIONS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the Protect ribbon's burn-in command opens. */
export const APPLY_REDACTIONS_DIALOG_ID = 'dialog.apply-redactions';

/**
 * The confirmation a burn-in asks for.
 *
 * ## It is a CONFIRM DIALOG and it is also where the two options live
 *
 * Splitting them would put a settings screen in front of an irreversible act
 * and then ask a person to confirm something they can no longer see. What is
 * being confirmed is *this scope, with this cover, removing these images* —
 * one sentence with three nouns in it.
 *
 * ## It claims no COUNT
 *
 * *Burn in 4 marks on 2 pages* would be better than *are you sure*, and it
 * needs a query channel of its own because the session lives in the contained
 * host. The dialog says the scope and what redaction does instead, and claims
 * no number it cannot support — `pageRedact.ts` records the trigger for
 * revisiting that.
 *
 * ## No `blurred`
 *
 * Measured: MuPDF offers no blur, and every way to add one puts a removable
 * annotation over redacted content or a second writer inside one command. The
 * axis that replaces it is what happens to a covered **image**, which is a real
 * choice about what is removed rather than about how the hole looks.
 */
export const APPLY_REDACTIONS_RESULT = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    cover: z.enum(PDF_REDACT_COVERS),
    images: z.enum(PDF_REDACT_IMAGES),
  })
  .strict();

/** What the burn-in dialog answers with. */
export type ApplyRedactionsAnswer = z.infer<typeof APPLY_REDACTIONS_RESULT>;

export const APPLY_REDACTIONS_DIALOG = declareDialog({
  id: APPLY_REDACTIONS_DIALOG_ID,
  title: APPLY_REDACTIONS_TITLE,
  props: z.object({
    /** The page the reader is on, so *this page* can be offered by number. */
    page: z.number().int().nonnegative(),
  }),
  result: APPLY_REDACTIONS_RESULT,
  component: lazy(() => import('./ApplyRedactionsBody.js')),
});
