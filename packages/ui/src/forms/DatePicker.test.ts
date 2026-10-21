import { describe, expect, it } from 'vitest';

import { type CalendarState, calendarCells, calendarKeyed, calendarUp, dayAfter, isoOf, monthAfter, monthWeeks } from './DatePicker.js';

const keyed = (state: CalendarState, key: string): CalendarState => {
  const answer = calendarKeyed(state, { key, ctrlKey: false });
  if (answer?.kind !== 'move') throw new Error(`${key} did not move the calendar`);
  return answer.state;
};

describe('the calendar’s views (the owner’s R25)', () => {
  const day = { year: 2026, month: 10, day: 21 };

  it('the decades page is anchored where it was entered and moves only past its edge', () => {
    const decades = calendarUp(calendarUp(calendarUp({ active: day, view: 'days' })));
    expect(decades.view).toBe('decades');
    // NINE DECADES BEFORE THE ONE IT WAS ENTERED FROM, two after.
    expect(calendarCells(decades).map((cell) => cell.value)).toStrictEqual([1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030, 2040]);
    // A KEY WITHIN THE PAGE leaves it where it is: the keyboard moves over a page that holds still.
    expect(calendarCells(keyed(decades, 'ArrowLeft'))[0]?.value).toBe(1930);
    // CONTROL: past its first decade, the page moves a whole page back.
    const before = keyed(keyed(decades, 'Home'), 'ArrowLeft');
    expect([before.active.year, calendarCells(before)[0]?.value]).toStrictEqual([1926, 1810]);
  });

  it('a leap day carried to a year without one is the 28th, and the years page dims the year either side', () => {
    const years = calendarUp(calendarUp({ active: { year: 2028, month: 2, day: 29 }, view: 'days' }));
    expect(keyed(years, 'ArrowLeft').active).toStrictEqual({ year: 2027, month: 2, day: 28 });
    expect(calendarCells(years).filter((cell) => cell.outside).map((cell) => cell.value)).toStrictEqual([2019, 2030]);
    // HOME AND END are the page's own first and last year, never a dimmed one.
    expect([keyed(years, 'Home').active.year, keyed(years, 'End').active.year]).toStrictEqual([2020, 2029]);
  });

  it('a key the calendar does not use is left to the box', () => {
    expect(calendarKeyed({ active: day, view: 'months' }, { key: 'a', ctrlKey: false })).toBeUndefined();
  });
});

/** The calendar's arithmetic (the owner's F10): a month's weeks, a day and a month on, and the text a field reads. */
describe('the date field calendar', () => {
  it('lays a month out Monday first, each day under its weekday', () => {
    // 1 October 2026 is a Thursday, so three empty days lead; the 31st is a Saturday, so one trails.
    const weeks = monthWeeks(2026, 10);
    expect(weeks[0]).toStrictEqual([null, null, null, 1, 2, 3, 4]);
    expect(weeks.at(-1)).toStrictEqual([26, 27, 28, 29, 30, 31, null]);
    expect(weeks.flat().filter((day) => day !== null)).toHaveLength(31);
    // CONTROL: a month that starts on a Monday leads with nothing — 1 June 2026.
    expect(monthWeeks(2026, 6)[0]?.[0]).toBe(1);
  });

  it('steps a day and a week across a month and a year', () => {
    expect(dayAfter({ year: 2026, month: 12, day: 31 }, 1)).toStrictEqual({ year: 2027, month: 1, day: 1 });
    expect(dayAfter({ year: 2026, month: 3, day: 3 }, -7)).toStrictEqual({ year: 2026, month: 2, day: 24 });
  });

  it('steps a month keeping the day within the shorter month, leap years included', () => {
    expect(monthAfter({ year: 2026, month: 1, day: 31 }, 1)).toStrictEqual({ year: 2026, month: 2, day: 28 });
    expect(monthAfter({ year: 2028, month: 1, day: 31 }, 1)).toStrictEqual({ year: 2028, month: 2, day: 29 });
    expect(monthAfter({ year: 2026, month: 1, day: 15 }, -1)).toStrictEqual({ year: 2025, month: 12, day: 15 });
  });

  it('writes a day as the ISO text every date pattern reads', () => {
    expect(isoOf({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
  });
});
