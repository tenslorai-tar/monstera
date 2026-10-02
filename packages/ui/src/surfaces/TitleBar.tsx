import { useLingui } from '@lingui/react';
import { type ReactElement, type ReactNode, useSyncExternalStore } from 'react';

import {
  LAYOUT_MODE_OPTION_TITLES,
  LAYOUT_MODE_TITLE,
  PALETTE_PLACEHOLDER,
  THEME_SWITCH_HIGH_CONTRAST,
  THEME_SWITCH_TO_DARK,
  THEME_SWITCH_TO_LIGHT,
} from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import { IconButton } from '../primitives/IconButton.js';
import { ICONS } from '../primitives/icons.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import {
  HIGH_CONTRAST_QUERIES,
  SYSTEM_DARK_QUERY,
  THEME_SETTING,
  highContrastWanted,
  shownTheme,
} from '../settings/appearance.js';
import { LAYOUT_MODE_SETTING, type LayoutMode } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';

const PALETTE_COMMAND = 'view.command-palette';
const MODES: readonly LayoutMode[] = ['ribbon', 'studio', 'focus'];

/** Whether any of `queries` matches, read by `read` and re-read when one of them changes. */
function useMediaAnswer(queries: readonly string[], read: () => boolean): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const watched = queries.map((query) => window.matchMedia(query));
      for (const query of watched) query.addEventListener('change', changed);
      return () => {
        for (const query of watched) query.removeEventListener('change', changed);
      };
    },
    read,
  );
}

const systemDark = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_DARK_QUERY).matches;

/**
 * The light and dark switch (ADR-0132): one button whose face is the theme a click switches to — a sun while dark is
 * showing, a moon while light is — running *View › Theme*'s command for it. From *System* that is the opposite of what
 * is showing. It writes nothing itself; the command writes `appearance.theme`, as Settings does.
 *
 * UNDER WINDOWS HIGH CONTRAST it is disabled and still focusable, its tooltip saying why: high contrast overrides the
 * setting (`applyAppearance`), so a click would change nothing a person could see. High contrast is read through
 * `highContrastWanted`, the same answer the theme is applied from, so the switch and the window cannot disagree.
 */
function ThemeSwitch({
  registry,
  context,
  settings,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  readonly settings: SettingsStore;
}): ReactElement | null {
  const theme = useSetting(settings, THEME_SETTING);
  const dark = useMediaAnswer([SYSTEM_DARK_QUERY], systemDark);
  const forced = useMediaAnswer(HIGH_CONTRAST_QUERIES, highContrastWanted);
  const toLight = registry.get('view.theme-light');
  const toDark = registry.get('view.theme-dark');
  if (toLight === undefined || toDark === undefined) return null;
  const next = shownTheme(theme, dark) === 'dark' ? 'light' : 'dark';
  return (
    <IconButton
      icon={next === 'light' ? ICONS.Sun : ICONS.Moon}
      label={forced ? THEME_SWITCH_HIGH_CONTRAST : next === 'light' ? THEME_SWITCH_TO_LIGHT : THEME_SWITCH_TO_DARK}
      size="dense"
      disabled={forced}
      focusableWhenDisabled
      onClick={() => {
        // Not awaited, for `QuickToolbar`'s reason: nothing here reads the result.
        void (next === 'light' ? toLight : toDark).run(context);
      }}
    />
  );
}

/**
 * §10.3's title bar: the document tabs, the Ctrl+K command search, the light and dark switch and the layout switcher —
 * drawn in every layout
 * mode, because Focus keeps it: *"the title bar stays because it holds the tabs and the way out"*.
 *
 * ## The tabs have the row
 *
 * Donate and Rate Us sat between the tabs and the search until 2026-09-27, when the owner moved them to the centre of
 * the menu row above so that this row's width goes to the open documents
 * ([ADR-0113](../../../../docs/DECISIONS/0113-the-applications-own-commands-sit-at-the-centre-of-the-menu-row.md)).
 * Nothing here is projected any more: the tabs, the search and the switcher each hold a value.
 *
 * ## Each of the bar's own controls runs REGISTERED COMMANDS, and none writes anything itself
 *
 * The light and dark switch (ADR-0132) runs *View › Theme*'s two commands, as the switcher below runs the layout's;
 * its face is the value it reads (`ThemeSwitch`).
 *
 * The command search is a second surface for `view.command-palette`, as `viewCommands.ts` says it
 * would be. The switcher is a second surface for the three `view.layout-*` commands, and that one is
 * not a matter of taste: `layoutModeCommands` remembers the mode a person left for Focus when Focus is
 * entered **through a command**, so a switcher writing `appearance.layout-mode` directly would enter
 * Focus with nothing remembered, and Escape would return to Ribbon instead of where the person was.
 * The setting is read here — which segment is lit — and written by the commands alone.
 *
 * ## Nothing for a command that is not registered
 *
 * The wired-tools rule: a control whose command does not exist is a control that does nothing. The
 * application registers all four; a surface drawn over a registry without them draws neither control.
 *
 * ## The tabs are passed in
 *
 * `DocumentTabs` is data with controls and needs the shell's tab state; this bar only places it.
 *
 * ## The window's caption is the row ABOVE this one
 *
 * Since v5-14 (ADR-0107) the menu bar is the window's top row, and the system draws its three window
 * controls over that row's end (Window Controls Overlay, `windowControlsOverlay.ts`). This bar sits
 * below it, spans the window, and reserves no room for them.
 */
export function TitleBar({
  registry,
  context,
  settings,
  children,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  readonly settings: SettingsStore;
  /** The open documents' strip. */
  readonly children?: ReactNode;
}): ReactElement {
  const { _ } = useLingui();
  const mode = useSetting(settings, LAYOUT_MODE_SETTING);
  const palette = registry.get(PALETTE_COMMAND);
  const modeCommands = new Map<LayoutMode, UiCommand | undefined>(
    MODES.map((each) => [each, registry.get(`view.layout-${each}`)]),
  );
  const switchable = [...modeCommands.values()].every((command) => command !== undefined);

  return (
    <header className="m-title-bar" data-pane="title-bar">
      {/* The application's mark is the MENU BAR's since v5-14 (ADR-0107), which is the row above this one. */}
      {children}
      {palette === undefined ? null : (
        <button
          type="button"
          className="m-command-search"
          onClick={() => {
            // Not awaited, for `QuickToolbar`'s reason: nothing here reads the result.
            void palette.run(context);
          }}
        >
          <Icon name="Search" size="dense" />
          <span>{_(PALETTE_PLACEHOLDER)}</span>
          {palette.shortcut === undefined ? null : (
            <kbd className="m-command-search__chord">{palette.shortcut}</kbd>
          )}
        </button>
      )}
      <ThemeSwitch registry={registry} context={context} settings={settings} />
      {switchable ? (
        <SegmentedControl<LayoutMode>
          label={LAYOUT_MODE_TITLE}
          options={MODES.map((each) => ({ value: each, label: LAYOUT_MODE_OPTION_TITLES[each] }))}
          value={mode}
          onChange={(chosen) => {
            void modeCommands.get(chosen)?.run(context);
          }}
        />
      ) : null}
    </header>
  );
}
