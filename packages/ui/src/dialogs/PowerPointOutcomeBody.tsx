import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  POWERPOINT_OUTCOME_FELL_BACK,
  POWERPOINT_OUTCOME_FELL_BACK_MORE,
  POWERPOINT_OUTCOME_NO_MODEL,
  POWERPOINT_OUTCOME_RECOGNISED,
} from '../messages/en.js';
import type { PowerPointOutcome } from './exportPowerPoint.js';

/**
 * What the PowerPoint export has to say after it wrote the file: which pages could not be made editable, by the numbers a
 * person counts them by, and that recognising scanned pages added words to the document
 * ([ADR-0210](../../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * Each sentence appears only where it is true, so a person is never told about a thing that did not happen. A default
 * export because `declareDialog` takes a `lazy()` component.
 */
export default function PowerPointOutcomeBody({
  fellBack,
  fellBackCount,
  recognised,
  noModel,
}: PowerPointOutcome): ReactElement {
  const { _ } = useLingui();
  // THE LISTED NUMBERS, joined here because a list is a sentence's business and a message has one `{pages}` to put it in.
  const pages = fellBack.join(', ');
  const unlisted = fellBackCount - fellBack.length;

  return (
    <div className="m-powerpoint-outcome">
      {fellBackCount > 0 ? (
        <p>
          {_(POWERPOINT_OUTCOME_FELL_BACK, { count: fellBackCount, pages })}
          {unlisted > 0 ? ` ${_(POWERPOINT_OUTCOME_FELL_BACK_MORE, { more: unlisted })}` : ''}
        </p>
      ) : null}
      {fellBackCount > 0 && noModel ? <p>{_(POWERPOINT_OUTCOME_NO_MODEL)}</p> : null}
      {recognised > 0 ? <p>{_(POWERPOINT_OUTCOME_RECOGNISED, { count: recognised })}</p> : null}
    </div>
  );
}
