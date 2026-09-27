import { Menu } from '@base-ui/react/menu';
import { Menubar } from '@base-ui/react/menubar';
import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

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
import { Button } from '../primitives/Button.js';
import { Icon } from '../primitives/Icon.js';
import type { CommandContext, CommandRegistry, UiCommand } from '../registries/commands.js';
import { LABELLED, type RowFit, nextRowFit } from './menuRowFit.js';
import {
  type MenuBarCommandEntry,
  type MenuBarItem,
  type MenuBarMenuModel,
  menuBarCommandsModel,
  menuBarModel,
  shortcutMapOf,
} from './projections.js';

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
  const buttons = menuBarCommandsModel(registry, context);
  const chords = new Map([...shortcutMapOf(registry)].map(([, command]) => [command.id, command.shortcut]));
  const bar = useRef<HTMLDivElement | null>(null);
  const start = useRef<HTMLDivElement | null>(null);
  const commands = useRef<HTMLDivElement | null>(null);
  const reserve = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<RowFit>(LABELLED);
  const hasButtons = buttons.length > 0;

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
      <div className="m-menu-bar__start" ref={start}>
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
