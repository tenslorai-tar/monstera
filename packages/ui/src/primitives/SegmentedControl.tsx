import { useLingui } from '@lingui/react';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

/** One segment: the value it selects and the text it shows, which is also its accessible name. */
export interface SegmentedOption<Value extends string> {
  readonly value: Value;
  readonly label: MessageKey;
  /** Values the label's message interpolates — a page number in *Page {page}*. */
  readonly values?: Readonly<Record<string, string | number>> | undefined;
  /**
   * Drawn but not choosable: a choice that exists and cannot be made now (a picture of the page for a model that
   * cannot see). ADR-0081's rule — disabled, not dropped, so the choice does not appear and vanish under a person.
   */
  readonly disabled?: boolean | undefined;
}

export interface SegmentedControlProps<Value extends string> {
  /** The group's accessible name — what is being chosen, e.g. *Layout*. */
  readonly label: MessageKey;
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  /** Lets the segments wrap onto more lines rather than overflow a narrow place (the Assistant's panel). */
  readonly wrap?: boolean | undefined;
}

/**
 * A choice of exactly one of a few values, shown all at once (§10.3's *"segmented control"*; M4: a
 * primitive is added the first time a feature needs it, in the package).
 *
 * ## Base UI's toggle group, and the one thing it does that this must not
 *
 * The group gives the keyboard model — one tab stop, arrow keys between segments — and
 * `aria-pressed` on each segment, so nothing here re-implements focus movement. Single-select is
 * its default; what it also allows is pressing the pressed segment, which leaves **no** value
 * selected. A segmented control always holds one, so an empty change is refused here rather than
 * passed on: the caller's value is controlled, and an ignored change leaves the pressed segment
 * pressed.
 *
 * A change to the value already held is not reported either, so a caller's `onChange` means a
 * different value was chosen — the layout switcher runs a command on it, and re-running Focus from
 * Focus is not something a click on the lit segment should do.
 */
export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  wrap,
}: SegmentedControlProps<Value>): ReactElement {
  const { _ } = useLingui();
  return (
    <ToggleGroup<Value>
      aria-label={_(label)}
      className={wrap === true ? 'm-segmented m-segmented--wrap' : 'm-segmented'}
      value={[value]}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen === undefined || chosen === value) return;
        onChange(chosen);
      }}
    >
      {options.map((option) => (
        <Toggle<Value>
          key={option.value}
          className="m-segmented__item"
          disabled={option.disabled === true}
          value={option.value}
        >
          {_(option.label, option.values)}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
