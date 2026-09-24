import { AI_PROVIDER_IDS, TRANSLATION_LANGUAGE_IDS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { TRANSLATE_PAGE_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Translate this page* opens to collect a language and a provider. */
export const TRANSLATE_PAGE_DIALOG_ID = 'dialog.translate-page';

/** What the dialog answers: the language, and the provider to ask. */
export const TRANSLATE_PAGE_RESULT = z
  .object({
    language: z.enum(TRANSLATION_LANGUAGE_IDS),
    provider: z.enum(AI_PROVIDER_IDS),
  })
  .strict();

export type TranslatePageAnswer = z.infer<typeof TRANSLATE_PAGE_RESULT>;

/**
 * Which language, and which provider (ADR-0097).
 *
 * ## THE PROVIDERS TRAVEL IN, and they are the ones with a key
 *
 * `ocr.ts`' reason for its languages: a list built from the registry would offer a provider the
 * translation then refuses for want of a key. So the command hands in the providers whose keys are
 * stored, and none is a designed state — a sentence saying where to add one, and no control to
 * start (§10.5).
 *
 * ## No language is chosen for the person
 *
 * Any default is a guess about what they want, and a guess here costs a paid request and a
 * rewritten page. The start control waits until a language is chosen.
 */
export const TRANSLATE_PAGE_DIALOG = declareDialog({
  id: TRANSLATE_PAGE_DIALOG_ID,
  title: TRANSLATE_PAGE_DIALOG_TITLE,
  props: z
    .object({
      /** The providers with a stored key, in the registry's order. */
      providers: z.array(z.enum(AI_PROVIDER_IDS)).max(AI_PROVIDER_IDS.length),
    })
    .strict(),
  result: TRANSLATE_PAGE_RESULT,
  component: lazy(() => import('./TranslatePageBody.js')),
});
