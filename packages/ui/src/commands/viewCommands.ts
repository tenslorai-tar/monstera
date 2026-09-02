import { DARK_PAGE_TITLE, GRID_TITLE, PALETTE_TITLE, RULERS_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';
import { DARK_PAGE_SETTING, GRID_SETTING, RULERS_SETTING } from '../settings/viewing.js';
import type { SettingsStore } from '../settingsStore.js';

/**
 * The reading aids a user turns on and off.
 *
 * ## Why a COMMAND writing a SETTING, and not one or the other
 *
 * The two answer different questions and both have to be answered:
 *
 * - **Where is the value?** In the settings registry, because it survives a
 *   restart and §10.4 says configurable behaviour lives there. A component
 *   holding it in state would be a preference that forgets itself.
 * - **How does a person reach it?** Through the command registry, because that
 *   is the only wiring place — the ribbon, the palette and the shortcut map are
 *   projections of it, and a toggle reachable only from a settings dialog is a
 *   display control a user cannot find while reading.
 *
 * This is not two writers. The setting is the writer of record for the value;
 * the command is one caller of `set`, and every surface that toggles a ruler is
 * a projection of this one entry.
 *
 * **These are `SettingsStore.set`'s first shipped callers**, which is why
 * `persistSettings` now reports a failed write: until something could change a
 * setting under a user, no write could fail under one.
 *
 * ## `when: hasDocument`, which was a correction rather than a default
 *
 * These were registered unconditionally at first, on the argument that a person
 * might set up their view before opening anything. The suite said otherwise, in
 * one line: *"the toolbar is ABSENT until a document is open"*. That property
 * held because every command on the surface required a document, and two that
 * did not put a **document tools** toolbar over the start screen.
 *
 * The test was right and the argument was weak. A ruler measures a page, and
 * with no page there is nothing to rule — so the guard is what the feature
 * means, not a concession to a surface.
 *
 * ## The QUICK TOOLBAR, and not the ribbon's Home section
 *
 * These are display controls, and `BUILD-PROMPT.md:604` puts display controls on
 * Home — which is where they belong the day a ribbon exists. **It does not
 * exist**: `surfaces/` holds the quick toolbar, the start screen and the dialog
 * host, and `projections.ts` computes a ribbon model nothing renders. A
 * `ribbon` placement today is a registration that projects into nothing, which
 * is §10.4's display-only sin arriving through the registry rather than through
 * a button — and it would look correct in every test that reads the model.
 *
 * So they are placed where a person can reach them, and moving them is a
 * one-line edit on the day the ribbon lands.
 */
export function toggleRulersCommand(deps: { readonly settings: SettingsStore }): UiCommand {
  return {
    id: 'view.toggle-rulers',
    title: RULERS_TITLE,
    shortcut: 'Ctrl+R',
    placements: [{ surface: 'quick-toolbar', order: 90 }],
    when: hasDocument,
    run: (): void => {
      // READ THROUGH THE STORE, not from a captured value: the command object is
      // built once and a captured boolean would toggle from whatever was true at
      // registration for ever.
      deps.settings.set(RULERS_SETTING.id, deps.settings.get(RULERS_SETTING.id) !== true);
    },
  };
}

/**
 * Opens the command palette.
 *
 * ## Registered like anything else, and it appears in ITSELF
 *
 * That reads odd and is right: the palette lists every available command, and
 * excluding this one would be a special case in the projection — the exact
 * hand-maintained exception the registry exists to forbid. A reader who runs it
 * from the palette gets the palette, which is harmless.
 *
 * **No `when`**, unlike everything else on this surface: the palette is how a
 * reader finds *Open*, so a palette that required a document would be closed on
 * the one screen where it is most needed. It has no `placements` either — it is
 * reached by its chord, and a button labelled *Command palette* is a control
 * whose whole purpose is to save a keystroke it costs a click to reach.
 */
export function commandPaletteCommand(deps: { readonly onOpen: () => void }): UiCommand {
  return {
    id: 'view.command-palette',
    title: PALETTE_TITLE,
    shortcut: 'Ctrl+K',
    placements: [],
    run: (): void => {
      deps.onOpen();
    },
  };
}

/** The grid's toggle. See {@link toggleRulersCommand} for why this shape. */
export function toggleGridCommand(deps: { readonly settings: SettingsStore }): UiCommand {
  return {
    id: 'view.toggle-grid',
    title: GRID_TITLE,
    shortcut: 'Ctrl+G',
    placements: [{ surface: 'quick-toolbar', order: 100 }],
    when: hasDocument,
    run: (): void => {
      deps.settings.set(GRID_SETTING.id, deps.settings.get(GRID_SETTING.id) !== true);
    },
  };
}

/**
 * Dark page mode's toggle.
 *
 * Same shape as the two above, and the same `when`: it inverts the page, so
 * with no page open there is nothing for it to do.
 */
export function toggleDarkPageCommand(deps: { readonly settings: SettingsStore }): UiCommand {
  return {
    id: 'view.toggle-dark-page',
    title: DARK_PAGE_TITLE,
    shortcut: 'Ctrl+Shift+D',
    placements: [{ surface: 'quick-toolbar', order: 110 }],
    when: hasDocument,
    run: (): void => {
      deps.settings.set(DARK_PAGE_SETTING.id, deps.settings.get(DARK_PAGE_SETTING.id) !== true);
    },
  };
}
