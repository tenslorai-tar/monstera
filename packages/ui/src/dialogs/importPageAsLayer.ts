import { lazy } from 'react';
import { z } from 'zod';

import { IMPORT_PAGE_AS_LAYER_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { IMPORT_PAGE_AS_LAYER_DRAFT, IMPORT_PAGE_AS_LAYER_RESULT } from './importPageAsLayerResult.js';
import { SOURCE_PROPS } from './sourceDocuments.js';

/** The id `importPageAsLayerCommand` opens to choose which document's page is placed. */
export const IMPORT_PAGE_AS_LAYER_DIALOG_ID = 'dialog.import-page-as-layer';

/**
 * Which document's page, and which of its pages, is laid over the page the command acts on, as a layer
 * ([ADR-0064](../../../../docs/DECISIONS/0064-a-page-imported-as-a-layer-is-mupdfs-because-the-layer-is.md)).
 *
 * `REPLACE_PAGE_DIALOG`'s shape, as its own entry for that dialog's reason: the title tells a reader what is about to
 * happen to their page, and the two do different things. The source row is the shared `SourceDocumentRow`.
 *
 * `page` goes in so the sentence can name it, and the sentence names the source page and document too, in plain words,
 * as they are chosen.
 */
export const IMPORT_PAGE_AS_LAYER_DIALOG = declareDialog({
  id: IMPORT_PAGE_AS_LAYER_DIALOG_ID,
  title: IMPORT_PAGE_AS_LAYER_TITLE,
  props: z
    .object({
      ...SOURCE_PROPS,
      /** The page the layer is placed on, zero-based. Shown 1-based. */
      page: z.number().int().nonnegative(),
      /** What the person had entered before *Choose file…*, restored as the dialog reopens. */
      draft: IMPORT_PAGE_AS_LAYER_DRAFT.optional(),
    })
    .strict(),
  result: IMPORT_PAGE_AS_LAYER_RESULT,
  component: lazy(() => import('./ImportPageAsLayerBody.js')),
});
