import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

import { MERGE_DOCUMENT_APPLY, MERGE_DOCUMENT_LABEL } from '../messages/en.js';
import type { MergeDocumentAnswer } from './mergeDocumentResult.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The merge dialog's body — choose which open document's pages come in.
 *
 * ## A NATIVE `<select>`, and that is invariant 27 rather than taste
 *
 * `ComparePane.tsx` records the reason and it holds here unchanged: Base UI's
 * `SelectPopup` injects a `<style>` element, and §9.27's pinned CSP admits no
 * inline style. So the primitive set has no select, and a picker is written
 * with the platform's own control until that trigger fires.
 *
 * It is also the accessible default — a native select is operable by keyboard,
 * by screen reader and by touch with nothing written here, which is what B9
 * means by substrate.
 *
 * ## The first choice is PRESELECTED, so the control has a value from the start
 *
 * `ComparePane`'s picker has a legitimate empty state — *the same document* is
 * a choice a reader returns to. This one does not: the dialog is only opened
 * when there is at least one other document, and *no document* is expressed by
 * dismissing rather than by an option. An empty first option would be a value
 * the result schema then has to refuse, which is a failure state invented by
 * the control.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function MergeDocumentBody({
  choices,
  resolve,
}: {
  readonly choices: readonly { readonly docId: string; readonly name: string }[];
} & DialogAnswering<MergeDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const pickerId = useId();
  // THE FIRST CHOICE, and `choices` is non-empty by the props schema — `.min(1)`
  // is what makes this safe rather than a guard here. A body defending against
  // a state its own schema refuses is a check that cannot fail.
  const [source, setSource] = useState(choices[0]?.docId ?? '');

  return (
    <div className="m-merge-document">
      <label className="m-merge-document__pick" htmlFor={pickerId}>
        {_(MERGE_DOCUMENT_LABEL)}
        <select
          id={pickerId}
          data-merge-pick="true"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
          }}
        >
          {choices.map((choice) => (
            <option key={choice.docId} value={choice.docId}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
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
