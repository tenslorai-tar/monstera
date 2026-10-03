import { Menu } from '@base-ui/react/menu';
import { useLingui } from '@lingui/react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { DOCUMENT_TOOLS_LABEL, FLOAT_BAR_GRIP_HELP, FLOAT_BAR_GRIP_LABEL, FLOAT_BAR_MORE } from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { FLOAT_BAR_POSITION_SETTING, QUICK_TOOLBAR_OPEN_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
import { type FloatBarPoint, type FloatBarRoom, type FloatBarShare, nudged, positionAt } from './floatBarPlace.js';
import { quickToolbarModel } from './projections.js';
import { railFolded } from './railFold.js';

/** The reset command, run by the grip's Home key so the key and the Window menu are one action. */
const RESET_COMMAND = 'view.reset-float-bar';

/** How far a press may travel and still be a click on the grip rather than the start of a drag. */
const CLICK_SLOP = 3;

/**
 * §10.3's floating quick toolbar — the **Float bar**, the owner's name for it — as a **projection of the command
 * registry**: *"a vertical pill on the canvas edge with the always-needed tools … repositionable and hideable"*.
 *
 * ## It names no command, and `check:secondwiring` is the mechanism
 *
 * This renders `quickToolbarModel(...)` and knows nothing about what is in it. Registering a command
 * with a `quick-toolbar` placement is the whole of putting it here, and removing the registration
 * removes the control with nothing to edit — §7's *"there is no second place where a feature is
 * wired"*.
 *
 * ## ICONS, at §10.4's primary-control size
 *
 * §10.4: *"16 px primary controls (rail, floating toolbar, buttons)"*. `DRAWS_A_GLYPH` already
 * refuses a command placed here with no icon, so every entry has one; the skip below keeps the type
 * honest rather than asserting. Each `IconButton` carries its title as accessible name and tooltip.
 *
 * ## Rendered only when it has something in it, and when it is shown
 *
 * The model is empty when no document is focused, because every command placed here declares
 * `when: hasDocument`. `appearance.quick-toolbar-open` is the one owner of whether it shows.
 *
 * ## MOVABLE, three ways, and always inside the page area (the owner's 27 September list, item 4)
 *
 * The grip at its top end, which v5 draws, moves it:
 *
 * - **by dragging** — pointer capture on the grip, so the drag follows the pointer across the page;
 * - **by a click, then a click where it should go** — WCAG 2.2's 2.5.7 *Dragging Movements* asks that anything done
 *   by dragging can be done by a single pointer without dragging, and this is that: the grip is pressed, the next
 *   press in the page area places the bar there, and Escape cancels;
 * - **by the keyboard** — the arrow keys move it a grid step, Shift four, which is the WAI-ARIA APG *Window Splitter*
 *   pattern's arrow keys on two axes and the keys Windows' own *Move* (Alt+Space, M) takes; Home runs *Reset Float bar
 *   position*. WCAG 2.1.1 needs this whatever 2.5.7 says: 2.5.7 is explicit that a keyboard route does not satisfy it.
 *
 * Where it is, is `appearance.float-bar-position`: a docked edge, or a share of the bar's travel in the page area
 * (`floatBarPlace.ts`), so no stored value can put it outside — at any window size, with no clamp on resize.
 */
export interface QuickToolbarProps {
  readonly registry: CommandRegistry;
  readonly context: CommandContext;
  readonly settings: SettingsStore;
}

/**
 * The page area's size and the bar's, read NOW, at the moment a press or a key needs them. Never held in state: a copy
 * of a layout is stale for as long as it takes to be refreshed, and the only readers of this are events, which run
 * against the layout the person is looking at.
 */
function roomOf(element: HTMLElement | null): FloatBarRoom | null {
  const area = element?.parentElement;
  if (element === null || area === null || area === undefined) return null;
  return {
    areaWidth: area.clientWidth,
    areaHeight: area.clientHeight,
    barWidth: element.offsetWidth,
    barHeight: element.offsetHeight,
  };
}

