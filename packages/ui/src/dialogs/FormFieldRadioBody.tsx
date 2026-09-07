import type { ReactElement } from 'react';

import { FORM_FIELD_GROUP_LABEL, FORM_FIELD_RADIO_APPLY } from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { FormFieldForm } from './FormFieldForm.js';
import type { FormFieldAnswer } from './formFieldResult.js';

/**
 * Which group a radio option belongs to, and which option it is.
 *
 * **The name's label differs here**, and that is the point of the dialog being
 * its own: a radio group is one field with several widgets, so the name a
 * person types is the *group's* and not this widget's. A label reading *Field
 * name* would suggest that drawing a second option needs a second name, which
 * is the one thing about radio groups people get wrong.
 */
export default function FormFieldRadioBody({
  resolve,
}: DialogAnswering<FormFieldAnswer>): ReactElement {
  return (
    <FormFieldForm
      apply={FORM_FIELD_RADIO_APPLY}
      collects="option"
      label={FORM_FIELD_GROUP_LABEL}
      resolve={resolve}
    />
  );
}
