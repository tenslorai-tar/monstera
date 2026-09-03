// THE NAMED EXPORT. `@axe-core/playwright` publishes
// `export { AxeBuilder, AxeBuilder as default }`, and under this repository's
// `verbatimModuleSyntax` the default import resolves to the namespace rather
// than the class — "this expression is not constructable", at compile time.
import { AxeBuilder } from '@axe-core/playwright';
import { BRIDGE_KEY } from '@monstera/contract';
import { asFileHandle } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { createBrowserShim } from './browserShim.js';

/**
 * §10.4's mandated gate: axe-core on a Playwright-rendered screen.
 *
 * *"Accessibility is enforced at runtime, not by a static lint rule. … The
 * mandated gate is axe-core running on every Playwright-rendered screen from
 * Stage 0, with zero serious violations — which is the stronger check anyway:
 * it sees composed screens, focus order and real contrast, where a static rule
 * sees one element's props."*
 *
 * ## The shim stays in Node, and the page gets a bridge
 *
 * The renderer reads one global — `window.monstera`, a single
 * `invoke(channel, params)` — which the preload defines in the shipped app.
 * Here `exposeFunction` puts a Node function on the page and the init script
 * wraps it in that shape, so the REAL browser shim answers, unmodified, from
 * the process that can import it.
 *
 * That indirection is not a workaround, it is what the package boundary
 * requires: `packages/ui` may not import `@monstera/testing` and `testing` may
 * not import `ui`, so no source file may compose the App with the shim. Nothing
 * needs to — Playwright drives the BUILT renderer, which is the artefact that
 * ships, and a harness page composed from source would be a fifth surface
 * proving something adjacent to the product.
 *
 * ## Zero SERIOUS violations, and the threshold is the law's
 *
 * §10.4 says zero serious. `serious` and `critical` are both above that line;
 * `moderate` and `minor` are reported in the failure text but do not fail, so
 * the gate says what it was asked to say rather than what its author felt like
 * enforcing. Widening it later is an amendment, which is the point of writing
 * the threshold down here.
 */

/** The impact levels §10.4's threshold covers. */
const BLOCKING = new Set(['serious', 'critical']);

/**
 * Puts the browser shim behind the page's bridge.
 *
 * A function each test calls rather than a `beforeEach`, because the SCREEN a
 * test renders depends on what the shim answers — a start screen with a recent
 * list and a recovery offer is a different composed screen from an empty one,
 * and §10.4's gate is on every screen rather than on every route. One shim for
 * all of them could only ever produce the first-launch one.
 */
async function bridge(
  page: Page,
  options: Parameters<typeof createBrowserShim>[0] = {},
): Promise<void> {
  const shim = createBrowserShim(options);

  // The client is keyed by channel; the bridge is keyed by string. The cast is
  // that one fact and nothing wider — `any` would also erase the parameter and
  // return types, which is what B7 is protecting.
  const client = shim.client as unknown as Record<string, (params: unknown) => Promise<unknown>>;

  await page.exposeFunction('__monsteraInvoke', async (channel: string, params: unknown) => {
    const handler = client[channel];
    if (handler === undefined) {
      // A CHANNEL THE SHIM DOES NOT HAVE IS A DEFECT, not a null answer. The
      // shim is complete by construction — it fails to compile if the registry
      // grows — so reaching this means the page asked for something that is not
      // in the contract at all.
      throw new Error(`the page invoked an unknown channel: ${channel}`);
    }
    return handler(params);
  });

  await page.addInitScript((key: string) => {
    Object.defineProperty(window, key, {
      value: {
        invoke: (channel: string, params: unknown) =>
          (
            window as unknown as {
              __monsteraInvoke: (c: string, p: unknown) => Promise<unknown>;
            }
          ).__monsteraInvoke(channel, params),
      },
    });
  }, BRIDGE_KEY);
}

test('CONTROL: axe reports a planted violation on this very page', async ({ page }) => {
  await bridge(page);

  // WITHOUT THIS, THE GATE IS UNFALSIFIABLE. *No serious violations* is what a
  // clean screen reports, what an empty document reports, and what an axe that
  // never ran reports — three states with one output, and the one everybody
  // hopes for. Checklist 4b: a search needs a positive control that finds
  // something known-present, on every run.
  //
  // Planted on the REAL page rather than a fixture document, so the control
  // exercises the same navigation, the same bridge and the same analyze() call
  // as the gate it certifies. A control on a different page would prove axe
  // works somewhere else.
  await page.goto('/');
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.setAttribute('src', 'data:,');
    document.body.append(img);
  });

  const results = await new AxeBuilder({ page }).analyze();
  const planted = results.violations.filter((violation) => violation.id === 'image-alt');

  expect(
    planted.length,
    `axe found no image-alt violation for an <img> with no alt text. It reported: ${
      results.violations.map((v) => v.id).join(', ') || 'nothing at all'
    }. Until this passes, the gate below cannot tell a clean screen from an axe that did not run.`,
  ).toBeGreaterThan(0);

  // AND AT A BLOCKING IMPACT, because the gate filters on impact and a control
  // that ignored the filter would certify a scan whose findings the gate then
  // discards.
  expect(planted.every((violation) => BLOCKING.has(String(violation.impact)))).toBe(true);
});

