import { z } from 'zod';

/**
 * What the copy-to-pages dialog answers with: already-validated **zero-based** pages, as `parsePageRanges` produced them
 * (`extractPagesResult.ts`' rule). Its own module for that file's forced reason: the entry imports the body lazily and
 * the body needs this type.
 */
export const FIELD_COPY_RESULT = z.object({ pages: z.array(z.number().int().nonnegative()).min(1) }).strict();

/** Zero-based pages, as the dialog produced them. */
export type FieldCopyAnswer = z.infer<typeof FIELD_COPY_RESULT>;
