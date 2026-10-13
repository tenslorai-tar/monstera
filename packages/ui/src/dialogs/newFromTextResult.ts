import { composedFamilySchema } from '@monstera/contract';
import { z } from 'zod';

/**
 * What the new-PDF-from-text dialog answers with: the family the composed words are set in. Its own module for
 * `insertMarkdownResult.ts`' reason: the entry imports the body lazily and the body needs this type.
 */
export const NEW_FROM_TEXT_RESULT = z.object({ family: composedFamilySchema }).strict();

/** The font a new PDF from Markdown or CSV is set in. */
export type NewFromTextAnswer = z.infer<typeof NEW_FROM_TEXT_RESULT>;
