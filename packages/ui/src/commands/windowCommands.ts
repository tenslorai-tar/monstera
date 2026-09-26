import { EXIT_TITLE, START_SCREEN_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import { hasDocument } from './documentCommands.js';

/**
 * *File › Start screen* and *File › Exit* (ADR-0107, the owner's answers of 2026-09-26).
 *
 * ## Exit is the window's close, not a second one
 *
 * `closeWindow` is the SAME path the caption's × reaches through `window.close-requested`: every open document through
 * the one close path — *Save / Don't save / Cancel* for each with unsaved changes — and `window.close` only when every
 * answer let it through. A Cancel anywhere leaves everything open. An Exit that quit by itself would be a second close
 * that asks nothing, which is the one thing the owner ruled out. No chord: Alt+F4 is the platform's, and it already
 * arrives as the × does.
 *
 * ## Start screen leaves the documents open
 *
 * It shows the start screen with every tab still in the strip and none of them in front; a tab brings its document
 * back. Hidden with no document in front, when the start screen is already what is on show.
 */
export function startScreenCommand(deps: { readonly showStart: () => void }): UiCommand {
  return {
    id: 'app.start-screen',
    icon: 'House',
    title: START_SCREEN_TITLE,
    placements: [{ surface: 'menu-bar', menu: 'file', group: 0, order: 40 }],
    when: hasDocument,
    run: (): void => {
      deps.showStart();
    },
  };
}

export function exitCommand(deps: { readonly closeWindow: () => Promise<void> }): UiCommand {
  return {
    id: 'app.exit',
    title: EXIT_TITLE,
    placements: [{ surface: 'menu-bar', menu: 'file', group: 3, order: 90 }],
    run: () => deps.closeWindow(),
  };
}
