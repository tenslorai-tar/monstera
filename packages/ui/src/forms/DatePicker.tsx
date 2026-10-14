import { useLingui } from '@lingui/react';
import type { CSSProperties, ReactElement } from 'react';

import { FORM_DATE_CALENDAR, FORM_DATE_EARLIER, FORM_DATE_LATER, FORM_DATE_OPEN } from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';

/** A day on the calendar: a year, a month from 1 and a day from 1, as a date field's format reads them. */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** How many days a month has, by the calendar `Date` keeps: the day before the next month's first. */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The day `days` after (or before) this one, across months and years. */
export function dayAfter(from: CalendarDay, days: number): CalendarDay {
  const at = new Date(Date.UTC(from.year, from.month - 1, from.day + days));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

/** The same day `months` later (or earlier), kept within the shorter month: 31 January and one month is 28 February. */
export function monthAfter(from: CalendarDay, months: number): CalendarDay {
  const first = new Date(Date.UTC(from.year, from.month - 1 + months, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth() + 1;
  return { year, month, day: Math.min(from.day, daysIn(year, month)) };
}

/**
 * A month's weeks, Monday first, each day of the month in its weekday's column and `null` where another month's day
 * would be. Monday first is ISO 8601's week, the one most of the world's calendars print.
 */
export function monthWeeks(year: number, month: number): readonly (readonly (number | null)[])[] {
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysIn(year, month) }, (_, at) => at + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7));
  return weeks;
}

/** A day's element id in the calendar `id` names: what the box being typed in points at as the day the keyboard is on. */
export function calendarDayId(id: string, day: number): string {
  return `${id}-day-${String(day)}`;
}

/** A day as the ISO text a date field's format reads (`parseFieldDate` takes it whatever the field's pattern). */
export function isoOf(day: CalendarDay): string {
  return `${String(day.year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}

/** The calendar's button, at the right edge of the box being typed in. It never takes the focus, for the calendar's reason. */
export function DateOpen({ style, onPress }: { readonly style: CSSProperties; readonly onPress: () => void }): ReactElement {
  const { i18n } = useLingui();
  return (
    <button
      aria-label={i18n._(FORM_DATE_OPEN)}
      className="m-date-open"
      onClick={onPress}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      style={style}
      tabIndex={-1}
      type="button"
    >
      <Icon name="Calendar" size="dense" />
    </button>
  );
}

/**
 * A small calendar under a date field being typed in (the owner's F10), on the page so it moves with the field.
 *
 * IT NEVER TAKES THE FOCUS: every press on it is stopped before the browser moves the focus, so the field's box stays
 * focused, still open, and the keyboard drives the calendar from the box (Alt+Down opens it, the arrows move a day or
 * a week, Page Up and Page Down a month, Enter chooses). A calendar that took the focus would close the box it belongs
 * to, since leaving the box is what fills it.
 */
export function DatePicker({
  id,
  active,
  chosen,
  style,
  onMove,
  onPick,
}: {
  readonly id: string;
  /** The day the keyboard is on, whose month is shown. */
  readonly active: CalendarDay;
  /** The day the field holds, marked, or none. */
  readonly chosen: CalendarDay | undefined;
  readonly style: CSSProperties;
  readonly onMove: (to: CalendarDay) => void;
  readonly onPick: (day: CalendarDay) => void;
}): ReactElement {
  const { i18n } = useLingui();
  // THE APPLICATION'S LANGUAGE names the month and the days, as every other word on screen is in it.
  const locale = i18n.locale;
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(active.year, active.month - 1, 1)),
  );
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  const fullDay = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
  // 1 January 2001 was a Monday, so the week from it names the columns in order.
  const columns = Array.from({ length: 7 }, (_, at) => weekday.format(new Date(Date.UTC(2001, 0, 1 + at))));
  const keep = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
  };
  const dayId = (day: number): string => calendarDayId(id, day);
  return (
    <div aria-label={i18n._(FORM_DATE_CALENDAR)} className="m-date-picker" id={id} onPointerDown={keep} role="dialog" style={style}>
      <div className="m-date-picker__head">
        <button
          aria-label={i18n._(FORM_DATE_EARLIER)}
          className="m-date-picker__step"
          onClick={() => {
            onMove(monthAfter(active, -1));
          }}
          tabIndex={-1}
          type="button"
        >
          <Icon name="ChevronLeft" size="dense" />
        </button>
        <span aria-live="polite" className="m-date-picker__month">
          {monthName}
        </span>
        <button
          aria-label={i18n._(FORM_DATE_LATER)}
          className="m-date-picker__step"
          onClick={() => {
            onMove(monthAfter(active, 1));
          }}
          tabIndex={-1}
          type="button"
        >
          <Icon name="ChevronRight" size="dense" />
        </button>
      </div>
      <table className="m-date-picker__grid" role="grid">
        <thead>
          <tr>
            {columns.map((name, at) => (
              <th key={at} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(active.year, active.month).map((week, row) => (
            <tr key={row}>
              {week.map((day, column) =>
                day === null ? (
                  <td key={column} />
                ) : (
                  <td key={column}>
                    <button
                      aria-label={fullDay.format(new Date(Date.UTC(active.year, active.month - 1, day)))}
                      aria-pressed={chosen?.year === active.year && chosen.month === active.month && chosen.day === day}
                      className={day === active.day ? 'm-date-picker__day m-date-picker__day--active' : 'm-date-picker__day'}
                      id={dayId(day)}
                      onClick={() => {
                        onPick({ year: active.year, month: active.month, day });
                      }}
                      tabIndex={-1}
                      type="button"
                    >
                      {day}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
