import {
  DOCUMENT_PASSWORD_MAX_CHARS,
  PDF_ENCRYPTIONS,
  PDF_PERMISSIONS,
} from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PROTECT_DOCUMENT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the Protect ribbon's password command opens. */
export const PROTECT_DOCUMENT_DIALOG_ID = 'dialog.protect-document';

/**
 * What a person chooses when they protect a document
 * ([ADR-0055](../../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * ## ONE DIALOG FOR THREE ROWS, because the format writes them as one thing
 *
 * D7 lists *set user/owner password*, *permission flags* and *remove password*
 * as three rows, and they are three sentences about one write: `/Encrypt`
 * present with these terms, or absent. Three dialogs would ask a person to know
 * which of three screens changes the thing they are looking at, and three
 * commands would be three writers of one concern (B3).
 *
 * **Removing is `encryption: 'none'`**, which is why the confirming control
 * changes its words rather than a fourth surface existing.
 *
 * ## The refusal it carries
 *
 * `none` with passwords, or a scheme with neither password, are both
 * incoherent — the first says *remove it* and hands over a password, the second
 * says *protect it* and protects nothing. The schema refuses both, so the state
 * cannot leave this dialog rather than being caught by the kernel over somebody's
 * document.
 *
 * ## What it does NOT carry
 *
 * Any claim that permissions are enforced. They are honoured by readers that
 * choose to, and the dialog says so in its own words — a protection dialog that
 * implied otherwise would be this application making a promise the file format
 * does not keep.
 */
export const PROTECT_DOCUMENT_RESULT = z
  .object({
    encryption: z.enum(PDF_ENCRYPTIONS),
    userPassword: z.string().min(1).max(DOCUMENT_PASSWORD_MAX_CHARS).optional(),
    ownerPassword: z.string().min(1).max(DOCUMENT_PASSWORD_MAX_CHARS).optional(),
    permissions: z.array(z.enum(PDF_PERMISSIONS)).max(PDF_PERMISSIONS.length),
  })
  .strict()
  .refine(
    (answer) =>
      answer.encryption === 'none'
        ? answer.userPassword === undefined && answer.ownerPassword === undefined
        : answer.userPassword !== undefined || answer.ownerPassword !== undefined,
    'a scheme needs at least one password, and removing protection takes none',
  );

/** What the protection dialog answers with. */
export type ProtectDocumentAnswer = z.infer<typeof PROTECT_DOCUMENT_RESULT>;

export const PROTECT_DOCUMENT_DIALOG = declareDialog({
  id: PROTECT_DOCUMENT_DIALOG_ID,
  title: PROTECT_DOCUMENT_TITLE,
  props: z.object({}).strict(),
  result: PROTECT_DOCUMENT_RESULT,
  component: lazy(() => import('./ProtectDocumentBody.js')),
});
