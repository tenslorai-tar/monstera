import {
  CLOUD_PROVIDER_IDS,
  CLOUD_REFUSALS,
  MAX_CLOUD_FILES,
  cloudFileSchema,
  cloudProviderSchema,
  cloudStateSchema,
} from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { CLOUD_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Cloud storage…* opens. */
export const CLOUD_DIALOG_ID = 'dialog.cloud-storage';

/**
 * What the person chose: sign in or out, show a provider's PDFs, open one, or upload the open
 * document. Each is carried out by the command, which then shows the dialog again with the result
 * — `aiSetup.ts`' loop, so the dialog holds no client and makes no call.
 */
export const CLOUD_RESULT = z.discriminatedUnion('kind', [
  // ONE MEMBER PER KIND, each a literal: a member whose `kind` is itself a union narrows the value
  // and not the object, so the compiler could not see that `open` alone carries a file.
  z.object({ kind: z.literal('sign-in'), provider: cloudProviderSchema }).strict(),
  z.object({ kind: z.literal('sign-out'), provider: cloudProviderSchema }).strict(),
  z.object({ kind: z.literal('list'), provider: cloudProviderSchema }).strict(),
  z.object({ kind: z.literal('upload'), provider: cloudProviderSchema }).strict(),
  z.object({ kind: z.literal('open'), provider: cloudProviderSchema, fileId: z.string().min(1) }).strict(),
]);

export type CloudAnswer = z.infer<typeof CLOUD_RESULT>;

/** What the last action ended in, said at the top of the next showing. */
export const CLOUD_NOTES = ['signed-in', 'signed-out', 'uploaded'] as const;

export const CLOUD_DIALOG = declareDialog({
  id: CLOUD_DIALOG_ID,
  title: CLOUD_TITLE,
  props: z
    .object({
      providers: z
        .array(z.object({ provider: cloudProviderSchema, state: cloudStateSchema }).strict())
        .max(CLOUD_PROVIDER_IDS.length),
      /** One provider's PDFs, when the person asked to see them. */
      listing: z
        .object({ provider: cloudProviderSchema, files: z.array(cloudFileSchema).max(MAX_CLOUD_FILES) })
        .strict()
        .optional(),
      /** Whether a document is open, so *Upload this document* can be offered. */
      documentOpen: z.boolean(),
      /** Why the last action did not happen. */
      problem: z.enum(CLOUD_REFUSALS).optional(),
      /** What the last action did. */
      note: z.enum(CLOUD_NOTES).optional(),
    })
    .strict(),
  result: CLOUD_RESULT,
  component: lazy(() => import('./CloudStorageBody.js')),
});
