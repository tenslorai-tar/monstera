import { lazy } from 'react';
import { z } from 'zod';

import { COMPONENT_CANNOT_START_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the `app.component-cannot-start` subscription opens. */
export const COMPONENT_CANNOT_START_DIALOG_ID = 'dialog.component-cannot-start';

/**
 * What the person is told when a part of Monstera could not start on this computer — an engine host whose library
 * Windows would not load, or a converter the loader refused.
 *
 * ## Why a dialog
 *
 * It answers the question the person has at that moment — *why did nothing happen?* — and what to do is not obvious
 * from anything else on screen. It carries nothing: the component is named by Help › Components, where its state is.
 */
export const COMPONENT_CANNOT_START_DIALOG = declareDialog({
  id: COMPONENT_CANNOT_START_DIALOG_ID,
  title: COMPONENT_CANNOT_START_TITLE,
  informs: 'message',
  props: z.object({}).strict(),
  component: lazy(() => import('./ComponentCannotStartBody.js')),
});
