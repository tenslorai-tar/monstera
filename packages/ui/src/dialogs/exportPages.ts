import { lazy } from 'react';
import { z } from 'zod';

import { EXPORT_LAYOUT_TEXT_TITLE, EXPORT_POWERPOINT_TITLE, EXPORT_TEXT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const EXPORT_POWERPOINT_DIALOG_ID = 'dialog.export-powerpoint';
export const EXPORT_TEXT_DIALOG_ID = 'dialog.export-text';
export const EXPORT_LAYOUT_TEXT_DIALOG_ID = 'dialog.export-layout-text';

/**
 * What an export whose only question is the pages answers (ADR-0161): the pages, already parsed, for the page-image
 * export's reason.
 */
export const EXPORT_PAGES_RESULT = z.object({ pages: z.array(z.number().int().nonnegative()).min(1) }).strict();

export type ExportPagesAnswer = z.infer<typeof EXPORT_PAGES_RESULT>;

/**
 * The page count the row builds *every page* from, and what a page becomes — a slide, or its text — which is the one
 * sentence the three dialogs do not share.
 */
export const EXPORT_PAGES_PROPS = z
  .object({ pageCount: z.number().int().positive(), becomes: z.enum(['slides', 'text']) })
  .strict();

export type ExportPagesProps = z.infer<typeof EXPORT_PAGES_PROPS>;

/**
 * ONE BODY, THREE DIALOGS: PowerPoint and the two text exports each ask only which pages, so a body each would be three
 * copies of one row and one button. They stay three declarations because each has its own title, which a person reads
 * to know which export they started.
 */
const BODY = lazy(() => import('./ExportPagesBody.js'));

export const EXPORT_POWERPOINT_DIALOG = declareDialog({
  id: EXPORT_POWERPOINT_DIALOG_ID,
  title: EXPORT_POWERPOINT_TITLE,
  props: EXPORT_PAGES_PROPS,
  result: EXPORT_PAGES_RESULT,
  component: BODY,
});

export const EXPORT_TEXT_DIALOG = declareDialog({
  id: EXPORT_TEXT_DIALOG_ID,
  title: EXPORT_TEXT_TITLE,
  props: EXPORT_PAGES_PROPS,
  result: EXPORT_PAGES_RESULT,
  component: BODY,
});

export const EXPORT_LAYOUT_TEXT_DIALOG = declareDialog({
  id: EXPORT_LAYOUT_TEXT_DIALOG_ID,
  title: EXPORT_LAYOUT_TEXT_TITLE,
  props: EXPORT_PAGES_PROPS,
  result: EXPORT_PAGES_RESULT,
  component: BODY,
});
