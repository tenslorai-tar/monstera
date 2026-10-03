import { Menu } from '@base-ui/react/menu';
import { Menubar } from '@base-ui/react/menubar';
import { useLingui } from '@lingui/react';
import type { ChannelResult } from '@monstera/contract';
import type { FileHandle, MessageKey } from '@monstera/shared';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import titleLogo from '../../../../assets/brand/logo-title.png';
import {
  MENU_BAR_LABEL,
  MENU_FILE,
  MENU_HELP,
  MENU_RECENT,
  MENU_RECENT_EMPTY,
  MENU_VIEW,
  MENU_WINDOW,
  RECENT_UNAVAILABLE,
  RECENT_UNAVAILABLE_NAMED,
  SECTION_COMMENT,
  SECTION_EDIT,
  SECTION_FORMS,
  SECTION_ORGANIZE,
  SECTION_PROTECT,
  SECTION_REVIEW,
  SECTION_TOOLS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Icon } from '../primitives/Icon.js';
import type { IconName } from '../primitives/icons.js';
import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import type { MenuBarSubmenu } from '../registries/placement.js';
import { GIVES_FOCUS_BACK, cancelsAnotherMenu } from './menuRowClose.js';
import { LABELLED, type RowFit, nextRowFit } from './menuRowFit.js';
import { arrivesByArrowKey, firstItem } from './menuRowKeys.js';
import {
  type MenuBarCommandEntry,
  type MenuBarItem,
  type MenuBarMenuModel,
  type MenuBarSubmenuEntry,
  menuBarCommandsModel,
  menuBarModel,
  shortcutMapOf,
} from './projections.js';

/** A recent file as `document.recent` answers it: a handle, a name, and whether it is there now (ADR-0143). */
export type RecentMenuEntry = ChannelResult<'document.recent'>['entries'][number];

/**
 * What File › Recent draws and does — the menu row's OWN value control
 * ([ADR-0143](../../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)),
 * as the status bar's page field is the bar's. The entries are main's list; an entry opens through the one recent-open
 * route the start screen takes. Never a command per file.
 */
export interface RecentMenu {
  /**
   * Main's list as it is now, with each entry's availability, or `undefined` when it could not be read. Never rejects:
   * an unreadable list is answered as `undefined`, which the row draws as no values rather than as an empty list.
   */
  readonly read: () => Promise<readonly RecentMenuEntry[] | undefined>;
  /** Opens one, by the handle main minted for it. */
  readonly open: (handle: FileHandle) => void;
}

/** Each submenu's name and glyph. Keyed by the placement's union, so a submenu with no name is a compile error. */
const SUBMENU_FACES: Readonly<Record<MenuBarSubmenu, { readonly title: MessageKey; readonly icon: IconName }>> = {
  recent: { title: MENU_RECENT, icon: 'History' },
};

/** The Button variant each placement tone draws as. Keyed by the placement's union, so a new tone fails to compile. */
const TONE_VARIANT: Readonly<Record<MenuBarCommandEntry['tone'], 'gold' | 'violet' | 'default'>> = {
  gold: 'gold',
  violet: 'violet',
  plain: 'default',
};

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
 * ## At its centre, the application's own commands
 *
 * Donate and Rate Us ([ADR-0113](../../../../docs/DECISIONS/0113-the-applications-own-commands-sit-at-the-centre-of-the-menu-row.md)),
 * projected by `menuBarCommandsModel` and drawn in the tone their placement names — never chosen here by id. The row is
 * three tracks: the mark and the menus, the commands, and a drag track whose minimum is the window controls plus
 * `--menu-drag-min`. The outer tracks share the free width, so the commands centre on the window; when the menus are
 * wider than their half they keep their width and the commands follow them. When even that cannot hold the words, the
 * buttons draw as their icons (`menuRowFit.ts`), which the row decides from its own measured slack.
 *
 * ## Alt and F10
 *
 * The Windows convention: F10, or Alt pressed and released with no other key between, moves the focus to the first
 * menu; the menubar pattern takes over from there (arrow keys, Enter, Escape). Escape from the bar returns the focus
 * to where it was, which `focusBefore` also gives a menu whose close ends the bar's use, so *Cut* in a text field cuts
 * in that field. A menu closed because the person went elsewhere leaves the focus there (`menuRowClose.ts`).
 */
