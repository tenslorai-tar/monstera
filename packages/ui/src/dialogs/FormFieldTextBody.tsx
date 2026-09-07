import type { ReactElement } from 'react';

import { FORM_FIELD_NAME_LABEL, FORM_FIELD_TEXT_APPLY } from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { FormFieldForm } from './FormFieldForm.js';
import type { FormFieldAnswer } from './formFieldResult.js';

/**
 * What a text field is called, collected after its box has been drawn.
 *
 * The behaviour is {@link FormFieldForm}'s; what stays here is this dialog's
 * message keys, declared statically so B9's rule holds and each dialog reads as
 * its own.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function FormFieldTextBody({
  resolve,
}: DialogAnswering<FormFieldAnswer>): ReactElement {
  return (
    <FormFieldForm
      apply={FORM_FIELD_TEXT_APPLY}
      collects="name"
      label={FORM_FIELD_NAME_LABEL}
      resolve={resolve}
    />
  );
}
