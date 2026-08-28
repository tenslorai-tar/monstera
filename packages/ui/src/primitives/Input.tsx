import { Field } from '@base-ui/react/field';
import { Input as BaseInput } from '@base-ui/react/input';
import type { ReactElement } from 'react';

/**
 * A single-line text input with its label (§10.4).
 *
 * ## The label is not optional, and it is not an `aria-label` either
 *
 * A control whose only name is `aria-label` is invisible to a sighted user who
 * needs to know what a field is for, and `placeholder` is not a label — it
 * disappears the moment anyone types. `Field.Root` associates a real `<label>`
 * with the control, so the name is one string serving both populations.
 *
 * Making it required means an unlabelled input cannot be constructed. That is
 * the same B5 move as `IconButton`'s required name: a rule that cannot be
 * forgotten beats a rule a lint pass has to notice was.
 *
 * ## Why Base UI's Field rather than a hand-written `htmlFor`
 *
 * The association needs an id that is unique per instance and stable across
 * renders. Hand-rolling it means either a caller-supplied id — which two call
 * sites will eventually collide on, silently pointing one label at the other's
 * control — or a generated one, which is `useId` plus the wiring Base UI already
 * ships. Rule 0's *do not re-derive a solved problem*, at the smallest scale it
 * appears.
 *
 * `label` is typed `string` and becomes `MessageKey` with the i18n scaffold
 * (ADR-0029 Decision 6).
 */
export interface InputProps {
  /** The visible label text, associated with the control. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /** A hint shown when empty. Never a substitute for {@link label}. */
  placeholder?: string | undefined;
}

export function Input({
  label,
  value,
  onValueChange,
  disabled = false,
  placeholder,
}: InputProps): ReactElement {
  return (
    <Field.Root className="m-field" disabled={disabled}>
      <Field.Label className="m-field__label">{label}</Field.Label>
      <BaseInput
        className="m-input"
        onValueChange={(next): void => {
          onValueChange(next);
        }}
        placeholder={placeholder}
        value={value}
      />
    </Field.Root>
  );
}
