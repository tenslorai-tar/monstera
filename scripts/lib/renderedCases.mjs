// @ts-check
/**
 * Every rendered case takes `test` from `packages/testing/src/renderedTest.ts`, whose `page` fails the case when PDF.js
 * reports a picture it could not decode ([ADR-0296](../../docs/DECISIONS/0296-the-renderer-is-served-from-its-own-scheme-and-a-picture-is-never-dropped-silently.md)).
 * A case that takes Playwright's own `test` would draw pages with that report going nowhere, which is how every CCITT,
 * JBIG2 and JPEG 2000 picture was dropped through every rendered case for eleven weeks. So the rendered suites refuse
 * to run while one does (`scripts/test/playwright.config.mjs`, which every rendered suite's config imports).
 *
 * The search's POSITIVE CONTROL, on every call: `renderedTest.ts` itself takes `test` from Playwright, as `base`, and
 * the scan must find that import there or it refuses to say anything, since a pattern that matched nothing would pass
 * every case (CLAUDE.md, item 4b).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The rendered suites' case files, by the suffixes their configs match. */
export const RENDERED_CASE = /\.(pw|visual|capture|measure)\.ts$/u;

/** An import of `test` from Playwright, under its own name or another, on one line or over several. */
const TAKES_PLAYWRIGHTS_TEST = /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/u;

/**
 * The rendered case files under `dir` that take `test` from Playwright directly. Throws when the scan cannot find the
 * import `renderedTest.ts` is known to make.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function casesTakingPlaywrightsTest(dir) {
  const own = readFileSync(join(dir, 'renderedTest.ts'), 'utf8');
  if (!TAKES_PLAYWRIGHTS_TEST.test(own)) {
    throw new Error('the scan for rendered cases taking Playwright’s test did not find renderedTest.ts’s own import of it, so it cannot see one');
  }
  return readdirSync(dir)
    .filter((name) => RENDERED_CASE.test(name))
    .filter((name) => TAKES_PLAYWRIGHTS_TEST.test(readFileSync(join(dir, name), 'utf8')));
}

/**
 * Refuses, by throwing, while any rendered case under `dir` takes Playwright's `test` directly.
 *
 * @param {string} dir
 */
export function refuseUnwatchedCases(dir) {
  const found = casesTakingPlaywrightsTest(dir);
  if (found.length > 0) {
    throw new Error(
      `${String(found.length)} rendered case file(s) take test from @playwright/test, where a picture PDF.js drops would go unheard: ` +
        `${found.join(', ')}. Import { expect, test } from './renderedTest.js' (ADR-0296).`,
    );
  }
}
