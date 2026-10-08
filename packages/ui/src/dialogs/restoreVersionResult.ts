import { z } from 'zod';

/**
 * The earlier version a person chose to restore: the opaque id main listed it under (ADR-0198), never a path. Its own
 * module for `deletePagesResult.ts`' reason: the entry imports the body lazily and the body needs this type.
 */
export const RESTORE_VERSION_RESULT = z.object({ id: z.string().min(1).max(32) }).strict();

/** One kept version as the dialog is given it: an id, when it was saved over (an ISO instant), and its size in bytes. */
export const KEPT_VERSION = z
  .object({ id: z.string().min(1).max(32), savedAt: z.string().max(40), bytes: z.number().int().nonnegative() })
  .strict();

export type RestoreVersionAnswer = z.infer<typeof RESTORE_VERSION_RESULT>;
export type KeptVersionProps = z.infer<typeof KEPT_VERSION>;
