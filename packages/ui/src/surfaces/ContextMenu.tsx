import { ContextMenu } from '@base-ui/react/context-menu';
import { useLingui } from '@lingui/react';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';

import { Icon } from '../primitives/Icon.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import type { MenuContext } from '../registries/placement.js';
import { pageSlotAt } from '../useVisiblePages.js';
import { contextMenuModel, type OrderedEntry } from './projections.js';

/**
 * One of §7's four context menus — page, annotation, selection, tab — as a **projection of the
 * command registry**, around the region a right-click opens it over.
 *
 * ## It names no command, and adding an item is one placement
 *
 * `QuickToolbar`'s rule: this renders `contextMenuModel(registry, context, menu)` and knows nothing
 * about what is in it, so a command gains a menu item by declaring
 * `{ surface: 'context-menu', context, order }` and loses it by dropping that line. The owner's
 * per-tool items arrive that way, with nothing here to edit.
 *
 * ## The CONTEXT is the caller's, and it is what the item acts on
 *
 * A thumbnail's menu is about THAT page and a tab's about THAT document, so the caller hands the
 * context the gesture was made over — the page the thumbnail draws, the tab's `DocId` — rather than
 * the focused document's. A command then runs against exactly what the person right-clicked, and
 * its `when` is asked about that too.
 *
 * ## The keyboard route is the same event
 *
 * Chromium dispatches `contextmenu` to the focused element for Shift+F10 and for the Menu key, so a
 * region whose controls can take focus opens its menu from the keyboard through the same trigger.
 * Base UI's menu then gives the list its roles, arrow keys, typeahead, Escape and focus return.
 *
 * ## Nothing to show is no menu
 *
 * Where no command is placed in this context for this state, the region renders its children and
 * no trigger — an empty popup is a control that describes nothing (`QuickToolbar`'s reason).
 */
export function ContextMenuArea({
  registry,
  context,
  menus,
  children,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /**
   * The contexts this region's menu shows, most specific first — `['annotation', 'page']` over a
   * page holding the selected annotations, `['page']` over any other. Each non-empty context is a
   * group, separated from the next, so selecting something ADDS its actions rather than hiding the
   * page's.
   */
  readonly menus: readonly MenuContext[];
  readonly children: ReactNode;
}): ReactElement {
  const groups = menuGroups(registry, context, menus);
  // `display: contents` ON BOTH BRANCHES: the region adds no box to the layout it wraps — a tab, a
  // thumbnail, the page area — and a `contextmenu` from anything inside still bubbles through it.
  if (groups.length === 0) return <div className="m-context-menu-region">{children}</div>;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className="m-context-menu-region" data-context-menu={groups.map((g) => g.menu).join(' ')}>
        {children}
      </ContextMenu.Trigger>
      <MenuPopup menu={{ context, groups }} />
    </ContextMenu.Root>
  );
}

/** One non-empty context of a menu: its commands in order, drawn as a group after a separator. */
export interface MenuGroup {
  readonly menu: MenuContext;
  readonly entries: readonly OrderedEntry[];
}

/** What a right-click over one item opens: the context its commands run against, and its groups, none of them empty. */
export interface AreaMenu {
  readonly context: CommandContext;
  readonly groups: readonly MenuGroup[];
}

/** The menu over one item — a page, a tab — asked when it is right-clicked; `undefined` is no menu there. */
export type MenuAt<K> = (key: K) => AreaMenu | undefined;

/** A list behind the one on show: it opens no menu, and is the same component, so bringing it forward remounts nothing. */
export const NO_MENU: MenuAt<unknown> = () => undefined;

/**
 * The groups a menu over `context` draws, most specific first, the empty ones left out — the one place a menu's
 * contents are decided, for a region's menu and a list's alike.
 */
export function menuGroups(registry: CommandRegistry, context: CommandContext, menus: readonly MenuContext[]): readonly MenuGroup[] {
  return menus
    .map((menu) => ({ menu, entries: contextMenuModel(registry, context, menu) }))
    .filter((group) => group.entries.length > 0);
}

/**
 * ONE context menu for a whole area of like items — the pages of a list, the tabs of the strip — where the item is
 * the one the right-click landed on.
 *
 * ## One per area, never one per item
 *
 * Each page, thumbnail and tab used to sit in a `ContextMenuArea` of its own, built with the menu its item would
 * open: a Base UI menu root, its floating tree and its portal per item, and every one of them rebuilt whenever the
 * context changed — which a tab switch does, in every layer at once. Measured 2026-10-02 in Chromium 151 with a
 * 5-page and a 40-page document open: 340 menu areas rendered across one switch, the largest single cost of the
 * 1.5–2.2 s of work the installed 0.1.8.0 showed after it; and across a scroll through 40 pages, 6,360 menu builds
 * against 159 renders of the lists holding them (`tabSwitchRenders.pw.ts`). A menu is open over one item at a time,
 * so one menu per area is all the screen can show.
 *
 * ## The item is asked at the right-click, not at render
 *
 * `keyAt` reads which item holds the event's target, from the mark the area's items already carry, and `menuAt` is
 * called with it when `contextmenu` reaches the area; what it answers is the menu that opens. A target in no item, or
 * an item with no menu, opens nothing: the menu is CONTROLLED, and refuses to open on such an event, which is what an
 * item with no region did before. The keyboard route is the same event, dispatched to the focused element inside the
 * item.
 *
 * ## What it holds while open is what was asked
 *
 * The menu shows and runs against the answer taken at the right-click, as a per-item menu did against its render.
 */
