import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { GENERATE_TOC_NO_OUTLINE } from '../messages/en.js';

/**
 * The table-of-contents problem dialog's body.
 *
 * `InsertImageProblemBody`'s rule: this follows a command that did not run, so
 * the sentence carries *your document has not changed* rather than leaving the
 * reassurance to a heading nobody reads twice.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function GenerateTocProblemBody(_props: {
  readonly reason: 'no-outline';
}): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-generate-toc-problem">
      <p>{_(GENERATE_TOC_NO_OUTLINE)}</p>
    </div>
  );
}
