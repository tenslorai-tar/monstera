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
 * ## It is a CONFIRM DIALOG and it is also where the options live
 *
 * Splitting them would put a settings screen in front of an irreversible act
 * and then ask a person to confirm something they can no longer see. What is
 * being confirmed is *these marks, with this cover, removing these images*.
 *
 * ## EVERY MARK, and it says how many (the owner, 2026-11-10)
 *
 * There is no scope to choose. An *Apply to: this page* over a page with no
 * marks, while other pages had them, removed nothing at all and said nothing,
 * so the person believed the document redacted (`pageRedact.test.ts`, *a
 * burn-in scoped to an unmarked page*). The dialog is opened with the count of
 * the document's marks and the pages they are on, from the same read the
 * question before a save counts with (`tallyPendingRedactions`), and its answer
 * carries no page list: the command sends `'all'`, so no answer this dialog can
 * give leaves a mark behind.
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
    cover: z.enum(PDF_REDACT_COVERS),
    images: z.enum(PDF_REDACT_IMAGES),
    /**
     * Whether the title survives — ADR-0079's open question, answered by the
     * owner 2026-09-21 and built as one field rather than a *keep metadata* flag.
     *
     * **Required here, not optional with a default.** A result schema whose
     * absent value meant *remove* would read the same as one whose absent value
     * meant *keep*, and only one of those leaks. The body spells it on every
     * answer.
     */
    keepTitle: z.boolean(),
    /**
     * Whether the bookmarks on pages this burn-in leaves untouched survive (ADR-0163's correction of 2026-11-06).
     * Required for `keepTitle`'s reason: absence must never mean *keep*.
     */
    keepBookmarks: z.boolean(),
  })
  .strict();

/** What the burn-in dialog answers with. */
export type ApplyRedactionsAnswer = z.infer<typeof APPLY_REDACTIONS_RESULT>;

/**
 * What the dialog starts on, and what a burn-in applies when *Confirm before redacting* is off — ONE definition, so
 * the choices a person would have been shown are exactly the ones applied without asking: a solid cover, the covered
 * image pixels removed, and the title and every bookmark removed with the rest (ADR-0079, ADR-0163: removal is the side
 * that cannot leak). Every reader burns in every mark, the third being *Apply* in the pending-redactions question
 * (`pendingRedactions.ts`), with these same choices, never a second set.
 */
export function applyRedactionsDefaults(): ApplyRedactionsAnswer {
  return { cover: 'solid', images: 'pixels', keepTitle: false, keepBookmarks: false };
}

export const APPLY_REDACTIONS_DIALOG = declareDialog({
  id: APPLY_REDACTIONS_DIALOG_ID,
  title: APPLY_REDACTIONS_TITLE,
  props: z.object({
    /**
     * How many marks the burn-in removes, and on how many pages, so the dialog says it rather than *are you sure*.
     * Absent only where main refused the count, and then the dialog claims no number.
     */
    counted: z.object({ marks: z.number().int().positive(), pages: z.number().int().positive() }).strict().optional(),
  }),
  result: APPLY_REDACTIONS_RESULT,
  component: lazy(() => import('./ApplyRedactionsBody.js')),
});
