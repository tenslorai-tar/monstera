import { lazy } from 'react';
import { z } from 'zod';

import { ABOUT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const ABOUT_DIALOG_ID = 'dialog.about';

/**
 * The first registered dialog.
 *
 * ## Why About, and why that is not a placeholder
 *
 * §10.4's rule is that a control which renders and does nothing is a defect, and
 * a first dialog is where a placeholder is most tempting. This one shows the
 * running application's **real** version and install channel, fetched over the
 * real `app.info` channel — so it is a dialog whose content is wrong the moment
 * anything about it breaks, rather than one that renders correctly whatever the
 * application is doing.
 *
 * It also needs no open document, which keeps clause 6 independent of clause 2:
 * a first dialog that required a document would make two clauses fail together
 * for one cause.
 *
 * ## The schema is the gate, and it runs at the OPEN call
 *
 * `declareDialog` ties the schema to the component's props, so a body whose
 * props disagree fails in this file rather than being erased at the mount point
 * (finding EEEEE-2). `openWith` validates before any state moves, so a refused
 * open leaves whatever was showing exactly as it was.
 *
 * `installChannel` is deliberately the contract's enum rather than a free
 * string: it is one of three values and a fourth would be a channel nobody
 * declared.
 */
export const ABOUT_DIALOG = declareDialog({
  id: ABOUT_DIALOG_ID,
  title: ABOUT_TITLE,
  props: z.object({
    version: z.string().min(1),
    installChannel: z.enum(['store', 'web', 'development']),
  }),
  // Lazy, per ADR-0029 Decision 7: a mounted-but-closed dialog keeps its body's
  // state across opens and costs its chunk on first paint. Nothing is loaded
  // until this dialog is actually opened.
  component: lazy(() => import('./AboutBody.js')),
});
