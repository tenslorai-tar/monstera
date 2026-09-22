import { AI_PROVIDER_IDS } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { AI_SETUP_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *Set up AI…* opens. */
export const AI_SETUP_DIALOG_ID = 'dialog.ai-setup';

/**
 * Why the last attempt did not keep the key, said on the next showing of the dialog — the
 * provider's own answer through `ai.models`, or this machine refusing to store a secret.
 */
export const AI_SETUP_PROBLEMS = ['unauthorised', 'unreachable', 'rejected', 'unreadable', 'not-stored'] as const;

export type AiSetupProblem = (typeof AI_SETUP_PROBLEMS)[number];

/**
 * What the setup answers: *Skip*, or a provider and the key to check — and, for Azure OpenAI,
 * the resource address its requests go to.
 *
 * The key is in this answer for one hop only: the command hands it straight to
 * `settings.saveSecret`, the one channel that stores a secret (ADR-0056), and holds nothing.
 */
export const AI_SETUP_RESULT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skip') }).strict(),
  z
    .object({
      kind: z.literal('check'),
      provider: z.enum(AI_PROVIDER_IDS),
      key: z.string().trim().min(1),
      endpoint: z.string().trim(),
    })
    .strict(),
]);

export type AiSetupAnswer = z.infer<typeof AI_SETUP_RESULT>;

/**
 * BUILD-PROMPT E5's first-run step: choose a provider, paste a key, have it checked, or Skip —
 * *"prominent, no dark patterns"*. Skip is a button of the same weight as the check, and the
 * sentence under the title says what no key means: every other part of the application works.
 */
export const AI_SETUP_DIALOG = declareDialog({
  id: AI_SETUP_DIALOG_ID,
  title: AI_SETUP_TITLE,
  props: z
    .object({
      /** Whether this machine can store a secret at all; a field that cannot keep a key is not offered. */
      secretsAvailable: z.boolean(),
      /** Why the previous attempt was not kept, or absent on the first showing. */
      problem: z.enum(AI_SETUP_PROBLEMS).optional(),
      /** The provider the previous attempt named, so a retry starts where the person was. */
      provider: z.enum(AI_PROVIDER_IDS).optional(),
    })
    .strict(),
  result: AI_SETUP_RESULT,
  component: lazy(() => import('./AiSetupBody.js')),
});
