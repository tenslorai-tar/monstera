import { MAX_SERVICE_DETAIL } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { SERVICE_REFUSED_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const SERVICE_REFUSED_DIALOG_ID = 'dialog.service-refused';

/**
 * A service did not read a page of an export (ADR-0086) — which page, and main's sentence, which
 * carries the service's own words where it gave any. Informational: nothing was written, and
 * nothing is asked.
 */
export const SERVICE_REFUSED_DIALOG = declareDialog({
  id: SERVICE_REFUSED_DIALOG_ID,
  title: SERVICE_REFUSED_TITLE,
  props: z.object({
    /** The page a person reads, from 1. */
    page: z.number().int().positive(),
    detail: z.string().max(MAX_SERVICE_DETAIL),
  }),
  component: lazy(() => import('./ServiceRefusedBody.js')),
});
