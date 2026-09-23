import { describe, expect, it } from 'vitest';

import {
  STATUS_SAVED,
  STATUS_SAVED_DAYS,
  STATUS_SAVED_HOURS,
  STATUS_SAVED_JUST_NOW,
  STATUS_SAVED_MINUTES,
  STATUS_UNSAVED,
} from './messages/en.js';
import { isDirty, savedState, savedTick } from './savedState.js';

/** An arbitrary wall-clock moment. Every case is relative to it, so its value decides nothing. */
const AT = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('isDirty', () => {
  it('is the two versions disagreeing, in EITHER direction', () => {
    expect(isDirty(4, 4)).toBe(false);
    expect(isDirty(5, 4)).toBe(true);
    // THE BACKWARDS CASE, which cannot happen through the save path and is asserted anyway:
    // `>` reads as naturally as `!==` here and would call a document saved-into-the-future
    // clean. A rule written once has to be right for every caller, including one that hands
    // the arguments over in the other order.
    expect(isDirty(4, 5)).toBe(true);
  });
});

describe('savedState', () => {
  it('a document whose versions disagree is UNSAVED, whatever the clock says', () => {
    // The age is irrelevant when there are changes on top of it — a bar reading
    // "Saved just now" over unsaved work is the defect this whole cell exists against.
    // `savedAt` is recent here, so a function that checked the time first is red.
    expect(savedState(5, 4, AT, AT + 1_000)).toStrictEqual({
      message: STATUS_UNSAVED,
      values: {},
      dirty: true,
    });
  });

  it('a document that has never been saved IN THIS WINDOW says so without a time', () => {
    // It opened from its file and nothing has changed, so it IS saved — but this window
    // watched no save, and the file's own age is a claim a renderer holding no path cannot
    // make. "Saved" with no duration is the honest sentence, and the one the export allows.
    expect(savedState(4, 4, undefined, AT)).toStrictEqual({
      message: STATUS_SAVED,
      values: {},
      dirty: false,
    });
  });

  it('counts in the largest unit that has passed, and CHANGES UNIT at each boundary', () => {
    // THE BOUNDARIES ARE THE CASE. A fixture at 30 seconds and one at 5 minutes are both
    // handled correctly by an off-by-one at 60 seconds, so each pair below straddles the
    // edge by a millisecond — which is the smallest amount that changes the answer (4a).
    const words = (age: number): unknown => savedState(4, 4, AT, AT + age);

    expect(words(MINUTE - 1)).toStrictEqual({
      message: STATUS_SAVED_JUST_NOW,
      values: {},
      dirty: false,
    });
    expect(words(MINUTE)).toStrictEqual({
      message: STATUS_SAVED_MINUTES,
      values: { count: 1 },
      dirty: false,
    });
    expect(words(HOUR - 1)).toStrictEqual({
      message: STATUS_SAVED_MINUTES,
      values: { count: 59 },
      dirty: false,
    });
    expect(words(HOUR)).toStrictEqual({
      message: STATUS_SAVED_HOURS,
      values: { count: 1 },
      dirty: false,
    });
    expect(words(DAY - 1)).toStrictEqual({
      message: STATUS_SAVED_HOURS,
      values: { count: 23 },
      dirty: false,
    });
    expect(words(DAY)).toStrictEqual({
      message: STATUS_SAVED_DAYS,
      values: { count: 1 },
      dirty: false,
    });
  });

  it('a clock that went BACKWARDS reads as just now, never as a negative age', () => {
    // Windows moves the wall clock on a time-server correction, so `now` can land before a
    // `savedAt` this window recorded. Without the clamp the arithmetic is fine and the
    // SENTENCE is "Saved -3 min ago", which makes a person doubt the save rather than the
    // clock. The floor is asserted rather than the subtraction.
    expect(savedState(4, 4, AT, AT - 3 * MINUTE)).toStrictEqual({
      message: STATUS_SAVED_JUST_NOW,
      values: {},
      dirty: false,
    });
  });
});

describe('savedTick', () => {
  it('asks for NO timer before the first save, because the text cannot change by itself', () => {
    // "Saved" with no duration is the same words for ever. A timer here would re-render the
    // whole status bar twice a minute for the life of every document nobody has saved.
    expect(savedTick(undefined, AT)).toBeUndefined();
  });

  it('coarsens as the age grows, so a long-open document is not re-rendered for nothing', () => {
    // Inside the hour the words count minutes, so a half-minute tick is right within a few
    // seconds. Past it nothing changes for an hour, and the interval says so.
    //
    // The ASSERTION IS THE INEQUALITY as well as the values: what the caller depends on is
    // that this answers the same number everywhere inside a band — that is what makes it safe
    // as an effect dependency, and a function returning the remaining time to the next
    // boundary would satisfy the three equalities' spirit and rebuild the timer on every tick.
    expect(savedTick(AT, AT + 10 * MINUTE)).toBe(savedTick(AT, AT + 11 * MINUTE));
    expect(savedTick(AT, AT + 10 * MINUTE)).toBe(30_000);
    expect(savedTick(AT, AT + 3 * HOUR)).toBe(30 * MINUTE);
    expect(savedTick(AT, AT + 3 * DAY)).toBe(HOUR);
  });
});
