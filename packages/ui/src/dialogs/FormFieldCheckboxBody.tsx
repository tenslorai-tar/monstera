import type { ReactElement } from 'react';

import { FORM_FIELD_CHECKBOX_APPLY, FORM_FIELD_NAME_LABEL } from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { FormFieldForm } from './FormFieldForm.js';
import type { FormFieldAnswer } from './formFieldResult.js';

/** What a tick box is called. See {@link FormFieldForm}. */
export default function FormFieldCheckboxBody({
  resolve,
}: DialogAnswering<FormFieldAnswer>): ReactElement {
  return (
    <FormFieldForm
      apply={FORM_FIELD_CHECKBOX_APPLY}
      collects="name"
      label={FORM_FIELD_NAME_LABEL}
      resolve={resolve}
    />
  );
}
