import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  DELETE_PAGES_HINT,
  EXTRACT_PAGES_APPLY,
  EXTRACT_PAGES_EMPTY,
  EXTRACT_PAGES_LABEL,
} from '../messages/en.js';
import { parsePageRanges } from '../pageRanges.js';
import type { ExtractPagesAnswer } from './extractPagesResult.js';
import { renderRangeProblem } from './pageRangeProblem.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The extract dialog's body — which pages become a new document.
 *
 * ## `DeletePagesBody` minus the everything-refusal, and that is the decision
 *
 * Deleting every page empties the open document, which `pageOrder.ts` refuses.
 * Extracting every page writes a copy and leaves the source untouched — odd to
 * ask for, not wrong — so there is no such guard here and its absence is
 * deliberate rather than forgotten.
 *
 * The hint string is `DELETE_PAGES_HINT` — the literal example `1-3, 5` — and
 * it is shared rather than copied because it is an example of the SYNTAX
 * `parsePageRanges` accepts, not of what either operation does. A second
 * identical string would be one a translator meets twice with no way to know
 * they must stay in step.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ExtractPagesBody({
  pageCount,
  resolve,
}: {
  readonly pageCount: number;
} & DialogAnswering<ExtractPagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState('');

  const parsed = parsePageRanges(text, pageCount);

  return (
    <div className="m-extract-pages">
      <Input
        label={EXTRACT_PAGES_LABEL}
        placeholder={DELETE_PAGES_HINT}
        value={text}
        onValueChange={setText}
      />
      <p className="m-extract-pages__problem" role="status">
        {renderRangeProblem(parsed, text, _, EXTRACT_PAGES_EMPTY)}
      </p>
      <Button
        label={EXTRACT_PAGES_APPLY}
        variant="primary"
        disabled={!parsed.ok}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `DeletePagesBody`'s reason: this is the only place that can produce
          // a value, and the schema behind `resolve` refuses an empty list.
          if (!parsed.ok) return;
          // COPIED, because `parsePageRanges` answers a `readonly` array and
          // zod's inferred shape is mutable. The copy is the honest conversion
          // rather than a cast.
          resolve({ pages: [...parsed.value] });
        }}
      />
    </div>
  );
}
