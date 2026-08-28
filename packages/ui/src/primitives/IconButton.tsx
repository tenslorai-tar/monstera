import { Button as BaseButton } from '@base-ui/react/button';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import type { IconSize } from './iconSize.js';

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
 * ## The tooltip half is OWED, with a trigger rather than a note
 *
 * §10.4 asks for a tooltip as well, and `Tooltip` is not one of Stage 0's four
 * primitives — it is in the set added *"the first time a feature needs them"*.
 * Nothing mounts an icon button yet, so the obligation is not live; it becomes
 * live at the first surface that renders one, which is the same commit that
 * needs `Tooltip`. `label` is already the text that tooltip will carry, so this
 * is one prop feeding two consumers rather than a second thing to write.
 *
 * Recorded here rather than in a document because this is where someone
 * building that surface will be reading.
 */
export interface IconButtonProps {
  /** The lucide icon component, e.g. `X`. Passed in, so this file imports none. */
  icon: LucideIcon;
  /**
   * The accessible name — what the control DOES, not what the glyph depicts.
   * "Close" rather than "cross".
   */
  label: string;
  /**
   * Which of §10.4's four uses this control is. The pixel size follows from it,
   * in `primitives.css` — see {@link IconSize} for why it is not written here.
   */
  size: IconSize;
  disabled?: boolean;
  onClick?: (() => void) | undefined;
}

export function IconButton({
  icon: Icon,
  label,
  size,
  disabled = false,
  onClick,
}: IconButtonProps): ReactElement {
  return (
    <BaseButton
      aria-label={label}
      className={`m-icon-button m-icon-button--${size}`}
      disabled={disabled}
      nativeButton
      onClick={onClick}
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
  );
}
