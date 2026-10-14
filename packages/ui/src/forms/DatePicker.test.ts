import { describe, expect, it } from 'vitest';

import { dayAfter, isoOf, monthAfter, monthWeeks } from './DatePicker.js';

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
