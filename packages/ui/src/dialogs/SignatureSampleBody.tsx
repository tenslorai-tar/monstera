import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useState } from 'react';

import {
  SAMPLE_CANCEL,
  SAMPLE_SIGNATURE_CHOOSE,
  SAMPLE_SIGNATURE_DRAW,
  SAMPLE_SIGNATURE_HOW,
  SAMPLE_SIGNATURE_KEPT,
  SAMPLE_SIGNATURE_KEPT_NOTE,
  SAMPLE_SIGNATURE_NAME,
  SAMPLE_SIGNATURE_PICTURE,
  SAMPLE_SIGNATURE_PICTURE_NOTE,
  SAMPLE_SIGNATURE_SAVE,
  SAMPLE_SIGNATURE_SAVE_NOTE,
  SAMPLE_SIGNATURE_TYPE,
  SAMPLE_SIGNATURE_UPLOAD,
  SAMPLE_SIGNATURE_USE,
  SIGN_DOCUMENT_CLEAR,
  SIGN_DOCUMENT_FONT,
  SIGN_DOCUMENT_FONT_COURIER,
  SIGN_DOCUMENT_FONT_HELVETICA,
  SIGN_DOCUMENT_FONT_TIMES,
  SIGN_DOCUMENT_FONT_TIMES_ITALIC,
  SIGN_DOCUMENT_PAD,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { type PadStroke, SignaturePad } from './SignaturePad.js';
import type { SignatureSampleAnswer } from './signatureSample.js';

type Look = 'drawn' | 'typed' | 'picture';
type Face = 'helvetica' | 'times-roman' | 'times-italic' | 'courier';

const FACES: readonly { readonly value: Face; readonly label: MessageKey }[] = [
  { value: 'helvetica', label: SIGN_DOCUMENT_FONT_HELVETICA },
  { value: 'times-roman', label: SIGN_DOCUMENT_FONT_TIMES },
  { value: 'times-italic', label: SIGN_DOCUMENT_FONT_TIMES_ITALIC },
  { value: 'courier', label: SIGN_DOCUMENT_FONT_COURIER },
];

/** A stroke that reads as a signature in the sample's screenshot: a loop and a tail, in the pad's own unit. */
const RAW_STROKES: readonly PadStroke[] = [
  [
    [0.12, 0.62], [0.16, 0.38], [0.22, 0.3], [0.27, 0.42], [0.24, 0.58], [0.3, 0.6], [0.36, 0.44],
    [0.4, 0.52], [0.46, 0.4], [0.5, 0.56], [0.56, 0.42], [0.62, 0.55], [0.7, 0.4], [0.78, 0.5], [0.88, 0.44],
  ],
  [
    [0.2, 0.72], [0.45, 0.7], [0.7, 0.68], [0.86, 0.66],
  ],
];
// THE PAD IS 3:1 and its unit is its width, so a y must stay under a third: drawn at 0.45 of the sketch's height.
const SAMPLE_STROKES: readonly PadStroke[] = RAW_STROKES.map((stroke) => stroke.map(([x, y]) => [x, y * 0.45] as const));

/**
 * SAMPLE (item 10, never committed): the plain Signature dialog of item 5 in the dialog pattern — Draw, Type or Upload,
 * *Save for reuse* ticked by default, and Cancel · Use Signature at the foot. It answers nothing real; it exists to be
 * looked at.
 */
export default function SignatureSampleBody({ resolve }: DialogAnswering<SignatureSampleAnswer>): ReactElement {
  const { _ } = useLingui();
  const [look, setLook] = useState<Look>('drawn');
  const [strokes, setStrokes] = useState<readonly PadStroke[]>(SAMPLE_STROKES);
  const [name, setName] = useState('Grace Hopper');
  const [face, setFace] = useState<Face>('times-italic');
  const [save, setSave] = useState(true);

  return (
    <div className="m-signature-sample">
      <DialogRow label={SAMPLE_SIGNATURE_HOW}>
        {() => (
          <SegmentedControl<Look>
            label={SAMPLE_SIGNATURE_HOW}
            options={[
              { value: 'drawn', label: SAMPLE_SIGNATURE_DRAW },
              { value: 'typed', label: SAMPLE_SIGNATURE_TYPE },
              { value: 'picture', label: SAMPLE_SIGNATURE_UPLOAD },
            ]}
            value={look}
            onChange={setLook}
          />
        )}
      </DialogRow>
      {look === 'drawn' ? (
        <div className="m-signature-sample__pad">
          <SignaturePad strokes={strokes} onStrokesChange={setStrokes} />
          <div className="m-signature-sample__under">
            <span className="m-dialog-row__note">{_(SIGN_DOCUMENT_PAD)}</span>
            <Button
              label={SIGN_DOCUMENT_CLEAR}
              onClick={() => {
                setStrokes([]);
              }}
            />
          </div>
        </div>
      ) : null}
      {look === 'typed' ? (
        <>
          <DialogRow label={SAMPLE_SIGNATURE_NAME}>
            {() => <Input label={SAMPLE_SIGNATURE_NAME} labelShownBeside value={name} onValueChange={setName} />}
          </DialogRow>
          <DialogRow label={SIGN_DOCUMENT_FONT}>
            {() => <SegmentedControl<Face> label={SIGN_DOCUMENT_FONT} options={FACES} value={face} onChange={setFace} wrap />}
          </DialogRow>
          <p className={`m-signature-sample__typed m-signature-sample__typed--${face}`}>{name}</p>
        </>
      ) : null}
      {look === 'picture' ? (
        <DialogRow label={SAMPLE_SIGNATURE_PICTURE} note={SAMPLE_SIGNATURE_PICTURE_NOTE}>
          {() => <Button label={SAMPLE_SIGNATURE_CHOOSE} onClick={() => undefined} />}
        </DialogRow>
      ) : null}
      <DialogRow label={SAMPLE_SIGNATURE_KEPT} note={SAMPLE_SIGNATURE_KEPT_NOTE}>
        {() => <span className="m-signature-sample__kept">—</span>}
      </DialogRow>
      <DialogRow label={SAMPLE_SIGNATURE_SAVE} note={SAMPLE_SIGNATURE_SAVE_NOTE}>
        {(labelId) => (
          <input
            aria-labelledby={labelId}
            checked={save}
            className="m-switch"
            onChange={(event) => {
              setSave(event.target.checked);
            }}
            role="switch"
            type="checkbox"
          />
        )}
      </DialogRow>
      <DialogFooter cancelLabel={SAMPLE_CANCEL}>
        <Button
          label={SAMPLE_SIGNATURE_USE}
          variant="primary"
          onClick={() => {
            resolve({ look });
          }}
        />
      </DialogFooter>
    </div>
  );
}
