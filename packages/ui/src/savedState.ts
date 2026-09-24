import type { MessageKey } from '@monstera/shared';

import {
  WINDOW_TITLE,
  WINDOW_TITLE_DOCUMENT,
  WINDOW_TITLE_UNSAVED,
  STATUS_SAVED,
  STATUS_SAVED_DAYS,
  STATUS_SAVED_HOURS,
  STATUS_SAVED_JUST_NOW,
  STATUS_SAVED_MINUTES,
  STATUS_UNSAVED,
} from './messages/en.js';

/**
 * What the status bar says about whether this document is on disk, and how long ago.
 *
 * ## One function, because three surfaces ask the same question
 *
 * The status bar draws the words, the tab draws a dot, the window's title carries the same dot
 * and the close path decides whether to ask. Each reading the two version numbers for itself
 * would be four opinions about what *dirty* means, which is how a tab ends up clean beside a bar
 * saying otherwise (B3a). The close path stays on `document.unsaved` — main's own answer, and
 * the one that must not be wrong — and the drawn surfaces take {@link isDirty} from here.
 *
 * ## The clock is PASSED IN
 *
 * `Date.now()` inside would make every case here a race against the machine it runs on, and
 * the interesting cases are all about a boundary — 59 seconds against 60. The caller holds a
 * ticking `now` and this stays a function of its arguments.
 */

/** A minute in milliseconds, and the units built from it. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The line to show, with whatever the line interpolates.
 *
 * `values` is always present, empty where the message takes none, so a caller cannot forget
 * the argument on the one branch that needs it.
 */
export interface SavedState {
  readonly message: MessageKey;
  readonly values: Readonly<Record<string, number>>;
  /** Whether the document holds changes the file does not — what a dirty dot draws. */
  readonly dirty: boolean;
}

/**
 * Whether this document holds changes its file does not.
 *
 * **A named rule with callers, rather than a `!==` at two call sites.** The tab's dot needs
 * only this and no clock; the status bar needs this plus an age. Writing the comparison twice
 * is how a dot ends up beside a bar that disagrees with it — and the inequality is the whole
 * rule, so the second spelling would look obviously right (B3a). {@link savedState} calls it
 * too, so there is one answer and not two that happen to agree.
 */
export function isDirty(version: number, savedVersion: number): boolean {
  return version !== savedVersion;
}

/**
 * The window's title: the product alone with no document, else the focused file's name, with the
 * tab's dot when it holds changes its file does not.
 *
 * **The dot is {@link isDirty}'s**, the tab's own rule, so a title can never say clean beside a
 * dotted tab. Save and *Save back to cloud* both clear it the same way, through `onSaved` moving
 * `savedVersion` — which is why neither needs a line here.
 *
 * @param focused the focused document's name and its two version numbers, or `undefined` for none
 */
export function windowTitle(
  focused: { readonly name: string; readonly version: number; readonly savedVersion: number } | undefined,
): { readonly message: MessageKey; readonly values: Readonly<Record<string, string>> } {
  if (focused === undefined) return { message: WINDOW_TITLE, values: {} };
  return {
    message: isDirty(focused.version, focused.savedVersion) ? WINDOW_TITLE_UNSAVED : WINDOW_TITLE_DOCUMENT,
    values: { file: focused.name },
  };
}

/**
 * Says where this document stands against its file.
 *
 * @param version the newest version the renderer has observed
 * @param savedVersion the newest version it has watched reach the file
 * @param savedAt when that happened, or `undefined` before any save in this window
 * @param now the current time, passed in rather than read
 */
export function savedState(
  version: number,
  savedVersion: number,
  savedAt: number | undefined,
  now: number,
): SavedState {
  if (isDirty(version, savedVersion)) {
    return { message: STATUS_UNSAVED, values: {}, dirty: true };
  }

  // NO SAVE IN THIS WINDOW, and the file still matches: the document opened from it and
  // nothing has changed. "Saved" with no time, because this window never watched a save and
  // the file's own age is a different claim it has no path to read.
  if (savedAt === undefined) return { message: STATUS_SAVED, values: {}, dirty: false };

  // A CLOCK THAT WENT BACKWARDS reads as *just now* rather than as a negative age. Windows
  // moves the wall clock on a time-server correction, and "Saved -3 min ago" is the kind of
  // thing that makes a person doubt the save rather than the clock.
  const age = Math.max(0, now - savedAt);
  if (age < MINUTE) return { message: STATUS_SAVED_JUST_NOW, values: {}, dirty: false };
  if (age < HOUR) {
    return { message: STATUS_SAVED_MINUTES, values: { count: Math.floor(age / MINUTE) }, dirty: false };
  }
  if (age < DAY) {
    return { message: STATUS_SAVED_HOURS, values: { count: Math.floor(age / HOUR) }, dirty: false };
  }
  return { message: STATUS_SAVED_DAYS, values: { count: Math.floor(age / DAY) }, dirty: false };
}

/**
 * How often the status bar must re-read the clock for its own text to stay true.
 *
 * **Derived from the age, not a constant**: inside the first minute the words change at the
 * minute mark, so a half-minute tick is enough to be right within a few seconds; past an hour
 * nothing changes for another hour and a 30-second timer would be 120 pointless renders. A
 * fixed interval has to be the fastest one the worst case needs, and then pays it for ever.
 *
 * @returns milliseconds until the next check, or `undefined` when the text cannot change on
 *   its own — nothing has been saved in this window, so no timer is needed at all.
 */
export function savedTick(savedAt: number | undefined, now: number): number | undefined {
  if (savedAt === undefined) return undefined;
  const age = Math.max(0, now - savedAt);
  if (age < HOUR) return MINUTE / 2;
  if (age < DAY) return HOUR / 2;
  return HOUR;
}
