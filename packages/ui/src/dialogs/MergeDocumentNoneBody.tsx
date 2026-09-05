import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { MERGE_DOCUMENT_NONE_BODY } from '../messages/en.js';

/**
 * The nothing-to-merge dialog's body.
 *
 * One sentence, and it names the action rather than the state — ADR-0040
 * Decision 2 makes *open the other document first* the step, and a message that
 * only reported the absence would leave a reader hunting for a merge control
 * that takes a file. There is not one, on purpose.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function MergeDocumentNoneBody(): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-merge-document-none">
      <p>{_(MERGE_DOCUMENT_NONE_BODY)}</p>
    </div>
  );
}
