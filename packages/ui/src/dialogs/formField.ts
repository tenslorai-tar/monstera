import { lazy } from 'react';
import { z } from 'zod';

import { FORM_FIELD_DROPDOWN_TITLE, FORM_FIELD_LISTBOX_TITLE, FORM_FIELD_RADIO_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';
import { KNOWN_FIELD } from '../annotations/fieldNameCheck.js';
import { FORM_FIELD_RESULT } from './formFieldResult.js';

/**
 * The three dialogs a create-field tool opens: for a field that needs more than a name. A text field and a checkbox
 * are named on the page, in the line their tools ask for (ADR-0154).
 *
 * ## Three declarations rather than one with a discriminant
 *
 * `declareDialog` takes its title **statically**, so a single dialog carrying
 * the kind in its props would have to be titled generically — *New form field*
 * for all three — where each of these says which field is about to exist.
 * Nothing is duplicated by having three: the body of each is a few lines, and
 * the behaviour they share is `FormFieldForm`, which has no words in it.
 *
 * ## No KIND in the props
 *
 * **The kind is not something a person chooses here** — it is which tool they
 * picked, and the tool is what opens the matching dialog. A `kind` prop would
 * let the wrong tool open the right dialog, which is a mismatch nothing
 * downstream could see: the answer's shape is the same either way.
 *
 * What the dialog IS told is the fields the document already has, so a name it cannot take is said as it is typed
 * (`fieldNameCheck.ts`), and, for a radio group already begun, the group's name, the choices this tool has drawn into it
 * and the number its next suggested choice takes. It was told nothing until 2026-10-07: a name the form already had went
 * to the writer, was refused there, and was shown as *something went wrong inside Monstera*.
 */
const FIELD_DIALOG_PROPS = z
  .object({
    known: z.array(KNOWN_FIELD),
    /** A radio tool's group so far: the name every later option takes, so it is asked for once. */
    group: z.string().optional(),
    /** The values the group's earlier options were drawn with in this run. */
    used: z.array(z.string()).optional(),
    /** The number the next option's suggested value takes. */
    nextNumber: z.number().int().positive().optional(),
  })
  .strict();

/** The id the radio tool opens. */
export const FORM_FIELD_RADIO_DIALOG_ID = 'dialog.form-field-radio';
/** The id the dropdown tool opens. */
export const FORM_FIELD_DROPDOWN_DIALOG_ID = 'dialog.form-field-dropdown';
/** The id the list-box tool opens. */
export const FORM_FIELD_LISTBOX_DIALOG_ID = 'dialog.form-field-listbox';

export const FORM_FIELD_RADIO_DIALOG = declareDialog({
  id: FORM_FIELD_RADIO_DIALOG_ID,
  title: FORM_FIELD_RADIO_TITLE,
  props: FIELD_DIALOG_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldRadioBody.js')),
});

export const FORM_FIELD_DROPDOWN_DIALOG = declareDialog({
  id: FORM_FIELD_DROPDOWN_DIALOG_ID,
  title: FORM_FIELD_DROPDOWN_TITLE,
  props: FIELD_DIALOG_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldDropdownBody.js')),
});

export const FORM_FIELD_LISTBOX_DIALOG = declareDialog({
  id: FORM_FIELD_LISTBOX_DIALOG_ID,
  title: FORM_FIELD_LISTBOX_TITLE,
  props: FIELD_DIALOG_PROPS,
  result: FORM_FIELD_RESULT,
  component: lazy(() => import('./FormFieldListboxBody.js')),
});

/** The three, for the composition root. */
export const FORM_FIELD_DIALOGS = [FORM_FIELD_RADIO_DIALOG, FORM_FIELD_DROPDOWN_DIALOG, FORM_FIELD_LISTBOX_DIALOG] as const;
