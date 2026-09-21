import { useLingui } from '@lingui/react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

/**
 * A tooltip naming — or describing — the control it is attached to (§10.4: *"Every
 * icon-only control has a tooltip and an accessible name"*).
 *
 * `IconButton`'s header owed this until the first surface rendered an icon-only control,
 * and the document panel's tab strip is that surface.
 *
 * ## It used to say "the text is the label, never a second string" (corrected 2026-09-21)
 *
 * That rule was right while every control carrying a tooltip was **icon-only**, where the
 * tooltip IS the accessible name and a second string would be a name the screen reader
 * never hears. The ribbon's buttons are not icon-only: they carry a visible label, and
 * the owner's design pass makes that label one or two words with the full description in
 * the tooltip. So the two texts are now deliberately different, and what stops that
 * becoming the defect the old rule guarded is **which ARIA relationship each one takes**.
 *
 * Base UI wires the popup as `aria-describedby`, so the tooltip is the control's
 * DESCRIPTION and never its name. A visible label remains the name; an icon-only control
 * still has none of its own, which is why `IconButton` passes the label here and must go
 * on doing so. The rule that replaces the old one: **a tooltip may say more than the
 * name, and may never say something else.**
 */
export interface TooltipProps {
  /**
   * What the tooltip says.
   *
   * For an icon-only control this is the accessible name and must match it exactly. For a
   * control with a visible label it is the fuller description, which the label abbreviates.
   */
  readonly label: MessageKey;
  /** The control, rendered as the trigger. It must carry its own accessible name. */
  readonly children: ReactElement;
}

export function Tooltip({ label, children }: TooltipProps): ReactElement {
  const { _ } = useLingui();
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6}>
          <BaseTooltip.Popup className="m-tooltip">{_(label)}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
