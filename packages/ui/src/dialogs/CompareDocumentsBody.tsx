import type { ReactElement } from 'react';
import { useState } from 'react';

import { COMPARE_DOCUMENTS_APPLY, COMPARE_DOCUMENTS_LABEL } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CompareDocumentsAnswer } from './compareDocuments.js';
import { type DocumentChoice, DocumentChoiceSelect } from './DocumentChoice.js';

/**
 * The compare picker's body: `MergeDocumentBody`'s, answering which document to compare with.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CompareDocumentsBody({
  choices,
  resolve,
}: {
  readonly choices: readonly DocumentChoice[];
} & DialogAnswering<CompareDocumentsAnswer>): ReactElement {
  const [other, setOther] = useState(choices[0]?.docId ?? '');

  return (
    <div className="m-compare-documents">
      <DocumentChoiceSelect
        label={COMPARE_DOCUMENTS_LABEL}
        choices={choices}
        value={other}
        onChange={setOther}
        marker="compare"
      />
      <Button
        label={COMPARE_DOCUMENTS_APPLY}
        variant="primary"
        disabled={other === ''}
        onClick={() => {
          if (other === '') return;
          resolve({ other });
        }}
      />
    </div>
  );
}
