import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  DOCUSIGN_SEND_ADD_SIGNER,
  DOCUSIGN_SEND_APPLY,
  DOCUSIGN_SEND_NOTE,
  DOCUSIGN_SEND_REMOVE_SIGNER,
  DOCUSIGN_SEND_SIGNER_EMAIL,
  DOCUSIGN_SEND_SIGNER_NAME,
  DOCUSIGN_SEND_SUBJECT,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { DOCUSIGN_SEND_RESULT, type DocusignSendAnswer } from './docusignSend.js';

/** One signer row, as typed. */
interface SignerRow {
  readonly name: string;
  readonly email: string;
}

/**
 * The send dialog's body.
 *
 * ## Send is enabled only by the ANSWER'S OWN SCHEMA
 *
 * The button asks `DOCUSIGN_SEND_RESULT` whether the typed values parse — the same
 * schema the dialog registry validates the answer with, and whose bounds are the
 * channel's. A separate "is this valid" rule here would be a second opinion about
 * what an email address is, and the one that disagreed would be the one a person
 * met.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function DocusignSendBody({
  resolve,
}: DialogAnswering<DocusignSendAnswer>): ReactElement {
  const { _ } = useLingui();
  const [emailSubject, setEmailSubject] = useState('');
  const [signers, setSigners] = useState<readonly SignerRow[]>([{ name: '', email: '' }]);

  const parsed = DOCUSIGN_SEND_RESULT.safeParse({ emailSubject, signers });

  /** Replaces one row's field, leaving the others as typed. */
  const change = (index: number, field: keyof SignerRow, value: string): void => {
    setSigners((current) =>
      current.map((row, at) => (at === index ? { ...row, [field]: value } : row)),
    );
  };

  return (
    <div className="m-docusign-send">
      <Input label={DOCUSIGN_SEND_SUBJECT} onValueChange={setEmailSubject} value={emailSubject} />

      <ol className="m-docusign-send__signers">
        {signers.map((row, index) => (
          <li className="m-docusign-send__signer" data-docusign-signer={index} key={index}>
            <Input
              label={DOCUSIGN_SEND_SIGNER_NAME}
              onValueChange={(value) => {
                change(index, 'name', value);
              }}
              value={row.name}
            />
            <Input
              label={DOCUSIGN_SEND_SIGNER_EMAIL}
              onValueChange={(value) => {
                change(index, 'email', value);
              }}
              value={row.email}
            />
            {/* ONE SIGNER STAYS: an envelope with nobody to sign it is not one
                DocuSign sends, so the last row has no remove control to press. */}
            {signers.length > 1 ? (
              <Button
                label={DOCUSIGN_SEND_REMOVE_SIGNER}
                onClick={() => {
                  setSigners((current) => current.filter((_row, at) => at !== index));
                }}
              />
            ) : null}
          </li>
        ))}
      </ol>
      <Button
        label={DOCUSIGN_SEND_ADD_SIGNER}
        onClick={() => {
          setSigners((current) => [...current, { name: '', email: '' }]);
        }}
      />

      <p className="m-docusign-send__note">{_(DOCUSIGN_SEND_NOTE)}</p>
      <Button
        disabled={!parsed.success}
        label={DOCUSIGN_SEND_APPLY}
        onClick={() => {
          if (parsed.success) resolve(parsed.data);
        }}
        variant="primary"
      />
    </div>
  );
}
