import { useLingui } from '@lingui/react';
import { DOCUMENT_PASSWORD_MAX_CHARS, MAX_SIGNATURE_FIELD } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  SIGN_DOCUMENT_APPLY,
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
export default function SignDocumentBody({
  resolve,
}: DialogAnswering<SignDocumentAnswer>): ReactElement {
  const { _ } = useLingui();
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
          });
        }}
        variant="primary"
      />
    </div>
  );
}
