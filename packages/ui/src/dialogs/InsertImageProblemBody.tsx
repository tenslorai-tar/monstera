import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { INSERT_IMAGE_TOO_LARGE, INSERT_IMAGE_UNREADABLE } from '../messages/en.js';

/**
 * The insert-image problem dialog's body.
 *
 * ## The document is UNCHANGED, and both sentences say so
 *
 * `HistoryTrimmedBody`'s rule, inverted: that dialog leads with *it worked*
 * because it follows a success. This follows a failure, and the user's first
 * question is whether anything happened to their document. Nothing did — main
 * refuses before the command runs in both cases — so each sentence carries it
 * rather than leaving the reassurance to a heading nobody reads twice.
 *
 * ## The limit is shown in MEGABYTES, converted here
 *
 * The wire carries bytes because that is what the check compares; a person
 * reads megabytes. The conversion is at the point of display and the value is
 * not stored, which is the same rule the design tokens follow about derived
 * values.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function InsertImageProblemBody(
  props: { readonly reason: 'unreadable' } | { readonly reason: 'too-large'; readonly limitBytes: number },
): ReactElement {
  const { _ } = useLingui();

  if (props.reason === 'unreadable') {
    return (
      <div className="m-insert-image-problem">
        <p>{_(INSERT_IMAGE_UNREADABLE)}</p>
      </div>
    );
  }

  const megabytes = Math.floor(props.limitBytes / (1024 * 1024));
  return (
    <div className="m-insert-image-problem">
      <p>{_(INSERT_IMAGE_TOO_LARGE, { megabytes })}</p>
    </div>
  );
}
