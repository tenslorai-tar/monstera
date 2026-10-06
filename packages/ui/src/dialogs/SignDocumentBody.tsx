import { useLingui } from '@lingui/react';
import type { ChosenSignatureMark, SignatureFont } from '@monstera/contract';
import { DOCUMENT_PASSWORD_MAX_CHARS, MAX_SIGNATURE_FIELD, TIMESTAMP_AUTHORITY_IDS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

import {
  SIGN_DOCUMENT_APPLY,
  SIGN_DOCUMENT_CERTIFY,
  SIGN_DOCUMENT_CERTIFY_COMMENTS,
  SIGN_DOCUMENT_CERTIFY_FORMS,
  SIGN_DOCUMENT_CERTIFY_LOCKED,
  SIGN_DOCUMENT_CERTIFY_NONE,
  SIGN_DOCUMENT_TIMESTAMP,
  SIGN_DOCUMENT_TIMESTAMP_DIGICERT,
  SIGN_DOCUMENT_TIMESTAMP_GLOBALSIGN,
  SIGN_DOCUMENT_TIMESTAMP_NONE,
  SIGN_DOCUMENT_TIMESTAMP_NOTE,
  SIGN_DOCUMENT_TIMESTAMP_SECTIGO,
  SIGN_DOCUMENT_CLEAR,
  SIGN_DOCUMENT_CONTACT,
  SIGN_DOCUMENT_EXPLAINS,
  SIGN_DOCUMENT_IMAGE_NOTE,
  SIGN_DOCUMENT_LOCATION,
  SIGN_DOCUMENT_LOOK,
  SIGN_DOCUMENT_LOOK_DRAWN,
  SIGN_DOCUMENT_LOOK_IMAGE,
  SIGN_DOCUMENT_LOOK_KEPT,
  SIGN_DOCUMENT_LOOK_TYPED,
  SIGN_DOCUMENT_KEEP,
  SIGN_DOCUMENT_KEPT_ADD,
  SIGN_DOCUMENT_KEPT_EMPTY,
  SIGN_DOCUMENT_KEPT_REMOVE,
  SIGN_DOCUMENT_MARK_MISSING,
  SIGN_DOCUMENT_NAME,
  SIGN_DOCUMENT_PASSPHRASE,
  SIGN_DOCUMENT_REASON,
  SIGN_DOCUMENT_TEXT,
  SIGN_DOCUMENT_TOO_LONG,
} from '../messages/en.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { DEFAULT_SIGNATURE_FONT } from '../signatureFaces.js';
import { KeptSignatureLook } from './KeptSignatureLook.js';
import { TypedSignatureFields, typedNameProblem, useSignatureFaces, useTypedName } from './TypedSignature.js';
import type { KeptSignature, SignDocumentAnswers } from './signDocument.js';
import type { PadStroke } from './SignaturePad.js';
import { SignaturePad } from './SignaturePad.js';

/**
 * What this dialog offers on the certification axis.
 *
 * **`approve` is a member rather than an absent value**, because *sign this*
 * and *certify this* are two claims a person chooses between, and a control
 * whose first option is blank asks them to notice an absence. The command maps
 * it back to an omitted field, which is what the payload means by *not a
 * certification*.
 */
const CERTIFY_CHOICES = [
  'approve',
  'no-changes',
  'form-fill',
  'form-fill-and-annotate',
] as const;

/** One of {@link CERTIFY_CHOICES}. */
type CertifyChoice = (typeof CERTIFY_CHOICES)[number];

/** Each choice's own words, exhaustive over the list. */
const CERTIFY_TITLES: Readonly<Record<CertifyChoice, MessageKey>> = {
  approve: SIGN_DOCUMENT_CERTIFY_NONE,
  'no-changes': SIGN_DOCUMENT_CERTIFY_LOCKED,
  'form-fill': SIGN_DOCUMENT_CERTIFY_FORMS,
  'form-fill-and-annotate': SIGN_DOCUMENT_CERTIFY_COMMENTS,
};

/**
 * What the timestamp control offers: no timestamp, then the contract's authorities
 * in the contract's order.
 *
 * `none` is the dialog's own member and never reaches the wire — it becomes an
 * absent field, for `approve`'s reason above.
 */
const TIMESTAMP_CHOICES = ['none', ...TIMESTAMP_AUTHORITY_IDS] as const;

/** One of {@link TIMESTAMP_CHOICES}. */
type TimestampChoice = (typeof TIMESTAMP_CHOICES)[number];

/** Each choice's title, keyed on the contract's ids so an authority added there needs one here. */
const TIMESTAMP_TITLES: Readonly<Record<TimestampChoice, MessageKey>> = {
  none: SIGN_DOCUMENT_TIMESTAMP_NONE,
  digicert: SIGN_DOCUMENT_TIMESTAMP_DIGICERT,
  globalsign: SIGN_DOCUMENT_TIMESTAMP_GLOBALSIGN,
  sectigo: SIGN_DOCUMENT_TIMESTAMP_SECTIGO,
};

/**
 * The three looks a visible signature can take, in the order offered.
 *
 * **Typed first**, because it is the one a person can complete from the
 * keyboard alone; the pad has no keyboard equivalent.
 */
const LOOKS = ['typed', 'drawn', 'image', 'saved'] as const satisfies readonly ChosenSignatureMark['kind'][];

type Look = (typeof LOOKS)[number];

const LOOK_TITLES: Readonly<Record<Look, MessageKey>> = {
  typed: SIGN_DOCUMENT_LOOK_TYPED,
  drawn: SIGN_DOCUMENT_LOOK_DRAWN,
  image: SIGN_DOCUMENT_LOOK_IMAGE,
  saved: SIGN_DOCUMENT_LOOK_KEPT,
};

/**
 * Collect what a signature carries, and say where the certificate comes from.
 *
 * ## No field for the certificate, and a sentence instead
 *
 * Main picks it. A person pressing *Sign* and meeting an unexpected file dialog
 * is a surprise one sentence avoids, and the sentence is also the honest
 * description of why there is no field: the renderer never holds a private key.
 * A picture of a signature is the same — main picks it — and gets its own
 * sentence for the same reason.
 *
 * ## `Sign` refuses for exactly one reason besides length
 *
 * An invisible signature has no required field — the passphrase may be empty,
 * because many certificates have none. A VISIBLE one needs something to draw:
 * a placement answered with no text and no strokes would put a blank box on the
 * page, so *Sign* signs nothing until the chosen look has content. It stays
 * pressable, and the status line says what is missing once it has been pressed
 * (`attempt.ts`); a field typed past its bound is said at once and disables it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignDocumentBody({
  placed,
  kept,
  resolve,
}: { readonly placed: boolean; readonly kept: readonly KeptSignature[] } & DialogAnswering<SignDocumentAnswers>): ReactElement {
  const { _ } = useLingui();
  const [certify, setCertify] = useState<CertifyChoice>('approve');
  // NO TIMESTAMP TO BEGIN WITH, and that is a decision rather than a default: a
  // timestamp sends a fingerprint of the signature to a third party, which is a
  // person's choice to make with the note beside the control in front of them.
  const [timestamp, setTimestamp] = useState<TimestampChoice>('none');
  const [passphrase, setPassphrase] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  // A KEPT SIGNATURE FIRST when there is one: a person who kept one kept it to use it.
  const [look, setLook] = useState<Look>(kept.length > 0 ? 'saved' : 'typed');
  const [text, setText] = useState('');
  const [font, setFont] = useState<SignatureFont>(DEFAULT_SIGNATURE_FONT);
  const faces = useSignatureFaces();
  const [strokes, setStrokes] = useState<readonly PadStroke[]>([]);
  const [chosenKept, setChosenKept] = useState<string | undefined>(kept[0]?.id);
  const [keep, setKeep] = useState(false);
  const keepId = useId();

  // WHICH FIELD IS TOO LONG, not only whether one is (WCAG 3.3.1): the first, by its own label, which the sentence
  // names and whose field is marked invalid.
  const tooLong = (
    [
      [SIGN_DOCUMENT_PASSPHRASE, passphrase.length > DOCUMENT_PASSWORD_MAX_CHARS],
      [SIGN_DOCUMENT_TEXT, text.length > MAX_SIGNATURE_FIELD],
      [SIGN_DOCUMENT_NAME, name.length > MAX_SIGNATURE_FIELD],
      [SIGN_DOCUMENT_REASON, reason.length > MAX_SIGNATURE_FIELD],
      [SIGN_DOCUMENT_LOCATION, location.length > MAX_SIGNATURE_FIELD],
      [SIGN_DOCUMENT_CONTACT, contactInfo.length > MAX_SIGNATURE_FIELD],
    ] as const
  ).find(([, long]) => long)?.[0];
  const over = tooLong !== undefined;

  // THE NAME SET IN THE CHOSEN FACE, as the plain Signature's dialog sets it (ADR-0150).
  const typed = useTypedName(faces, font, text.trim());
  const facing = placed && look === 'typed' && text.trim() !== '' && typed !== undefined ? typedNameProblem(typed) : undefined;

  /** The look as the person chose it, or `undefined` when it has nothing to draw. */
  const mark = ((): ChosenSignatureMark | undefined => {
    if (look === 'image') return { kind: 'image' };
    if (look === 'saved') return chosenKept === undefined ? undefined : { kind: 'saved', id: chosenKept };
    if (look === 'drawn') {
      return strokes.length > 0
        ? {
            kind: 'drawn',
            strokes: strokes.map((stroke) => stroke.map(([across, down]): [number, number] => [across, down])),
          }
        : undefined;
    }
    return text.trim().length > 0 && typed?.kind === 'outline' ? { kind: 'typed', text: text.trim(), font } : undefined;
  })();
  const missing = placed && mark === undefined;
  const attempt = useAttempt();

  /** A trimmed field, or `undefined` when it holds nothing a reader would show. */
  const stated = (value: string): { readonly value: string } | undefined =>
    value.trim().length > 0 ? { value: value.trim() } : undefined;

  return (
    <div className="m-sign-document">
      <p className="m-sign-document__note">{_(SIGN_DOCUMENT_EXPLAINS)}</p>

      {placed ? (
        <div className="m-sign-document__look">
          <DialogRow label={SIGN_DOCUMENT_LOOK}>
            <select
              aria-label={_(SIGN_DOCUMENT_LOOK)}
              data-sign-look=""
              onChange={(event) => {
                setLook(event.target.value as Look);
                attempt.forget();
              }}
              value={look}
            >
              {LOOKS.map((choice) => (
                <option key={choice} value={choice}>
                  {_(LOOK_TITLES[choice])}
                </option>
              ))}
            </select>
          </DialogRow>

          {look === 'typed' ? (
            <TypedSignatureFields
              face={font}
              faces={faces}
              invalid={tooLong === SIGN_DOCUMENT_TEXT || facing !== undefined}
              label={SIGN_DOCUMENT_TEXT}
              onFaceChange={setFont}
              onTextChange={setText}
              text={text}
            />
          ) : null}

          {look === 'drawn' ? (
            <>
              <SignaturePad onStrokesChange={setStrokes} strokes={strokes} />
              <Button
                disabled={strokes.length === 0}
                label={SIGN_DOCUMENT_CLEAR}
                onClick={() => {
                  setStrokes([]);
                }}
              />
            </>
          ) : null}

          {look === 'image' ? (
            <p className="m-sign-document__note">{_(SIGN_DOCUMENT_IMAGE_NOTE)}</p>
          ) : null}

          {look === 'typed' || look === 'drawn' ? (
            <label className="m-sign-document__keep" htmlFor={keepId}>
              <input
                id={keepId}
                type="checkbox"
                data-sign-keep=""
                checked={keep}
                onChange={(event) => {
                  setKeep(event.target.checked);
                }}
              />
              {_(SIGN_DOCUMENT_KEEP)}
            </label>
          ) : null}

          {look === 'saved' ? (
            <fieldset className="m-sign-document__kept">
              <legend>{_(SIGN_DOCUMENT_LOOK_KEPT)}</legend>
              {kept.length === 0 ? <p className="m-sign-document__note">{_(SIGN_DOCUMENT_KEPT_EMPTY)}</p> : null}
              {kept.map((entry, index) => (
                <div key={entry.id} className="m-sign-document__kept-row">
                  <label className="m-sign-document__kept-choice" data-sign-kept={entry.id}>
                    <input
                      type="radio"
                      name="sign-kept"
                      checked={chosenKept === entry.id}
                      onChange={() => {
                        setChosenKept(entry.id);
                      }}
                    />
                    <KeptSignatureLook entry={entry} number={index + 1} />
                  </label>
                  <Button
                    label={SIGN_DOCUMENT_KEPT_REMOVE}
                    onClick={() => {
                      resolve({ library: 'remove', id: entry.id });
                    }}
                  />
                </div>
              ))}
              <Button
                label={SIGN_DOCUMENT_KEPT_ADD}
                onClick={() => {
                  resolve({ library: 'add' });
                }}
              />
            </fieldset>
          ) : null}
        </div>
      ) : null}

      <DialogRow label={SIGN_DOCUMENT_PASSPHRASE}>
        <Input
          invalid={tooLong === SIGN_DOCUMENT_PASSPHRASE}
          label={SIGN_DOCUMENT_PASSPHRASE}
          labelShownBeside
          onValueChange={setPassphrase}
          secret
          value={passphrase}
        />
      </DialogRow>
      {/* THE SIGNER'S OWN NAME, so the browser's fill-in can offer it (WCAG 1.3.5). */}
      <DialogRow label={SIGN_DOCUMENT_NAME}>
        <Input
          invalid={tooLong === SIGN_DOCUMENT_NAME}
          label={SIGN_DOCUMENT_NAME}
          labelShownBeside
          onValueChange={setName}
          purpose="name"
          value={name}
        />
      </DialogRow>
      <DialogRow label={SIGN_DOCUMENT_REASON}>
        <Input invalid={tooLong === SIGN_DOCUMENT_REASON} label={SIGN_DOCUMENT_REASON} labelShownBeside onValueChange={setReason} value={reason} />
      </DialogRow>
      <DialogRow label={SIGN_DOCUMENT_LOCATION}>
        <Input
          invalid={tooLong === SIGN_DOCUMENT_LOCATION}
          label={SIGN_DOCUMENT_LOCATION}
          labelShownBeside
          onValueChange={setLocation}
          value={location}
        />
      </DialogRow>
      <DialogRow label={SIGN_DOCUMENT_CONTACT}>
        <Input
          invalid={tooLong === SIGN_DOCUMENT_CONTACT}
          label={SIGN_DOCUMENT_CONTACT}
          labelShownBeside
          onValueChange={setContactInfo}
          value={contactInfo}
        />
      </DialogRow>

      <DialogRow label={SIGN_DOCUMENT_CERTIFY}>
        {/* A NATIVE `<select>`, for `DocumentChoice`'s reason: §9.27's pinned
            CSP admits no inline style, so the primitive set has no select. */}
        <select
          aria-label={_(SIGN_DOCUMENT_CERTIFY)}
          data-sign-certify=""
          onChange={(event) => {
            setCertify(event.target.value as CertifyChoice);
          }}
          value={certify}
        >
          {CERTIFY_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {_(CERTIFY_TITLES[choice])}
            </option>
          ))}
        </select>
      </DialogRow>

      <DialogRow label={SIGN_DOCUMENT_TIMESTAMP}>
        {/* A NATIVE `<select>`, for the certify control's reason above. */}
        <select
          aria-label={_(SIGN_DOCUMENT_TIMESTAMP)}
          data-sign-timestamp=""
          onChange={(event) => {
            setTimestamp(event.target.value as TimestampChoice);
          }}
          value={timestamp}
        >
          {TIMESTAMP_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {_(TIMESTAMP_TITLES[choice])}
            </option>
          ))}
        </select>
      </DialogRow>
      {/* THE SENTENCE ADR-0058 Decision 1 PROMISED, on screen beside the choice:
          what leaves the machine, and what an observer on the network learns. */}
      <p className="m-sign-document__note">{_(SIGN_DOCUMENT_TIMESTAMP_NOTE)}</p>

      <p className="m-sign-document__problem" role="status">
        {tooLong !== undefined
          ? _(SIGN_DOCUMENT_TOO_LONG, { field: _(tooLong) })
          : facing !== undefined
            ? _(facing.message, facing.values)
            : missing && attempt.tried
              ? _(SIGN_DOCUMENT_MARK_MISSING)
              : ''}
      </p>
      <DialogFooter>
        <Button
          disabled={over}
          label={SIGN_DOCUMENT_APPLY}
          onClick={() => {
            attempt.attempt();
            if (over || missing) return;
            const named = stated(name);
            const why = stated(reason);
            const where = stated(location);
            const contact = stated(contactInfo);
            resolve({
              // THE PASSPHRASE IS NOT TRIMMED, and the four beside it are: PDF
              // hands a passphrase to a hash, so a trailing space is part of it,
              // while a `/Reason` of three spaces is one a reader displays blank.
              passphrase,
              ...(named === undefined ? {} : { name: named.value }),
              ...(why === undefined ? {} : { reason: why.value }),
              ...(where === undefined ? {} : { location: where.value }),
              ...(contact === undefined ? {} : { contactInfo: contact.value }),
              // `approve` BECOMES AN ABSENT FIELD, which is what the payload
              // means by *not a certification*. Sending the word would put a
              // fourth member in a schema whose three are all `/DocMDP` levels.
              ...(certify === 'approve' ? {} : { certify }),
              // `none` BECOMES AN ABSENT FIELD, for `approve`'s reason: the payload's
              // enum names only authorities.
              ...(timestamp === 'none' ? {} : { timestamp }),
              // A MARK ONLY FOR A PLACEMENT. The ribbon's invisible signature has
              // nowhere to draw one, and answering the default look anyway would
              // hand the command a field it has no rectangle for.
              ...(placed && mark !== undefined ? { mark } : {}),
              // KEEP ONLY WHAT THIS DIALOG MADE: a typed or drawn look, with the box ticked.
              ...(placed && keep && (look === 'typed' || look === 'drawn') ? { keep: true as const } : {}),
            });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
