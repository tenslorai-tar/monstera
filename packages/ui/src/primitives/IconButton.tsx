import { useLingui } from '@lingui/react';
import { Button as BaseButton } from '@base-ui/react/button';
import type { MessageKey } from '@monstera/shared';
import type { LucideIcon } from 'lucide-react';
import { useRef, type ReactElement } from 'react';

import type { IconSize } from './iconSize.js';
import { Tooltip } from './Tooltip.js';
import { useOnColor } from './useOnColor.js';

/**
 * An icon-only button (§10.4).
 *
 * ## The accessible name is REQUIRED, and that is the whole point of the type
 *
 * §10.4: *"Every icon-only control has a tooltip and an accessible name."* An
 * icon-only button has no text node, so without `aria-label` its accessible name
 * is empty and a screen reader announces "button". Making `label` a required
 * prop means a nameless icon button cannot be constructed — B5 over a lint rule
 * that has to notice one is missing.
 *
 * `size` is an {@link IconSize}, so the pixel value is §10.4's and never a call
 * site's opinion.
 *
 * ## The tooltip comes from the same label
 *
 * §10.4 asks for a tooltip as well. `label` is the one text both carry, so the
 * tooltip cannot say something the accessible name does not, and a caller cannot
 * give one without the other. There is no prop to leave the tooltip off: an
 * icon-only control with a name and no tooltip is §10.4's defect too.
 */
export interface IconButtonProps {
  /** The lucide icon component, e.g. `X`. Passed in, so this file imports none. */
  icon: LucideIcon;
  /**
   * The accessible name — what the control DOES, not what the glyph depicts.
   * "Close" rather than "cross".
   */
  label: MessageKey;
  /**
   * Which of §10.4's four uses this control is. The pixel size follows from it,
   * in `primitives.css` — see {@link IconSize} for why it is not written here.
   */
  size: IconSize;
  disabled?: boolean;
  onClick?: (() => void) | undefined;
  /**
   * `'primary'` fills the control with the accent — the one action of its place, as v5-03's send arrow. The glyph's
   * colour is then SOLVED against the fill by `useOnColor`, exactly as `Button`'s primary does, never stored.
   */
  variant?: 'primary' | undefined;
}

export function IconButton({
  icon: Icon,
  label,
  size,
  disabled = false,
  onClick,
  variant,
}: IconButtonProps): ReactElement {
  // Subscribed rather than resolved once — see `Button` for why the module
  // function is the wrong call here.
  const { _ } = useLingui();
  const element = useRef<HTMLElement>(null);
  // `Button`'s rule: only an enabled primary sits on the accent; disabled, the stylesheet draws `--faint` on the surface.
  // BOTH ENDS OF THE GRADIENT DRAWN, `Button`'s reason: in light both are darker than `--accent`.
  useOnColor(
    element,
    'color',
    '--text',
    variant === 'primary' && !disabled ? ['--accent-grad-top', '--accent-grad-bottom'] : [],
    'text',
  );

  return (
    <Tooltip label={label}>
      <BaseButton
        aria-label={_(label)}
        className={
          variant === 'primary'
            ? `m-icon-button m-icon-button--${size} m-icon-button--primary`
            : `m-icon-button m-icon-button--${size}`
        }
        disabled={disabled}
        nativeButton
        onClick={onClick}
        ref={element}
        type="button"
      >
        {/* `aria-hidden`: the glyph must not contribute a second name beside the
            label above. lucide renders an <svg> with no accessible name of its
            own, but a future icon carrying a <title> would, and the announcement
            would then read twice.

            No width or height: the size class above carries it, from the one
            place §10.4's four values are written down. */}
        <Icon aria-hidden focusable={false} />
      </BaseButton>
    </Tooltip>
  );
}
