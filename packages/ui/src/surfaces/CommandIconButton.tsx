import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { IconButton } from '../primitives/IconButton.js';
import { ICONS, type IconName } from '../primitives/icons.js';
import type { RunCommand } from '../registries/useRunCommand.js';

/**
 * One command drawn as an icon button — the float bar's and the status bar's — given only plain values and the
 * surface's runner (`useRunCommand`), which runs the command by its id against the registry and context on screen at the
 * press. Handed the command object, or a handler made in the surface's list, every button was new at every version a
 * command moves — which rebuilds the registry — and was drawn again with the UI library's button and tooltip under it
 * (ADR-0258's measurement); `RibbonTool` is the ribbon's.
 */
export function CommandIconButton({
  id,
  label,
  icon,
  pressed,
  run,
  size,
}: {
  readonly id: string;
  readonly label: MessageKey;
  readonly icon: IconName;
  /** Whether the state it sets is on, read from the context while the surface is drawn; `undefined` for none. */
  readonly pressed: boolean | undefined;
  readonly run: RunCommand;
  readonly size: 'control' | 'dense';
}): ReactElement {
  return (
    <IconButton
      icon={ICONS[icon]}
      label={label}
      size={size}
      pressed={pressed}
      onClick={() => {
        run(id);
      }}
    />
  );
}
