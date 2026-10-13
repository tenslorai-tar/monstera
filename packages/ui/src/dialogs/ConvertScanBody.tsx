import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  CONVERT_SCAN_EXCEL,
  CONVERT_SCAN_EXCEL_BUTTON,
  CONVERT_SCAN_EXCEL_NAME,
  CONVERT_SCAN_INTRO,
  CONVERT_SCAN_SEARCHABLE,
  CONVERT_SCAN_SEARCHABLE_BUTTON,
  CONVERT_SCAN_SEARCHABLE_NAME,
  CONVERT_SCAN_WORD,
  CONVERT_SCAN_WORD_BUTTON,
  CONVERT_SCAN_WORD_NAME,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ConvertScanAnswer } from './convertScanResult.js';

/** Each outcome: what it is called, one short line of what it does, and the words on its button. */
const OUTCOMES: readonly {
  readonly outcome: ConvertScanAnswer['outcome'];
  readonly name: MessageKey;
  readonly says: MessageKey;
  readonly button: MessageKey;
}[] = [
  { outcome: 'searchable', name: CONVERT_SCAN_SEARCHABLE_NAME, says: CONVERT_SCAN_SEARCHABLE, button: CONVERT_SCAN_SEARCHABLE_BUTTON },
  { outcome: 'word', name: CONVERT_SCAN_WORD_NAME, says: CONVERT_SCAN_WORD, button: CONVERT_SCAN_WORD_BUTTON },
  { outcome: 'excel', name: CONVERT_SCAN_EXCEL_NAME, says: CONVERT_SCAN_EXCEL, button: CONVERT_SCAN_EXCEL_BUTTON },
];

/**
 * The Convert scan dialog's body: three outcomes, each a row of its own (the owner's N1) — its name, one short line,
 * and its button at the right with room between, never a button run on from the end of a sentence. A default export
 * because `declareDialog` takes a `lazy()` component.
 */
export default function ConvertScanBody({ resolve }: DialogAnswering<ConvertScanAnswer>): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-convert-scan">
      <p>{_(CONVERT_SCAN_INTRO)}</p>
      <ul className="m-convert-scan__list">
        {OUTCOMES.map((entry) => (
          <li className="m-convert-scan__row" data-outcome={entry.outcome} key={entry.outcome}>
            <span className="m-convert-scan__text">
              <strong className="m-convert-scan__name">{_(entry.name)}</strong>
              <span className="m-convert-scan__says">{_(entry.says)}</span>
            </span>
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
