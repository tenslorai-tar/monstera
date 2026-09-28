import { ocrLanguagesSchema } from '@monstera/contract';
import { z } from 'zod';

/** The Help centre's article on getting an Azure or Anthropic key and what each costs (ADR-0112). */
export const KEYS_ARTICLE = 'ai-keys-and-pricing';

/** Recognise these pages in these languages, read together. */
const OCR_RUN = z
  .object({
    pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
    languages: ocrLanguagesSchema,
  })
  .strict();

/**
 * Or, instead, show how to get a key: the dialog's handwriting note is where a person without one learns they need
 * one, so it is where the article is offered. An ANSWER rather than a second dialog opened from inside the first —
 * a body cannot open a dialog, and the command that opened this one opens the Help centre.
 */
const OCR_HELP = z.object({ help: z.literal(KEYS_ARTICLE) }).strict();

export const OCR_RESULT = z.union([OCR_RUN, OCR_HELP]);

export type OcrAnswer = z.infer<typeof OCR_RESULT>;
