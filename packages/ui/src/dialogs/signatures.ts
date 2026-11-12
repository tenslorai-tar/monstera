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
 * ## It answers ONE THING
 *
 * What a person mostly does here is decide whether to trust the document, and
 * that is a judgement rather than a command. The one thing it answers, since
 * ADR-0291 Decision 7, is which signature's signed version to save as a copy,
 * offered where the file holds more than that signature signed.
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
  signedThrough: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/**
 * The one answer: *Save this signed version…* for the signature whose signed bytes end at `signedThrough`
 * (ADR-0291 Decision 7). Closing the window answers nothing, which is reading it.
 */
export const SIGNATURES_RESULT = z.object({ signedThrough: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();

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
  // IT ANSWERS ONE THING since ADR-0291 Decision 7: which signed version to save. Everything else it shows is read.
  result: SIGNATURES_RESULT,
  component: lazy(() => import('./SignaturesBody.js')),
});
