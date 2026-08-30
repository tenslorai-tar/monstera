import { lazy } from 'react';
import { z } from 'zod';

import { PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a command opens when its answer is a failure. */
export const COMMAND_PROBLEM_DIALOG_ID = 'dialog.command-problem';

/**
 * What the user is told when a command was refused.
 *
 * ## The mapping from a code to a sentence, which is what was owed
 *
 * ADR-0009 §9's whole design is that a failure crossing to the renderer carries
 * a **code** and never a diagnostic — no message, no stack, no path. That is
 * only half a mechanism: a code nothing renders is a refusal the user meets as
 * a control that did nothing. The renderer's code → key mapping is the other
 * half, and it was owed from the day the first handler returned one.
 *
 * Every code here leaves the document exactly as it was, which is why the title
 * describes the operation rather than the state.
 *
 * ## `internal` carries its incident id, and only its id
 *
 * The diagnostic stays main-side. What crosses is an opaque reference, and
 * showing it is what makes it useful — a user can quote it and it names the log
 * entry that holds the real text. A dialog that swallowed it would leave the id
 * minted for nobody.
 *
 * The pair is `z.discriminatedUnion` rather than an optional field, so
 * `{code: 'document-busy', incident: '…'}` is unrepresentable: an id exists only
 * for the one code the boundary mints it for (B5).
 *
 * ## Invariant 18 clause (i)'s "tell the user"
 *
 * `document-poisoned` is the code that clause exists for. The supervisor has
 * stopped rebuilding, the command log and the canonical bytes are intact, and
 * refusing is what STRANDS the work rather than destroying it — so the sentence
 * has to say the changes are still there before it says anything else. A message
 * that only reported a failure would invite the user to close the window, which
 * is the single action that loses them.
 */
export const COMMAND_PROBLEM_DIALOG = declareDialog({
  id: COMMAND_PROBLEM_DIALOG_ID,
  title: PROBLEM_TITLE,
  props: z.discriminatedUnion('code', [
    z.object({ code: z.literal('document-not-open') }),
    z.object({ code: z.literal('document-busy') }),
    z.object({ code: z.literal('document-poisoned') }),
    z.object({ code: z.literal('checkpoint-restore-not-built') }),
    z.object({ code: z.literal('internal'), incident: z.string().min(1) }),
  ]),
  component: lazy(() => import('./CommandProblemBody.js')),
});
