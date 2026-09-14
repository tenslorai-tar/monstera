import { useLingui } from '@lingui/react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

/**
 * A tooltip naming the control it is attached to (§10.4: *"Every icon-only control has a
 * tooltip and an accessible name"*).
 *
 * `IconButton`'s header owed this until the first surface rendered an icon-only control,
 * and the document panel's tab strip is that surface.
 *
 * ## The text is the label, never a second string
 *
 * It takes the same `MessageKey` the control's accessible name comes from, so the tooltip
 * cannot say something the screen reader does not. Base UI's `Trigger` renders the
 * control through `render`, so the tooltip wraps a primitive without re-implementing it.
 */
export interface TooltipProps {
  readonly label: MessageKey;
  /** The control, rendered as the trigger. It must carry the same accessible name. */
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
