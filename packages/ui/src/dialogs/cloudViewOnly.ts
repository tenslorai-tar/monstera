import { cloudProviderSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { CLOUD_VIEW_ONLY_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const CLOUD_VIEW_ONLY_DIALOG_ID = 'dialog.cloud-view-only';

/**
 * When the person is told a cloud file is not theirs to change:
 *
 * - `opened` — the provider said so when the file was opened, and this is said BEFORE any edit;
 * - `read-only` — Save back was asked of such a file, so nothing was sent;
 * - `forbidden` — the provider refused Save back's upload with HTTP 403, though it had not said so at open.
 *
 * All three offer the one thing that keeps the person's changes in the cloud: a copy in their own storage.
 */
export const CLOUD_VIEW_ONLY_MOMENTS = ['opened', 'read-only', 'forbidden'] as const;

export type CloudViewOnlyMoment = (typeof CLOUD_VIEW_ONLY_MOMENTS)[number];

/** The person asked for the copy. A dismissal answers nothing the schema accepts, and ends it (ADR-0038). */
export const CLOUD_VIEW_ONLY_RESULT = z.object({ kind: z.literal('save-copy') }).strict();

/**
 * A file shared with the person to view (the owner's 0.1.6.0 run): Save back refused it and the words were *sign in
 * again*, which could never help. This says why in plain words and offers the copy instead.
 */
export const CLOUD_VIEW_ONLY_DIALOG = declareDialog({
  id: CLOUD_VIEW_ONLY_DIALOG_ID,
  title: CLOUD_VIEW_ONLY_TITLE,
  props: z.object({ provider: cloudProviderSchema, moment: z.enum(CLOUD_VIEW_ONLY_MOMENTS) }).strict(),
  result: CLOUD_VIEW_ONLY_RESULT,
  component: lazy(() => import('./CloudViewOnlyBody.js')),
});
