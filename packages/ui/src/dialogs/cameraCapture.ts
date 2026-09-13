import { capturedFramesSchema } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { CAMERA_CAPTURE_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id *New PDF from camera* asks. */
export const CAMERA_CAPTURE_DIALOG_ID = 'dialog.camera-capture';

/**
 * The pictures a person takes, answered as JPEG frames.
 *
 * THE CHANNEL'S OWN SCHEMA, `capturedFramesSchema`, so a dialog answer is exactly what
 * `document.newFromCapture` accepts: a frame the body could not bound would be refused
 * here, at the dialog, rather than as an `internal` answer after it closed.
 */
export const CAMERA_CAPTURE_RESULT = z.object({ frames: capturedFramesSchema }).strict();

/** What the dialog answers with. */
export type CameraCaptureAnswer = z.infer<typeof CAMERA_CAPTURE_RESULT>;

export const CAMERA_CAPTURE_DIALOG = declareDialog({
  id: CAMERA_CAPTURE_DIALOG_ID,
  title: CAMERA_CAPTURE_TITLE,
  props: z.object({}).strict(),
  result: CAMERA_CAPTURE_RESULT,
  component: lazy(() => import('./CameraCaptureBody.js')),
});
