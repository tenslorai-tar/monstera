import { type BrowserContext, type ConsoleMessage, type Page, test as base, expect } from '@playwright/test';

/**
 * The `test` every rendered case takes: Playwright's, failing the case when PDF.js reports a picture it could not decode
 * on ANY page the case draws in ([ADR-0296](../../../docs/DECISIONS/0296-the-renderer-is-served-from-its-own-scheme-and-a-picture-is-never-dropped-silently.md)).
 *
 * ## Why every case, and not the one that draws pictures
 *
 * A picture PDF.js cannot decode is dropped whole and the rest of the page draws: no exception, no failed draw, only a
 * warning in the worker's console. Every Store release from 2026-08-29 dropped every CCITT, JBIG2 and JPEG 2000 picture
 * that way, through every rendered case that drew a page, and none of them could see it. So the report is read from
 * every page and each of its workers, the worker being where PDF.js parses, and any one of them fails the case.
 *
 * ## Every page, not the `page` fixture's alone
 *
 * A case may open pages of its own, in the fixture's context or in a context of its own (KKKKKKKKK-4: eight files did).
 * So the context fixture's pages are watched as each opens, and so is every context the worker's browser makes.
 *
 * ## The one case that wants the report
 *
 * A case that draws a picture NO decoder can read, to see what a person is shown, declares
 * `test.use({ undecodedPictures: 'expected' })`, and then the case fails when PDF.js reports NONE: a declaration that
 * the report is expected is a claim the case can see it.
 *
 * The rendered configs refuse a case that takes `test` from Playwright directly (`scripts/lib/renderedCases.mjs`).
 */

/** PDF.js's own words when it drops a picture: an image, an inline image, or an XObject it ignored, an image mask's way. */
export const UNDECODED = /Unable to decode (inline )?image|ignoring XObject/u;

/** What the pages of the case running now reported, emptied as each case starts. */
const heard: string[] = [];
const hear = (message: ConsoleMessage): void => {
  const text = message.text();
  if (UNDECODED.test(text)) heard.push(text);
};
const watchPage = (page: Page): void => {
  page.on('console', hear);
  page.on('worker', (worker) => {
    worker.on('console', hear);
  });
};
const watchContext = (context: BrowserContext): void => {
  for (const page of context.pages()) watchPage(page);
  context.on('page', watchPage);
};

export const test = base.extend<{ undecodedPictures: 'refused' | 'expected'; picturesHeard: undefined }, { watchedBrowser: undefined }>({
  // EVERY CONTEXT THE WORKER'S BROWSER MAKES, a case's own included: `newContext` and `newPage` wrapped once a worker,
  // before any case runs, so the heard list a case is judged by holds what its own pages said.
  watchedBrowser: [
    async ({ browser }, use) => {
      const newContext = browser.newContext.bind(browser);
      const newPage = browser.newPage.bind(browser);
      browser.newContext = async (...options: Parameters<typeof browser.newContext>) => {
        const made = await newContext(...options);
        watchContext(made);
        return made;
      };
      browser.newPage = async (...options: Parameters<typeof browser.newPage>) => {
        const made = await newPage(...options);
        watchPage(made);
        return made;
      };
      await use(undefined);
    },
    { scope: 'worker', auto: true },
  ],
  undecodedPictures: ['refused', { option: true }],
  context: async ({ context }, use) => {
    watchContext(context);
    await use(context);
  },
  picturesHeard: [
    async ({ undecodedPictures, context: _context }, use) => {
      heard.length = 0;
      await use(undefined);
      if (undecodedPictures === 'expected') {
        expect(heard.length, 'the case expected PDF.js to report a picture it could not decode, and it reported none').toBeGreaterThan(0);
      } else {
        expect([...heard], 'PDF.js could not decode a picture, and drew the page without it').toStrictEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
