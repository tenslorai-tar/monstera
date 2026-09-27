import { NEXT_PANE_TITLE, PREVIOUS_PANE_TITLE } from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';

/**
 * F6 and Shift+F6 move the focus between the window's panes (the owner's 27 September list, item 12; WCAG 2.1.1).
 *
 * ## Windows' convention, and the WAI-ARIA one
 *
 * F6 cycles among the panes of a window in Windows applications, and the WAI-ARIA Authoring Practices' *Window
 * Splitter* pattern names it as the key that moves between panes. Tab reaches everything too, but through every control
 * on the way: a keyboard user in the page area who wants the status bar's page field would otherwise walk the whole
 * ribbon and both panels to get there.
 *
 * ## The panes say so themselves
 *
 * Each pane's root carries `data-pane`, and the order is the document's — title bar, ribbon, document panel, pages,
 * right panel, status bar — so a pane that is not drawn (a collapsed panel, Focus mode's hidden chrome) is simply not
 * in the cycle, and a new pane joins by carrying the attribute rather than by an edit to a list here.
 *
 * ## Where the focus lands
 *
 * On the pane's first control a keyboard can reach, or on the pane itself when it holds none, so the move always lands
 * somewhere a screen reader announces.
 */

const REACHABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

/**
 * Moves the focus to the next (`1`) or previous (`-1`) pane after the one holding it, wrapping at the ends.
 *
 * @returns the pane it moved to, or `undefined` where the window draws no pane at all
 */
export function cyclePane(root: ParentNode, step: 1 | -1, active: Element | null): HTMLElement | undefined {
  const panes = [...root.querySelectorAll<HTMLElement>('[data-pane]')];
  if (panes.length === 0) return undefined;
  const current = panes.findIndex((pane) => active !== null && pane.contains(active));
  // FROM OUTSIDE EVERY PANE (the menu bar, a dialog just closed), F6 goes to the first and Shift+F6 to the last.
  const next = current === -1 ? (step === 1 ? 0 : panes.length - 1) : (current + step + panes.length) % panes.length;
  const pane = panes[next];
  if (pane === undefined) return undefined;
  const target = pane.querySelector<HTMLElement>(REACHABLE);
  if (target !== null) {
    target.focus();
  } else {
    // A PANE WITH NO CONTROL takes the focus itself, programmatically only — `-1` keeps it out of the Tab order.
    if (!pane.hasAttribute('tabindex')) pane.setAttribute('tabindex', '-1');
    pane.focus();
  }
  return pane;
}

/** The two commands, so the keys are projected like every other shortcut and appear in the palette and Help. */
export function paneCommands(): readonly UiCommand[] {
  return [
    {
      id: 'view.next-pane',
      title: NEXT_PANE_TITLE,
      shortcut: 'F6',
      placements: [],
      run: (): void => {
        cyclePane(document, 1, document.activeElement);
      },
    },
    {
      id: 'view.previous-pane',
      title: PREVIOUS_PANE_TITLE,
      shortcut: 'Shift+F6',
      placements: [],
      run: (): void => {
        cyclePane(document, -1, document.activeElement);
      },
    },
  ];
}
