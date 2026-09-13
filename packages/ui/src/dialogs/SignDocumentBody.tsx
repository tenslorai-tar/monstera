import { useLingui } from '@lingui/react';
import type { RequestedSignatureMark } from '@monstera/contract';
import {
  DOCUMENT_PASSWORD_MAX_CHARS,
  MAX_SIGNATURE_FIELD,
  SIGNATURE_FONTS,
  TIMESTAMP_AUTHORITY_IDS,
} from '@monstera/contract';
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
  SIGN_DOCUMENT_FONT,
  SIGN_DOCUMENT_FONT_COURIER,
  SIGN_DOCUMENT_FONT_HELVETICA,
  SIGN_DOCUMENT_FONT_TIMES,
  SIGN_DOCUMENT_FONT_TIMES_ITALIC,
  SIGN_DOCUMENT_IMAGE_NOTE,
  SIGN_DOCUMENT_LOCATION,
  SIGN_DOCUMENT_LOOK,
  SIGN_DOCUMENT_LOOK_DRAWN,
  SIGN_DOCUMENT_LOOK_IMAGE,
  SIGN_DOCUMENT_LOOK_TYPED,
  SIGN_DOCUMENT_MARK_MISSING,
  SIGN_DOCUMENT_NAME,
  SIGN_DOCUMENT_PASSPHRASE,
  SIGN_DOCUMENT_REASON,
  SIGN_DOCUMENT_TEXT,
  SIGN_DOCUMENT_TOO_LONG,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SignDocumentAnswer } from './signDocument.js';
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
const LOOKS = ['typed', 'drawn', 'image'] as const satisfies readonly RequestedSignatureMark['kind'][];

type Look = (typeof LOOKS)[number];

const LOOK_TITLES: Readonly<Record<Look, MessageKey>> = {
  typed: SIGN_DOCUMENT_LOOK_TYPED,
  drawn: SIGN_DOCUMENT_LOOK_DRAWN,
  image: SIGN_DOCUMENT_LOOK_IMAGE,
};

