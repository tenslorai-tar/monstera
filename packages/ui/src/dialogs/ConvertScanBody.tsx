import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  CONVERT_SCAN_EXCEL,
  CONVERT_SCAN_EXCEL_BUTTON,
  CONVERT_SCAN_INTRO,
  CONVERT_SCAN_SEARCHABLE,
  CONVERT_SCAN_SEARCHABLE_BUTTON,
  CONVERT_SCAN_WORD,
  CONVERT_SCAN_WORD_BUTTON,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ConvertScanAnswer } from './convertScanResult.js';

/** Each outcome, what it does in plain words, and the words on its button. */
const OUTCOMES: readonly { readonly outcome: ConvertScanAnswer['outcome']; readonly says: MessageKey; readonly button: MessageKey }[] = [
  { outcome: 'searchable', says: CONVERT_SCAN_SEARCHABLE, button: CONVERT_SCAN_SEARCHABLE_BUTTON },
  { outcome: 'word', says: CONVERT_SCAN_WORD, button: CONVERT_SCAN_WORD_BUTTON },
  { outcome: 'excel', says: CONVERT_SCAN_EXCEL, button: CONVERT_SCAN_EXCEL_BUTTON },
];

/**
 * The Convert scan dialog's body: three outcomes, each a sentence of what it does and one button that goes to it.
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ConvertScanBody({ resolve }: DialogAnswering<ConvertScanAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-convert-scan">
      <p>{_(CONVERT_SCAN_INTRO)}</p>
      <ul className="m-convert-scan__list">
        {OUTCOMES.map((entry) => (
          <li className="m-convert-scan__row" data-outcome={entry.outcome} key={entry.outcome}>
            <span className="m-convert-scan__says">{_(entry.says)}</span>
            <Button
              label={entry.button}
              onClick={() => {
                resolve({ outcome: entry.outcome });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
