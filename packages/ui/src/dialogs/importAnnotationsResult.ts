import { annotationImportReportSchema } from '@monstera/contract';
import { lazy } from 'react';
import { COMMENTS_IMPORT_RESULT_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

export const IMPORT_ANNOTATIONS_RESULT_DIALOG_ID = 'dialog.import-annotations-result';
export const IMPORT_ANNOTATIONS_RESULT_DIALOG = declareDialog({
  id: IMPORT_ANNOTATIONS_RESULT_DIALOG_ID,
  title: COMMENTS_IMPORT_RESULT_TITLE,
  informs: 'message',
  props: annotationImportReportSchema,
  component: lazy(() => import('./ImportAnnotationsResultBody.js')),
});
