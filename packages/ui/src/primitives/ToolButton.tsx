import { useLingui } from '@lingui/react';
import { Button as BaseButton } from '@base-ui/react/button';
import type { MessageKey } from '@monstera/shared';
import { useId, type ReactElement } from 'react';

import { Icon } from './Icon.js';
import type { IconName } from './icons.js';
import { Tooltip } from './Tooltip.js';

/**
 * A ribbon button: a glyph over its caption, §10.3's *"compact 52 px buttons"*
 * with §10.4's 20 px ribbon icon.
 *
 * A primitive rather than markup in `Ribbon.tsx`, because §10.4 grows controls
 * *"in the package, never ad hoc in the feature"*. A surface that drew its own
 * glyph-and-caption button would be the first of several.
 *
 * ## The caption IS the accessible name
 *
 * The label is visible, so it names the control and the glyph is hidden. An
 * `aria-label` beside visible text would be a second name, and the two can
 * disagree the day the catalogue is translated.
 *
 * ## And the DESCRIPTION is a different relationship, not a longer name
 *
 * The owner's design pass makes every ribbon caption one or two words, with the
 * full sentence in the tooltip. Those are two texts on one control, which is the
 * shape `Tooltip`'s old rule forbade — and what makes it sound here is that they
 * take different ARIA relationships: the caption is `aria-labelledby` by being
 * visible text, and Base UI wires the tooltip popup as `aria-describedby`. A
 * screen-reader user hears *Straighten*, then *Straighten crooked pages*.
 *
 * **A button with no description is not wrapped at all**, rather than wrapped
 * with its own label repeated. A tooltip that says exactly what is already on
 * screen is noise a pointer user cannot dismiss, and for a control whose name is
 * visible it adds nothing to the accessibility tree either.
 */
export interface ToolButtonProps {
  readonly label: MessageKey;
  /**
   * The fuller sentence, shown on hover and focus and exposed as the control's
   * description. Absent where the caption already says the whole thing.
   */
  // `| undefined` SPELT OUT, because `exactOptionalPropertyTypes` is on: a
  // projection forwards `command.description` whether or not the command has
  // one, and a bare `?:` would refuse the absent case at every call site and be
  // worked around with a spread.
  readonly description?: MessageKey | undefined;
  readonly icon: IconName;
  readonly onClick: () => void;
}

export function ToolButton({ label, description, icon, onClick }: ToolButtonProps): ReactElement {
  const { _ } = useLingui();
  const describedBy = useId();
  const button = (
    <BaseButton
      aria-describedby={description === undefined ? undefined : describedBy}
      className="m-tool-button"
      nativeButton
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} size="ribbon" />
      <span className="m-tool-button__label">{_(label)}</span>
    </BaseButton>
  );
  if (description === undefined) return button;
  return (
    <>
      <Tooltip label={description}>{button}</Tooltip>
      {/* THE DESCRIPTION, WIRED BY HAND, because the tooltip does not do it.
          Measured 2026-09-21 in the packaged shell: with the popup open the
          trigger carries `data-popup-open` and `data-base-ui-tooltip-trigger`
          and NO `aria-describedby` — so a tooltip alone reaches a pointer and
          nothing else, and abbreviating the caption would have cost a screen
          reader the sentence with nothing put back. B9 makes that a defect
          rather than a shortfall.

          OUTSIDE the button, not inside it: text inside a button becomes part
          of its accessible NAME, which would make the name the caption and the
          sentence run together. Outside, the caption stays the name and this is
          the description — which is also the relationship WCAG 2.5.3 needs,
          since an abbreviation is not a substring of the sentence it stands for.

          It is always present rather than only while hovering, so the
          accessibility tree does not depend on a pointer being somewhere. */}
      <span className="m-visually-hidden" id={describedBy}>
        {_(description)}
      </span>
    </>
  );
}
