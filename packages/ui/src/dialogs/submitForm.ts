import { MAX_ACTION_FIELDS, MAX_LINK_URI, SUBMIT_FORMATS, type SubmitFormat } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { lazy } from 'react';
import { z } from 'zod';

import { SUBMIT_FORMAT_FDF, SUBMIT_FORMAT_HTML, SUBMIT_FORMAT_PDF, SUBMIT_FORMAT_XFDF, SUBMIT_FORM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/**
 * Each encoding's name, as a person meets it: the question's and the Properties editor's. A total record, so a format
 * the contract gains has a name or no build.
 */
export const SUBMIT_FORMAT_NAMES: Readonly<Record<SubmitFormat, MessageKey>> = {
  fdf: SUBMIT_FORMAT_FDF,
  xfdf: SUBMIT_FORMAT_XFDF,
  html: SUBMIT_FORMAT_HTML,
  pdf: SUBMIT_FORMAT_PDF,
};

/** The id a push button's Submit opens before anything leaves the document (ADR-0259 Decision 6). */
export const SUBMIT_FORM_DIALOG_ID = 'dialog.submit-form';

/** The routes a submission goes by: posted for `https:`; shared as a file or put in a message for `mailto:` (ADR-0263). */
export const SUBMIT_ROUTES = ['post', 'share', 'mail-app'] as const;

/** The answer that sends, naming the route the person chose. Closing the dialog is keeping the data, so × and Escape send nothing. */
export const SUBMIT_FORM_SEND_RESULT = z.object({ send: z.literal(true), route: z.enum(SUBMIT_ROUTES) }).strict();

/**
 * What the question answers, and what it REPORTS without closing (ADR-0094): Copy asks the opener to copy the
 * address, through `main`, since the renderer holds no clipboard; only {@link SUBMIT_FORM_SEND_RESULT} sends.
 */
export const SUBMIT_FORM_RESULT = z.union([SUBMIT_FORM_SEND_RESULT, z.object({ copy: z.literal(true) }).strict()]);

/**
 * Asked before a push button sends the form's data: where it goes, in which encoding, and which fields, as the
 * button's action holds them. A `mailto:` address says the mail app opens with the data in a message and nothing is
 * sent until the person sends it there.
 */
export const SUBMIT_FORM_DIALOG = declareDialog({
  id: SUBMIT_FORM_DIALOG_ID,
  title: SUBMIT_FORM_TITLE,
  props: z
    .object({
      address: z.string().max(MAX_LINK_URI),
      format: z.enum(SUBMIT_FORMATS),
      /** The fields named, or `null` for every field. */
      fields: z.array(z.string()).max(MAX_ACTION_FIELDS).readonly().nullable(),
      /** Whether the address is a `mailto:` one, which opens the mail app rather than sending. */
      mail: z.boolean(),
    })
    .strict(),
  result: SUBMIT_FORM_RESULT,
  component: lazy(() => import('./SubmitFormBody.js')),
});