/** Each face's name, keyed on the contract's own list. */
const FONT_TITLES: Readonly<Record<(typeof SIGNATURE_FONTS)[number], MessageKey>> = {
  helvetica: SIGN_DOCUMENT_FONT_HELVETICA,
  'times-roman': SIGN_DOCUMENT_FONT_TIMES,
  'times-italic': SIGN_DOCUMENT_FONT_TIMES_ITALIC,
  courier: SIGN_DOCUMENT_FONT_COURIER,
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
 * ## `Sign` is disabled for exactly one reason besides length
 *
 * An invisible signature has no required field — the passphrase may be empty,
 * because many certificates have none. A VISIBLE one needs something to draw:
 * a placement answered with no text and no strokes would put a blank box on the
 * page, so *Sign* waits until the chosen look has content, and the status line
 * says so rather than leaving a disabled control to explain itself.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SignDocumentBody({
  placed,
  resolve,
}: { readonly placed: boolean } & DialogAnswering<SignDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const certifyId = useId();
  const lookId = useId();
  const fontId = useId();
  const [certify, setCertify] = useState<CertifyChoice>('approve');
  const timestampId = useId();
  // NO TIMESTAMP TO BEGIN WITH, and that is a decision rather than a default: a
  // timestamp sends a fingerprint of the signature to a third party, which is a
  // person's choice to make with the note beside the control in front of them.
  const [timestamp, setTimestamp] = useState<TimestampChoice>('none');
  const [passphrase, setPassphrase] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [look, setLook] = useState<Look>('typed');
  const [text, setText] = useState('');
  const [font, setFont] = useState<(typeof SIGNATURE_FONTS)[number]>('times-italic');
  const [strokes, setStrokes] = useState<readonly PadStroke[]>([]);

  const over =
    passphrase.length > DOCUMENT_PASSWORD_MAX_CHARS ||
    [name, reason, location, contactInfo, text].some((value) => value.length > MAX_SIGNATURE_FIELD);

  /** The look as the channel carries it, or `undefined` when it has nothing to draw. */
  const mark = ((): RequestedSignatureMark | undefined => {
    if (look === 'image') return { kind: 'image' };
    if (look === 'drawn') {
      return strokes.length > 0
        ? {
            kind: 'drawn',
            strokes: strokes.map((stroke) => stroke.map(([across, down]): [number, number] => [across, down])),
          }
        : undefined;
    }
    return text.trim().length > 0 ? { kind: 'typed', text: text.trim(), font } : undefined;
  })();
  const missing = placed && mark === undefined;

  /** A trimmed field, or `undefined` when it holds nothing a reader would show. */
  const stated = (value: string): { readonly value: string } | undefined =>
    value.trim().length > 0 ? { value: value.trim() } : undefined;

  return (
    <div className="m-sign-document">
      <p className="m-sign-document__note">{_(SIGN_DOCUMENT_EXPLAINS)}</p>

      {placed ? (
        <div className="m-sign-document__look">
          <label className="m-document-choice" htmlFor={lookId}>
            {_(SIGN_DOCUMENT_LOOK)}
            <select
              id={lookId}
              data-sign-look=""
              onChange={(event) => {
                setLook(event.target.value as Look);
              }}
              value={look}
            >
              {LOOKS.map((choice) => (
                <option key={choice} value={choice}>
                  {_(LOOK_TITLES[choice])}
                </option>
              ))}
            </select>
          </label>

          {look === 'typed' ? (
            <>
              <Input label={SIGN_DOCUMENT_TEXT} onValueChange={setText} value={text} />
              <label className="m-document-choice" htmlFor={fontId}>
                {_(SIGN_DOCUMENT_FONT)}
                <select
                  id={fontId}
                  data-sign-font=""
                  onChange={(event) => {
                    setFont(event.target.value as (typeof SIGNATURE_FONTS)[number]);
                  }}
                  value={font}
                >
                  {SIGNATURE_FONTS.map((face) => (
                    <option key={face} value={face}>
                      {_(FONT_TITLES[face])}
                    </option>
                  ))}
                </select>
              </label>
            </>
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
        </div>
      ) : null}

      <Input
        label={SIGN_DOCUMENT_PASSPHRASE}
        onValueChange={setPassphrase}
        secret
        value={passphrase}
      />
      <Input label={SIGN_DOCUMENT_NAME} onValueChange={setName} value={name} />
      <Input label={SIGN_DOCUMENT_REASON} onValueChange={setReason} value={reason} />
      <Input label={SIGN_DOCUMENT_LOCATION} onValueChange={setLocation} value={location} />
      <Input label={SIGN_DOCUMENT_CONTACT} onValueChange={setContactInfo} value={contactInfo} />

      <label className="m-document-choice" htmlFor={certifyId}>
        {_(SIGN_DOCUMENT_CERTIFY)}
        {/* A NATIVE `<select>`, for `DocumentChoice`'s reason: §9.27's pinned
            CSP admits no inline style, so the primitive set has no select. */}
        <select
          id={certifyId}
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
      </label>

      <label className="m-document-choice" htmlFor={timestampId}>
        {_(SIGN_DOCUMENT_TIMESTAMP)}
        {/* A NATIVE `<select>`, for the certify control's reason above. */}
        <select
          id={timestampId}
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
      </label>
      {/* THE SENTENCE ADR-0058 Decision 1 PROMISED, on screen beside the choice:
          what leaves the machine, and what an observer on the network learns. */}
      <p className="m-sign-document__note">{_(SIGN_DOCUMENT_TIMESTAMP_NOTE)}</p>

      <p className="m-sign-document__problem" role="status">
        {over ? _(SIGN_DOCUMENT_TOO_LONG) : missing ? _(SIGN_DOCUMENT_MARK_MISSING) : ''}
      </p>
      <Button
        disabled={over || missing}
        label={SIGN_DOCUMENT_APPLY}
        onClick={() => {
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
          });
        }}
        variant="primary"
      />
    </div>
  );
}
