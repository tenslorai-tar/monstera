import { Menu } from '@base-ui/react/menu';
import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { CHOICE_MENU_NAME } from '../messages/en.js';
import { Icon } from './Icon.js';
import type { SegmentedOption } from './SegmentedControl.js';

/**
 * A choice of one value from a short list, drawn closed as its NAME and opened as a menu of the values.
 *
 * ## Where it differs from `SegmentedControl`, and why it exists beside it
 *
 * A segmented control shows every value at once, which is right where there is room and wrong in the Assistant's
 * pane, where *Asking about* wrapped onto two lines of six chips over the message box (the owner's review of
 * 0.1.6.0, `assistant_1` to `3`). This draws one button reading what is being chosen — *Context*, *Sources* — and
 * opens the values on demand. The options are the segmented control's type, so a caller moving between the two
 * changes the component and nothing else.
 *
 * ## The value is in the NAME, because the face does not show it
 *
 * The closed button reads only its label, by the owner's design. A screen reader is told the label AND the chosen
 * value (`CHOICE_MENU_NAME`), since a control whose state is visible to nobody is a control a person cannot check.
 * Each value is a radio item, so the open menu announces which one is chosen.
 *
 * ## A Base UI MENU, never its Select
 *
 * Base UI's `Select` injects a `<style>` element, which the renderer's pinned CSP refuses (invariant 27; the same
 * reason `DocumentChoice` is a native select). A menu does not, and it is positioned like every other popup here,
 * so it is a no-drag region over the title bar like them (`primitives.css`, `[data-side]`).
 */
export interface ChoiceMenuProps<Value extends string> {
  /** What is being chosen, which is also the closed face: *Context*, *Sources*. */
  readonly label: MessageKey;
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}

export function ChoiceMenu<Value extends string>({ label, options, value, onChange }: ChoiceMenuProps<Value>): ReactElement {
  const { _ } = useLingui();
  const chosen = options.find((option) => option.value === value);
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={_(CHOICE_MENU_NAME, { label: _(label), value: chosen === undefined ? '' : _(chosen.label, chosen.values) })}
        className="m-choice-menu"
        data-choice-menu=""
      >
        <span>{_(label)}</span>
        <Icon name="ChevronDown" size="dense" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="top" sideOffset={4}>
          <Menu.Popup className="m-context-menu m-choice-menu__popup">
            <Menu.RadioGroup
              value={value}
              onValueChange={(next: unknown) => {
                // A VALUE FROM THE OPTIONS ONLY: Base UI types a radio's value as `unknown`, and every value this menu
                // renders is one of `options`, so anything else is not a choice anybody made.
                const picked = options.find((option) => option.value === next);
                if (picked === undefined || picked.value === value) return;
                onChange(picked.value);
              }}
            >
              {options.map((option) => (
                <Menu.RadioItem
                  className="m-context-menu-item"
                  closeOnClick
                  data-choice={option.value}
                  disabled={option.disabled === true}
                  key={option.value}
                  label={_(option.label, option.values)}
                  value={option.value}
                >
                  <Menu.RadioItemIndicator className="m-choice-menu__mark" keepMounted>
                    {option.value === value ? <Icon name="Check" size="dense" /> : null}
                  </Menu.RadioItemIndicator>
                  <span>{_(option.label, option.values)}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
