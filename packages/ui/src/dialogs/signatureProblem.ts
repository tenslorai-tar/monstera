import { MAX_SIGNATURE_FIELD } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SIGNATURE_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the plain Signature opens when nothing was placed (ADR-0133). */
export const SIGNATURE_PROBLEM_DIALOG_ID = 'dialog.signature-problem';

/**
 * Why a plain signature was not placed: `document.placeSignature`'s refusals, each one a person did not choose. A
 * closed picker is the other outcome and opens nothing, as `SIGN_PROBLEM_DIALOG`'s argument has it.
 *
 * **And three a typed name meets before anything is sent** (ADR-0150): its face cannot write some of its characters,
 * its outline is past the bound, or it draws nothing. The dialogs say so while the person is typing; these reach a
 * kept typed signature, which is placed by one click and has no field to say it in.
 *
 * **And two a scanned signature PDF meets** (G3d): its first page carries no ink, or it needs a password. Upload says
 * them before anything is placed; a picture picked at the click says them there.
 *
 * **Its own dialog rather than *Sign with certificate*'s**, whose every sentence says *the document was not signed* — a
 * claim about a certificate this route never asked for. Informational, so it answers nothing (ADR-0038).
 */
export const SIGNATURE_PROBLEM_DIALOG = declareDialog({
  id: SIGNATURE_PROBLEM_DIALOG_ID,
  title: SIGNATURE_PROBLEM_TITLE,
  informs: 'message',
  props: z.discriminatedUnion('reason', [
    z.object({ reason: z.literal('unreadable') }).strict(),
    z.object({ reason: z.literal('too-large'), limitBytes: z.number().int().positive() }).strict(),
    z.object({ reason: z.literal('absent') }).strict(),
    z.object({ reason: z.literal('cannot-write'), characters: z.string().min(1).max(MAX_SIGNATURE_FIELD) }).strict(),
    z.object({ reason: z.literal('too-long') }).strict(),
    z.object({ reason: z.literal('blank') }).strict(),
    z.object({ reason: z.literal('scan-blank') }).strict(),
    z.object({ reason: z.literal('scan-locked') }).strict(),
  ]),
  component: lazy(() => import('./SignatureProblemBody.js')),
});
