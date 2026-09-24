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
