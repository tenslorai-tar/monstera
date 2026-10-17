import { describe, expect, it } from 'vitest';

import { IDLE_RELEASE_MS, type IdleState, keepStartScroll, shouldAskRelease, takeStartScroll } from './idleRelease.js';

/**
 * ADR-0252's renderer half: ask `main` to give the window's memory back only after a quiet minute with nothing open,
 * nothing on screen and nothing running. Each control breaks one condition of a state the rule otherwise asks in.
 */
const quiet = (overrides: Partial<IdleState> = {}): IdleState => ({
  documents: 0,
  dialogOpen: false,
  inFlight: 0,
  quietSince: 0,
  asked: false,
  now: IDLE_RELEASE_MS,
  ...overrides,
});

describe('when an idle window asks to give its memory back', () => {
  it('asks after a quiet minute with nothing open', () => {
    expect(shouldAskRelease(quiet())).toBe(true);
  });

  it('CONTROL: one millisecond short of the minute, it does not', () => {
    expect(shouldAskRelease(quiet({ now: IDLE_RELEASE_MS - 1 }))).toBe(false);
  });

  it('CONTROL: a document open, a dialog open, or work in flight each stop it', () => {
    expect(shouldAskRelease(quiet({ documents: 1 }))).toBe(false);
    expect(shouldAskRelease(quiet({ dialogOpen: true }))).toBe(false);
    expect(shouldAskRelease(quiet({ inFlight: 1 }))).toBe(false);
  });

  it('CONTROL: input inside the minute starts it again, and a window that asked does not ask twice', () => {
    expect(shouldAskRelease(quiet({ quietSince: 1 }))).toBe(false);
    expect(shouldAskRelease(quiet({ asked: true }))).toBe(false);
  });
});

describe('the start area keeps its place across the reload', () => {
  /** A storage in memory, as the window's `sessionStorage` is for one page's life and the next one's. */
  const memory = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
    const held = new Map<string, string>();
    return {
      getItem: (key) => held.get(key) ?? null,
      setItem: (key, value) => {
        held.set(key, value);
      },
      removeItem: (key) => {
        held.delete(key);
      },
    };
  };

  it('an offset kept before the reload is taken once after it', () => {
    const storage = memory();
    keepStartScroll(storage, 318.6);
    expect(takeStartScroll(storage)).toBe(319);
    // ONCE: the next start screen opens where any other start does.
    expect(takeStartScroll(storage)).toBeUndefined();
  });

  it('CONTROL: a storage that refuses keeps nothing and answers nothing, and throws nowhere', () => {
    const refusing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    keepStartScroll(refusing, 100);
    expect(takeStartScroll(refusing)).toBeUndefined();
  });
});
