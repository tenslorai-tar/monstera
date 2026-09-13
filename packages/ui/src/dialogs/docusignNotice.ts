import { DOCUSIGN_REFUSALS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { DOCUSIGN_NOTICE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id DocuSign's commands open to say what happened. */
export const DOCUSIGN_NOTICE_DIALOG_ID = 'dialog.docusign-notice';

/**
 * Every outcome of a DocuSign command a person is told about.
 *
 * **The contract's refusals, not a copy of them** — `signProblem.ts`' rule and its
 * reason: the command forwards the channel's kind untranslated, and `ask` takes
 * `unknown` props, so a copy that fell behind the channel would compile and fail its
 * parse only when a person met the refusal. Beside them, the three outcomes that are
 * not refusals: a document sent, a document this session sent nothing for, and an
 * envelope DocuSign has not finished.
 */
export const DOCUSIGN_NOTICES = [...DOCUSIGN_REFUSALS, 'sent', 'nothing-sent', 'not-completed'] as const;

/** One of {@link DOCUSIGN_NOTICES}. */
export type DocusignNotice = (typeof DOCUSIGN_NOTICES)[number];

/**
 * What happened with DocuSign.
 *
 * **A sent document is told too**, and not only a refusal: sending uploads the
 * document to a third party and emails its signers, and a command that returned
 * quietly after doing that would leave a person unsure whether it happened.
 *
 * `status` is DocuSign's own word for an envelope that is not finished, shown as
 * DocuSign gives it.
 *
 * ## It ANSWERS NOTHING
 *
 * `declareDialog` gives an entry no result unless it declares one (ADR-0038).
 */
export const DOCUSIGN_NOTICE_DIALOG = declareDialog({
  id: DOCUSIGN_NOTICE_DIALOG_ID,
  title: DOCUSIGN_NOTICE_TITLE,
  props: z
    .object({
      reason: z.enum(DOCUSIGN_NOTICES),
      status: z.string().min(1).max(64).optional(),
    })
    .strict(),
  component: lazy(() => import('./DocusignNoticeBody.js')),
});
