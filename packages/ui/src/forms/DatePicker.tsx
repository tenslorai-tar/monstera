import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { CSSProperties, ReactElement } from 'react';

import {
  FORM_DATE_CALENDAR,
  FORM_DATE_EARLIER,
  FORM_DATE_EARLIER_DECADES,
  FORM_DATE_EARLIER_DECADE,
  FORM_DATE_EARLIER_YEAR,
  FORM_DATE_LATER,
  FORM_DATE_LATER_DECADES,
  FORM_DATE_LATER_DECADE,
  FORM_DATE_LATER_YEAR,
  FORM_DATE_OPEN,
  FORM_DATE_RANGE,
  FORM_DATE_SHOW_DECADES,
  FORM_DATE_SHOW_MONTHS,
  FORM_DATE_SHOW_YEARS,
  FORM_DATE_TODAY,
} from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';

/** A day on the calendar: a year, a month from 1 and a day from 1, as a date field's format reads them. */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * What the calendar shows (the owner's R25): a month's days, a year's months, ten years, or twelve decades. The
 * title goes up one, choosing goes down one, so a date of birth thirty years back is seven presses away whatever today
 * is: the title three times, then the decade, the year, the month and the day.
 */
export type CalendarView = 'days' | 'months' | 'years' | 'decades';

/** An open calendar: the day the keyboard is on, whose page is shown, and the view it is shown in. */
export interface CalendarState {
  readonly active: CalendarDay;
  readonly view: CalendarView;
  /**
   * The first year of the decades page, set when the view is entered. ANCHORED rather than a century, because a date of
   * birth is behind today: a century page puts 1985 off the page shown from 2015, and a page that followed every key
   * would move under the keyboard. The page holds the decade it was entered from ninth of twelve.
   */
  readonly decadesFrom?: number;
}

/** How many decades of the decades page come before the one it was entered from: ninety years back, twenty on. */
const DECADES_BEFORE = 9;

/** The view the title goes up to; the top one stays. */
const UP: Readonly<Record<CalendarView, CalendarView>> = { days: 'months', months: 'years', years: 'decades', decades: 'decades' };

/** The view choosing a cell goes down to; choosing a day picks it instead. */
const DOWN: Readonly<Record<Exclude<CalendarView, 'days'>, CalendarView>> = { months: 'days', years: 'months', decades: 'years' };

/** How far one cell of each view is, in months: a month, a year, ten years. */
const CELL_MONTHS: Readonly<Record<Exclude<CalendarView, 'days'>, number>> = { months: 1, years: 12, decades: 120 };

/** How far one page of each view is, in months — what the arrows and Page Up and Page Down move. */
const PAGE_MONTHS: Readonly<Record<CalendarView, number>> = { days: 1, months: 12, years: 120, decades: 1440 };

/** The columns the twelve cells of a month, year or decade page sit in, so Up and Down move a row. */
const CELL_COLUMNS = 4;

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

/** The same month and day in `year`, kept within the month (29 February in a year with none is the 28th). */
function inYear(from: CalendarDay, year: number): CalendarDay {
  return monthAfter(from, (year - from.year) * 12);
}

/** Today, on the computer's own calendar. Read when it is asked for, never during a render. */
export function today(): CalendarDay {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** The first year of the ten `year` is in. */
const decadeOf = (year: number): number => Math.floor(year / 10) * 10;

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

/** One cell of a month, year or decade page: the day it moves to when chosen, and whether it is outside the page. */
interface CalendarCell {
  /** The month, the year, or the decade's first year. */
  readonly value: number;
  readonly to: CalendarDay;
  /** The year before a ten and the one after it: shown, and dimmer. A decades page has none. */
  readonly outside: boolean;
}

/** The twelve cells of the page `state` shows, for the three views that are not days. */
export function calendarCells(state: CalendarState): readonly CalendarCell[] {
  const { active, view } = state;
  if (view === 'months') {
    return Array.from({ length: 12 }, (_, at) => ({ value: at + 1, to: monthAfter(active, at + 1 - active.month), outside: false }));
  }
  if (view === 'years') {
    const first = decadeOf(active.year);
    return Array.from({ length: 12 }, (_, at) => {
      const year = first - 1 + at;
      return { value: year, to: inYear(active, year), outside: at === 0 || at === 11 };
    });
  }
  const first = decadesFromOf(state);
  return Array.from({ length: 12 }, (_, at) => {
    const decade = first + at * 10;
    return { value: decade, to: inYear(active, decade + (active.year - decadeOf(active.year))), outside: false };
  });
}

/** The decades page's first year: as anchored, or with the active decade ninth where nothing anchored it. */
function decadesFromOf(state: CalendarState): number {
  return state.decadesFrom ?? decadeOf(state.active.year) - DECADES_BEFORE * 10;
}

/** A decades state whose page holds its active decade: the page moves a whole page at a time, never under each key. */
function onItsPage(state: CalendarState): CalendarState {
  if (state.view !== 'decades') return { active: state.active, view: state.view };
  let from = decadesFromOf(state);
  const decade = decadeOf(state.active.year);
  while (decade < from) from -= 120;
  while (decade > from + 110) from += 120;
  return { active: state.active, view: 'decades', decadesFrom: from };
}

/** The cell of the page that `day` is in: its month, its year, or its decade's first year. */
function cellOf(view: Exclude<CalendarView, 'days'>, day: CalendarDay): number {
  if (view === 'months') return day.month;
  if (view === 'years') return day.year;
  return decadeOf(day.year);
}

/** An element id in the calendar `id` names: what the box being typed in points at as the cell the keyboard is on. */
export function calendarCellId(id: string, state: CalendarState): string {
  return state.view === 'days' ? `${id}-day-${String(state.active.day)}` : `${id}-${state.view}-${String(cellOf(state.view, state.active))}`;
}

/** The title pressed: the view above, on the same day; the decades page is anchored here, at its entry. */
export function calendarUp(state: CalendarState): CalendarState {
  if (state.view === 'decades') return state;
  return onItsPage({ active: state.active, view: UP[state.view] });
}

/**
 * An arrow pressed: a page earlier (`-1`) or later (`1`) in the view shown — a month, a year, ten years, or the decades
 * page's hundred and twenty.
 */
export function calendarPage(state: CalendarState, direction: -1 | 1): CalendarState {
  const decadesFrom = state.view === 'decades' ? decadesFromOf(state) + direction * 120 : undefined;
  return onItsPage({
    active: monthAfter(state.active, direction * PAGE_MONTHS[state.view]),
    view: state.view,
    ...(decadesFrom === undefined ? {} : { decadesFrom }),
  });
}

/** A cell of a month, year or decade page chosen: that day, one view down. */
export function calendarChoose(state: CalendarState, to: CalendarDay): CalendarState {
  return { active: to, view: state.view === 'days' ? 'days' : DOWN[state.view] };
}

/** What a key does to an open calendar: a new state, a day picked, the calendar closed, or nothing it answers. */
export type CalendarKeyed =
  | { readonly kind: 'move'; readonly state: CalendarState }
  | { readonly kind: 'pick'; readonly day: CalendarDay }
  | { readonly kind: 'close' }
  | undefined;

/**
 * THE KEYBOARD, in every view, driven from the box being typed in, which keeps the focus. In the days: a day or a week
 * with the arrows, a month with Page Up and Page Down, the month's first and last day with Home and End, Enter to choose.
 * In the others the twelve cells sit four to a row: the arrows move a cell or a row, Page Up and Page Down a page,
 * Home and End the page's first and last cell, and Enter goes down a view. Ctrl+Up goes up a view, as the title does
 * (Windows' own calendar control zooms out on it). Escape closes the calendar in any view.
 */
export function calendarKeyed(state: CalendarState, pressed: { readonly key: string; readonly ctrlKey: boolean }): CalendarKeyed {
  const { active, view } = state;
  const { key } = pressed;
  if (key === 'Escape') return { kind: 'close' };
  if (pressed.ctrlKey && key === 'ArrowUp') return { kind: 'move', state: calendarUp(state) };
  if (key === 'Enter') return view === 'days' ? { kind: 'pick', day: active } : { kind: 'move', state: calendarChoose(state, active) };
  const move = (to: CalendarDay): CalendarKeyed => ({ kind: 'move', state: onItsPage({ ...state, active: to }) });
  if (key === 'PageUp') return { kind: 'move', state: calendarPage(state, -1) };
  if (key === 'PageDown') return { kind: 'move', state: calendarPage(state, 1) };
  if (view === 'days') {
    const days: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const by = days[key];
    if (by !== undefined) return move(dayAfter(active, by));
    if (key === 'Home') return move({ ...active, day: 1 });
    if (key === 'End') return move({ ...active, day: daysIn(active.year, active.month) });
    return undefined;
  }
  const cells: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -CELL_COLUMNS, ArrowDown: CELL_COLUMNS };
  const by = cells[key];
  if (by !== undefined) return move(monthAfter(active, by * CELL_MONTHS[view]));
  // THE PAGE'S OWN FIRST AND LAST CELL, never the dimmer ones either side of it.
  const inside = calendarCells(state).filter((cell) => !cell.outside);
  if (key === 'Home') return move(inside[0]?.to ?? active);
  if (key === 'End') return move(inside.at(-1)?.to ?? active);
  return undefined;
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

/** Each view's two arrows, and what its title offers. */
const ARROWS: Readonly<Record<CalendarView, readonly [MessageKey, MessageKey]>> = {
  days: [FORM_DATE_EARLIER, FORM_DATE_LATER],
  months: [FORM_DATE_EARLIER_YEAR, FORM_DATE_LATER_YEAR],
  years: [FORM_DATE_EARLIER_DECADE, FORM_DATE_LATER_DECADE],
  decades: [FORM_DATE_EARLIER_DECADES, FORM_DATE_LATER_DECADES],
};
const TITLE_GOES_TO: Readonly<Record<Exclude<CalendarView, 'decades'>, MessageKey>> = {
  days: FORM_DATE_SHOW_MONTHS,
  months: FORM_DATE_SHOW_YEARS,
  years: FORM_DATE_SHOW_DECADES,
};

/**
 * A small calendar under a date field being typed in (the owner's F10), on the page so it moves with the field: a
 * month's days, and from its title a year's months, ten years and twelve decades (R25), with Today at its foot.
 *
 * IT NEVER TAKES THE FOCUS: every press on it is stopped before the browser moves the focus, so the field's box stays
 * focused, still open, and the keyboard drives the calendar from the box through {@link calendarKeyed}. A calendar that
 * took the focus would close the box it belongs to, since leaving the box is what fills it.
 */
export function DatePicker({
  id,
  state,
  chosen,
  style,
  onMove,
  onPick,
}: {
  readonly id: string;
  /** The day the keyboard is on, whose page is shown, and the view. */
  readonly state: CalendarState;
  /** The day the field holds, marked, or none. */
  readonly chosen: CalendarDay | undefined;
  readonly style: CSSProperties;
  readonly onMove: (to: CalendarState) => void;
  readonly onPick: (day: CalendarDay) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const { active, view } = state;
  // THE APPLICATION'S LANGUAGE names the months and the days, as every other word on screen is in it.
  const locale = i18n.locale;
  const year = new Intl.NumberFormat(locale, { useGrouping: false });
  const monthLong = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
  const monthShort = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const range = (first: number, last: number): string => i18n._(FORM_DATE_RANGE, { first: year.format(first), last: year.format(last) });
  const title =
    view === 'days'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(active.year, active.month - 1, 1)))
      : view === 'months'
        ? year.format(active.year)
        : view === 'years'
          ? range(decadeOf(active.year), decadeOf(active.year) + 9)
          : range(decadesFromOf(state), decadesFromOf(state) + 119);
  const keep = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
  };
  const [earlier, later] = ARROWS[view];
  const titleText = (
    <span aria-live="polite" className="m-date-picker__month">
      {title}
    </span>
  );
  return (
    <div aria-label={i18n._(FORM_DATE_CALENDAR)} className="m-date-picker" data-view={view} id={id} onPointerDown={keep} role="dialog" style={style}>
      <div className="m-date-picker__head">
        <button
          aria-label={i18n._(earlier)}
          className="m-date-picker__step"
          onClick={() => {
            onMove(calendarPage(state, -1));
          }}
          tabIndex={-1}
          type="button"
        >
          <Icon name="ChevronLeft" size="dense" />
        </button>
        {view === 'decades' ? (
          titleText
        ) : (
          <button
            aria-label={`${title}, ${i18n._(TITLE_GOES_TO[view])}`}
            className="m-date-picker__title"
            onClick={() => {
              onMove(calendarUp(state));
            }}
            tabIndex={-1}
            type="button"
          >
            {titleText}
          </button>
        )}
        <button
          aria-label={i18n._(later)}
          className="m-date-picker__step"
          onClick={() => {
            onMove(calendarPage(state, 1));
          }}
          tabIndex={-1}
          type="button"
        >
          <Icon name="ChevronRight" size="dense" />
        </button>
      </div>
      {view === 'days' ? <DaysGrid chosen={chosen} id={id} locale={locale} onPick={onPick} state={state} /> : (
        <table className="m-date-picker__grid" role="grid">
          <tbody>
            {[0, 1, 2].map((row) => (
              <tr key={row}>
                {calendarCells(state)
                  .slice(row * CELL_COLUMNS, row * CELL_COLUMNS + CELL_COLUMNS)
                  .map((cell) => {
                    const holds = chosen !== undefined && (view === 'months' ? chosen.year === active.year : true) && cellOf(view, chosen) === cell.value;
                    // A DECADE SHOWS ITS FIRST YEAR and is named by its whole range, which begins with what it shows.
                    const shown = view === 'months' ? monthShort.format(new Date(Date.UTC(2001, cell.value - 1, 1))) : year.format(cell.value);
                    const named =
                      view === 'months'
                        ? `${monthLong.format(new Date(Date.UTC(2001, cell.value - 1, 1)))} ${year.format(active.year)}`
                        : view === 'years'
                          ? shown
                          : range(cell.value, cell.value + 9);
                    const classes = ['m-date-picker__day', 'm-date-picker__cell'];
                    if (cell.value === cellOf(view, active)) classes.push('m-date-picker__day--active');
                    if (cell.outside) classes.push('m-date-picker__cell--outside');
                    return (
                      <td key={cell.value}>
                        <button
                          aria-label={named}
                          aria-pressed={holds}
                          className={classes.join(' ')}
                          id={`${id}-${view}-${String(cell.value)}`}
                          onClick={() => {
                            onMove(calendarChoose(state, cell.to));
                          }}
                          tabIndex={-1}
                          type="button"
                        >
                          {shown}
                        </button>
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="m-date-picker__foot">
        <button
          className="m-date-picker__today"
          onClick={() => {
            onPick(today());
          }}
          tabIndex={-1}
          type="button"
        >
          {i18n._(FORM_DATE_TODAY)}
        </button>
      </div>
    </div>
  );
}

/** A month's days, Monday first: the days view. */
function DaysGrid({
  id,
  state,
  chosen,
  locale,
  onPick,
}: {
  readonly id: string;
  readonly state: CalendarState;
  readonly chosen: CalendarDay | undefined;
  readonly locale: string;
  readonly onPick: (day: CalendarDay) => void;
}): ReactElement {
  const { active } = state;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  const fullDay = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
  // 1 January 2001 was a Monday, so the week from it names the columns in order.
  const columns = Array.from({ length: 7 }, (_, at) => weekday.format(new Date(Date.UTC(2001, 0, 1 + at))));
  return (
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
                    id={calendarCellId(id, { active: { ...active, day }, view: 'days' })}
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
  );
}
