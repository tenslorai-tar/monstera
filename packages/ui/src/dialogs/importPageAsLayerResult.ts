import { z } from 'zod';

/**
 * What the import-page-as-layer dialog answers with — its own module for
 * `deletePagesResult.ts`' forced reason: the entry imports the body lazily and the body
 * needs this type, so declaring it beside the entry would make the two circular.
 *
 * `REPLACE_PAGE_RESULT`'s shape today, and deliberately **not** aliased: two dialogs
 * answering the same shape is a coincidence of what each currently asks. The layer's name
 * is not here — the command reads it from the choice it offered, so a dialog cannot send
 * a name that was never a tab's.
 */
export const IMPORT_PAGE_AS_LAYER_RESULT = z.object({ source: z.string().min(1) }).strict();

/** The open document whose first page becomes the layer. */
export type ImportPageAsLayerAnswer = z.infer<typeof IMPORT_PAGE_AS_LAYER_RESULT>;
