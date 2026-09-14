import { lazy } from 'react';
import { z } from 'zod';

import { IMPORT_PAGE_AS_LAYER_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { IMPORT_PAGE_AS_LAYER_RESULT } from './importPageAsLayerResult.js';

/** The id `importPageAsLayerCommand` opens to choose which document's page is placed. */
export const IMPORT_PAGE_AS_LAYER_DIALOG_ID = 'dialog.import-page-as-layer';

/**
 * Which OPEN document's first page is placed on the page on screen, as a layer
 * ([ADR-0064](../../../../docs/DECISIONS/0064-a-page-imported-as-a-layer-is-mupdfs-because-the-layer-is.md)).
 *
 * `REPLACE_PAGE_DIALOG`'s shape, as its own entry for that dialog's reason: the title
 * tells a reader what is about to happen to their page, and the two do different things.
 * The picker is the shared `DocumentChoiceSelect`.
 *
 * `page` goes in so the sentence can name it, and the sentence also says it is the
 * document's FIRST page that is placed — the renderer knows no other document's page
 * count, so that is not a choice this dialog can offer (the command's note).
 */
export const IMPORT_PAGE_AS_LAYER_DIALOG = declareDialog({
  id: IMPORT_PAGE_AS_LAYER_DIALOG_ID,
  title: IMPORT_PAGE_AS_LAYER_TITLE,
  props: z
    .object({
      /** The other open documents, in tab order. Never includes the target. */
      choices: z
        .array(z.object({ docId: z.string().min(1), name: z.string().min(1) }).strict())
        .min(1),
      /** The page the layer is placed on, zero-based. Shown 1-based. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: IMPORT_PAGE_AS_LAYER_RESULT,
  component: lazy(() => import('./ImportPageAsLayerBody.js')),
});
