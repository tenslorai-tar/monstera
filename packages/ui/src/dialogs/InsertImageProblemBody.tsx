import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  INSERT_IMAGE_TOO_LARGE,
  INSERT_IMAGE_TOO_MANY_PIXELS,
  INSERT_IMAGE_UNREADABLE,
} from '../messages/en.js';

/**
 * The insert-image problem dialog's body.
 *
 * ## The document is UNCHANGED, and every sentence says so
 *
 * `HistoryTrimmedBody`'s rule, inverted: that dialog leads with *it worked*
 * because it follows a success. This follows a failure, and the user's first
 * question is whether anything happened to their document. Nothing did — main
 * refuses before the page is made in every case — so each sentence carries it
 * rather than leaving the reassurance to a heading nobody reads twice.
 *
 * ## Limits are shown in the units a person reads, converted here
 *
 * The wire carries bytes and pixels because those are what the checks compare; a
 * person reads megabytes and megapixels. The conversion is at the point of display
 * and the value is not stored, which is the same rule the design tokens follow about
 * derived values.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function InsertImageProblemBody(
  props:
    | { readonly reason: 'unreadable' }
    | { readonly reason: 'too-large'; readonly limitBytes: number }
    | { readonly reason: 'too-many-pixels'; readonly limitPixels: number },
): ReactElement {
  const { _ } = useLingui();

  switch (props.reason) {
    case 'unreadable':
      return (
        <div className="m-insert-image-problem">
          <p>{_(INSERT_IMAGE_UNREADABLE)}</p>
        </div>
      );
    case 'too-large':
      return (
        <div className="m-insert-image-problem">
          <p>{_(INSERT_IMAGE_TOO_LARGE, { megabytes: Math.floor(props.limitBytes / (1024 * 1024)) })}</p>
        </div>
      );
    case 'too-many-pixels':
      return (
        <div className="m-insert-image-problem">
          <p>{_(INSERT_IMAGE_TOO_MANY_PIXELS, { megapixels: Math.floor(props.limitPixels / 1_000_000) })}</p>
        </div>
      );
  }
}
