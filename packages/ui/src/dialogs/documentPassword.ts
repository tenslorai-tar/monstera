import { DOCUMENT_PASSWORD_MAX_CHARS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { DOCUMENT_PASSWORD_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the viewer opens when a document will not parse without a password. */
export const DOCUMENT_PASSWORD_DIALOG_ID = 'dialog.document-password';

/**
 * What a person types to open an encrypted document
 * ([ADR-0055](../../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * ## `retry` IS A PROP, and it is the only thing that changes between attempts
 *
 * A first prompt and a second one after a refusal are the same question with a
 * different sentence above the field. Two dialogs would be two titles and two
 * bodies for one act; a dialog that tracked its own attempt count would be a
 * second place that knows whether the last password worked, and main already
 * knows (B3a).
 *
 * ## NO `NOT trimmed`, and that is a decision rather than an omission
 *
 * Every other text dialog here trims, because a comment of three spaces is an
 * empty comment. A password of three spaces is a password: PDF hands the bytes
 * to a hash, and trimming one would refuse a document whose owner chose a
 * password ending in a space — a refusal with no way for anybody to work out
 * why. The empty string is still refused, because an empty attempt is what the
 * engine already made before it reported the document locked.
 *
 * ## The bound is the contract's
 *
 * `DOCUMENT_PASSWORD_MAX_CHARS`, so the dialog cannot accept what the channel
 * refuses — a form that let a person type past the wire's bound would turn a
 * mistyped password into a frame error.
 */
export const DOCUMENT_PASSWORD_RESULT = z
  .object({ password: z.string().min(1).max(DOCUMENT_PASSWORD_MAX_CHARS) })
  .strict();

/** What the password dialog answers with. */
export type DocumentPasswordAnswer = z.infer<typeof DOCUMENT_PASSWORD_RESULT>;

export const DOCUMENT_PASSWORD_DIALOG = declareDialog({
  id: DOCUMENT_PASSWORD_DIALOG_ID,
  title: DOCUMENT_PASSWORD_TITLE,
  props: z.object({
    /** The document's name, so a person knows which file is asking. */
    name: z.string().max(255),
    /** Whether an earlier attempt on this document was refused. */
    retry: z.boolean(),
  }),
  result: DOCUMENT_PASSWORD_RESULT,
  component: lazy(() => import('./DocumentPasswordBody.js')),
});
