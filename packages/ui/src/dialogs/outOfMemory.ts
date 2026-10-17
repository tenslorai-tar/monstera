import { lazy } from 'react';
import { z } from 'zod';

import { OUT_OF_MEMORY_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const OUT_OF_MEMORY_DIALOG_ID = 'dialog.out-of-memory';

/**
 * A failure proven to be memory running out (ADR-0253), with the computer's figures as `main` read them: an engine host
 * killed at its memory budget during a command, or the window's renderer ended out of memory. Other programs are named
 * only where `othersUsingMost` says the computer was short; otherwise the sentence names the total alone.
 */
export const outOfMemorySchema = z
  .object({
    totalBytes: z.number().int().positive(),
    availableBytes: z.number().int().nonnegative(),
    othersUsingMost: z.boolean(),
  })
  .strict();

export type OutOfMemory = z.infer<typeof outOfMemorySchema>;

/** The person asked to try again. A dismissal answers nothing the schema accepts (ADR-0038). */
export const OUT_OF_MEMORY_RESULT = z.object({ kind: z.literal('try-again') }).strict();

export const OUT_OF_MEMORY_DIALOG = declareDialog({
  id: OUT_OF_MEMORY_DIALOG_ID,
  title: OUT_OF_MEMORY_TITLE,
  props: outOfMemorySchema,
  result: OUT_OF_MEMORY_RESULT,
  component: lazy(() => import('./OutOfMemoryBody.js')),
});

/** The computer's memory in whole gigabytes, as the sentence says it: at least one, so a small computer is never *0 GB*. */
export function wholeGigabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024 ** 3));
}
