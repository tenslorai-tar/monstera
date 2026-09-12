import { useLingui } from '@lingui/react';
import { PDF_SANITIZE_PARTS, type PdfSanitizePart } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  SANITIZE_DOCUMENT_APPLY,
  SANITIZE_DOCUMENT_EMPTY,
  SANITIZE_DOCUMENT_EXPLAINS,
  SANITIZE_PART_EMBEDDED_FILES,
  SANITIZE_PART_EXTERNAL_ACTIONS,
  SANITIZE_PART_FLATTEN,
  SANITIZE_PART_JAVASCRIPT,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SanitizeDocumentAnswer } from './sanitizeDocument.js';

/** Each part's own words, exhaustive over the contract's list. */
const PART_TITLES: Readonly<Record<PdfSanitizePart, MessageKey>> = {
  javascript: SANITIZE_PART_JAVASCRIPT,
  'embedded-files': SANITIZE_PART_EMBEDDED_FILES,
  'external-actions': SANITIZE_PART_EXTERNAL_ACTIONS,
  flatten: SANITIZE_PART_FLATTEN,
};

/**
 * Choose what a sanitise takes out.
 *
 * ## Everything is ticked, and a cleared box means *leave this in*
 *
 * The opposite way round from the protection dialog's permissions, and
 * deliberately: there the default grants and a tick withholds, because an
 * unprotected document already grants everything. Here the command's name
 * promises removal, so the default removes and clearing a box is the decision.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SanitizeDocumentBody({
  resolve,
}: DialogAnswering<SanitizeDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const [parts, setParts] = useState<readonly PdfSanitizePart[]>(PDF_SANITIZE_PARTS);

  const usable = parts.length > 0;

  return (
    <div className="m-sanitize-document">
      <fieldset className="m-sanitize-document__parts">
        <legend>{_(SANITIZE_DOCUMENT_EXPLAINS)}</legend>
        {PDF_SANITIZE_PARTS.map((part) => (
          <label key={part}>
            <input
              checked={parts.includes(part)}
              data-sanitize-part={part}
              onChange={(event) => {
                setParts((current) =>
                  event.target.checked
                    ? [...current, part]
                    : current.filter((held) => held !== part),
                );
              }}
              type="checkbox"
            />
            {_(PART_TITLES[part])}
          </label>
        ))}
      </fieldset>

      <p className="m-sanitize-document__problem" role="status">
        {usable ? '' : _(SANITIZE_DOCUMENT_EMPTY)}
      </p>
      <Button
        disabled={!usable}
        label={SANITIZE_DOCUMENT_APPLY}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute: the
          // result schema refuses an empty list, so a mismatch would throw
          // `DialogResultRejected` over the user's document.
          if (!usable) return;
          resolve({ parts: [...parts] });
        }}
        variant="primary"
      />
    </div>
  );
}
