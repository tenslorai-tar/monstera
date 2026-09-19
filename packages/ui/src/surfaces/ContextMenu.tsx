import { ContextMenu } from '@base-ui/react/context-menu';
import { useLingui } from '@lingui/react';
import type { ReactElement, ReactNode } from 'react';

import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import type { MenuContext } from '../registries/placement.js';
import { contextMenuModel } from './projections.js';

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
  const { i18n } = useLingui();
  const groups = menus
    .map((menu) => ({ menu, entries: contextMenuModel(registry, context, menu) }))
    .filter((group) => group.entries.length > 0);
  // `display: contents` ON BOTH BRANCHES: the region adds no box to the layout it wraps — a tab, a
  // thumbnail, the page area — and a `contextmenu` from anything inside still bubbles through it.
  if (groups.length === 0) return <div className="m-context-menu-region">{children}</div>;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className="m-context-menu-region" data-context-menu={groups.map((g) => g.menu).join(' ')}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="m-context-menu">
            {groups.flatMap(({ menu, entries }, index) => [
              ...(index === 0 ? [] : [<ContextMenu.Separator key={`separator-${menu}`} className="m-context-menu-separator" />]),
              ...entries.map((entry) => (
              <ContextMenu.Item
                key={entry.command.id}
                className="m-context-menu-item"
                data-command={entry.command.id}
                label={i18n._(entry.command.title)}
                onClick={() => {
                  // Not awaited, `QuickToolbar`'s reason: the command reports through its own
                  // callback, and a handler returning a promise would make the menu wait on IPC.
                  void entry.command.run(context);
                }}
              >
                <span>{i18n._(entry.command.title)}</span>
                {entry.command.shortcut === undefined ? null : (
                  <span className="m-context-menu-chord">{entry.command.shortcut}</span>
                )}
              </ContextMenu.Item>
              )),
            ])}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
