import type { SettingsSurface } from './settingsFile.js';

/**
 * When to ask for a Store rating — the founding record's E3, in main.
 *
 * ## E3's rule, and its figures are E3's
 *
 * *"First prompt no sooner than 3 days after install **and** after real use (≥2 sessions); then every 3 days
 * while unreviewed, max 5 prompts total."* A prompt is never modal and never on a dirty close: the page shows
 * it as a banner at start, and nothing here runs at close.
 *
 * ## What is recorded, and what is NOT
 *
 * `installDate` (the first run this record saw), `sessions`, `lastPromptAt`, `promptCount`, `reviewedAt`.
 * **The opt-out is not here**: E3's *"a Settings toggle surfaces `optedOut`"* is the toggle itself — the
 * setting is its one home, read through `enabled`, and *Don't ask again* writes that setting. A copy in this
 * record would be a second writer of one choice (B3).
 *
 * *"The Store cannot be queried for review status; `reviewedAt` is the honest local record and the code must
 * not pretend otherwise."* So `reviewedAt` means *this person said so, or pressed Rate and the Store opened*,
 * and nothing more.
 */

/** E3: the first prompt waits this long after install, and each later one this long after the last. */
export const PROMPT_GAP_DAYS = 3;
/** E3: real use first — this many sessions, the one running included. */
export const MIN_SESSIONS = 2;
/** E3: never more prompts than this, in total. */
export const MAX_PROMPTS = 5;

/** The record's file name inside `userData`. */
export const ENGAGEMENT_FILE = 'engagement.json';

const DAY_MS = 86_400_000;

/** What the handlers need. */
export interface Engagement {
  /** Whether to ask now. A `true` is recorded as a prompt shown, since the page shows it on this answer. */
  due(): boolean;
  /** A person pressed Rate and the Store opened, or said they had reviewed: never ask again. */
  reviewed(): void;
  /** A person said *Later*: the three days start again from now. */
  later(): void;
}

/** What the two channels need: whether to ask, and what an answer does. */
export interface ReviewPrompt {
  due(): boolean;
  /** Records the answer; for *rate*, opens the Store's review page and answers whether it opened. */
  answer(action: 'rate' | 'reviewed' | 'later'): Promise<boolean>;
}

/**
 * The prompt over the record and the one way this build opens the Store's review page.
 *
 * **Rate records `reviewedAt` only when the page opened.** A build with no address, or a platform that
 * refused, sent the person nowhere, and recording a review then would stop the prompts for a rating that
 * never had a chance to happen.
 */
export function reviewPrompt(engagement: Engagement, openReview: () => Promise<boolean>): ReviewPrompt {
  return {
    due: () => engagement.due(),
    answer: async (action) => {
      if (action === 'later') {
        engagement.later();
        return false;
      }
      if (action === 'reviewed') {
        engagement.reviewed();
        return false;
      }
      const opened = await openReview();
      if (opened) engagement.reviewed();
      return opened;
    },
  };
}

/** A prompt that is never due and opens nothing: a graph with no engagement record — every unit test's. */
export const NO_REVIEW_PROMPT: ReviewPrompt = {
  due: () => false,
  answer: () => Promise.resolve(false),
};

/**
 * The engagement record over a JSON document, counting this launch as a session.
 *
 * @param file the document, from `createJsonFile`, for `SettingsSurface`'s reason
 * @param deps `now`, injected so a case can move the clock; `enabled`, the Settings toggle's value
 */
export function createEngagement(
  file: SettingsSurface,
  deps: { readonly now: () => Date; readonly enabled: () => boolean },
): Engagement {
  const stored = file.read();
  const at = (key: string): number | null => {
    const value = stored[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const count = (key: string): number => {
    const value = stored[key];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
  };
  // A RECORD NOBODY WROTE starts today: the first run this build saw is the honest install date it has.
  const state = {
    installDate: at('installDate') ?? deps.now().getTime(),
    sessions: count('sessions') + 1,
    lastPromptAt: at('lastPromptAt'),
    promptCount: count('promptCount'),
    reviewedAt: at('reviewedAt'),
  };
  const persist = (): void => {
    file.write({ ...state });
  };
  // THIS LAUNCH IS A SESSION, counted as the record is read, so two launches are two whatever else happens.
  persist();

  const daysSince = (then: number): number => (deps.now().getTime() - then) / DAY_MS;

  return {
    due: () => {
      if (!deps.enabled() || state.reviewedAt !== null) return false;
      if (state.promptCount >= MAX_PROMPTS || state.sessions < MIN_SESSIONS) return false;
      if (daysSince(state.installDate) < PROMPT_GAP_DAYS) return false;
      if (state.lastPromptAt !== null && daysSince(state.lastPromptAt) < PROMPT_GAP_DAYS) return false;
      state.lastPromptAt = deps.now().getTime();
      state.promptCount += 1;
      persist();
      return true;
    },
    reviewed: () => {
      state.reviewedAt = deps.now().getTime();
      persist();
    },
    later: () => {
      state.lastPromptAt = deps.now().getTime();
      persist();
    },
  };
}
