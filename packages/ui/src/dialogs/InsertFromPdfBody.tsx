import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

import {
  INSERT_FROM_PDF_APPLY,
  INSERT_FROM_PDF_LABEL,
  INSERT_FROM_PDF_POSITION,
  INSERT_FROM_PDF_RANGE,
} from '../messages/en.js';
import type { InsertFromPdfAnswer } from './insertFromPdfResult.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/**
 * The insert-from-PDF dialog's body — which document, and where it goes.
 *
 * ## The position is 1-BASED on screen and 0-based on the way out
 *
 * A reader counts pages from one, and `pageNumbering.ts`' rule is that the
 * conversion happens once at the surface holding the text. So the field shows
 * `1` for the front of the document and the answer carries `0`.
 *
 * **`pageCount + 1` is a legal position**, because inserting after the last
 * page is a real request — `at: pageCount` in the destination frame. Bounding
 * the field at `pageCount` would make *put it at the end* unexpressible, which
 * is the off-by-one every insert in this build has a note about.
 *
 * ## A native `<select>`, for `MergeDocumentBody`'s reason
 *
 * Invariant 27: Base UI's `SelectPopup` injects a `<style>` element and §9.27's
 * pinned CSP admits no inline style.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function InsertFromPdfBody({
  choices,
  pageCount,
  resolve,
}: {
  readonly choices: readonly { readonly docId: string; readonly name: string }[];
  readonly pageCount: number;
} & DialogAnswering<InsertFromPdfAnswer>): ReactElement {
  const { _ } = useLingui();
  const pickerId = useId();
  const [source, setSource] = useState(choices[0]?.docId ?? '');
  // DEFAULTS TO THE END, which is what a reader most often means and what makes
  // this dialog's relationship to merge visible: the same command, with the
  // position it would have chosen anyway.
  const [position, setPosition] = useState(String(pageCount + 1));

  const parsed = Number.parseInt(position, 10);
  const usable =
    source !== '' &&
    /^\d+$/u.test(position.trim()) &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= pageCount + 1;

  return (
    <div className="m-insert-from-pdf">
      <label className="m-insert-from-pdf__pick" htmlFor={pickerId}>
        {_(INSERT_FROM_PDF_LABEL)}
        <select
          id={pickerId}
          data-insert-pick="true"
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
      <Input
        label={INSERT_FROM_PDF_POSITION}
        value={position}
        onValueChange={setPosition}
      />
      <p className="m-insert-from-pdf__hint" role="status">
        {_(INSERT_FROM_PDF_RANGE, { last: pageCount + 1 })}
      </p>
      <Button
        label={INSERT_FROM_PDF_APPLY}
        variant="primary"
        disabled={!usable}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `DeletePagesBody`'s reason: this is the only place that can produce
          // a value and the schema behind `resolve` refuses a negative index.
          if (!usable) return;
          // THE ONE CONVERSION. 1-based on screen, 0-based on the wire.
          resolve({ source, at: parsed - 1 });
        }}
      />
    </div>
  );
}
