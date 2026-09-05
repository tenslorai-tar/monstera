import type { ReactElement } from 'react';
import { useState } from 'react';

import { MERGE_DOCUMENT_APPLY, MERGE_DOCUMENT_LABEL } from '../messages/en.js';
import { type DocumentChoice, DocumentChoiceSelect } from './DocumentChoice.js';
import type { MergeDocumentAnswer } from './mergeDocumentResult.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The merge dialog's body — choose which open document's pages come in.
 *
 * The picker is {@link DocumentChoiceSelect}, shared with insert-from-PDF and
 * replace-page; its header carries why the control is a native `<select>`.
 *
 * The first choice is preselected, and `choices` is non-empty by the props
 * schema — `.min(1)` is what makes that safe rather than a guard here. A body
 * defending against a state its own schema refuses is a check that cannot fail.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function MergeDocumentBody({
  choices,
  resolve,
}: {
  readonly choices: readonly DocumentChoice[];
} & DialogAnswering<MergeDocumentAnswer>): ReactElement {
  const [source, setSource] = useState(choices[0]?.docId ?? '');

  return (
    <div className="m-merge-document">
      <DocumentChoiceSelect
        label={MERGE_DOCUMENT_LABEL}
        choices={choices}
        value={source}
        onChange={setSource}
        marker="merge"
      />
      <Button
        label={MERGE_DOCUMENT_APPLY}
        variant="primary"
        disabled={source === ''}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `DeletePagesBody`'s reason: this is the only place that can produce
          // a value, and the schema behind `resolve` refuses an empty string.
          if (source === '') return;
          resolve({ source });
        }}
      />
    </div>
  );
}
