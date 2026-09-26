import { configure } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * The time limit for a test that renders the whole `App`, in milliseconds. TEST-ONLY: nothing the
 * application runs imports this.
 *
 * ## The limit is there to catch a hang, and Vitest's default sat inside the normal spread
 *
 * A test limit exists to end a test that will never finish. Vitest's default is 5000 ms, a figure
 * nobody chose for these files, and they render every surface of the application in React's
 * development build under happy-dom, so their duration is CPU work that stretches with whatever else
 * the suite runs beside them. Measured 2026-09-24 on the owner's development machine (Windows 11,
 * 4 cores, 11.9 GB), one test at a time:
 *
 * - alone, one file: 0.66–2.5 s per test (`AppClose.test.tsx`, `AppTabs.test.tsx`, five runs);
 * - the two files together: up to 6.4 s for one test;
 * - in a full `npm run test` that passed: slowest tests 3.4 s and 3.9 s;
 * - in a full `npm run test` that failed: 5.8, 5.8 and 3.5 s over the default.
 *
 * Nothing was looping: one test rendered `App` 8 times and 256 tooltips in all. A profile gave about
 * 15% of the time to React's development `jsx` recording a stack per element.
 *
 * So the default failed tests at random, and 20 s is about three times the worst reading while still
 * ending a real hang. The owner's decision, 2026-09-24.
 *
 * **CI RUNNERS MAY BE SLOWER THAN THIS MACHINE.** If a CI run of these files ever comes close to
 * 20 s, re-measure where it happened and choose again from the readings — never raise this number
 * to make a red run green.
 *
 * `fullAppTestLimit.test.ts` finds the files that render `App` by searching the source, and fails if
 * one of them does not take this limit or any other file does.
 */
export const FULL_APP_TEST_TIMEOUT = 20_000;

/**
 * How long a `find*` or `waitFor` in these files waits — Testing Library's own default is 1000 ms, a figure nobody
 * chose here either.
 *
 * ## A dialog's body is a lazy chunk, and its first import happens INSIDE the wait
 *
 * ADR-0029 Decision 7 makes every dialog body `lazy()`: the frame and its title render at once and the body when its
 * module arrives. Under Vitest that arrival is the worker transforming the module on first import, which is not UI
 * settling and has no bound of its own. Measured 2026-09-26 on the owner's machine (Windows 11, 4 cores): importing
 * all 82 bodies cold took 4376 ms, 53 ms each on average (a probe under `packages/ui/src`, not kept). And on
 * windows-latest at 7539dd80 the first import of one body missed the 1000 ms window: the dialog titled *That could
 * not be done* was found and its sentence was not (`App.test.tsx`, the POISONED case, the run's public annotation).
 *
 * 10 s is more than twice the cold cost of every body at once, and half the case limit — so a real miss still ends
 * in Testing Library's DOM dump, which names what was on screen, rather than in a bare case timeout, which names
 * nothing.
 */
export const FULL_APP_WAIT = 10_000;

/**
 * Both limits, in the ONE call every file that renders `App` makes — so a file cannot take the case limit and keep
 * the 1 s wait, which is how the window above went unchosen while the limit beside it was chosen.
 */
export function applyFullAppLimits(
  // THE TWO SETTERS, defaulted and injectable: Vitest exposes no reader for a file's test limit, so the case that
  // proves both are set asserts the calls rather than a readback.
  set: {
    readonly vitest: (config: { readonly testTimeout: number }) => void;
    readonly testingLibrary: (config: { readonly asyncUtilTimeout: number }) => void;
  } = { vitest: vi.setConfig, testingLibrary: configure },
): void {
  set.vitest({ testTimeout: FULL_APP_TEST_TIMEOUT });
  set.testingLibrary({ asyncUtilTimeout: FULL_APP_WAIT });
}
