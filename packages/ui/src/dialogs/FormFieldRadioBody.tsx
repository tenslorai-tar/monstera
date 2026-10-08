import type { ReactElement } from 'react';

import type { KnownField } from '../annotations/fieldNameCheck.js';
import { FORM_FIELD_GROUP_LABEL, FORM_FIELD_GROUP_NOTE, FORM_FIELD_RADIO_APPLY } from '../messages/en.js';
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
 *
 * **The group is asked for once.** The tool remembers it until Escape and hands it back for every later option, so the
 * second and third drag ask only for the choice's own value, suggested as the next free `Option N`.
 */
export default function FormFieldRadioBody({
  known,
  group,
  used,
  nextNumber,
  resolve,
}: {
  readonly known: readonly KnownField[];
  readonly group?: string | undefined;
  readonly used?: readonly string[] | undefined;
  readonly nextNumber?: number | undefined;
} & DialogAnswering<FormFieldAnswer>): ReactElement {
  return (
    <FormFieldForm
      apply={FORM_FIELD_RADIO_APPLY}
      collects="option"
      group={group}
      known={known}
      label={FORM_FIELD_GROUP_LABEL}
      nextNumber={nextNumber}
      note={FORM_FIELD_GROUP_NOTE}
      resolve={resolve}
      used={used}
    />
  );
}
