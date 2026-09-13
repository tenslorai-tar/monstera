import { lazy } from 'react';
import { z } from 'zod';

import { MARKDOWN_IMPORT_PROBLEM_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id both Markdown import commands open when an import produced no document. */
export const MARKDOWN_IMPORT_PROBLEM_DIALOG_ID = 'dialog.markdown-import-problem';

/**
 * What the user is told when a Markdown file they picked did not become pages.
 *
 * ## `insertImageProblem.ts`' shape, with the reasons the import has
 *
 * Every member is an answer the channel gave with `ok`: the file, the composition or
 * the destination was the problem, not a refusal of the document. A dismissal opens
 * nothing, because the person did it on purpose.
 *
 * **The composer's refusals are flattened into `reason`**, because each needs its own
 * sentence and only one of them has a line to name. `unencodable-text` carries it; a
 * sentence naming the line is what lets a person find the character.
 *
 * `absent` and `at-capacity` are here rather than on the open problem, because the
 * PDF WAS written — the person has a file where they chose, and the sentence says so.
 */
const markdownImportProblemSchema = z.discriminatedUnion('reason', [
  z.object({ reason: z.literal('unreadable') }),
  z.object({ reason: z.literal('too-large'), limitBytes: z.number().int().positive() }),
  z.object({ reason: z.literal('not-utf8') }),
  z.object({
    reason: z.literal('unencodable-text'),
    line: z.number().int().positive().nullable(),
  }),
  z.object({ reason: z.literal('nothing-to-draw') }),
  z.object({
    reason: z.literal('destination-contested'),
    openElsewhere: z.number().int().positive(),
  }),
  z.object({ reason: z.literal('write-failed') }),
  z.object({ reason: z.literal('absent') }),
  z.object({ reason: z.literal('at-capacity') }),
]);

/**
 * The props the dialog takes.
 *
 * Inferred from the SCHEMA and not from the declared dialog, because the dialog's type
 * is inferred in part from the body it lazily imports — and the body takes this type,
 * which would make each the other's input.
 */
export type MarkdownImportProblem = z.infer<typeof markdownImportProblemSchema>;

export const MARKDOWN_IMPORT_PROBLEM_DIALOG = declareDialog({
  id: MARKDOWN_IMPORT_PROBLEM_DIALOG_ID,
  title: MARKDOWN_IMPORT_PROBLEM_TITLE,
  props: markdownImportProblemSchema,
  component: lazy(() => import('./MarkdownImportProblemBody.js')),
});