export function MenuBar({
  registry,
  context,
  focusBefore,
  recent,
}: {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  /** The text field that held the focus before the bar took it, if one did (`typingFocus.ts`). */
  readonly focusBefore: () => HTMLElement | undefined;
  /** File › Recent's values and how one opens (ADR-0143). */
  readonly recent: RecentMenu;
}): ReactElement {
  const { _ } = useLingui();
  // A COUNTER THE OPENING OF A MENU MOVES, so the model below is recomputed at that moment.
  const [, setOpened] = useState(0);
  // THE RECENT LIST AS MAIN LAST ANSWERED IT, read again each time a menu holding File › Recent opens — so the submenu
  // shows the list, and which files are there, as they are when the person looks. `undefined` until an answer comes.
  const [recentEntries, setRecentEntries] = useState<readonly RecentMenuEntry[] | undefined>(undefined);
  const menus = menuBarModel(registry, context);
  const buttons = menuBarCommandsModel(registry, context);
  const chords = new Map([...shortcutMapOf(registry)].map(([, command]) => [command.id, command.shortcut]));
  const bar = useRef<HTMLDivElement | null>(null);
  const start = useRef<HTMLDivElement | null>(null);
  const commands = useRef<HTMLDivElement | null>(null);
  const reserve = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<RowFit>(LABELLED);
  const hasButtons = buttons.length > 0;
  // WHY EACH ROW MENU LAST CLOSED, as Base UI reported it, keyed by the menu's id.
  const closedFor = useRef(new Map<string, Menu.Root.ChangeEventReason>());
  // THE TITLE OF EACH ROW MENU THE ARROW KEYS ARE BRINGING, until that menu has finished opening.
  const byArrowKey = useRef(new Map<string, Element>());

  // THE ROW'S SLACK, measured whenever any of its parts changes width — a window resize, a language, a button
  // appearing. Its width less its padding, the three parts as drawn, and the two gaps between them.
  useLayoutEffect(() => {
    const row = bar.current;
    if (row === null || !hasButtons || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const style = getComputedStyle(row);
      const inner = row.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd);
      const gaps = 2 * parseFloat(style.columnGap || '0');
      const held = [start, commands, reserve].reduce((sum, part) => sum + (part.current?.offsetWidth ?? 0), 0);
      const drawn = commands.current?.offsetWidth ?? 0;
      setFit((was) => {
        const next = nextRowFit(was, inner - held - gaps, drawn);
        return next.iconsOnly === was.iconsOnly && next.labelled === was.labelled ? was : next;
      });
    };
    // NO FIRST CALL HERE: an observer reports every element once when it starts observing, which is the first
    // measurement, and it arrives as a callback rather than as a state change inside this effect.
    const observer = new ResizeObserver(measure);
    for (const part of [row, start.current, commands.current]) if (part !== null) observer.observe(part);
    return (): void => {
      observer.disconnect();
    };
  }, [hasButtons]);

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

  /**
   * One command item. `held` is false for a submenu's command while the submenu has no values: it acts on them, so with
   * none there is nothing for it to do (ADR-0143) — *Clear list* over an empty list.
   */
  const item = ({ command, enabled, checked }: MenuBarItem, held = true): ReactElement => {
    const chord = chords.get(command.id);
    const runs = enabled && held;
    const face = (
      <>
        <span className="m-menu-bar__mark" aria-hidden="true">
          {checked === true ? <Icon name="Check" size="dense" /> : null}
        </span>
        {/* THE COMMAND'S GLYPH in its own column, so every title starts at one edge (the owner's review of 0.1.8.0).
            Decorative: the item's name is its title. It takes the item's colour, so a disabled item's glyph is muted
            with its words. The registry refuses a command in a menu without one. */}
        <span className="m-menu-bar__icon" aria-hidden="true">
          {command.icon === undefined ? null : <Icon name={command.icon} size="dense" />}
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
        disabled={!runs}
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
        disabled={!runs}
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

  /** File › Recent's own values: each file main keeps, an unavailable one disabled and saying so (ADR-0143). */
  const recentValues = (): readonly ReactElement[] | undefined => {
    if (recentEntries === undefined) return undefined;
    if (recentEntries.length === 0) {
      return [
        <Menu.Item key="empty" className="m-context-menu-item m-menu-bar__item" disabled>
          <span className="m-menu-bar__mark" aria-hidden="true" />
          <span className="m-menu-bar__icon" aria-hidden="true" />
          <span className="m-menu-bar__title">{_(MENU_RECENT_EMPTY)}</span>
        </Menu.Item>,
      ];
    }
    return recentEntries.map((entry) => (
      // THE HANDLE IS THE KEY, as on the start screen: two files may share a name.
      <Menu.Item
        key={entry.handle}
        className="m-context-menu-item m-menu-bar__item"
        data-recent-file={entry.name}
        // LISTED AND DISABLED, NEVER HIDDEN: a file on a drive that is not connected is back when the drive is. Its
        // name carries the state, so a screen reader hears it with the file rather than only seeing muted text.
        disabled={!entry.available}
        label={entry.name}
        aria-label={entry.available ? undefined : _(RECENT_UNAVAILABLE_NAMED, { name: entry.name })}
        onClick={() => {
          recent.open(entry.handle);
        }}
      >
        <span className="m-menu-bar__mark" aria-hidden="true" />
        <span className="m-menu-bar__icon" aria-hidden="true">
          <Icon name="FileText" size="dense" />
        </span>
        <span className="m-menu-bar__title m-menu-bar__file">{entry.name}</span>
        {entry.available ? null : (
          <span className="m-context-menu-chord" aria-hidden="true">
            {_(RECENT_UNAVAILABLE)}
          </span>
        )}
      </Menu.Item>
    ));
  };

  /**
   * What each submenu holds of the row's own: how its values are read when its menu opens, the values as drawn, and
   * whether it holds any. Keyed by the closed union, so a submenu added to the placement fails to compile here until the
   * row can read and draw what it holds.
   */
  const sources: Readonly<
    Record<
      MenuBarSubmenu,
      { readonly read: () => void; readonly values: readonly ReactElement[] | undefined; readonly held: boolean }
    >
  > = {
    recent: {
      read: () => {
        void recent.read().then((entries) => {
          if (entries !== undefined) setRecentEntries(entries);
        });
      },
      values: recentValues(),
      held: recentEntries !== undefined && recentEntries.length > 0,
    },
  };

  /**
   * A submenu (ADR-0143): its trigger in the parent menu where its first member falls, then — inside — the row's own
   * values, a separator, and the commands placed in it.
   */
  const submenu = (entry: MenuBarSubmenuEntry): ReactElement => {
    const face = SUBMENU_FACES[entry.id];
    const { values, held } = sources[entry.id];
    return (
      <Menu.SubmenuRoot key={`submenu:${entry.id}`}>
        <Menu.SubmenuTrigger className="m-context-menu-item m-menu-bar__item" data-submenu={entry.id} label={_(face.title)}>
          <span className="m-menu-bar__mark" aria-hidden="true" />
          <span className="m-menu-bar__icon" aria-hidden="true">
            <Icon name={face.icon} size="dense" />
          </span>
          <span className="m-menu-bar__title">{_(face.title)}</span>
          {/* THE ARROW in the chord's column: this item opens a menu rather than running something. */}
          <span className="m-context-menu-chord m-menu-bar__opens" aria-hidden="true">
            <Icon name="ChevronRight" size="dense" />
          </span>
        </Menu.SubmenuTrigger>
        <Menu.Portal>
          <Menu.Positioner side="right" align="start" sideOffset={4} alignOffset={-5}>
            <Menu.Popup className="m-context-menu m-menu-bar__popup m-menu-bar__submenu" data-submenu-popup={entry.id}>
              {values}
              {values === undefined ? null : <Menu.Separator className="m-context-menu-separator" />}
              {entry.items.map((member) => item(member, held))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.SubmenuRoot>
    );
  };

  /**
   * A row menu closing (`menuRowClose.ts`): refused when the close was raised for another menu of the row, else its
   * reason kept for its popup's `finalFocus`, which reads it as the popup lets the focus go — after the close is
   * reported.
   */
  const closing = (id: string, details: Menu.Root.ChangeEventDetails): void => {
    if (cancelsAnotherMenu(details)) {
      details.cancel();
      return;
    }
    closedFor.current.set(id, details.reason);
  };

  /** Where a row menu leaves the focus as it closes: given back only when the close ends the bar's use. */
  const focusOnClose =
    (id: string) =>
    (): HTMLElement | boolean =>
      GIVES_FOCUS_BACK[closedFor.current.get(id) ?? 'none'] ? (focusBefore() ?? true) : false;

  /** A row menu opening: its title kept when the arrow keys brought it from its neighbour (`menuRowKeys.ts`). */
  const arriving = (id: string, details: Menu.Root.ChangeEventDetails): void => {
    if (arrivesByArrowKey(details) && details.trigger !== undefined) byArrowKey.current.set(id, details.trigger);
    else byArrowKey.current.delete(id);
  };

  /**
   * A row menu open, and Base UI done placing the focus in it: one the arrow keys brought moves the focus on to its
   * first item. The popup is the one its title names in `aria-controls`.
   */
  const arrived = (id: string): void => {
    const title = byArrowKey.current.get(id);
    byArrowKey.current.delete(id);
    const popup = document.getElementById(title?.getAttribute('aria-controls') ?? '');
    if (popup !== null) firstItem(popup)?.focus();
  };

  /** The submenus a menu holds, whose values are read as it opens. */
  const submenusIn = (menu: MenuBarMenuModel): readonly MenuBarSubmenu[] =>
    menu.groups.flatMap((group) => group.items.flatMap((each) => (each.kind === 'submenu' ? [each.id] : [])));

  return (
    <div className="m-menu-bar" ref={bar}>
      <div className="m-menu-bar__start" ref={start}>
        {/* ADR-0002: the supplied artwork. Decorative — the bar is named, and the window's title names the application. */}
        <img className="m-menu-bar__logo" src={titleLogo} alt="" />
        <Menubar className="m-menu-bar__menus" aria-label={_(MENU_BAR_LABEL)}>
          {menus.map((menu) => (
            <Menu.Root
              key={menu.id}
              onOpenChange={(open, details) => {
                if (!open) {
                  closing(menu.id, details);
                  return;
                }
                arriving(menu.id, details);
                setOpened((count) => count + 1);
                // ASKED AS THE MENU OPENS, so the answer is in by the time the pointer or the arrow key reaches the
                // submenu. A failed read leaves the last answer, and before any, no values at all — never a list
                // claiming to be empty that was only unread.
                for (const id of submenusIn(menu)) sources[id].read();
              }}
              onOpenChangeComplete={(open) => {
                if (open) arrived(menu.id);
              }}
            >
              <Menu.Trigger className="m-menu-bar__trigger" data-menu={menu.id}>
                {_(MENU_TITLES[menu.id])}
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="bottom" align="start" sideOffset={2}>
                  <Menu.Popup className="m-context-menu m-menu-bar__popup" finalFocus={focusOnClose(menu.id)}>
                    {menu.groups.map((group, index) => (
                      <Fragment key={`${String(index)}:${group.caption ?? ''}`}>
                        {index === 0 ? null : <Menu.Separator className="m-context-menu-separator" />}
                        <Menu.Group className="m-menu-bar__group">
                          {group.caption === undefined ? null : (
                            <Menu.GroupLabel className="m-menu-bar__caption">{_(group.caption)}</Menu.GroupLabel>
                          )}
                          {group.items.map((each) => (each.kind === 'submenu' ? submenu(each) : item(each)))}
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
      {hasButtons ? (
        <div className="m-menu-bar__commands" ref={commands} data-icons-only={fit.iconsOnly ? 'true' : 'false'}>
          {buttons.map(({ command, tone }) => (
            <Button
              icon={command.icon}
              iconOnly={fit.iconsOnly}
              key={command.id}
              label={command.title}
              onClick={() => {
                run(command);
              }}
              variant={TONE_VARIANT[tone]}
            />
          ))}
        </div>
      ) : null}
      {/* THE DRAG TRACK'S MINIMUM, as a box the row can measure: the window controls' area plus `--menu-drag-min`.
          Empty and hidden from the accessibility tree; the row itself is what moves the window. */}
      {hasButtons ? <div className="m-menu-bar__reserve" ref={reserve} aria-hidden="true" /> : null}
    </div>
  );
}
