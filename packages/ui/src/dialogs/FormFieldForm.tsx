import { useLingui } from '@lingui/react';
import { MAX_FIELD_NAME, MAX_FIELD_OPTIONS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { X } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  FORM_FIELD_ADD_OPTION,
  FORM_FIELD_NAME_EMPTY,
  FORM_FIELD_NAME_SEGMENT,
  FORM_FIELD_NAME_TOO_LONG,
  FORM_FIELD_OPTIONS_EMPTY,
  FORM_FIELD_OPTIONS_LABEL,
  FORM_FIELD_OPTION_LABEL,
  FORM_FIELD_REMOVE_OPTION,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { IconButton } from '../primitives/IconButton.js';
import { Input } from '../primitives/Input.js';
import type { FormFieldAnswer } from './formFieldResult.js';

/**
 * Describing a form field after its box has been drawn — the form five dialogs
 * render.
 *
 * ## Why one component and five declarations
 *
 * `AnnotationTextForm`'s shape and its argument, one row along. What differs
 * between creating a text field and creating a dropdown is **the words** and
 * **which questions are asked**; the name's validation, its two refusals and
 * the guard behind the apply control are one behaviour. A single dialog with a
 * kind in its props would put user-facing wording behind a value crossing a zod
 * schema, and `declareDialog` takes its title statically — so all five would
 * share one generic title.
 *
 * The message keys arrive as ordinary props rather than through the props
 * schema, which keeps B9's rule intact: every string a person reads is a key
 * resolved by `useLingui`, declared statically in the module that owns its
 * dialog.
 *
 * ## The name's third refusal, which the other form does not have
 *
 * A dot in a field name makes a **parent** in the field tree — measured
 * 2026-09-08, `owner.first` and `owner.second` are siblings under `owner` — so
 * an empty segment asks for a node with no name. `createFormFieldSchema` refuses
 * it at the boundary; this refuses it here, with a sentence, because a person
 * who typed a trailing dot needs to be told what a dot means rather than meeting
 * a control that closes and does nothing.
 *
 * That is the same reason `AnnotationTextForm` grew its `validate` hook for a
 * link's page number: a name's shape is a different kind of wrong from a name's
 * emptiness.
 *
 * ## Options are a list of inputs, not a separated string
 *
 * The alternatives were both silently lossy. **Comma-separated** makes an option
 * containing a comma unenterable, and nothing tells the person that. **One per
 * line** needs a textarea primitive §10.4 does not have, and carries the same
 * problem for a newline. A list of single-line fields is what the data is: each
 * option is its own value, and the control says so.
 *
 * An empty trailing row is normal — it is the one a person is about to type
 * into — so blanks are dropped on the way out rather than refused.
 */
export interface FormFieldFormProps {
  /** The name field's label. */
  readonly label: MessageKey;
  /** The confirming control, which says exactly what it will create. */
  readonly apply: MessageKey;
  /**
   * Which questions this dialog asks beyond the name.
   *
   * A rendering discriminant, passed as an ordinary prop. `'option'` is a radio
   * group's — one widget is one option of a group — and `'options'` is a choice
   * field's list.
   */
  readonly collects: 'name' | 'option' | 'options';
  /** The dialog's own `resolve`. */
  readonly resolve: (answer: FormFieldAnswer) => void;
}

export function FormFieldForm({
  label,
  apply,
  collects,
  resolve,
}: FormFieldFormProps): ReactElement {
  const { _ } = useLingui();
  const [name, setName] = useState('');
  const [option, setOption] = useState('');
  const [options, setOptions] = useState<readonly string[]>(['']);

  const trimmedName = name.trim();
  const overLong = trimmedName.length > MAX_FIELD_NAME;
  // THE SEGMENT RULE, on the trimmed value and only when it is non-empty, so it
  // never has to repeat the refusal above it.
  const badSegment =
    trimmedName.length > 0 &&
    !overLong &&
    !trimmedName.split('.').every((segment) => segment.trim().length > 0);

  const filled = options.map((value) => value.trim()).filter((value) => value.length > 0);
  const needsOption = collects === 'option' && option.trim().length === 0;
  const needsOptions = collects === 'options' && filled.length === 0;

  const problem: MessageKey | '' = overLong
    ? FORM_FIELD_NAME_TOO_LONG
    : trimmedName.length === 0
      ? FORM_FIELD_NAME_EMPTY
      : badSegment
        ? FORM_FIELD_NAME_SEGMENT
        : needsOption || needsOptions
          ? FORM_FIELD_OPTIONS_EMPTY
          : '';
  const usable = problem === '';

  return (
    <div className="m-form-field">
      <Input label={label} onValueChange={setName} value={name} />

      {collects === 'option' ? (
        <Input label={FORM_FIELD_OPTION_LABEL} onValueChange={setOption} value={option} />
      ) : null}

      {collects === 'options' ? (
        <div className="m-form-field__options">
          {options.map((value, index) => (
            // INDEXED KEY, deliberately: these rows have no identity of their
            // own — two options may hold the same string, and a key derived
            // from the value would make React reuse the wrong input the moment
            // they did.
            //
            // NO `eslint-disable` HERE, and the first spelling had one for
            // `react/no-array-index-key`. That rule is not registered in
            // `eslint.config.js` — `eslint-plugin-react-hooks` is, and the
            // full `eslint-plugin-react` is not — so the directive suppressed
            // nothing and read as *this project bans index keys and here is the
            // exception*, which is a comment claiming a control that does not
            // exist.
            <div className="m-form-field__option" key={index}>
              <Input
                label={FORM_FIELD_OPTIONS_LABEL}
                onValueChange={(next) => {
                  setOptions(options.map((held, at) => (at === index ? next : held)));
                }}
                value={value}
              />
              <IconButton
                icon={X}
                label={FORM_FIELD_REMOVE_OPTION}
                onClick={() => {
                  // NEVER TO ZERO ROWS. An empty list would leave a person with
                  // nothing to type into and no way back to a row.
                  const left = options.filter((_held, at) => at !== index);
                  setOptions(left.length === 0 ? [''] : left);
                }}
                size="control"
              />
            </div>
          ))}
          <Button
            disabled={options.length >= MAX_FIELD_OPTIONS}
            label={FORM_FIELD_ADD_OPTION}
            onClick={() => {
              setOptions([...options, '']);
            }}
          />
        </div>
      ) : null}

      <p className="m-form-field__problem" role="status">
        {problem === '' ? '' : _(problem)}
      </p>
      <Button
        disabled={!usable}
        label={apply}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `AnnotationTextForm`'s reason: the schema behind `resolve` refuses
          // an empty name, so a mismatch would throw over the user's document
          // rather than doing nothing.
          if (!usable) return;
          resolve({
            name,
            ...(collects === 'option' ? { option } : {}),
            ...(collects === 'options' ? { options: filled } : {}),
          });
        }}
        variant="primary"
      />
    </div>
  );
}
