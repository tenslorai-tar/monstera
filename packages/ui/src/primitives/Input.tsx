import { useLingui } from '@lingui/react';
import { Field } from '@base-ui/react/field';
import { Input as BaseInput } from '@base-ui/react/input';
import type { MessageKey } from '@monstera/shared';
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
  label: MessageKey;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /**
   * A hint shown when empty. Never a substitute for {@link label}.
   *
   * A `MessageKey` too: it is text a user reads, and the only thing that made it
   * feel different from a label is that it is optional.
   */
  placeholder?: MessageKey | undefined;
  /**
   * Whether what is typed is a secret the screen must not show.
   *
   * **A boolean rather than a `type` passthrough**, and the difference is B5:
   * `type` would let a caller spell `email`, `number` or `url` — four more
   * behaviours nothing here has designed, each with its own browser validation
   * and its own mobile keyboard — while this names the one distinction the
   * application actually has. The wrong choice stops being expressible instead
   * of being discouraged.
   *
   * It is also the only reason this primitive knows anything about input types
   * at all: a document password is text a person types into a dialog like any
   * other, and rendering it in the clear is the one thing that would be wrong
   * (ADR-0055).
   */
  secret?: boolean;
  /**
   * Whether what is in the field is refused — too long, not a number. Base UI's field writes `aria-invalid` on the
   * control, so the field that is wrong is announced as wrong, beside the sentence that says why (WCAG 3.3.1).
   */
  invalid?: boolean | undefined;
  /**
   * What the field holds, for the browser's own fill-in (WCAG 1.3.5) — `name` for a person's name, `email`. A token
   * from the HTML list, never free text; absent for a field whose purpose is not one of them.
   */
  purpose?: 'name' | 'email' | undefined;
  /**
   * Where the field sits in a row that already SHOWS its label — the Settings dialog's, whose bold words beside the
   * control are that label. The field keeps its own `<label>` for its accessible name, drawn visually hidden, so the
   * name is still one string for both populations and the screen shows it once.
   */
  labelShownBeside?: boolean;
}

export function Input({
  label,
  value,
  onValueChange,
  disabled = false,
  placeholder,
  secret = false,
  invalid,
  purpose,
  labelShownBeside = false,
}: InputProps): ReactElement {
  // Subscribed rather than resolved once — see `Button`.
  const { _ } = useLingui();

  return (
    <Field.Root className="m-field" disabled={disabled} invalid={invalid}>
      <Field.Label className={labelShownBeside ? 'm-visually-hidden' : 'm-field__label'}>{_(label)}</Field.Label>
      <BaseInput
        autoComplete={purpose}
        className="m-input"
        // HTML'S OWN RULE FOR WHICH WAY TYPED TEXT RUNS: the first letter with a direction decides, so Hebrew or Arabic
        // shows right to left as it is typed, and Latin as before. The platform's answer, not one of ours (ADR-0128).
        dir="auto"
        onValueChange={(next): void => {
          onValueChange(next);
        }}
        // `undefined` stays `undefined` rather than becoming the empty string:
        // an absent placeholder and a placeholder that resolves to nothing are
        // different, and only one of them is a catalogue defect.
        placeholder={placeholder === undefined ? undefined : _(placeholder)}
        type={secret ? 'password' : 'text'}
        value={value}
      />
    </Field.Root>
  );
}

/**
 * A field for text that runs to sentences — a note, a text box's words, a reply.
 *
 * **It grows with what is typed and then scrolls inside**: three lines to start, so it reads as a place to write
 * rather than a one-line box (the owner's review: a note in a one-line field), and at most ten, past which it scrolls
 * so the dialog's footer stays in the window. `field-sizing: content` is the platform's own growing box
 * (`primitives.css`), so no script measures it.
 *
 * The same Base UI field as {@link Input}, so its label, its invalid state and its direction are one rule for both.
 * Enter starts a new line, as it does in any multi-line box; the dialog's action is its button.
 */
export function TextArea({
  label,
  value,
  onValueChange,
  disabled = false,
  invalid,
  labelShownBeside = false,
}: Pick<InputProps, 'label' | 'value' | 'onValueChange' | 'disabled' | 'invalid' | 'labelShownBeside'>): ReactElement {
  const { _ } = useLingui();
  return (
    <Field.Root className="m-field m-field--text" disabled={disabled} invalid={invalid}>
      <Field.Label className={labelShownBeside ? 'm-visually-hidden' : 'm-field__label'}>{_(label)}</Field.Label>
      <BaseInput
        className="m-input m-textarea"
        dir="auto"
        onValueChange={(next): void => {
          onValueChange(next);
        }}
        render={<textarea rows={3} />}
        value={value}
      />
    </Field.Root>
  );
}
