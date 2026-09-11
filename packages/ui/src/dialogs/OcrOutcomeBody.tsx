import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  OCR_OUTCOME_NONE,
  OCR_OUTCOME_RECOGNISED,
  OCR_OUTCOME_SKIPPED,
  OCR_OUTCOME_STOPPED,
} from '../messages/en.js';

/**
 * What the recognition did.
 *
 * ## The NOTHING case is a sentence of its own, not a zero
 *
 * *Read the text on 0 pages* is true and useless. A document whose pages already
 * carry text has nothing to recognise, and that is the one outcome a reader cannot
 * see for themselves — so it gets the sentence and the counts are left out of it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function OcrOutcomeBody({
  recognised,
  skipped,
  stopped,
}: {
  readonly recognised: number;
  readonly skipped: number;
  readonly stopped: boolean;
}): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-ocr-outcome">
      {recognised === 0 && !stopped ? (
        <p>{_(OCR_OUTCOME_NONE)}</p>
      ) : (
        <p>{_(OCR_OUTCOME_RECOGNISED, { count: recognised })}</p>
      )}
      {/* THE SKIPPED COUNT ONLY WHERE THERE IS ONE, because *0 pages already had
          text* is a line that says nothing and pushes the line that does out of a
          reader's first glance. */}
      {skipped > 0 ? <p>{_(OCR_OUTCOME_SKIPPED, { count: skipped })}</p> : null}
      {stopped ? <p role="status">{_(OCR_OUTCOME_STOPPED)}</p> : null}
    </div>
  );
}
