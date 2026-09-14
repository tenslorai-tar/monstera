import { MAX_STRUCTURE_NAME, MAX_STRUCTURE_NODES } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PAGE_STRUCTURE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id the command opens, and the registry's key. */
export const PAGE_STRUCTURE_DIALOG_ID = 'dialog.pageStructure';

/**
 * One page's tagged structure, as the engine read it.
 *
 * ## The command reads and the dialog displays, which is `wordCount.ts`' split
 *
 * `DialogRegistry.openWith` validates props at the open call, so the outline is
 * read before this opens rather than fetched by the body (ADR-0029 Decision 7).
 *
 * ## A REFUSAL OPENS THIS TOO, and says so
 *
 * A reading-order control that did nothing when the lane refused would be the
 * display-only defect. The refusals available — a document closed, busy or
 * poisoned — are all about the document, so one sentence covers them.
 *
 * ## `page` is ONE-BASED here, and only here
 *
 * It is the number a person reads in the page box. The command converts from the
 * context's zero-based index at the one place both numbers are in hand.
 */
export const PAGE_STRUCTURE_DIALOG = declareDialog({
  id: PAGE_STRUCTURE_DIALOG_ID,
  title: PAGE_STRUCTURE_TITLE,
  props: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('read'),
      page: z.number().int().positive(),
      nodes: z
        .array(
          z.object({
            role: z.string().max(MAX_STRUCTURE_NAME),
            raw: z.string().max(MAX_STRUCTURE_NAME),
            depth: z.number().int().nonnegative().max(MAX_STRUCTURE_NODES),
            lines: z.number().int().nonnegative(),
          }),
        )
        .max(MAX_STRUCTURE_NODES),
      truncated: z.boolean(),
      untaggedLines: z.number().int().nonnegative(),
      images: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal('refused'),
      page: z.number().int().positive(),
    }),
  ]),
  // Lazy, per ADR-0029 Decision 7: nothing is loaded until this is opened.
  component: lazy(() => import('./PageStructureBody.js')),
});
