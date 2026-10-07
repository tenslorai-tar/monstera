import { lazy } from 'react';
import { z } from 'zod';

import { FIELD_COPY_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { FIELD_COPY_RESULT } from './fieldCopyResult.js';

/** The id `copyFieldToPagesCommand` opens to ask which pages. */
export const FIELD_COPY_DIALOG_ID = 'dialog.field-copy';

/**
 * Which pages a form field is copied onto (ADR-0193).
 *
 * `extractPages.ts`' shape and its parser: the pages are typed as a range expression, one-based, and come out zero-based.
 * What is different is the one page that is refused, the field's own, since a copy on the page it is already on would be
 * a second field in the same place. `from` is that page, zero-based, so the body can say so before anything is sent.
 */
export const FIELD_COPY_DIALOG = declareDialog({
  id: FIELD_COPY_DIALOG_ID,
  title: FIELD_COPY_TITLE,
  props: z.object({ pageCount: z.number().int().positive(), from: z.number().int().nonnegative() }).strict(),
  result: FIELD_COPY_RESULT,
  component: lazy(() => import('./FieldCopyBody.js')),
});
