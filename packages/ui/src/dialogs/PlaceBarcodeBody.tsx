import { useLingui } from '@lingui/react';
import type { BARCODE_FORMATS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

import {
  PLACE_BARCODE_APPLY,
  PLACE_BARCODE_AZTEC,
  PLACE_BARCODE_CODE128,
  PLACE_BARCODE_DATA_MATRIX,
  PLACE_BARCODE_EAN13,
  PLACE_BARCODE_FORMAT,
  PLACE_BARCODE_PDF417,
  PLACE_BARCODE_QR,
  PLACE_BARCODE_REFUSED,
  PLACE_BARCODE_TEXT,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
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
 * *Add* is disabled until there is text, because an empty barcode is no symbol at all and the
 * result schema refuses it.
 */
export default function PlaceBarcodeBody({
  refused,
  resolve,
}: { readonly refused?: PlaceBarcodeAnswer | undefined } & DialogAnswering<PlaceBarcodeAnswer>): ReactElement {
  const { _ } = useLingui();
  const textId = useId();
  const [text, setText] = useState(refused?.text ?? '');
  const [format, setFormat] = useState<Format>(refused?.format ?? 'QRCode');

  return (
    <div className="m-place-barcode">
      {refused === undefined ? null : (
        <p className="m-place-barcode__refused" role="alert">
          {_(PLACE_BARCODE_REFUSED)}
        </p>
      )}
      <label htmlFor={textId}>{_(PLACE_BARCODE_TEXT)}</label>
      <textarea
        id={textId}
        className="m-place-barcode__text"
        value={text}
        rows={3}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <fieldset className="m-place-barcode__formats">
        <legend>{_(PLACE_BARCODE_FORMAT)}</legend>
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
      </fieldset>
      <Button
        label={PLACE_BARCODE_APPLY}
        variant="primary"
        disabled={text.length === 0}
        onClick={() => {
          resolve({ text, format });
        }}
      />
    </div>
  );
}
