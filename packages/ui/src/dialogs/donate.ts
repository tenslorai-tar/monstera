import { lazy } from 'react';
import { z } from 'zod';

import { DONATE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const DONATE_DIALOG_ID = 'dialog.donate';

/**
 * What the dialog answers with.
 *
 * Two named actions rather than a boolean, for `CloseUnsavedBody`'s reason: a button labelled with
 * what it does is safe to press without reading the question above it, and a `false` here would mean
 * *later* in this dialog and something else in the next one.
 *
 * **Dismissal is not one of them.** The × and Escape settle the promise `undefined`, which the command
 * treats exactly as `later` — so the platform's dismissal and the visible *Not now* do the same thing,
 * which is the only arrangement where neither is a surprise.
 */
export const DONATE_RESULT = z.enum(['open', 'later']);

export type DonateAnswer = z.infer<typeof DONATE_RESULT>;

/**
 * *Support Monstera* — the title bar's Donate button (the owner's design, 2026-09-22;
 * [ADR-0095](../../../../docs/DECISIONS/0095-the-title-bar-projects-the-applications-own-commands.md)).
 *
 * ## Why a dialog rather than the button opening the page
 *
 * A button in the window chrome that throws a browser open on one click is the behaviour people have
 * learnt to distrust in exactly this kind of button. The dialog says where you are about to be sent
 * and what the project does with the money before anything leaves the application, and *Not now* is a
 * real answer.
 *
 * ## It takes no props
 *
 * Nothing about the document, the window or the build changes what it says. `.strict()` all the same,
 * so a caller that starts passing something gets a refusal at the open call rather than a field the
 * body silently ignores.
 */
export const DONATE_DIALOG = declareDialog({
  id: DONATE_DIALOG_ID,
  title: DONATE_TITLE,
  props: z.object({}).strict(),
  result: DONATE_RESULT,
  component: lazy(() => import('./DonateBody.js')),
});
