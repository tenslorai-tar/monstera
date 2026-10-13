import type { I18n } from '@lingui/core';
import { z } from 'zod';

import { byteSize } from '../byteSize.js';
import { STATUS_SIZE_KB } from '../messages/en.js';

/**
 * A picked file refused for its size, as every problem dialog that says so takes it: the bound and the file's own size
 * (the owner's O10: a limit's message gives the file's size and what happens next).
 *
 * **One shape and one rendering for every dialog** (B3a). Until 2026-10-13 five dialogs each carried the bound alone and
 * each turned it into megabytes itself, four with `Math.floor` and one with `Math.round`, so the same bound read
 * differently in two dialogs and none of them could say how large the person's file was.
 */
export const fileTooLargeProps = z
  .object({
    reason: z.literal('too-large'),
    limitBytes: z.number().int().positive(),
    fileBytes: z.number().int().positive(),
  })
  .strict();

/** See {@link fileTooLargeProps}. */
export type FileTooLargeProps = z.infer<typeof fileTooLargeProps>;

/** A channel's `too-large` answer as a problem dialog's props: both sizes cross, never one. */
export function fileTooLargeProblem(answer: { readonly limitBytes: number; readonly fileBytes: number }): FileTooLargeProps {
  return { reason: 'too-large', limitBytes: answer.limitBytes, fileBytes: answer.fileBytes };
}

/**
 * The two sizes a too-large sentence names, each as a person reads a size (`byteSize`).
 *
 * **NEVER THE SAME TEXT TWICE.** `byteSize` gives megabytes to one decimal, so a file a few kilobytes past a 1 MiB bound
 * reads "1 MB" beside a bound of "1 MB" — a sentence refusing a file for being larger than itself. Where the two would
 * read alike, both are given in kilobytes, which separate any two sizes a person could be refused between.
 */
export function fileTooLargeValues(i18n: I18n, props: FileTooLargeProps): { readonly size: string; readonly limit: string } {
  const size = byteSize(i18n, props.fileBytes);
  const limit = byteSize(i18n, props.limitBytes);
  if (size !== limit) return { size, limit };
  return { size: i18n._(STATUS_SIZE_KB, { size: Math.ceil(props.fileBytes / 1024) }), limit: i18n._(STATUS_SIZE_KB, { size: Math.floor(props.limitBytes / 1024) }) };
}
