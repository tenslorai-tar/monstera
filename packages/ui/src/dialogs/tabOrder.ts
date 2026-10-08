import { TAB_ORDERS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { TAB_ORDER_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Tab order* opens to ask how the Tab key walks the form. */
export const TAB_ORDER_DIALOG_ID = 'dialog.tab-order';

/** What the dialog answers with: one of the three orders a reader knows (`/Tabs`'s `R`, `C` and `S`). */
export const TAB_ORDER_RESULT = z.object({ order: z.enum(TAB_ORDERS) }).strict();

/** The order a person chose. */
export type TabOrderAnswer = z.infer<typeof TAB_ORDER_RESULT>;

/**
 * How the Tab key walks a form's fields (ADR-0193).
 *
 * The three are the ones a PDF can say for a page, set on every page at once: a form is filled in one order, and a page
 * that walked differently from the one before would be a form that surprises. Dismissing it sets nothing.
 */
export const TAB_ORDER_DIALOG = declareDialog({
  id: TAB_ORDER_DIALOG_ID,
  title: TAB_ORDER_TITLE,
  props: z.object({}).strict(),
  result: TAB_ORDER_RESULT,
  component: lazy(() => import('./TabOrderBody.js')),
});
