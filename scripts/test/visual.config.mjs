// @ts-check
/**
 * The visual baselines run: §10.7.
 *
 * §10.7, verbatim: *"Playwright screenshot baselines for the start screen, each
 * ribbon section, one dialog and one panel, in all three themes, compared by
 * perceptual diff with a stated tolerance. Exact hashes go flaky on environment
 * updates, and a flaky gate gets ignored — which is worse than no gate.
 * Baselines are regenerated deliberately, in their own commit, never as a side
 * effect."*
 *
 * ## The accessibility run's config, with three things changed
 *
 * The server, the browser path, the device and `retries: 0` are that config's,
 * imported rather than restated: two opinions about how the built renderer is
 * served are how the two runs would drift apart (B3a).
 *
 * - **Its own file pattern**, `.visual.ts`, which the accessibility run's
 *   `.pw.ts` does not match. The baselines are a separate verb, so regenerating
 *   them is a command a person types rather than something `test:a11y` does.
 * - **Baselines beside the package, named by platform.** Font rasterisation
 *   differs between operating systems, so a baseline is a fact about one
 *   platform, and the platform in the name makes a comparison against another
 *   platform's image a missing baseline rather than a false drift.
 * - **The tolerance**, stated below with where it came from.
 */

import { defineConfig } from '@playwright/test';

import accessibility from './playwright.config.mjs';

export default defineConfig({
  ...accessibility,
  testMatch: '**/*.visual.ts',
  snapshotPathTemplate: '{testDir}/../baselines/{arg}-{platform}{ext}',
  expect: {
    toHaveScreenshot: {
      // PIXELMATCH'S PERCEPTUAL DISTANCE, per pixel: a pixel counts as different only
      // when its colour moves further than this in YIQ space, which is weighted the
      // way the eye weights brightness over hue. 0.2 is Playwright's own default.
      threshold: 0.2,
      // 100 PIXELS, chosen between two readings taken 2026-09-15 on one Windows 11
      // build of the renderer (`docs/JOURNAL.md`, design pass J):
      //
      // - the SPREAD: three comparisons at zero tolerance matched all 33 images
      //   exactly, once captures waited for the page to be drawn;
      // - the SMALLEST CHANGE THIS MUST SEE: the control's one-word change on the
      //   start screen, "Open PDF…" to "Open PDFs", moved 319 pixels.
      //
      // An absolute count rather than a ratio, because the panel image is a
      // fraction of the window's size, and a ratio would let the same one-word
      // change through there. 100 is under a third of the planted change and
      // leaves room for the anti-aliasing a browser or font update moves — the
      // environment drift §10.7 names as why exact hashes go flaky. The spread on
      // the CI runner is not yet read; if it exceeds this, that is a finding about
      // the environment, and the figure is re-chosen from the reading, not raised.
      maxDiffPixels: 100,
    },
  },
});
