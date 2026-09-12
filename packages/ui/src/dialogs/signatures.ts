import { MAX_SIGNATURE_FIELD, MAX_SIGNATURES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SIGNATURES_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the Protect ribbon's verification command opens. */
export const SIGNATURES_DIALOG_ID = 'dialog.signatures';

/**
 * What a document's signatures say, shown to a person.
 *
 * ## It ANSWERS NOTHING
 *
 * `declareDialog` gives an entry no result unless it declares one (ADR-0038),
 * so this is informational by construction. There is nothing to do about a
 * signature from here: what a person does is decide whether to trust the
 * document, and that is a judgement rather than a command.
 *
 * ## The props are the channel's answer, restated
 *
 * A dialog's props go through a zod schema, so the shape is declared again
 * rather than imported — the one copy this build keeps, for `declareDialog`'s
 * own reason: props are validated at the open call, and a schema that deferred
 * to another module's would be a validation with nothing to validate against.
 */
const shownSignatureSchema = z.object({
  signer: z.string().max(MAX_SIGNATURE_FIELD),
  organisation: z.string().max(MAX_SIGNATURE_FIELD),
  reason: z.string().max(MAX_SIGNATURE_FIELD),
  location: z.string().max(MAX_SIGNATURE_FIELD),
  notBefore: z.string().max(MAX_SIGNATURE_FIELD),
  notAfter: z.string().max(MAX_SIGNATURE_FIELD),
  coversDocument: z.boolean(),
  coversWholeFile: z.boolean(),
});

/**
 * One row of the signature list, as the body renders it.
 *
 * **Named from the schema rather than from the entry**, because the entry's
 * type is inferred from its own `props` and a type reaching back into it is a
 * circular reference the compiler refuses. The schema is the thing both take.
 */
export type ShownSignature = z.infer<typeof shownSignatureSchema>;

export const SIGNATURES_DIALOG = declareDialog({
  id: SIGNATURES_DIALOG_ID,
  title: SIGNATURES_TITLE,
  props: z.object({
    signatures: z.array(shownSignatureSchema).max(MAX_SIGNATURES),
    /** Whether a signature was there and could not be read. */
    unreadable: z.boolean(),
  }),
  component: lazy(() => import('./SignaturesBody.js')),
});
