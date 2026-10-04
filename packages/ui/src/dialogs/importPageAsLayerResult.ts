import { z } from 'zod';

import { chooseFileAnswer } from './sourceDocuments.js';

/**
 * What the import-page-as-layer dialog answers with — **its own module for `deletePagesResult.ts`'s forced reason**:
 * the entry imports the body lazily and the body needs this type, so declaring it beside the entry makes the two
 * circular.
 *
 * The layer's name is not here — the command reads it from the choice it offered, so a dialog cannot send a name that
 * was never a tab's. `sourcePage` is zero-based in the SOURCE, converted once in the body.
 */

/** What the dialog reopens with after *Choose file…*: the source page as typed. */
export const IMPORT_PAGE_AS_LAYER_DRAFT = z.object({ sourcePage: z.string().max(20) }).strict();

export const IMPORT_PAGE_AS_LAYER_RESULT = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('import'),
      source: z.string().min(1),
      sourcePage: z.number().int().nonnegative(),
    })
    .strict(),
  chooseFileAnswer(IMPORT_PAGE_AS_LAYER_DRAFT),
]);

/** The document and page that become the layer — or a file to choose first. */
export type ImportPageAsLayerAnswer = z.infer<typeof IMPORT_PAGE_AS_LAYER_RESULT>;
