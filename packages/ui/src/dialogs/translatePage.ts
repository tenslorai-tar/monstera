import { AI_PROVIDER_IDS, TRANSLATION_LANGUAGE_IDS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { TRANSLATE_PAGE_DIALOG_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Translate this page* opens to collect a language and a provider. */
export const TRANSLATE_PAGE_DIALOG_ID = 'dialog.translate-page';

/** How many pages one run translates at most: a bound so the answer has a size, far past any document a person translates. */
export const MAX_TRANSLATE_PAGES = 100_000;

/**
 * WHAT is translated: the page on show, the words selected (answered as text to copy — a block's words are rewritten
 * whole by the in-place editor, so a selection is not written back), or the pages named — one page after another, each its
 * own `editTextBlock`, and *Whole document* is every page named.
 */
export const TRANSLATE_SCOPE = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('page') }).strict(),
  z.object({ scope: z.literal('selection') }).strict(),
  z
    .object({ scope: z.literal('pages'), pages: z.array(z.number().int().nonnegative()).min(1).max(MAX_TRANSLATE_PAGES) })
    .strict(),
]);

/** What the dialog answers: the language, the provider to ask, and what to translate. */
export const TRANSLATE_PAGE_RESULT = z
  .object({
    language: z.enum(TRANSLATION_LANGUAGE_IDS),
    provider: z.enum(AI_PROVIDER_IDS),
    what: TRANSLATE_SCOPE,
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
      /** The document's page count, for *Whole document* and the typed pages. */
      pageCount: z.number().int().positive(),
      /** Whether words are selected on the page: *Selected text* is drawn either way and chosen only when they are. */
      hasSelection: z.boolean(),
    })
    .strict(),
  result: TRANSLATE_PAGE_RESULT,
  component: lazy(() => import('./TranslatePageBody.js')),
});
