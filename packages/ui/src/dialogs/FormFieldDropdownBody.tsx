import type { ReactElement } from 'react';

import { FORM_FIELD_DROPDOWN_APPLY, FORM_FIELD_NAME_LABEL } from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { FormFieldForm } from './FormFieldForm.js';
import type { FormFieldAnswer } from './formFieldResult.js';

/** What a dropdown is called and what it offers. See {@link FormFieldForm}. */
export default function FormFieldDropdownBody({
  resolve,
}: DialogAnswering<FormFieldAnswer>): ReactElement {
  return (
    <FormFieldForm
      apply={FORM_FIELD_DROPDOWN_APPLY}
      collects="options"
      label={FORM_FIELD_NAME_LABEL}
      resolve={resolve}
    />
  );
}
