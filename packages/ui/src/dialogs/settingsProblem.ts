import { lazy } from 'react';
import { z } from 'zod';

import { SETTINGS_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id `persistSettings` opens, and the registry's key. */
export const SETTINGS_PROBLEM_DIALOG_ID = 'dialog.settings-problem';

/**
 * What the user is told when a preference could not be stored.
 *
 * ## This closes row 292's owed clause, and its trigger was reached rather than
 *   the calendar
 *
 * `persistSettings` fired `settings.save` and ignored the answer. The row said
 * so, and said what deferred it: **`SettingsStore.set` had no shipped caller**,
 * so no write could fail under a user. The rulers' toggle commands are that
 * first caller, which is what makes this owed now rather than later.
 *
 * (The clause's *earlier* stated reason — a dialog registry this application
 * did not have — had already expired, which is why the row was corrected on
 * 2026-09-01 rather than closed. A deferral's reason and its trigger are two
 * things, and this one outlived one of them.)
 *
 * ## Why a dialog rather than silence, given the change DID take effect
 *
 * The setting is applied in memory, so the ruler appears and the user has every
 * reason to believe the matter is settled. What failed is only that it will not
 * survive a restart — which the user discovers at the restart, in a different
 * session, with no way to connect it to what they did. That gap between *it
 * worked* and *it did not persist* is exactly what makes silence wrong here:
 * the failure is invisible at the moment it is diagnosable.
 *
 * ## One field, and it is not the error
 *
 * The channel's failure carries a code; what a user can do about any of them is
 * the same — the preference is applied now and will not be remembered. So the
 * body says that, and the code goes to the log rather than to the reader. A
 * dialog listing storage error codes is a dialog nobody can act on.
 *
 * The **setting's title** is carried, because *which* preference did not stick
 * is the one thing the user needs and the one thing they cannot infer if they
 * changed two.
 */
export const SETTINGS_PROBLEM_DIALOG = declareDialog({
  id: SETTINGS_PROBLEM_DIALOG_ID,
  title: SETTINGS_PROBLEM_TITLE,
  props: z.object({
    /**
     * The message key naming the setting that did not persist.
     *
     * A KEY and not a rendered string: this crosses no boundary, but a resolved
     * string here would be resolved in whatever locale was active when the
     * failure happened rather than when the dialog renders, and the two differ
     * the moment a language change is what failed to save.
     */
    setting: z.string().min(1),
  }),
  component: lazy(() => import('./SettingsProblemBody.js')),
});
