import { useLingui } from '@lingui/react';
import { MAX_SIGNATURE_FIELD, type RequestedSignatureMark, SIGNATURE_FONTS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

import {
  SIGN_DOCUMENT_CLEAR,
  SIGN_DOCUMENT_FONT_COURIER,
  SIGN_DOCUMENT_FONT_HELVETICA,
  SIGN_DOCUMENT_FONT_TIMES,
  SIGN_DOCUMENT_FONT_TIMES_ITALIC,
  SIGN_DOCUMENT_KEPT_REMOVE,
  SIGN_DOCUMENT_MARK_MISSING,
  SIGNATURE_DRAW,
  SIGNATURE_KEPT,
  SIGNATURE_KEPT_NOTE,
  SIGNATURE_KEPT_USE,
  SIGNATURE_MAKE,
  SIGNATURE_NAME,
  SIGNATURE_PAD_HINT,
  SIGNATURE_PICTURE,
  SIGNATURE_PICTURE_MISSING,
  SIGNATURE_PICTURE_SHOWN,
  SIGNATURE_SAVE,
  SIGNATURE_SAVE_NOTE,
  SIGNATURE_STYLE,
  SIGNATURE_TOO_LONG,
  SIGNATURE_TYPE,
  SIGNATURE_UPLOAD,
  SIGNATURE_UPLOAD_CHOOSE,
  SIGNATURE_UPLOAD_CHOOSE_ANOTHER,
  SIGNATURE_UPLOAD_NOTE,
  SIGNATURE_USE,
} from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { KeptSignatureLook } from './KeptSignatureLook.js';
import type { HeldSignaturePicture, SignatureAnswers } from './signature.js';
import type { KeptSignature } from './signDocument.js';
import type { PadStroke } from './SignaturePad.js';
import { SignaturePad } from './SignaturePad.js';

/** The three ways to make a new signature, in the order the owner named them. */
type Way = 'draw' | 'type' | 'upload';

/** Each face's name, keyed on the contract's own list, so a face added there owes its words here. */
const FACES: Readonly<Record<(typeof SIGNATURE_FONTS)[number], MessageKey>> = {
  helvetica: SIGN_DOCUMENT_FONT_HELVETICA,
  'times-roman': SIGN_DOCUMENT_FONT_TIMES,
  'times-italic': SIGN_DOCUMENT_FONT_TIMES_ITALIC,
  courier: SIGN_DOCUMENT_FONT_COURIER,
};

/**
 * The plain Signature's dialog (ADR-0133), in the dialog pattern: the kept signatures first, for one-click reuse; then
 * a new one, drawn on a white pad, typed in a choice of faces, or a picture to upload; *Save for reuse*, ticked; and
 * the footer's Cancel and *Use Signature*.
 *
 * ## A kept signature is used by ONE click
 *
 * It answers at once with that look, and the person then clicks on the page. Nothing in the rows below applies to it:
 * it is already kept, so *Save for reuse* has nothing to do.
 *
 * ## An upload is previewed before it is placed
 *
 * *Choose picture…* is an answer: the opener asks main to pick and hold one, then asks again with it in `picked`, so the
 * picture shown here is the one main will place (ADR-0133's second correction). The renderer shows it by a `blob:`
 * address and names it by the handle main gave; it never holds a path.
 *
 * ## *Use Signature* waits for something to draw
 *
 * A drawn look needs a stroke, a typed one a name and an upload its picture. The button stays pressable, and once it
 * has been pressed the status line says what is missing (`attempt.ts`); switching to another way forgets the press,
 * since that way's empty field is one the person has not yet had a chance to fill.
 */
export default function SignatureBody({
  kept,
  picked,
  keep: keptChoice,
  resolve,
}: {
  readonly kept: readonly KeptSignature[];
  readonly picked?: HeldSignaturePicture | undefined;
  readonly keep?: boolean | undefined;
} & DialogAnswering<SignatureAnswers>): ReactElement {
  const { _ } = useLingui();
  const facesName = useId();
  const keepId = useId();
  // ASKED AGAIN WITH A PICTURE, the dialog opens where the person was: on Upload, showing it.
  const [way, setWay] = useState<Way>(picked === undefined ? 'draw' : 'upload');
  const [strokes, setStrokes] = useState<readonly PadStroke[]>([]);
  const [name, setName] = useState('');
  const [face, setFace] = useState<(typeof SIGNATURE_FONTS)[number]>('times-italic');
  // TICKED, the owner's default: a signature made here is usually one a person will place again.
  const [keep, setKeep] = useState(keptChoice ?? true);

  const tooLong = name.trim().length > MAX_SIGNATURE_FIELD;
  const attempt = useAttempt();
  /** The look to place, or `undefined` while the chosen way has nothing to draw. */
  const mark = ((): RequestedSignatureMark | undefined => {
    if (way === 'upload') return picked === undefined ? undefined : { kind: 'image', picked: picked.handle };
    if (way === 'draw') {
      return strokes.length === 0
        ? undefined
        : { kind: 'drawn', strokes: strokes.map((stroke) => stroke.map(([across, down]): [number, number] => [across, down])) };
    }
    const text = name.trim();
    return text.length === 0 || tooLong ? undefined : { kind: 'typed', text, font: face };
  })();

  return (
    <div className="m-signature">
      {kept.length === 0 ? null : (
        <div className="m-signature__kept-block">
          <DialogRow label={SIGNATURE_KEPT} note={SIGNATURE_KEPT_NOTE}>
            {null}
          </DialogRow>
          <ul className="m-signature__kept">
            {kept.map((entry, index) => (
              <li className="m-signature__kept-item" key={entry.id}>
                <button
                  aria-label={_(SIGNATURE_KEPT_USE, { number: index + 1 })}
                  className="m-signature__kept-use"
                  data-signature-kept={entry.id}
                  onClick={() => {
                    resolve({ mark: { kind: 'saved', id: entry.id }, keep: false });
                  }}
                  type="button"
                >
                  <KeptSignatureLook entry={entry} number={index + 1} />
                </button>
                <Button
                  label={SIGN_DOCUMENT_KEPT_REMOVE}
                  onClick={() => {
                    resolve({ library: 'remove', id: entry.id });
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogRow label={SIGNATURE_MAKE}>
        <SegmentedControl<Way>
          label={SIGNATURE_MAKE}
          onChange={(next) => {
            setWay(next);
            attempt.forget();
          }}
          options={[
            { value: 'draw', label: SIGNATURE_DRAW },
            { value: 'type', label: SIGNATURE_TYPE },
            { value: 'upload', label: SIGNATURE_UPLOAD },
          ]}
          value={way}
        />
      </DialogRow>

      {way === 'draw' ? (
        <div className="m-signature__pad">
          <SignaturePad onStrokesChange={setStrokes} strokes={strokes} />
          <div className="m-signature__under-pad">
            <span className="m-dialog-row__note">{_(SIGNATURE_PAD_HINT)}</span>
            <Button
              disabled={strokes.length === 0}
              label={SIGN_DOCUMENT_CLEAR}
              onClick={() => {
                setStrokes([]);
              }}
            />
          </div>
        </div>
      ) : null}

      {way === 'type' ? (
        <>
          <DialogRow label={SIGNATURE_NAME}>
            <Input invalid={tooLong} label={SIGNATURE_NAME} labelShownBeside onValueChange={setName} purpose="name" value={name} />
          </DialogRow>
          {/* THE FACES AS THEY WILL LOOK: each choice shows the name in that face, so a person picks a signature rather
              than a font's name. Radio rows in the pattern's shape, named by the row's heading. */}
          <div aria-labelledby={`${facesName}-heading`} className="m-dialog-choices" role="radiogroup">
            <div className="m-dialog-row__text" id={`${facesName}-heading`}>
              <span className="m-dialog-row__label">{_(SIGNATURE_STYLE)}</span>
            </div>
            {SIGNATURE_FONTS.map((each) => (
              <label className="m-dialog-choice" key={each}>
                <input
                  checked={face === each}
                  name={facesName}
                  onChange={() => {
                    setFace(each);
                  }}
                  type="radio"
                />
                <span className="m-dialog-row__text">
                  <span className={`m-signature__face m-sign-font--${each}`}>{name.trim() === '' ? _(FACES[each]) : name.trim()}</span>
                  <span className="m-dialog-row__note">{_(FACES[each])}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      ) : null}

      {way === 'upload' ? (
        <div className="m-signature__upload">
          <DialogRow label={SIGNATURE_PICTURE} note={SIGNATURE_UPLOAD_NOTE}>
            <Button
              label={picked === undefined ? SIGNATURE_UPLOAD_CHOOSE : SIGNATURE_UPLOAD_CHOOSE_ANOTHER}
              onClick={() => {
                resolve({ upload: 'pick', keep });
              }}
            />
          </DialogRow>
          {picked === undefined ? null : (
            <img
              alt={_(SIGNATURE_PICTURE_SHOWN, { name: picked.name })}
              className="m-signature__picture"
              data-signature-picture=""
              src={picked.src}
            />
          )}
        </div>
      ) : null}

      <DialogRow label={SIGNATURE_SAVE} note={SIGNATURE_SAVE_NOTE}>
        <input
          aria-label={_(SIGNATURE_SAVE)}
          checked={keep}
          data-signature-keep=""
          id={keepId}
          onChange={(event) => {
            setKeep(event.target.checked);
          }}
          type="checkbox"
        />
      </DialogRow>

      <p className="m-signature__problem" role="status">
        {tooLong
          ? _(SIGNATURE_TOO_LONG, { limit: MAX_SIGNATURE_FIELD })
          : mark === undefined && attempt.tried
            ? _(way === 'upload' ? SIGNATURE_PICTURE_MISSING : SIGN_DOCUMENT_MARK_MISSING)
            : ''}
      </p>
      <DialogFooter>
        <Button
          disabled={tooLong}
          label={SIGNATURE_USE}
          onClick={() => {
            attempt.attempt();
            if (mark === undefined) return;
            resolve({ mark, keep });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
