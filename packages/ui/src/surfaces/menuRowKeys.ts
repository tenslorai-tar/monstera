import type { Menu } from '@base-ui/react/menu';

/**
 * A ROW MENU REACHED BY THE ARROW KEYS FROM ITS NEIGHBOUR, which opens with the focus on its first item — the WAI-ARIA
 * menubar pattern's second permitted form for Right and Left in a menu ("opens the submenu of that menuitem and places
 * focus on the first item"), and what a Windows menu bar does.
 *
 * Base UI moves between the bar's menus by moving the focus to the next title, which opens its menu because one is
 * open (`trigger-focus`). Nothing about that open says a key caused it, so the menu takes the focus on its popup: read
 * in the development build on 2026-10-03, after ArrowRight from File's first item the focus was on Edit's `menu`
 * element with no item highlighted — neither of the pattern's two forms, and a screen reader announced no item.
 *
 * The key is told from the pointer by the browser's own focus modality: the title the arrow key moved to matches
 * `:focus-visible` (read `edit:true`), and a title focused by a click or a hover does not (read `view:false`,
 * `organize:false`). A hover opens with `trigger-hover` in any case.
 */
export function arrivesByArrowKey(details: Menu.Root.ChangeEventDetails): boolean {
  if (details.reason !== 'trigger-focus') return false;
  const target = details.event.target;
  return target instanceof Element && target.matches(':focus-visible');
}

/**
 * A popup's first item that can run, which is where Base UI itself puts the focus when a menu opens from the keyboard
 * on its title (it skips an item disabled by attribute; `useListNavigation`'s initial sync). Focusing it through the DOM
 * brings Base UI's highlight with it, so ArrowDown moves on from there (read: Undo focused and highlighted, then Redo).
 */
export function firstItem(popup: Element): HTMLElement | null {
  for (const item of popup.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')) {
    if (item.getAttribute('aria-disabled') !== 'true' && !item.hasAttribute('data-disabled')) return item;
  }
  return null;
}
