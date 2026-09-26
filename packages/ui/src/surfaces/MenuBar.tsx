import { Menu } from '@base-ui/react/menu';
import { Menubar } from '@base-ui/react/menubar';
import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { Fragment, useEffect, useRef, useState, type ReactElement } from 'react';

import titleLogo from '../../../../assets/brand/logo-title.png';
import {
  MENU_BAR_LABEL,
  MENU_FILE,
  MENU_HELP,
  MENU_VIEW,
  MENU_WINDOW,
  SECTION_COMMENT,
  SECTION_EDIT,
  SECTION_FORMS,
  SECTION_ORGANIZE,
  SECTION_PROTECT,
  SECTION_REVIEW,
  SECTION_TOOLS,
} from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import { type MenuBarItem, type MenuBarMenuModel, menuBarModel, shortcutMapOf } from './projections.js';

/** Each menu's name. Keyed by the model's own union, so a menu with no name is a compile error. */
const MENU_TITLES: Readonly<Record<MenuBarMenuModel['id'], MessageKey>> = {
  file: MENU_FILE,
  edit: SECTION_EDIT,
  view: MENU_VIEW,
  organize: SECTION_ORGANIZE,
  comment: SECTION_COMMENT,
  forms: SECTION_FORMS,
  review: SECTION_REVIEW,
  protect: SECTION_PROTECT,
  tools: SECTION_TOOLS,
  window: MENU_WINDOW,
  help: MENU_HELP,
};

/**
 * THE MENU BAR (§10.3, [ADR-0107](../../../../docs/DECISIONS/0107-the-menu-bar-is-a-projection.md)): the window's top
 * row, the application's mark and *File · Edit · View · Organize · Comment · Forms · Review · Protect · Tools · Window ·
 * Help*, with the system's window controls over its end.
 *
 * ## It names no command
 *
 * `menuBarModel` is the projection; this draws it. A section's menu is its ribbon section and the application menus
 * come from `menu-bar` placements, so a feature reaches the bar by registering, never by an edit here.
 *
 * ## The model is read WHEN A MENU OPENS
 *
 * Whether *Cut* can run depends on what has focus and what is selected there — state that changes without the shell
 * re-rendering. So opening a menu re-renders this bar, and the model is computed then, from the same context every
 * other surface receives.
 *
 * ## Alt and F10
 *
 * The Windows convention: F10, or Alt pressed and released with no other key between, moves the focus to the first
 * menu; the menubar pattern takes over from there (arrow keys, Enter, Escape). Escape from the bar returns the focus
 * to where it was, which `focusBefore` also gives a closing menu, so *Cut* in a text field cuts in that field.
 */
export function MenuBar({
  registry,
  context,
  focusBefore,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /** The text field that held the focus before the bar took it, if one did (`typingFocus.ts`). */
  readonly focusBefore: () => HTMLElement | undefined;
}): ReactElement {
  const { _ } = useLingui();
  // A COUNTER THE OPENING OF A MENU MOVES, so the model below is recomputed at that moment.
  const [, setOpened] = useState(0);
  const menus = menuBarModel(registry, context);
  const chords = new Map([...shortcutMapOf(registry)].map(([, command]) => [command.id, command.shortcut]));
  const bar = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let altAlone = false;
    const first = (): void => {
      bar.current?.querySelector<HTMLElement>('.m-menu-bar__trigger')?.focus();
    };
    const down = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') {
        altAlone = !event.repeat && !event.ctrlKey && !event.shiftKey && !event.metaKey;
        return;
      }
      altAlone = false;
      if (event.key === 'F10' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        event.preventDefault();
        first();
      }
    };
    const up = (event: KeyboardEvent): void => {
      if (event.key !== 'Alt' || !altAlone) return;
      altAlone = false;
      event.preventDefault();
      first();
    };
    // A POINTER PRESS between Alt's down and up means Alt was a modifier, not a request for the bar.
    const press = (): void => {
      altAlone = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointerdown', press);
    return (): void => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointerdown', press);
    };
  }, []);

  const run = (command: UiCommand): void => {
    // Not awaited, for `QuickToolbar`'s reason: nothing here reads the result.
    void command.run(context);
  };

  const item = ({ command, enabled, checked }: MenuBarItem): ReactElement => {
    const chord = chords.get(command.id);
    const face = (
      <>
        <span className="m-menu-bar__mark" aria-hidden="true">
          {checked === true ? <Icon name="Check" size="dense" /> : null}
        </span>
        <span className="m-menu-bar__title">{_(command.title)}</span>
        {/* THE CHORD IS SEEN, AND ANNOUNCED AS A SHORTCUT: `aria-keyshortcuts` on the item carries it to assistive
            technology, so the visible text is kept out of the item's name — *Open*, not *OpenCtrl+O*. */}
        {chord === undefined ? null : (
          <span className="m-context-menu-chord" aria-hidden="true">
            {chord}
          </span>
        )}
      </>
    );
    // A COMMAND THAT SETS A STATE is a checkable item, so a screen reader hears whether it is on.
    return checked === undefined ? (
      <Menu.Item
        key={command.id}
        className="m-context-menu-item m-menu-bar__item"
        data-command={command.id}
        disabled={!enabled}
        label={_(command.title)}
        aria-keyshortcuts={chord}
        onClick={() => {
          run(command);
        }}
      >
        {face}
      </Menu.Item>
    ) : (
      <Menu.CheckboxItem
        key={command.id}
        className="m-context-menu-item m-menu-bar__item"
        data-command={command.id}
        disabled={!enabled}
        label={_(command.title)}
        aria-keyshortcuts={chord}
        checked={checked}
        closeOnClick
        onCheckedChange={() => {
          run(command);
        }}
      >
        {face}
      </Menu.CheckboxItem>
    );
  };

  return (
    <div className="m-menu-bar" ref={bar}>
      {/* ADR-0002: the supplied artwork. Decorative — the bar is named, and the window's title names the application. */}
      <img className="m-menu-bar__logo" src={titleLogo} alt="" />
      <Menubar className="m-menu-bar__menus" aria-label={_(MENU_BAR_LABEL)}>
        {menus.map((menu) => (
          <Menu.Root
            key={menu.id}
            onOpenChange={(open) => {
              if (open) setOpened((count) => count + 1);
            }}
          >
            <Menu.Trigger className="m-menu-bar__trigger" data-menu={menu.id}>
              {_(MENU_TITLES[menu.id])}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="start" sideOffset={2}>
                <Menu.Popup className="m-context-menu m-menu-bar__popup" finalFocus={() => focusBefore() ?? true}>
                  {menu.groups.map((group, index) => (
                    <Fragment key={`${String(index)}:${group.caption ?? ''}`}>
                      {index === 0 ? null : <Menu.Separator className="m-context-menu-separator" />}
                      <Menu.Group className="m-menu-bar__group">
                        {group.caption === undefined ? null : (
                          <Menu.GroupLabel className="m-menu-bar__caption">{_(group.caption)}</Menu.GroupLabel>
                        )}
                        {group.items.map(item)}
                      </Menu.Group>
                    </Fragment>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ))}
      </Menubar>
    </div>
  );
}
