import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  DELETE_PAGES_APPLY,
  DELETE_PAGES_EMPTY,
  DELETE_PAGES_EVERYTHING,
  DELETE_PAGES_HINT,
  DELETE_PAGES_LABEL,
} from '../messages/en.js';
import { renderRangeProblem } from './pageRangeProblem.js';
import { parsePageRanges } from '../pageRanges.js';
import type { DeletePagesAnswer } from './deletePagesResult.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The delete-pages dialog's body — the first that collects arguments.
 *
 * ## Every refusal is shown BEFORE the button is pressed
 *
 * The parse runs on each keystroke and the apply control is disabled while the
 * expression is unusable, so the failure a person meets is a sentence naming
 * the part that is wrong rather than a dialog that closes and does nothing.
 * That is the difference between validation as feedback and validation as a
 * gate, and this body needs both: the schema on the way out is the gate.
 *
 * ## Deleting every page is refused HERE and in the kernel
 *
 * `pageOrder.ts` throws for it, because a PDF with no pages is not one a reader
 * opens. Repeating the rule here is not a second opinion about it — the kernel
 * stays the authority and its refusal is what makes the document safe — this is
 * the same rule stated where a person can act on it, since a modal that closes
 * and reports an internal error is the worst way to learn it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DeletePagesBody({
  pageCount,
  resolve,
}: {
  readonly pageCount: number;
  // THE SCHEMA'S OWN OUTPUT, not a hand-written restatement of it — see
  // `deletePagesResult.ts` for why it is a separate module and why the
  // hand-written version did not compile.
} & DialogAnswering<DeletePagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState('');

  const parsed = parsePageRanges(text, pageCount);
  // EVERY PAGE IS REFUSED, and it is computed from the parse rather than from
  // the text: `1-4`, `4,3,2,1` and `1,1,2,3,4` are the same request, and a
  // check on the string would catch one of the three.
  const everything = parsed.ok && parsed.value.length >= pageCount;

  return (
    <div className="m-delete-pages">
      <Input
        label={DELETE_PAGES_LABEL}
        placeholder={DELETE_PAGES_HINT}
        value={text}
        onValueChange={setText}
      />
      <p className="m-delete-pages__problem" role="status">
        {everything
          ? _(DELETE_PAGES_EVERYTHING)
          : renderRangeProblem(parsed, text, _, DELETE_PAGES_EMPTY)}
      </p>
      <Button
        label={DELETE_PAGES_APPLY}
        variant="primary"
        disabled={!parsed.ok || everything}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute. A
          // disabled control is a rendering decision; this is the only place
          // that can produce a value, and the schema behind `resolve` refuses
          // an empty list — so a mismatch between the two would be a thrown
          // `DialogResultRejected` over the user's document.
          if (!parsed.ok || everything) return;
          // COPIED, because `parsePageRanges` answers a `readonly` array and
          // zod's inferred shape is mutable. The copy is the honest conversion
          // rather than a cast: the parser's guarantee is that nothing changes
          // ITS array, and handing the same reference to a mutable field would
          // be that guarantee stated and not held.
          resolve({ pages: [...parsed.value] });
        }}
      />
    </div>
  );
}

