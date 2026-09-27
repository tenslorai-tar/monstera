import type { MessageKey } from '@monstera/shared';
import { lazy } from 'react';
import { z } from 'zod';

import { HELP_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const HELP_DIALOG_ID = 'dialog.help';

const ID = z.string().min(1).max(128);

/** *Show me* answers with the command whose control to ring; closing answers nothing. */
export const HELP_RESULT = z.object({ kind: z.literal('show'), command: ID }).strict();

export type HelpAnswer = z.infer<typeof HELP_RESULT>;

/**
 * The Help centre
 * ([ADR-0112](../../../../docs/DECISIONS/0112-the-help-centre-is-bundled-articles-and-f1-opens-the-one-for-where-you-are.md)).
 *
 * ## Ids cross, never articles
 *
 * The articles are bundled with the renderer and the body reads them itself, so the props name only WHERE to open —
 * an article, a context whose articles come first — and which commands have a control on screen to ring. An id the
 * body does not know opens the list, not an error: an article renamed under a stale id is still a Help centre.
 *
 * ## `showable` is the opener's, because only the opener holds the registry
 *
 * *Show me* for a command with no control on screen would ring nothing, which is the display-only defect, so the body
 * draws it only for the commands named here. Each carries its title as a KEY, the button's words. 1024 is above the
 * registry's size and bounds a list gone wrong.
 */
export const HELP_DIALOG = declareDialog({
  id: HELP_DIALOG_ID,
  title: HELP_TITLE,
  props: z
    .object({
      article: ID.nullable(),
      context: ID.nullable(),
      showable: z
        .array(
          z
            .object({
              id: ID,
              title: z.custom<MessageKey>((value) => typeof value === 'string' && value.length > 0),
            })
            .strict(),
        )
        .max(1024),
    })
    .strict(),
  result: HELP_RESULT,
  component: lazy(() => import('./HelpBody.js')),
});
