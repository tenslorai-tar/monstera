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
 * EVERY DIALOG BODY, loaded when this module is imported — which every file that renders `App` does, for
 * {@link applyFullAppLimits}.
 *
 * ## The race this removes, and why the set is derived
 *
 * ADR-0029 Decision 7 makes every dialog body `lazy()`: the frame and its title render at once and the body when its
 * module arrives. Under Vitest that arrival is the worker transforming the module on first import — measured
 * 2026-09-26 on the owner's machine, 4376 ms for all 82 bodies cold, 53 ms each on average — and it happened inside
 * Testing Library's 1000 ms wait. On windows-latest at 7539dd80 the dialog titled *That could not be done* was found
 * and its sentence was not.
 *
 * `App.test.tsx` had removed that race since 2026-09-06 with a HAND-KEPT list of the bodies it reads, whose comment
 * predicted its own failure: a body added to a case and not to the list. The command-problem body was the one missed,
 * and the stage audit of 1e1bfad..e24eca0e found two more a full-App case reads with no preload — the close question
 * in `AppClose.test.tsx` and Cloud storage in `App.test.tsx`. Glob-loaded, the set IS every body there is, so there is
 * no entry to forget.
 *
 * **What this replaced**: a 10 s wait window (6b570c3b, kept as a "backstop" in e24eca0e). A longer wait was a raised
 * timeout standing in for an incomplete list — Rule 0's banned reflex, and the remedy the 2026-09-06 block had already
 * rejected — and it made a missed entry slower rather than visible. Testing Library's default wait is back.
 *
 * Cost: the import, once per file that renders `App` (five), at the figure above.
 */
export const DIALOG_BODIES: Readonly<Record<string, unknown>> = import.meta.glob('./dialogs/*Body.tsx', { eager: true });

/**
 * The case limit, in the ONE call every file that renders `App` makes — and importing it is what loads
 * {@link DIALOG_BODIES}, so a file cannot take the limit without the bodies.
 */
export function applyFullAppLimits(
  // THE SETTER, defaulted and injectable: Vitest exposes no reader for a file's test limit, so the case that proves
  // it is set asserts the call rather than a readback.
  set: { readonly vitest: (config: { readonly testTimeout: number }) => void } = { vitest: vi.setConfig },
): void {
  set.vitest({ testTimeout: FULL_APP_TEST_TIMEOUT });
}
