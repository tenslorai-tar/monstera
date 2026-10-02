import { fileHandleSchema, libraryIdSchema, requestedSignatureMarkSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SIGNATURE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { KEPT_SIGNATURE } from './signDocument.js';

/** The id the plain Signature's command opens (ADR-0133). */
export const SIGNATURE_DIALOG_ID = 'dialog.signature';

/**
 * What the Signature dialog answers: the look to place and whether to keep it, or a kept signature to remove — after
 * which the opener removes it and asks again with the library as it then is (`SIGN_DOCUMENT_ANSWERS`' reason: props
 * are fixed while a dialog is open).
 *
 * **The contract's own mark schema**, so the dialog cannot answer a look the channel refuses; a kept look is `saved`
 * by its id, and the person's *Save for reuse* travels beside it for main to act on after the mark is placed.
 */
export const SIGNATURE_ANSWERS = z.union([
  z.object({ mark: requestedSignatureMarkSchema, keep: z.boolean() }).strict(),
  z.object({ library: z.literal('remove'), id: libraryIdSchema }).strict(),
  /**
   * Upload's *Choose picture…*: the opener asks main to pick and hold one, then asks again with it to preview
   * (ADR-0133's second correction). *Save for reuse* travels with it so asking again does not reset it.
   */
  z.object({ upload: z.literal('pick'), keep: z.boolean() }).strict(),
]);

/** A picture main holds for this dialog: the handle the placement names, its file's name, and a `blob:` to show it. */
export const HELD_SIGNATURE_PICTURE = z
  .object({ handle: fileHandleSchema, name: z.string().min(1), src: z.string().startsWith('blob:') })
  .strict();

export type HeldSignaturePicture = z.infer<typeof HELD_SIGNATURE_PICTURE>;

export type SignatureAnswers = z.infer<typeof SIGNATURE_ANSWERS>;

/** The look and the keep, as the Signature command holds them between the dialog and the click. */
export type SignatureLook = Extract<SignatureAnswers, { mark: unknown }>;

export const SIGNATURE_DIALOG = declareDialog({
  id: SIGNATURE_DIALOG_ID,
  title: SIGNATURE_TITLE,
  /**
   * `kept` is the signature library — the one *Sign with certificate* offers too — for one-click reuse. `picked` is the
   * picture main holds after Upload's pick, shown before it is placed; `keep` is *Save for reuse* as it was left.
   */
  props: z
    .object({ kept: z.array(KEPT_SIGNATURE).readonly(), picked: HELD_SIGNATURE_PICTURE.optional(), keep: z.boolean().optional() })
    .strict(),
  result: SIGNATURE_ANSWERS,
  component: lazy(() => import('./SignatureBody.js')),
});
