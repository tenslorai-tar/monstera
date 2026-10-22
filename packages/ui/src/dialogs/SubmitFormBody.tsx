import { useLingui } from '@lingui/react';
import type { SubmitFormat } from '@monstera/contract';
import type { ReactElement } from 'react';

import {
  SUBMIT_FORM_EXPLAINS_MAIL,
  SUBMIT_FORM_EXPLAINS_WEB,
  SUBMIT_FORM_FIELDS_ALL,
  SUBMIT_FORM_FIELDS_SOME,
  SUBMIT_FORM_OPEN_MAIL,
  SUBMIT_FORM_SEND,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { SUBMIT_FORMAT_NAMES } from './submitForm.js';

/**
 * Names where a push button sends the form's data, in which encoding and which fields, with *Send* (or *Open in mail
 * app*) the one way on (ADR-0259 Decision 6). The address is shown whole, broken anywhere, as the follow-link question
 * shows one, because a person deciding whether to send their data must be able to read all of it.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SubmitFormBody({
  address,
  format,
  fields,
  mail,
  resolve,
}: DialogAnswering<{ readonly send: true }> & {
  readonly address: string;
  readonly format: SubmitFormat;
  readonly fields: readonly string[] | null;
  readonly mail: boolean;
}): ReactElement {
  const { _ } = useLingui();
  const named = _(SUBMIT_FORMAT_NAMES[format]);
  return (
    <div className="m-follow-link">
      <p>{_(mail ? SUBMIT_FORM_EXPLAINS_MAIL : SUBMIT_FORM_EXPLAINS_WEB, { format: named })}</p>
      <p className="m-follow-link__address" data-submit-form-address="">
        {address}
      </p>
      {fields === null ? (
        <p>{_(SUBMIT_FORM_FIELDS_ALL)}</p>
      ) : (
        <>
          <p>{_(SUBMIT_FORM_FIELDS_SOME, { count: fields.length })}</p>
          <ul className="m-submit-form__fields">
            {fields.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </>
      )}
      <DialogFooter>
        <Button
          label={mail ? SUBMIT_FORM_OPEN_MAIL : SUBMIT_FORM_SEND}
          variant="primary"
          onClick={() => {
            resolve({ send: true });
          }}
        />
      </DialogFooter>
    </div>
  );
}
