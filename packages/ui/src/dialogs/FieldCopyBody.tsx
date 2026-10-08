import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import {
  DELETE_PAGES_HINT,
  FIELD_COPY_APPLY,
  FIELD_COPY_EMPTY,
  FIELD_COPY_LABEL,
  FIELD_COPY_NOTE,
  FIELD_COPY_OWN_PAGE,
} from '../messages/en.js';
import { formatPageRanges, parsePageRanges } from '../pageRanges.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Problem } from '../primitives/Problem.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { FieldCopyAnswer } from './fieldCopyResult.js';
import { renderRangeProblem } from './pageRangeProblem.js';

/**
 * The copy-to-pages dialog's body: which pages the field is copied onto.
 *
 * It starts with every OTHER page, written as ranges, so the common ask (the same field on each page of a form) is one
 * press and any narrower one is a keystroke away. The field's own page is refused in words and never dropped from what
 * was typed: a parse that quietly left it out would copy onto pages the person did not name.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function FieldCopyBody({
  pageCount,
  from,
  resolve,
}: { readonly pageCount: number; readonly from: number } & DialogAnswering<FieldCopyAnswer>): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState(() =>
    formatPageRanges(Array.from({ length: pageCount }, (_unused, page) => page).filter((page) => page !== from)),
  );
  const fieldRef = useRef<HTMLDivElement>(null);
  const parsed = parsePageRanges(text, pageCount);
  const ownPage = parsed.ok && parsed.value.includes(from);

  return (
    <div className="m-extract-pages">
      <div ref={fieldRef}>
        <DialogRow label={FIELD_COPY_LABEL} note={FIELD_COPY_NOTE}>
          <Input
            label={FIELD_COPY_LABEL}
            labelShownBeside
            opensFocused
            placeholder={DELETE_PAGES_HINT}
            value={text}
            onValueChange={setText}
          />
        </DialogRow>
      </div>
      <Problem
        message={ownPage ? _(FIELD_COPY_OWN_PAGE) : renderRangeProblem(parsed, text, _, FIELD_COPY_EMPTY)}
        about={{ within: fieldRef }}
      />
      <DialogFooter>
        <Button
          label={FIELD_COPY_APPLY}
          variant="primary"
          disabled={!parsed.ok || ownPage}
          onClick={() => {
            // GUARDED AGAIN rather than trusting the disabled attribute: this is the only place that makes a value.
            if (!parsed.ok || ownPage) return;
            resolve({ pages: [...parsed.value] });
          }}
        />
      </DialogFooter>
    </div>
  );
}
