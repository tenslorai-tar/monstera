import { pageMarkKindSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { PAGE_MARKS_NOTICE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id Edit and Remove of a kind of mark open to say what they could not reach. */
export const PAGE_MARKS_NOTICE_DIALOG_ID = 'dialog.page-marks-notice';

/**
 * What Edit and Remove of a watermark, headers and footers or Bates numbers could not reach (ADR-0246 Decisions 5 and
 * 6), in plain words: none of the kind at all, a mark an older Monstera wrote without a record, and another program's
 * mark inside the page's own content. Each is left on the page, and a command that left something quietly would read as
 * one that failed.
 *
 * It ANSWERS NOTHING: `declareDialog` gives an entry no result unless it declares one (ADR-0038).
 */
export const PAGE_MARKS_NOTICE_DIALOG = declareDialog({
  id: PAGE_MARKS_NOTICE_DIALOG_ID,
  title: PAGE_MARKS_NOTICE_TITLE,
  informs: 'report',
  props: z
    .object({
      kind: pageMarkKindSchema,
      /** Whether the document carries none of this kind that can be changed or removed. */
      none: z.boolean(),
      /** Pages carrying an older Monstera's stamp, whose kind cannot be told. */
      older: z.number().int().nonnegative(),
      /** Pages carrying another program's mark of this kind inside their own content. */
      inline: z.number().int().nonnegative(),
    })
    .strict(),
  component: lazy(() => import('./PageMarksNoticeBody.js')),
});
