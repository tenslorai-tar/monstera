import { OCR_LANGUAGES, ocrLanguageSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { OCR_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { OCR_RESULT } from './ocrResult.js';
import { TARGET_PAGES } from './pageScope.js';

/** The id the OCR command opens to collect a language and a scope. */
export const OCR_DIALOG_ID = 'dialog.ocr';

/**
 * Which pages to recognise, and in which language.
 *
 * ## THE LANGUAGES TRAVEL IN, and the list is the machine's rather than the build's
 *
 * `OCR_LANGUAGES` declares fourteen and `scripts/provision/tessdata.mjs`
 * downloads fourteen, but CI provisions **`eng` alone** and a reader's machine may
 * have any subset. So the command asks `app.ocrLanguages` and hands the answer to
 * this dialog: a list built from the declared enum would offer a model the
 * recognition then fails on, which is the wired-tools defect wearing a dropdown.
 *
 * ## An empty list is `available: false`, not an empty dropdown
 *
 * `spellCheck.ts`' shape and its reason. A dialog offering no languages is
 * indistinguishable from one whose list failed to load, and §10.5 requires the
 * no-binary state to be designed rather than arrived at — so the absent case is a
 * sentence that says what is missing and the control to start is not rendered at
 * all.
 *
 * It is one prop rather than two because the second is derivable from the first
 * and a pair would make `{ available: true, languages: [] }` representable (B5).
 *
 * ## The current page travels in so the scope can be offered
 *
 * `cropPages.ts`' argument word for word: *this page* and *all pages* are the two
 * scopes worth having, and the first needs to know which page.
 */
export const OCR_DIALOG = declareDialog({
  id: OCR_DIALOG_ID,
  title: OCR_TITLE,
  props: z
    .object({
      /** The command's `targetPages`, for the scope's first choice (ADR-0104). */
      pages: TARGET_PAGES,
      /**
       * The models this machine has, in {@link OCR_LANGUAGES}' order.
       *
       * Bounded by the declared set, which is the one bound that cannot go stale:
       * the list is a subset of a closed enum.
       */
      languages: z.array(ocrLanguageSchema).max(OCR_LANGUAGES.length),
      /**
       * Whether a recognition service — Azure's endpoint and key, or an Anthropic key — is
       * stored, so the handwriting sentence can say where to go rather than always saying *add a
       * key* to a person who has one (§10.5's no-key state, told only when it is the state).
       */
      servicesReady: z.boolean(),
    })
    .strict(),
  result: OCR_RESULT,
  component: lazy(() => import('./OcrBody.js')),
});
