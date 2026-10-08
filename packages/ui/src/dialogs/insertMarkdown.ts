import { lazy } from 'react';
import { z } from 'zod';

import { INSERT_MARKDOWN_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { INSERT_MARKDOWN_RESULT } from './insertMarkdownResult.js';

/** The id `insertMarkdownCommand` opens to choose where the converted pages go. */
export const INSERT_MARKDOWN_DIALOG_ID = 'dialog.insert-markdown';

/**
 * Where a Markdown file's pages go: at the start, at the end, or after a page — the position row of *Insert from PDF*
 * ([ADR-0040](../../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)), without the source rows, because
 * the source is a file the next step picks.
 *
 * ## It answers a position and nothing else
 *
 * The file is picked, read and converted in `main` after this answer (`document.appendMarkdown`, which has taken `at` since
 * the command was *append*), so the dialog neither holds nor names a document, and the whole converted content is inserted.
 */
export const INSERT_MARKDOWN_DIALOG = declareDialog({
  id: INSERT_MARKDOWN_DIALOG_ID,
  title: INSERT_MARKDOWN_TITLE,
  props: z
    .object({
      /** The TARGET's page count, bounding the position. */
      pageCount: z.number().int().positive(),
      /** The page on show, zero-based: *after page* starts on it. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
  result: INSERT_MARKDOWN_RESULT,
  component: lazy(() => import('./InsertMarkdownBody.js')),
});
