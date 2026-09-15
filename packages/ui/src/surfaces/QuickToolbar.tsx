import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { DOCUMENT_TOOLS_LABEL } from '../messages/en.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { QUICK_TOOLBAR_EDGE_SETTING, QUICK_TOOLBAR_OPEN_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
import { quickToolbarModel } from './projections.js';

/**
 * §10.3's floating quick toolbar, as a **projection of the command registry**: *"a vertical pill on
 * the canvas edge with the always-needed tools … repositionable and hideable"*.
 *
 * ## It names no command, and `check:secondwiring` is the mechanism
 *
 * This renders `quickToolbarModel(...)` and knows nothing about what is in it. Registering a command
 * with a `quick-toolbar` placement is the whole of putting it here, and removing the registration
 * removes the control with nothing to edit — §7's *"there is no second place where a feature is
 * wired"*.
 *
 * ## ICONS, at §10.4's primary-control size
 *
 * §10.4: *"16 px primary controls (rail, floating toolbar, buttons)"*. `DRAWS_A_GLYPH` already
 * refuses a command placed here with no icon, so every entry has one; the skip below keeps the type
 * honest rather than asserting. Each `IconButton` carries its title as accessible name and tooltip.
 * Until 2026-09-15 this drew text buttons, 150 px wide, which is not a pill.
 *
 * ## Rendered only when it has something in it, and when it is shown
 *
 * The model is empty when no document is focused, because every command placed here declares
 * `when: hasDocument` — a decision about emptiness, not about documents. And
 * `appearance.quick-toolbar-open` is the one owner of whether it shows; `view.toggle-quick-toolbar`
 * writes it from the palette, a chord and the status bar, which is what makes hiding it
 * recoverable once the pill itself is gone.
 *
 * ## Repositionable: which edge of the page area
 *
 * `appearance.quick-toolbar-edge`, left or right, set in the Settings dialog. Positioned against the
 * page area it floats over — `DocumentBody` places it inside that pane — never the window.
 */
export interface QuickToolbarProps {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  readonly settings: SettingsStore;
}

export function QuickToolbar({ registry, context, settings }: QuickToolbarProps): ReactElement | null {
  const { i18n } = useLingui();
  const open = useSetting(settings, QUICK_TOOLBAR_OPEN_SETTING);
  const edge = useSetting(settings, QUICK_TOOLBAR_EDGE_SETTING);
  const entries = quickToolbarModel(registry, context);
  if (!open || entries.length === 0) return null;

  return (
    <div
      className={`m-quick-toolbar m-quick-toolbar--${edge}`}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={i18n._(DOCUMENT_TOOLS_LABEL)}
    >
      {entries.flatMap((entry) => {
        const icon = entry.command.icon;
        if (icon === undefined) return [];
        return [
          <IconButton
            key={entry.command.id}
            icon={ICONS[icon]}
            label={entry.command.title}
            size="control"
            onClick={() => {
              // Not awaited: a click handler returning a promise would make React's event handling
              // wait on IPC, and nothing here reads the result — the command reports through its
              // own callback.
              void entry.command.run(context);
            }}
          />,
        ];
      })}
    </div>
  );
}