/**
 * Renders the screen the shim describes and asserts §10.4's threshold on it.
 *
 * The mount assertion is inside here rather than in each case, because it is
 * every case's positive control: an empty document has zero accessibility
 * violations, so a page that failed to mount scores a perfect result — the
 * reassuring answer, from the failure this gate is least able to notice.
 */
async function expectNoSeriousViolations(
  page: Page,
  present: string,
): Promise<void> {
  const failures: string[] = [];
  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  await page.goto('/');

  await expect(page.locator('#root')).not.toBeEmpty();
  // AND THE SCREEN THIS CASE IS ABOUT IS THE ONE ON SCREEN. `#root` is
  // non-empty for every state the application can be in, so a case seeding a
  // recovery offer and getting a first-launch screen would pass — and would
  // report a clean result about a screen it never rendered.
  await expect(page.getByText(present)).toBeVisible();
  expect(failures, failures.join('\n')).toEqual([]);

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) =>
    BLOCKING.has(String(violation.impact)),
  );

  expect(
    blocking,
    blocking
      .map(
        (violation) =>
          `${String(violation.impact)}: ${violation.id} — ${violation.help}\n` +
          violation.nodes.map((node) => `    ${node.html}`).join('\n'),
      )
      .join('\n\n') ||
      `other impacts seen (not blocking): ${
        results.violations.map((v) => `${String(v.impact)}:${v.id}`).join(', ') || 'none'
      }`,
  ).toEqual([]);
}

test('the start screen renders through the contract and has no serious a11y violations', async ({
  page,
}) => {
  await bridge(page);

  await expectNoSeriousViolations(page, 'Open a PDF to begin.');
});

test('a message with a PLACEHOLDER renders its value, in the production build', async ({
  page,
}) => {
  // THE CONTROL FOR A DEFECT ONLY THIS ARTEFACT CAN HAVE, found 2026-09-03.
  //
  // `@lingui/core` 6.6.0 registers its runtime message compiler only when
  // `NODE_ENV !== 'production'`, so without one the built renderer returned the
  // raw catalogue string and every placeholder reached the screen literally —
  // *"Reopen {name}?"*, *"Page {page} of {count}"*. Every unit test in this
  // repository runs in development mode, where the constructor registers the
  // compiler for us, so all of them passed. `i18n.ts` now registers it.
  //
  // This case is here rather than beside the i18n module because the artefact
  // is the subject: the difference does not exist in a vitest run, and a case
  // that could not see it would be asserting the thing that was already true.
  // THE RECOVERY OFFER IS DRIVEN BY THE RECORDED SESSION, not by the head of
  // the recent list — multi-document tabs ended that correspondence, and the
  // interpolated string this case is about moved with it onto the per-document
  // control.
  await bridge(page, {
    recent: [{ handle: asFileHandle('handle-a'), name: 'annual report.pdf' }],
    lastExitClean: false,
    lastSession: [{ handle: asFileHandle('handle-a'), name: 'annual report.pdf' }],
  });
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Reopen annual report.pdf' })).toBeVisible();
  // AND THE PLACEHOLDER IS NOT ON SCREEN. Asserting the interpolated text alone
  // would pass for a page rendering both — which is not a state this library
  // produces, and is exactly the assumption that let the defect through.
  await expect(page.getByText('{name}')).toHaveCount(0);
});

test('the start screen WITH a recent list and a recovery offer is clean too', async ({ page }) => {
  // A DIFFERENT COMPOSED SCREEN, which is what §10.4's *every* is about: the
  // offer, the list and the controls together are what a reader meets after a
  // run that did not finish, and nothing about the empty screen's result says
  // anything about this one's contrast, focus order or naming.
  // TWO DOCUMENTS IN THE SESSION, which is the screen tabs made possible: the
  // offer is a list of controls now, and a screen with one row would not
  // exercise the arrangement a reader meets after losing several.
  await bridge(page, {
    recent: [
      { handle: asFileHandle('handle-a'), name: 'annual report.pdf' },
      { handle: asFileHandle('handle-b'), name: 'notes.pdf' },
    ],
    lastExitClean: false,
    lastSession: [
      { handle: asFileHandle('handle-a'), name: 'annual report.pdf' },
      { handle: asFileHandle('handle-b'), name: 'notes.pdf' },
    ],
  });

  await expectNoSeriousViolations(page, 'Monstera closed unexpectedly. These documents were open:');
});
