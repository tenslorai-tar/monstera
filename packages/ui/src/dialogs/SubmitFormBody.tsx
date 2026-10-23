import { useLingui } from '@lingui/react';
import type { SubmitFormat } from '@monstera/contract';
import type { ReactElement } from 'react';
import type { z } from 'zod';

import {
  SUBMIT_FORM_COPY,
  SUBMIT_FORM_EXPLAINS_MAIL,
  SUBMIT_FORM_EXPLAINS_MAIL_WHOLE,
  SUBMIT_FORM_EXPLAINS_WEB,
  SUBMIT_FORM_EXPLAINS_WEB_WHOLE,
  SUBMIT_FORM_FIELDS_ALL,
  SUBMIT_FORM_FIELDS_SOME,
  SUBMIT_FORM_OPEN_MAIL,
  SUBMIT_FORM_ROUTES,
  SUBMIT_FORM_SEND,
  SUBMIT_FORM_SHARE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter } from '../primitives/Dialog.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { SUBMIT_FORMAT_NAMES, type SUBMIT_FORM_RESULT } from './submitForm.js';

/**
 * Names where a push button sends the form's data, in which encoding and which fields, with the ways on as buttons
 * (ADR-0259 Decision 6, ADR-0261 Decision 3). The address is shown whole, broken anywhere, as the follow-link question
 * shows one, because a person deciding whether to send their data must be able to read all of it.
 *
 * A `mailto:` address offers two routes, because many people's mail app is not a Share target (the owner's answer of
 * 2026-10-23): *Share with the file attached*, the Windows Share sheet with the data as a file, and *Open in my mail
 * app*, the data in the message. The sheet takes no recipient, so the address has a Copy beside it, the crash report's
 * way; Copy is REPORTED to the opener, which copies through `main`, and the dialog stays open.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function SubmitFormBody({
  address,
  format,
  fields,
  mail,
  resolve,
  update,
}: DialogAnswering<z.infer<typeof SUBMIT_FORM_RESULT>> & {
  readonly address: string;
  readonly format: SubmitFormat;
  readonly fields: readonly string[] | null;
  readonly mail: boolean;
}): ReactElement {
  const { _ } = useLingui();
  const named = _(SUBMIT_FORMAT_NAMES[format]);
  const whole = format === 'pdf';
  const explains = whole
    ? mail
      ? SUBMIT_FORM_EXPLAINS_MAIL_WHOLE
      : SUBMIT_FORM_EXPLAINS_WEB_WHOLE
    : mail
      ? SUBMIT_FORM_EXPLAINS_MAIL
      : SUBMIT_FORM_EXPLAINS_WEB;
  return (
    <div className="m-follow-link">
      <p>{_(explains, { format: named })}</p>
      <p className="m-follow-link__address" data-submit-form-address="">
        {address}
      </p>
      {mail ? (
        <div className="m-submit-form__copy">
          <Button
            label={SUBMIT_FORM_COPY}
            onClick={() => {
              update({ copy: true });
            }}
          />
        </div>
      ) : null}
      {/* THE WHOLE DOCUMENT CARRIES EVERY FIELD, which its sentence above already says. */}
      {whole ? null : fields === null ? (
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
      {mail ? <p>{_(SUBMIT_FORM_ROUTES)}</p> : null}
      <DialogFooter>
        {mail ? (
          <>
            <Button
              label={SUBMIT_FORM_OPEN_MAIL}
              onClick={() => {
                resolve({ send: true, route: 'mail-app' });
              }}
            />
            <Button
              label={SUBMIT_FORM_SHARE}
              variant="primary"
              onClick={() => {
                resolve({ send: true, route: 'share' });
              }}
            />
          </>
        ) : (
          <Button
            label={SUBMIT_FORM_SEND}
            variant="primary"
            onClick={() => {
              resolve({ send: true, route: 'post' });
            }}
          />
        )}
      </DialogFooter>
    </div>
  );
}
