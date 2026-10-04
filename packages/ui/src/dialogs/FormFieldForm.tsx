import { useLingui } from '@lingui/react';
import { MAX_FIELD_OPTIONS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { X } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  FORM_FIELD_ADD_OPTION,
  FORM_FIELD_OPTIONS_EMPTY,
  FORM_FIELD_OPTIONS_LABEL,
  FORM_FIELD_OPTION_LABEL,
  FORM_FIELD_REMOVE_OPTION,
} from '../messages/en.js';
import { attemptProblem, useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { IconButton } from '../primitives/IconButton.js';
import { Input } from '../primitives/Input.js';
import { fieldNameProblem } from '../annotations/typedRules.js';
import type { FormFieldAnswer } from './formFieldResult.js';

/**
 * Describing a form field after its box has been drawn — the form the radio,
 * dropdown and list box dialogs render. A text field and a checkbox need only a
 * name, which is typed on the page in the line their tools ask for (ADR-0154).
 *
 * ## Why one component and three declarations
 *
 * What differs between creating a radio button and creating a dropdown is **the words** and
 * **which questions are asked**; the name's validation, its refusals and the
 * guard behind the apply control are one behaviour. A single dialog with a kind
 * in its props would put user-facing wording behind a value crossing a zod
 * schema, and `declareDialog` takes its title statically — so all three would
 * share one generic title.
 *
 * The message keys arrive as ordinary props rather than through the props
 * schema, which keeps B9's rule intact: every string a person reads is a key
 * resolved by `useLingui`, declared statically in the module that owns its
 * dialog.
 *
 * ## The name's third refusal
 *
 * A dot in a field name makes a **parent** in the field tree — measured
 * 2026-09-08, `owner.first` and `owner.second` are siblings under `owner` — so
 * an empty segment asks for a node with no name. `createFormFieldSchema` refuses
 * it at the boundary; this refuses it here, with a sentence, because a person
 * who typed a trailing dot needs to be told what a dot means rather than meeting
 * a control that closes and does nothing. The rule is `typedRules.ts`'
 * `fieldNameProblem`, which the on-page name line takes too: a name's shape is
 * a different kind of wrong from a name's emptiness, and both are said there.
 *
 * ## Options are a list of inputs, not a separated string
 *
 * The alternatives were both silently lossy. **Comma-separated** makes an option
 * containing a comma unenterable, and nothing tells the person that. **One per
 * line** in a `TextArea` carries the same problem for a newline. A list of
 * single-line fields is what the data is: each option is its own value, and the
 * control says so.
 *
 * An empty trailing row is normal — it is the one a person is about to type
 * into — so blanks are dropped on the way out rather than refused.
 */
export interface FormFieldFormProps {
  /** The name field's label. */
  readonly label: MessageKey;
  /** A sentence under the name's label, for what the name means here — a radio group's is the group's, not this option's. */
  readonly note?: MessageKey | undefined;
  /** The confirming control, which says exactly what it will create. */
  readonly apply: MessageKey;
  /**
   * Which question this dialog asks beyond the name.
   *
   * A rendering discriminant, passed as an ordinary prop. `'option'` is a radio
   * group's — one widget is one option of a group — and `'options'` is a choice
   * field's list. A field that needs only a name is named on the page, in the
   * line the tool asks for (ADR-0154), so there is no dialog for it.
   */
  readonly collects: 'option' | 'options';
  /** The dialog's own `resolve`. */
  readonly resolve: (answer: FormFieldAnswer) => void;
}

export function FormFieldForm({
  label,
  note,
  apply,
  collects,
  resolve,
}: FormFieldFormProps): ReactElement {
  const { _ } = useLingui();
  const [name, setName] = useState('');
  const [option, setOption] = useState('');
  const [options, setOptions] = useState<readonly string[]>(['']);

  const trimmedName = name.trim();
  // THE NAME'S RULE, the one the on-page name field takes too (`typedRules.ts`).
  const nameProblem = fieldNameProblem(name);

  const filled = options.map((value) => value.trim()).filter((value) => value.length > 0);
  const needsOption = collects === 'option' && option.trim().length === 0;
  const needsOptions = collects === 'options' && filled.length === 0;

  // A NAME THAT IS WRONG is said as typed and disables the action; A NAME OR OPTION NOT YET TYPED only once the action
  // is pressed (`attempt.ts`).
  const invalid: MessageKey | undefined = trimmedName.length === 0 ? undefined : nameProblem;
  const missing: MessageKey | undefined =
    trimmedName.length === 0 ? nameProblem : needsOption || needsOptions ? FORM_FIELD_OPTIONS_EMPTY : undefined;
  const attempt = useAttempt();
  const problem = attemptProblem(attempt, invalid, missing !== undefined, missing);
  const usable = invalid === undefined && missing === undefined;

  return (
    <div className="m-form-field">
      <DialogRow label={label} note={note}>
        <Input label={label} labelShownBeside onValueChange={setName} opensFocused value={name} />
      </DialogRow>

      {collects === 'option' ? (
        <DialogRow label={FORM_FIELD_OPTION_LABEL}>
          <Input label={FORM_FIELD_OPTION_LABEL} labelShownBeside onValueChange={setOption} value={option} />
        </DialogRow>
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
            // ONE ROW PER OPTION, its remove control beside its field in the row's control.
            <DialogRow key={index} label={FORM_FIELD_OPTIONS_LABEL}>
              <Input
                label={FORM_FIELD_OPTIONS_LABEL}
                labelShownBeside
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
            </DialogRow>
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
        {problem === undefined ? '' : _(problem)}
      </p>
      <DialogFooter>
        <Button
          disabled={invalid !== undefined}
          label={apply}
          onClick={() => {
            attempt.attempt();
            // GUARDED rather than trusting the disabled attribute: the schema behind
            // `resolve` refuses an empty name, so a mismatch would throw over
            // the user's document rather than doing nothing.
            if (!usable) return;
            resolve({
              name,
              ...(collects === 'option' ? { option } : {}),
              ...(collects === 'options' ? { options: filled } : {}),
            });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
