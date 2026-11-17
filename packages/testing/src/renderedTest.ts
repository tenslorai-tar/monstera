import { type ConsoleMessage, test as base, expect } from '@playwright/test';

/**
 * The `test` every rendered case takes: Playwright's, with a `page` that fails the case when PDF.js reports a picture
 * it could not decode ([ADR-0296](../../../docs/DECISIONS/0296-the-renderer-is-served-from-its-own-scheme-and-a-picture-is-never-dropped-silently.md)).
 *
 * ## Why every case, and not the one that draws pictures
 *
 * A picture PDF.js cannot decode is dropped whole and the rest of the page draws: no exception, no failed draw, only a
 * warning in the worker's console. Every Store release from 2026-08-29 dropped every CCITT, JBIG2 and JPEG 2000 picture
 * that way, through every rendered case that drew a page, and none of them could see it. So the report is read from the
 * page and from each of its workers, the worker being where PDF.js parses, and any one of them fails the case.
 *
 * ## The one case that wants the report
 *
 * A case that draws a picture NO decoder can read, to see what a person is shown, declares
 * `test.use({ undecodedPictures: 'expected' })`, and then the case fails when PDF.js reports NONE: a declaration that
 * the report is expected is a claim the case can see it, and an expected report that never came is a case testing a
 * picture that decoded.
 *
 * `scripts/test/playwright.config.mjs` refuses to run a rendered case that takes `test` from Playwright directly, so
 * this is the only `test` a case can have.
 */
export const test = base.extend<{ undecodedPictures: 'refused' | 'expected' }>({
  undecodedPictures: ['refused', { option: true }],
  page: async ({ page, undecodedPictures }, use) => {
    const dropped: string[] = [];
    const hear = (message: ConsoleMessage): void => {
      const text = message.text();
      if (UNDECODED.test(text)) dropped.push(text);
    };
    page.on('console', hear);
    page.on('worker', (worker) => {
      worker.on('console', hear);
    });
    await use(page);
    if (undecodedPictures === 'expected') {
      expect(dropped.length, 'the case expected PDF.js to report a picture it could not decode, and it reported none').toBeGreaterThan(0);
    } else {
      expect(dropped, 'PDF.js could not decode a picture, and drew the page without it').toStrictEqual([]);
    }
  },
});

/** PDF.js's own words when it drops a picture: `Unable to decode image "…"` and `Unable to decode inline image: …`. */
export const UNDECODED = /Unable to decode (inline )?image/u;

export { expect };