export function MenuArea<K>({
  keyAt,
  menuAt,
  children,
}: {
  /** Which item holds `target`, or `undefined` for a target in none. Stable, for `menuAt`'s reason. */
  readonly keyAt: (target: EventTarget | null) => K | undefined;
  readonly menuAt: MenuAt<K>;
  readonly children: ReactNode;
}): ReactElement {
  const [shown, setShown] = useState<AreaMenu | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // THE ANSWER FOR THE EVENT IN FLIGHT: set by the capture handler below and read by `onOpenChange`, which Base UI
  // calls from the same event's bubbling. A ref, because the state set a moment earlier is not readable until the
  // next render.
  const asked = useRef<AreaMenu | undefined>(undefined);
  return (
    <ContextMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next && asked.current !== undefined);
      }}
    >
      <ContextMenu.Trigger
        className="m-context-menu-region"
        data-menu-area=""
        onContextMenuCapture={(event) => {
          const key = keyAt(event.target);
          const menu = key === undefined ? undefined : menuAt(key);
          asked.current = menu;
          if (menu !== undefined) setShown(menu);
        }}
      >
        {children}
      </ContextMenu.Trigger>
      {shown === undefined ? null : <MenuPopup menu={shown} />}
    </ContextMenu.Root>
  );
}

/** The page whose slot holds a target, through the one reader of the `data-page` mark. Module-level, so stable. */
const PAGE_AT = (target: EventTarget | null): number | undefined => pageSlotAt(target)?.page;

/**
 * A list's slots inside its page menu (§7), or bare where the list has none. A list's `menuAt` is defined for as long
 * as it is mounted or never — `NO_MENU` behind, the live one in front — so the element at this position never changes
 * type and its slots are never remounted by a switch.
 */
export function inPageMenu(menuAt: MenuAt<number> | undefined, slots: ReactNode): ReactNode {
  return menuAt === undefined ? slots : <MenuArea keyAt={PAGE_AT} menuAt={menuAt}>{slots}</MenuArea>;
}

/** The popup both areas draw: its groups, separated, each item running against the menu's context. */
function MenuPopup({ menu }: { readonly menu: AreaMenu }): ReactElement {
  const { i18n } = useLingui();
  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner>
        <ContextMenu.Popup
          className="m-context-menu m-area-menu"
          // A PRESS IN THE MENU LEAVES THE PAGE'S SELECTION ALONE. A mousedown's default action
          // moves the document's selection to where it lands, so clicking *Copy* emptied the very
          // selection the item was about to copy — measured 2026-09-19: the selection was `""`
          // when the command ran. Base UI takes its items from pointer and click events and moves
          // focus itself, so neither needs the default this cancels.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          {menu.groups.flatMap(({ menu: group, entries }, index) => [
            ...(index === 0 ? [] : [<ContextMenu.Separator key={`separator-${group}`} className="m-context-menu-separator" />]),
            ...entries.map((entry) => (
              <ContextMenu.Item
                key={entry.command.id}
                className="m-context-menu-item"
                data-command={entry.command.id}
                label={i18n._(entry.command.title)}
                // THE CHORD ANNOUNCED AS A SHORTCUT and kept out of the item's name, `MenuBar`'s rule.
                aria-keyshortcuts={entry.command.shortcut}
                onClick={() => {
                  // Not awaited, `QuickToolbar`'s reason: the command reports through its own
                  // callback, and a handler returning a promise would make the menu wait on IPC.
                  void entry.command.run(menu.context);
                }}
              >
                {/* THE COMMAND'S GLYPH in its own column, the menu row's rule (the owner's item 9b): every title starts
                    at one edge. Decorative, the item's name being its title, and in the item's colour. The registry
                    refuses a command placed here without one. */}
                <span className="m-context-menu__icon" aria-hidden="true">
                  {entry.command.icon === undefined ? null : <Icon name={entry.command.icon} size="dense" />}
                </span>
                <span>{i18n._(entry.command.title)}</span>
                {entry.command.shortcut === undefined ? null : (
                  <span className="m-context-menu-chord" aria-hidden="true">
                    {entry.command.shortcut}
                  </span>
                )}
              </ContextMenu.Item>
            )),
          ])}
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}
