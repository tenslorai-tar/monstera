import { lazy } from 'react';
import { z } from 'zod';

import { WORDS_NOT_WRITTEN_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const WORDS_NOT_WRITTEN_DIALOG_ID = 'dialog.words-not-written';

/** The two answers (ADR-0278). A dismissed dialog answers nothing, which the leaving rule reads as `keep`. */
export const WORDS_NOT_WRITTEN_RESULT = z.enum(['keep', 'discard']);

export type WordsNotWrittenAnswer = z.infer<typeof WORDS_NOT_WRITTEN_RESULT>;

export const WORDS_NOT_WRITTEN_DIALOG = declareDialog({
  id: WORDS_NOT_WRITTEN_DIALOG_ID,
  title: WORDS_NOT_WRITTEN_TITLE,
  props: z.object({}),
  result: WORDS_NOT_WRITTEN_RESULT,
  component: lazy(() => import('./WordsNotWrittenBody.js')),
});
