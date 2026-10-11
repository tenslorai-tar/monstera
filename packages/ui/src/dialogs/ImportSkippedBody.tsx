import { useLingui } from '@lingui/react';
import type { ComposeSkip, ImportSkippedPart } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  IMPORT_RESULT_MORE,
  IMPORT_SKIPPED_INTRO,
  IMPORT_SKIPPED_LINE,
  IMPORT_SKIPPED_PICTURE,
  IMPORT_SKIP_IMAGE_UNREADABLE,
  IMPORT_SKIP_QUOTE_INSIDE,
  IMPORT_SKIP_QUOTE_NEVER_CLOSED,
  IMPORT_SKIP_TEXT_AFTER_QUOTE,
  IMPORT_SKIP_TOO_MANY_PIXELS,
} from '../messages/en.js';

/** The sentence for each reason a part was left out. A Record, so a reason added to the contract is a compile error here. */
const REASON_MESSAGE: Readonly<Record<ComposeSkip['reason'], MessageKey>> = {
  'quote-never-closed': IMPORT_SKIP_QUOTE_NEVER_CLOSED,
  'text-after-quote': IMPORT_SKIP_TEXT_AFTER_QUOTE,
  'quote-inside-field': IMPORT_SKIP_QUOTE_INSIDE,
  'image-unreadable': IMPORT_SKIP_IMAGE_UNREADABLE,
  'too-many-pixels': IMPORT_SKIP_TOO_MANY_PIXELS,
};

/**
 * The body: each part left out, where it was — a line, or a file's own name shown as it is — and why. A default export
 * because `declareDialog` takes a `lazy()` component.
 */
export default function ImportSkippedBody({
  skipped,
  more,
}: {
  readonly skipped: readonly ImportSkippedPart[];
  readonly more: number;
}): ReactElement {
  const { _ } = useLingui();
  const where = (part: ImportSkippedPart): string =>
    // A FILE'S NAME IS THE PERSON'S OWN, shown as it is and never translated.
    part.line !== null ? _(IMPORT_SKIPPED_LINE, { line: part.line }) : (part.file ?? _(IMPORT_SKIPPED_PICTURE));
  return (
    <div className="m-import-result">
      <p>{_(IMPORT_SKIPPED_INTRO, { count: skipped.length + more })}</p>
      <ul className="m-dialog-list m-import-result__list">
        {skipped.map((part, at) => (
          <li className="m-import-result__row" data-skipped-part={part.line ?? part.file ?? ''} key={String(at)}>
            <span className="m-import-result__name">{where(part)}</span>
            <span className="m-import-result__reason">{_(REASON_MESSAGE[part.reason])}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p>{_(IMPORT_RESULT_MORE, { count: more })}</p> : null}
    </div>
  );
}
