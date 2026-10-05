import { MAX_BOXED_CHARACTERS, boxedCharacterSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { BOXED_CHARACTERS_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const BOXED_CHARACTERS_DIALOG_ID = 'dialog.boxed-characters';

/**
 * A composed document that OPENED with characters no font could draw, each shown as a box
 * ([ADR-0172](../../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
 * Decision 8): every place named by line and column, the owner's answer to Q4 — *tell the person which characters are
 * affected and where* — and past the channel's bound the rest counted.
 *
 * Its own dialog and not a reason of the import problem's, whose title says the import did not finish: this one did,
 * and the document is open beside it. `workbookIncomplete.ts`' reason, for rows a workbook lacks.
 */
export const boxedCharactersSchema = z
  .object({
    boxed: z.array(boxedCharacterSchema).min(1).max(MAX_BOXED_CHARACTERS),
    more: z.number().int().min(0),
  })
  .strict();

export type BoxedCharacters = z.infer<typeof boxedCharactersSchema>;

export const BOXED_CHARACTERS_DIALOG = declareDialog({
  id: BOXED_CHARACTERS_DIALOG_ID,
  title: BOXED_CHARACTERS_TITLE,
  informs: 'message',
  props: boxedCharactersSchema,
  component: lazy(() => import('./BoxedCharactersBody.js')),
});
