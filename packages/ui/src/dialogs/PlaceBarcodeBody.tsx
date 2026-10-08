import { useLingui } from '@lingui/react';
import type { BARCODE_FORMATS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  PLACE_BARCODE_APPLY,
  PLACE_BARCODE_AZTEC,
  PLACE_BARCODE_CODE128,
  PLACE_BARCODE_DATA_MATRIX,
  PLACE_BARCODE_EAN13,
  PLACE_BARCODE_EMPTY,
  PLACE_BARCODE_FORMAT,
  PLACE_BARCODE_PDF417,
  PLACE_BARCODE_QR,
  PLACE_BARCODE_REFUSED,
  PLACE_BARCODE_TEXT,
} from '../messages/en.js';
import { attemptProblem, useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { TextArea } from '../primitives/Input.js';
import { Problem } from '../primitives/Problem.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { PlaceBarcodeAnswer } from './placeBarcode.js';

type Format = (typeof BARCODE_FORMATS)[number];

/**
 * Each symbology and the words a person reads for it, as a record so a format added to the
 * contract arrives owing its words. The order is the record's: two-dimensional codes first,
 * because a link or a sentence is what most people are placing.
 */
const FORMATS: Readonly<Record<Format, MessageKey>> = {
  QRCode: PLACE_BARCODE_QR,
  DataMatrix: PLACE_BARCODE_DATA_MATRIX,
  Aztec: PLACE_BARCODE_AZTEC,
  PDF417: PLACE_BARCODE_PDF417,
  Code128: PLACE_BARCODE_CODE128,
  EAN13: PLACE_BARCODE_EAN13,
};

/**
 * The place-barcode dialog's body: the text, the type, and — when main refused the last try —
 * why nothing was added, with that try filled in.
 *
 * *Add* with no text adds nothing and says so, because an empty barcode is no symbol at all and
 * the result schema refuses it (`attempt.ts`: said once pressed, not on opening).
 */
export default function PlaceBarcodeBody({
  refused,
  resolve,
}: { readonly refused?: PlaceBarcodeAnswer | undefined } & DialogAnswering<PlaceBarcodeAnswer>): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState(refused?.text ?? '');
  const [format, setFormat] = useState<Format>(refused?.format ?? 'QRCode');
  const attempt = useAttempt();
  // NOTHING TYPED is said once Add is pressed (`attempt.ts`). Whether the text fits the type is main's to decide, and
  // said by the refused state above.
  const problem = attemptProblem(attempt, undefined, text.length === 0, PLACE_BARCODE_EMPTY);

  return (
    <div className="m-place-barcode">
      {refused === undefined ? null : <Problem message={_(PLACE_BARCODE_REFUSED)} />}
      {/* THE PRIMITIVE'S MULTI-LINE FIELD, as every dialog's: a textarea of its own drew a resize corner, a thicker
          border and cramped text beside the other fields (the gallery, 2026-10-03). */}
      <DialogRow label={PLACE_BARCODE_TEXT} problem={problem === undefined ? undefined : _(problem)}>
        <TextArea
          invalid={problem !== undefined}
          label={PLACE_BARCODE_TEXT}
          labelShownBeside
          onValueChange={setText}
          opensFocused
          value={text}
        />
      </DialogRow>
      {/* NATIVE RADIOS IN A NAMED GROUP, the row's words naming it: four formats, each a word. */}
      <DialogRow label={PLACE_BARCODE_FORMAT}>
        <div aria-label={_(PLACE_BARCODE_FORMAT)} className="m-place-barcode__formats" role="radiogroup">
          {(Object.keys(FORMATS) as Format[]).map((each) => (
            <label key={each}>
              <input
                type="radio"
                name="place-barcode-format"
                checked={format === each}
                onChange={() => {
                  setFormat(each);
                }}
              />
              {_(FORMATS[each])}
            </label>
          ))}
        </div>
      </DialogRow>
      <DialogFooter>
        <Button
          label={PLACE_BARCODE_APPLY}
          variant="primary"
          onClick={() => {
            attempt.attempt();
            // GUARDED: the result schema refuses empty text, so a mismatch would throw `DialogResultRejected`.
            if (text.length === 0) return;
            resolve({ text, format });
          }}
        />
      </DialogFooter>
    </div>
  );
}