export function QuickToolbar({ registry, context, settings }: QuickToolbarProps): ReactElement | null {
  const { i18n } = useLingui();
  const open = useSetting(settings, QUICK_TOOLBAR_OPEN_SETTING);
  const position = useSetting(settings, FLOAT_BAR_POSITION_SETTING);
  const entries = quickToolbarModel(registry, context);
  const shown = open && entries.length > 0;
  const bar = useRef<HTMLDivElement | null>(null);
  /** A press on the grip: where it began, where the bar was, the room at that moment, and whether it became a drag. */
  const press = useRef<{
    readonly x: number;
    readonly y: number;
    readonly from: FloatBarPoint;
    readonly room: FloatBarRoom;
    moved: boolean;
  } | null>(null);
  const [dragged, setDragged] = useState<FloatBarShare | null>(null);
  const [placing, setPlacing] = useState(false);
  const helpId = useId();

  // CLICK-TO-PLACE: the next press in the page area puts the bar there, centred on the press, and goes no further —
  // a press meant to place the bar must not also select an annotation under it. Escape cancels.
  useEffect(() => {
    const area = bar.current?.parentElement;
    if (!placing || area === null || area === undefined) return undefined;
    const place = (event: globalThis.PointerEvent): void => {
      const element = bar.current;
      const room = roomOf(element);
      if (element === null || room === null) return;
      if (element.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      const box = area.getBoundingClientRect();
      settings.set(
        FLOAT_BAR_POSITION_SETTING.id,
        positionAt(
          {
            left: event.clientX - box.left - area.clientLeft - room.barWidth / 2,
            top: event.clientY - box.top - area.clientTop - room.barHeight / 2,
          },
          room,
        ),
      );
      setPlacing(false);
    };
    const cancel = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setPlacing(false);
    };
    area.addEventListener('pointerdown', place, true);
    window.addEventListener('keydown', cancel);
    return (): void => {
      area.removeEventListener('pointerdown', place, true);
      window.removeEventListener('keydown', cancel);
    };
  }, [placing, settings]);

  // THE FOLD (ADR-0147, extended): when the page area is too short for the strip, its last tools go into a *More* at
  // its end, by the rail's own rule. Each tool costs one button and the gap after it, read from a drawn one; the rest of
  // the strip — the grip and the padding — is what is left of its height once those are taken away, which does not
  // depend on how many are folded. The room is the area's height less the token margin at each end.
  const tools = entries.filter((entry) => entry.command.icon !== undefined);
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set());
  const toolCount = tools.length;
  useLayoutEffect(() => {
    const element = bar.current;
    const area = element?.parentElement;
    if (!shown || element === null || area === null || area === undefined || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const measure = (): void => {
      const buttons = element.querySelectorAll<HTMLElement>(':scope > .m-icon-button');
      const first = buttons[0];
      if (first === undefined) return;
      const step = first.offsetHeight + parseFloat(getComputedStyle(element).rowGap || '0');
      const rest = element.offsetHeight - buttons.length * step;
      const margin = parseFloat(getComputedStyle(element).getPropertyValue('--space-8')) || 0;
      const capacity = Math.max(0, Math.floor((area.clientHeight - 2 * margin - rest) / step));
      const next = railFolded(toolCount, undefined, capacity);
      setFolded((was) => (was.size === next.size && [...next].every((place) => was.has(place)) ? was : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(element);
    return (): void => {
      observer.disconnect();
    };
  }, [shown, toolCount]);

  if (!shown) return null;

  /** Where the bar is drawn now, read from its own box, so a move starts from what the person sees. */
  const drawn = (): FloatBarPoint | null => {
    const element = bar.current;
    const area = element?.parentElement;
    if (element === null || area === null || area === undefined) return null;
    const mine = element.getBoundingClientRect();
    const theirs = area.getBoundingClientRect();
    return { left: mine.left - theirs.left - area.clientLeft, top: mine.top - theirs.top - area.clientTop };
  };

  const store = (point: FloatBarPoint): void => {
    const room = roomOf(bar.current);
    if (room !== null) settings.set(FLOAT_BAR_POSITION_SETTING.id, positionAt(point, room));
  };

  /** Where the pointer at (x, y) puts the bar during a press, through the clamp — a share of the room. */
  const shareAt = (
    start: NonNullable<typeof press.current>,
    event: { readonly clientX: number; readonly clientY: number },
  ): FloatBarShare =>
    positionAt({ left: start.from.left + event.clientX - start.x, top: start.from.top + event.clientY - start.y }, start.room);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    const from = drawn();
    const room = roomOf(bar.current);
    if (from === null || room === null || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, y: event.clientY, from, room, moved: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const start = press.current;
    if (start === null) return;
    if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CLICK_SLOP) return;
    start.moved = true;
    // THROUGH THE CLAMP while dragging, so the bar never shows outside the page area even for one frame.
    setDragged(shareAt(start, event));
  };

  // THE RELEASE DECIDES, from its own coordinates: a browser coalesces pointer moves and may deliver none after the
  // last it drew, so the last MOVE is not where the person let go. Stored from the last move, a fast drag to the
  // corner landed 37 px short of it, one run in twelve (measured 2026-09-28). A press that never passed the click slop
  // — by its moves or its release — is a click, and arms click-to-place.
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    const start = press.current;
    press.current = null;
    if (start === null) return;
    const moved = start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP;
    if (!moved) setPlacing((was) => !was);
    else settings.set(FLOAT_BAR_POSITION_SETTING.id, shareAt(start, event));
    setDragged(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Home') {
      event.preventDefault();
      void registry.get(RESET_COMMAND)?.run(context);
      return;
    }
    if (event.key === 'Escape' && placing) {
      event.preventDefault();
      setPlacing(false);
      return;
    }
    const from = drawn();
    const to = from === null ? undefined : nudged(from, event.key, event.shiftKey);
    if (to === undefined) return;
    event.preventDefault();
    store(to);
  };

  // DRAWN: while dragging, at the pointer; moved, at its stored share; docked, by the stylesheet. A share, NEVER
  // pixels: the stylesheet resolves it against the page area as laid out now (`.m-quick-toolbar--free`), so the bar
  // cannot be drawn from a stale measurement of the area. A pixel position computed from a measured room lagged a
  // shrinking window by a render, and was drawn 3 px outside the area on both CI runners (2026-09-28).
  const free = dragged ?? (typeof position === 'string' ? null : position);
  const docked = typeof position === 'string' ? position : 'start';
  const placement = free === null ? `m-quick-toolbar--${docked}` : 'm-quick-toolbar--free';

  return (
    <div
      ref={bar}
      className={`m-quick-toolbar ${placement}`}
      style={free === null ? undefined : ({ '--float-x': String(free.x), '--float-y': String(free.y) } as CSSProperties)}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={i18n._(DOCUMENT_TOOLS_LABEL)}
      data-placing={placing ? 'true' : 'false'}
    >
      <button
        type="button"
        className="m-quick-toolbar__grip"
        aria-label={i18n._(FLOAT_BAR_GRIP_LABEL)}
        aria-describedby={helpId}
        aria-pressed={placing}
        title={i18n._(FLOAT_BAR_GRIP_LABEL)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null;
          setDragged(null);
        }}
        onKeyDown={onKeyDown}
      >
        <Icon name="GripHorizontal" size="dense" />
      </button>
      <span id={helpId} className="m-visually-hidden">
        {i18n._(FLOAT_BAR_GRIP_HELP)}
      </span>
      {tools.flatMap((entry, place) => {
        const icon = entry.command.icon;
        if (icon === undefined || folded.has(place)) return [];
        return [
          <IconButton
            key={entry.command.id}
            icon={ICONS[icon]}
            label={entry.command.title}
            size="control"
            pressed={entry.command.checked?.(context)}
            onClick={() => {
              // Not awaited: a click handler returning a promise would make React's event handling
              // wait on IPC, and nothing here reads the result — the command reports through its
              // own callback.
              void entry.command.run(context);
            }}
          />,
        ];
      })}
      {folded.size === 0 ? null : (
        // THE FOLDED TOOLS, in the strip's order, in a menu opened beside the strip on its page side. A tool that is on
        // is a checkable item, so the menu says so as the strip's pressed button did.
        <Menu.Root>
          <Menu.Trigger
            className="m-icon-button m-icon-button--control m-quick-toolbar__more"
            aria-label={i18n._(FLOAT_BAR_MORE)}
            data-holds={tools
              .filter((_, place) => folded.has(place))
              .map((entry) => entry.command.id)
              .join(' ')}
            nativeButton
          >
            <Icon name="Ellipsis" size="control" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side={docked === 'end' && free === null ? 'left' : 'right'} align="end" sideOffset={8}>
              <Menu.Popup className="m-context-menu m-menu-bar__popup">
                {tools.map((entry, place) => {
                  if (!folded.has(place)) return null;
                  const checked = entry.command.checked?.(context);
                  const face = (
                    <>
                      <span className="m-menu-bar__mark" aria-hidden="true">
                        {checked === true ? <Icon name="Check" size="dense" /> : null}
                      </span>
                      <span className="m-menu-bar__icon" aria-hidden="true">
                        {entry.command.icon === undefined ? null : <Icon name={entry.command.icon} size="dense" />}
                      </span>
                      <span className="m-menu-bar__title">{i18n._(entry.command.title)}</span>
                    </>
                  );
                  const run = (): void => {
                    void entry.command.run(context);
                  };
                  return checked === undefined ? (
                    <Menu.Item
                      key={entry.command.id}
                      className="m-context-menu-item m-menu-bar__item"
                      data-command={entry.command.id}
                      label={i18n._(entry.command.title)}
                      onClick={run}
                    >
                      {face}
                    </Menu.Item>
                  ) : (
                    <Menu.CheckboxItem
                      key={entry.command.id}
                      className="m-context-menu-item m-menu-bar__item"
                      data-command={entry.command.id}
                      label={i18n._(entry.command.title)}
                      checked={checked}
                      closeOnClick
                      onCheckedChange={run}
                    >
                      {face}
                    </Menu.CheckboxItem>
                  );
                })}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  );
}
