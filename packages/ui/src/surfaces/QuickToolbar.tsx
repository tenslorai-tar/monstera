import { useLingui } from '@lingui/react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { DOCUMENT_TOOLS_LABEL, FLOAT_BAR_GRIP_HELP, FLOAT_BAR_GRIP_LABEL } from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import { ICONS } from '../primitives/icons.js';
import { IconButton } from '../primitives/IconButton.js';
import type { CommandContext, CommandRegistry } from '../registries/commands.js';
import { FLOAT_BAR_POSITION_SETTING, QUICK_TOOLBAR_OPEN_SETTING } from '../settings/layout.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';
import { type FloatBarPoint, type FloatBarRoom, nudged, pointOf, positionAt } from './floatBarPlace.js';
import { quickToolbarModel } from './projections.js';

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

export function QuickToolbar({ registry, context, settings }: QuickToolbarProps): ReactElement | null {
  const { i18n } = useLingui();
  const open = useSetting(settings, QUICK_TOOLBAR_OPEN_SETTING);
  const position = useSetting(settings, FLOAT_BAR_POSITION_SETTING);
  const entries = quickToolbarModel(registry, context);
  const shown = open && entries.length > 0;
  const bar = useRef<HTMLDivElement | null>(null);
  /** A press on the grip: where it began, where the bar was, whether it has become a drag, and where it would land. */
  const press = useRef<{
    readonly x: number;
    readonly y: number;
    readonly from: FloatBarPoint;
    moved: boolean;
    at: { readonly x: number; readonly y: number } | null;
  } | null>(null);
  const [room, setRoom] = useState<FloatBarRoom | null>(null);
  const [dragged, setDragged] = useState<FloatBarPoint | null>(null);
  const [placing, setPlacing] = useState(false);
  const helpId = useId();

  // THE ROOM: the page area's size and the bar's, re-read whenever either changes — a window resize, a panel
  // collapsing, a command arriving on the bar. The observer reports once when it starts, which is the first reading.
  useLayoutEffect(() => {
    const element = bar.current;
    const area = element?.parentElement;
    if (!shown || element === null || area === null || area === undefined || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      setRoom({
        areaWidth: area.clientWidth,
        areaHeight: area.clientHeight,
        barWidth: element.offsetWidth,
        barHeight: element.offsetHeight,
      });
    });
    observer.observe(area);
    observer.observe(element);
    return (): void => {
      observer.disconnect();
    };
  }, [shown]);

  // CLICK-TO-PLACE: the next press in the page area puts the bar there, centred on the press, and goes no further —
  // a press meant to place the bar must not also select an annotation under it. Escape cancels.
  useEffect(() => {
    const area = bar.current?.parentElement;
    if (!placing || area === null || area === undefined) return undefined;
    const place = (event: globalThis.PointerEvent): void => {
      const element = bar.current;
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
  }, [placing, room, settings]);

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
    if (room !== null) settings.set(FLOAT_BAR_POSITION_SETTING.id, positionAt(point, room));
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    const from = drawn();
    if (from === null || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, y: event.clientY, from, moved: false, at: null };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const start = press.current;
    if (start === null || room === null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) <= CLICK_SLOP) return;
    start.moved = true;
    // THROUGH THE CLAMP while dragging, so the bar never shows outside the page area even for one frame — and the
    // clamped share is what is stored on release, never a point read back from it.
    start.at = positionAt({ left: start.from.left + dx, top: start.from.top + dy }, room);
    setDragged(pointOf(start.at, room));
  };

  const onPointerUp = (): void => {
    const start = press.current;
    press.current = null;
    if (start === null) return;
    if (!start.moved) setPlacing((was) => !was);
    else if (start.at !== null) settings.set(FLOAT_BAR_POSITION_SETTING.id, start.at);
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

  // DRAWN: while dragging, at the pointer; moved, at its stored share of the room; docked, by the stylesheet.
  const free = dragged ?? (typeof position === 'string' || room === null ? null : pointOf(position, room));
  const docked = typeof position === 'string' ? position : 'start';
  const placement = free === null ? `m-quick-toolbar--${docked}` : 'm-quick-toolbar--free';

  return (
    <div
      ref={bar}
      className={`m-quick-toolbar ${placement}`}
      style={free === null ? undefined : { left: free.left, top: free.top }}
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
      {entries.flatMap((entry) => {
        const icon = entry.command.icon;
        if (icon === undefined) return [];
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
    </div>
  );
}
