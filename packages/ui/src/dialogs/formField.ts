import { lazy } from 'react';
import { z } from 'zod';

import {
  FORM_FIELD_CHECKBOX_TITLE,
  FORM_FIELD_DROPDOWN_TITLE,
  FORM_FIELD_LISTBOX_TITLE,
  FORM_FIELD_RADIO_TITLE,
  FORM_FIELD_TEXT_TITLE,
} from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { FORM_FIELD_RESULT } from './formFieldResult.js';

/**
 * The five dialogs a create-field tool opens, one per kind.
 *
 * ## Five declarations rather than one with a discriminant
 *
 * `AnnotationTextForm`'s ruling, one row along and for its reasons.
 * `declareDialog` takes its title **statically**, so a single dialog carrying
 * the kind in its props would have to be titled generically — *New form field*
 * for all five — where each of these says which field is about to exist. Nothing
 * is duplicated by having five: the body of each is four lines, and the
 * behaviour they share is `FormFieldForm`, which has no words in it.
 *
 * ## No props, and the reason is not the text dialog's
 *
 * `ANNOTATION_TEXT_DIALOG` has none because any string is a legal thing for a
 * text box to say. These have none because **the kind is not something a person
 * chooses here** — it is which tool they picked, and the tool is what opens the
 * matching dialog. A `kind` prop would let the wrong tool open the right dialog,
 * which is a mismatch nothing downstream could see: the answer's shape is the
 * same either way.
 *
 * `.strict()` on an empty object is still the right declaration rather than an
 * omission — it refuses a caller that passes something, which is how a props
 * shape drifts.
 */
const NO_PROPS = z.object({}).strict();

/** The id the text-field tool opens. */
export const FORM_FIELD_TEXT_DIALOG_ID = 'dialog.form-field-text';
/** The id the checkbox tool opens. */
export const FORM_FIELD_CHECKBOX_DIALOG_ID = 'dialog.form-field-checkbox';
/** The id the radio tool opens. */
export const FORM_FIELD_RADIO_DIALOG_ID = 'dialog.form-field-radio';
/** The id the dropdown tool opens. */
export const FORM_FIELD_DROPDOWN_DIALOG_ID = 'dialog.form-field-dropdown';
/** The id the list-box tool opens. */
export const FORM_FIELD_LISTBOX_DIALOG_ID = 'dialog.form-field-listbox';

export const FORM_FIELD_TEXT_DIALOG = declareDialog({
  id: FORM_FIELD_TEXT_DIALOG_ID,
  title: FORM_FIELD_TEXT_TITLE,
  props: NO_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldTextBody.js')),
});

export const FORM_FIELD_CHECKBOX_DIALOG = declareDialog({
  id: FORM_FIELD_CHECKBOX_DIALOG_ID,
  title: FORM_FIELD_CHECKBOX_TITLE,
  props: NO_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldCheckboxBody.js')),
});

export const FORM_FIELD_RADIO_DIALOG = declareDialog({
  id: FORM_FIELD_RADIO_DIALOG_ID,
  title: FORM_FIELD_RADIO_TITLE,
  props: NO_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldRadioBody.js')),
});

export const FORM_FIELD_DROPDOWN_DIALOG = declareDialog({
  id: FORM_FIELD_DROPDOWN_DIALOG_ID,
  title: FORM_FIELD_DROPDOWN_TITLE,
  props: NO_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldDropdownBody.js')),
});

export const FORM_FIELD_LISTBOX_DIALOG = declareDialog({
  id: FORM_FIELD_LISTBOX_DIALOG_ID,
  title: FORM_FIELD_LISTBOX_TITLE,
  props: NO_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldListboxBody.js')),
});

/** The five, for the composition root. */
export const FORM_FIELD_DIALOGS = [
  FORM_FIELD_TEXT_DIALOG,
  FORM_FIELD_CHECKBOX_DIALOG,
  FORM_FIELD_RADIO_DIALOG,
  FORM_FIELD_DROPDOWN_DIALOG,
  FORM_FIELD_LISTBOX_DIALOG,
] as const;
