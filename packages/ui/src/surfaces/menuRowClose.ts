import type { Menu } from '@base-ui/react/menu';

/**
 * WHAT A MENU ON THE MENU ROW DOES AS IT CLOSES, decided from why Base UI says it is closing.
 *
 * Two decisions, and Base UI makes each of them wrongly for a menubar in a way our own code made worse. Both were read
 * from the menus' own open-change reasons in the development build on 2026-10-03, driving the row the way a hand does,
 * and both reproduced the owner's recording of 0.1.10.0.
 */

/**
 * WHETHER A ROW MENU GIVES THE FOCUS BACK when it closes for this reason: to the text field that held it before the bar
 * took it, else to the menu's title (`MenuBar`'s `focusBefore`).
 *
 * Only a close that ENDS the bar's use gives it back — a command chosen, Esc, the open title pressed, a press that
 * started on a title and was released elsewhere. A close that happens because the person went somewhere else leaves the
 * focus where they went: another menu opened under the pointer or the arrow keys, the focus moved out, a press outside.
 *
 * It has to be decided here because a `finalFocus` FUNCTION is always obeyed. Base UI keeps its own rule — do not pull
 * the focus back once it has moved somewhere else — only for the boolean form: `FloatingFocusManager` tests
 * `typeof returnFocus !== 'boolean'` on the option, so a function's answer is explicit even when it is `true`, and its
 * documentation's "return `true` to use the default behaviour" does not hold (read in @base-ui/react 1.7.0). With the
 * function answering for every close, a menu closed because the next title's menu opened pulled the focus back to its
 * own title, and the menu just opened closed on `focus-out` — after which hover opens nothing, because the bar switches
 * menus on hover only while one is open. That is the menu that vanished as the pointer moved along the row.
 *
 * Keyed by Base UI's own reason union, so a reason a later release adds is a compile error until it is decided here.
 */
export const GIVES_FOCUS_BACK: Readonly<Record<Menu.Root.ChangeEventReason, boolean>> = {
  'item-press': true,
  'escape-key': true,
  'trigger-press': true,
  'close-press': true,
  'cancel-open': true,
  'imperative-action': true,
  none: true,
  'sibling-open': false,
  'list-navigation': false,
  'focus-out': false,
  'outside-press': false,
  'trigger-hover': false,
  'trigger-focus': false,
};

/**
 * Whether a `cancel-open` close was raised for ANOTHER menu of the row, and so must not close this one.
 *
 * Base UI's `MenuTrigger` (1.7.0, unchanged in 1.8.0) listens once for the document's next `mouseup` whenever a
 * menubar menu opens on hover, and never removes that listener when the menu closes without one — as every menu does
 * that the pointer passes over on its way along the row. The next release anywhere runs each such listener; each tests
 * the release against ITS OWN title and popup, finds it outside them, and emits `close` on the bar's one shared floating
 * tree, which the menu open at that moment obeys. So the press that opens File on its way down is undone by its own
 * release on File: the flicker, every time after the pointer has swept the row.
 *
 * Base UI's rule for that listener is that a release on the menu's title or inside the menu is not a cancel. This
 * applies the same rule to the menu actually being closed — its own title, or an open menu — and Base UI's listener
 * for a menu that IS cancelling never reports a release there, so no real cancel is refused.
 */
export function cancelsAnotherMenu(details: Menu.Root.ChangeEventDetails): boolean {
  if (details.reason !== 'cancel-open') return false;
  const target = details.event.target;
  if (!(target instanceof Element)) return false;
  return details.trigger?.contains(target) === true || target.closest('[role="menu"]') !== null;
}
