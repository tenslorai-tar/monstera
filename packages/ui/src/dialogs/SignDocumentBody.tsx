import { useLingui } from '@lingui/react';
import { DOCUMENT_PASSWORD_MAX_CHARS, MAX_SIGNATURE_FIELD } from '@monstera/contract';
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
  SIGN_DOCUMENT_CONTACT,
  SIGN_DOCUMENT_EXPLAINS,
  SIGN_DOCUMENT_LOCATION,
  SIGN_DOCUMENT_NAME,
  SIGN_DOCUMENT_PASSPHRASE,
  SIGN_DOCUMENT_REASON,
  SIGN_DOCUMENT_TOO_LONG,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { SignDocumentAnswer } from './signDocument.js';

/**
 * Collect what a signature carries, and say where the certificate comes from.
 *
 * ## No field for the certificate, and a sentence instead
 *
 * Main picks it. A person pressing *Sign* and meeting an unexpected file dialog
 * is a surprise one sentence avoids, and the sentence is also the honest
 * description of why there is no field: the renderer never holds a private key.
 *
 * ## `Sign` is never disabled
 *
 * Every field here is optional — including the passphrase, because many
 * certificates have none. There is no unusable state to guard against, so a
 * disabled control would be one nothing could re-enable.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
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

export default function SignDocumentBody({
  resolve,
}: DialogAnswering<SignDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
  const certifyId = useId();
  const [certify, setCertify] = useState<CertifyChoice>('approve');
  const [passphrase, setPassphrase] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [contactInfo, setContactInfo] = useState('');

  const over =
    passphrase.length > DOCUMENT_PASSWORD_MAX_CHARS ||
    [name, reason, location, contactInfo].some((value) => value.length > MAX_SIGNATURE_FIELD);

  /** A trimmed field, or `undefined` when it holds nothing a reader would show. */
  const stated = (value: string): { readonly value: string } | undefined =>
    value.trim().length > 0 ? { value: value.trim() } : undefined;

  return (
    <div className="m-sign-document">
      <p className="m-sign-document__note">{_(SIGN_DOCUMENT_EXPLAINS)}</p>

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

      <p className="m-sign-document__problem" role="status">
        {over ? _(SIGN_DOCUMENT_TOO_LONG) : ''}
      </p>
      <Button
        disabled={over}
        label={SIGN_DOCUMENT_APPLY}
        onClick={() => {
          if (over) return;
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
          });
        }}
        variant="primary"
      />
    </div>
  );
}
