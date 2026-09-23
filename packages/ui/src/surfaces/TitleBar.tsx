import { useLingui } from '@lingui/react';
import type { ReactElement, ReactNode } from 'react';

import titleLogo from '../../../../assets/brand/logo-title.png';
import { LAYOUT_MODE_OPTION_TITLES, LAYOUT_MODE_TITLE, PALETTE_PLACEHOLDER } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Icon } from '../primitives/Icon.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import { LAYOUT_MODE_SETTING, type LayoutMode } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
import { titleBarModel } from './projections.js';

const PALETTE_COMMAND = 'view.command-palette';
const MODES: readonly LayoutMode[] = ['ribbon', 'studio', 'focus'];

/**
 * §10.3's title bar: the document tabs (Window Controls Overlay), **the application's own commands**,
 * the Ctrl+K command search and the layout switcher — drawn in every layout mode, because Focus keeps
 * it: *"the title bar stays because it holds the tabs and the way out"*.
 *
 * ## The buttons between the tabs and the search are a PROJECTION
 *
 * The owner's design (2026-09-22) puts Donate and Rate Us there, and
 * [ADR-0095](../../../../docs/DECISIONS/0095-the-title-bar-projects-the-applications-own-commands.md)
 * made the title bar a placement surface so this file names neither of them. A third one is a
 * placement on a command, not an edit here — which is the whole point, since a list of two commands
 * written into a surface is the cheapest-looking second wiring place there is.
 *
 * `emphasis` comes from the placement and decides the variant. The bar does not read a command's id
 * to choose how it looks, because that is the same layout table one field narrower.
 *
 * ## Both of the bar's own controls run REGISTERED COMMANDS, and neither writes anything itself
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
 * Window Controls Overlay — the bar as the window's own caption — is not here: it needs main to hide
 * the native title bar and a channel carrying the theme's colours to the overlay's buttons.
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
  const buttons = titleBarModel(registry, context);
  const palette = registry.get(PALETTE_COMMAND);
  const modeCommands = new Map<LayoutMode, UiCommand | undefined>(
    MODES.map((each) => [each, registry.get(`view.layout-${each}`)]),
  );
  const switchable = [...modeCommands.values()].every((command) => command !== undefined);

  return (
    <header className="m-title-bar">
      {/* ADR-0002: the supplied artwork, scaled. Decorative — at 26 px it reads as a shape, and the tabs beside it carry
          the identifying text — so it has an empty name rather than a second "Monstera" for a screen reader. */}
      <img className="m-title-bar__logo" src={titleLogo} alt="" />
      {children}
      {/* THE APPLICATION'S OWN COMMANDS (ADR-0095) — Donate and Rate Us in the owner's design.
          Projected, so this surface names none of them and adding a third is a placement. */}
      {buttons.length === 0 ? null : (
        <div className="m-title-bar__commands">
          {buttons.map(({ command, emphasis }) => (
            <Button
              icon={command.icon}
              key={command.id}
              label={command.title}
              onClick={() => {
                // Not awaited, for the command search's reason below: nothing here reads a result.
                void command.run(context);
              }}
              variant={emphasis === 'primary' ? 'primary' : 'default'}
            />
          ))}
        </div>
      )}
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
