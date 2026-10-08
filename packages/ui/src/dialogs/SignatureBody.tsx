import { useLingui } from '@lingui/react';
import { type ChosenSignatureMark, MAX_SIGNATURE_FIELD, type SignatureFont } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useId, useRef, useState } from 'react';

import {
  SIGN_DOCUMENT_CLEAR,
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
import { Problem } from '../primitives/Problem.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { DEFAULT_SIGNATURE_FONT } from '../signatureFaces.js';
import { TypedSignatureFields, typedNameProblem, useSignatureFaces, useTypedName } from './TypedSignature.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { KeptSignatureLook } from './KeptSignatureLook.js';
import type { HeldSignaturePicture, SignatureAnswers } from './signature.js';
import type { KeptSignature } from './signDocument.js';
import type { PadStroke } from './SignaturePad.js';
import { SignaturePad } from './SignaturePad.js';

/** The three ways to make a new signature, in the order the owner named them. */
type Way = 'draw' | 'type' | 'upload';

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
 *
 * ## A typed name its style cannot write is said as it is typed
 *
 * The style's own character map decides (ADR-0150 Decision 5), and the status line names the characters while the
 * person can still change the name or the style; the list of styles says the same of each one. Nothing is drawn in a
 * missing letter's place, so *Use Signature* has nothing to place until the name and the style agree.
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
  const keepId = useId();
  /** The signature's own fields (the pad, the typed name or the picture button), which a refusal about the look is about. */
  const markFields = useRef<HTMLDivElement>(null);
  const faces = useSignatureFaces();
  // ASKED AGAIN WITH A PICTURE, the dialog opens where the person was: on Upload, showing it.
  const [way, setWay] = useState<Way>(picked === undefined ? 'draw' : 'upload');
  const [strokes, setStrokes] = useState<readonly PadStroke[]>([]);
  const [name, setName] = useState('');
  const [face, setFace] = useState<SignatureFont>(DEFAULT_SIGNATURE_FONT);
  // TICKED, the owner's default: a signature made here is usually one a person will place again.
  const [keep, setKeep] = useState(keptChoice ?? true);

  const tooLong = name.trim().length > MAX_SIGNATURE_FIELD;
  const attempt = useAttempt();
  // THE NAME SET IN THE CHOSEN FACE — what the preview shows and what decides whether there is a mark to place.
  const typed = useTypedName(faces, face, name.trim());
  /** The look to place, or `undefined` while the chosen way has nothing to draw. */
  const mark = ((): ChosenSignatureMark | undefined => {
    if (way === 'upload') return picked === undefined ? undefined : { kind: 'image', picked: picked.handle };
    if (way === 'draw') {
      return strokes.length === 0
        ? undefined
        : { kind: 'drawn', strokes: strokes.map((stroke) => stroke.map(([across, down]): [number, number] => [across, down])) };
    }
    const text = name.trim();
    return text.length === 0 || tooLong || typed?.kind !== 'outline' ? undefined : { kind: 'typed', text, font: face };
  })();
  // WHAT THE CHOSEN FACE CANNOT DO WITH WHAT WAS TYPED, said as soon as it is typed: the person has acted, and the list
  // beside it already says the same of every face.
  const facing = way === 'type' && name.trim() !== '' && typed !== undefined ? typedNameProblem(typed) : undefined;

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

      <div ref={markFields}>
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
        <TypedSignatureFields
          face={face}
          faces={faces}
          invalid={tooLong || facing !== undefined}
          label={SIGNATURE_NAME}
          onFaceChange={setFace}
          onTextChange={setName}
          text={name}
        />
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
      </div>

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

      <Problem
        about={{ within: markFields }}
        focusField={!tooLong && facing === undefined && mark === undefined && attempt.tried}
        message={
          tooLong
            ? _(SIGNATURE_TOO_LONG, { limit: MAX_SIGNATURE_FIELD })
            : facing !== undefined
              ? _(facing.message, facing.values)
              : mark === undefined && attempt.tried
                ? _(way === 'upload' ? SIGNATURE_PICTURE_MISSING : SIGN_DOCUMENT_MARK_MISSING)
                : undefined
        }
        reserve
      />
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
