import type { ReactElement } from 'react';

import { FORM_FIELD_LISTBOX_APPLY, FORM_FIELD_NAME_LABEL } from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { FormFieldForm } from './FormFieldForm.js';
import type { FormFieldAnswer } from './formFieldResult.js';

/** What a list box is called and what it offers. See {@link FormFieldForm}. */
export default function FormFieldListboxBody({
  resolve,
}: DialogAnswering<FormFieldAnswer>): ReactElement {
  return (
    <FormFieldForm
      apply={FORM_FIELD_LISTBOX_APPLY}
      collects="options"
      label={FORM_FIELD_NAME_LABEL}
      resolve={resolve}
    />
  );
}
