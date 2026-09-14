// THE NAMED EXPORT. `@axe-core/playwright` publishes
// `export { AxeBuilder, AxeBuilder as default }`, and under this repository's
// `verbatimModuleSyntax` the default import resolves to the namespace rather
// than the class — "this expression is not constructable", at compile time.
import { AxeBuilder } from '@axe-core/playwright';
import { BRIDGE_KEY } from '@monstera/contract';
import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion, asFileHandle } from '@monstera/shared';
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

test('the PRIMITIVES are styled in the production build, not left as browser controls', async ({
  page,
}) => {
  // THE CONTROL FOR A STYLESHEET NOTHING IMPORTED, found 2026-09-14. `primitives.css`
  // existed and was reviewed, and `main.tsx` imported only `tokens.css` and `app.css`, so
  // every primitive shipped with the browser's own button styling. No unit test can see
  // it: happy-dom loads no stylesheet. The built bundle is the subject, as in the
  // placeholder case below.
  //
  // PADDING, because the value separates the two states. The primitive declares
  // `var(--space-8) var(--space-16)`, and Chromium's default button padding is 1px 6px, so
  // a missing stylesheet cannot produce 8px by coincidence.
  await bridge(page);
  await page.goto('/');

  const open = page.getByRole('button', { name: 'Open a document' });
  await expect(open).toBeVisible();
  const padding = await open.evaluate((element) => {
    const style = getComputedStyle(element);
    return { top: style.paddingTop, left: style.paddingLeft };
  });
  expect(padding).toStrictEqual({ top: '8px', left: '16px' });
});

test('the UI FONT is the system stack, on text and on controls, in the production build', async ({
  page,
}) => {
  // §10.4: "System font stack (Segoe UI first on Windows)". Nothing set a font until
  // 2026-09-14, so the shell drew in the browser's serif. The DECLARED family is read,
  // not the face drawn: it is the same on every platform, where the face the stack falls
  // through to is not. A control is read as well as text, because Chromium gives
  // controls a font of their own unless told to inherit.
  await bridge(page);
  await page.goto('/');

  const expected = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim(),
  );
  // THE TOKEN IS THERE, or the comparisons below would pass on two empty strings.
  expect(expected.startsWith("'Segoe UI'") || expected.startsWith('"Segoe UI"')).toBe(true);

  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  const open = page.getByRole('button', { name: 'Open a document' });
  await expect(open).toBeVisible();
  const control = await open.evaluate((element) => getComputedStyle(element).fontFamily);

  const normalise = (family: string): string => family.replaceAll("'", '"').replaceAll(/\s*,\s*/gu, ',');
  expect(normalise(body)).toBe(normalise(expected));
  expect(normalise(control)).toBe(normalise(expected));
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

/** A one-page document built here, so the case needs no fixture from the corpus (B10). */
async function onePagePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/**
 * Bridges a page whose Open command yields the one-page document, `times` times.
 *
 * `times` because a reload is a fresh renderer that has to open the document again, and each
 * open takes one answer.
 */
async function bridgeWithDocument(
  page: Page,
  stored: Record<string, unknown>,
  times: number,
): Promise<void> {
  const bytes = await onePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000c2');
  await bridge(page, {
    settings: stored,
    opens: Array.from({ length: times }, () => ({
      kind: 'opened' as const,
      docId,
      version: asDocVersion(1),
      byteLength: bytes.byteLength,
      name: 'width.pdf',
    })),
    documentBytes: new Map([[docId, bytes]]),
  });
}

/** The resizable pane's measured width, in CSS pixels. */
async function panelPaneWidth(page: Page): Promise<number> {
  const pane = page.locator('.m-splitter__pane').first();
  await expect(pane).toBeVisible();
  const box = await pane.boundingBox();
  return box?.width ?? 0;
}

test('the document panel is RESIZABLE, and its width is the stored setting, across a reload', async ({
  page,
}) => {
  // §10.3: "panels resizable with persisted widths". No component test can see this: happy-dom
  // lays nothing out, every rect is 0, and the splitter resolves no pixel size against a zero
  // root. The production build in a real browser is the subject.
  //
  // THE STORED WIDTH IS NOT THE FALLBACK. 256 against a fallback of 224, so a panel that ignored
  // the setting cannot pass the first assertion by drawing its default.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.document-panel-width': 256 }, 2);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a document' }).click();

  const handle = page.getByRole('separator', { name: 'Resize the document panel' });
  await expect(handle).toBeVisible();

  // THE PANE IS NOT THE STORED PIXELS EXACTLY, and the gap is the library's rule, measured.
  // `parsePanelSize` resolves "256px" as 256 / root × 100 %, and `getPanelFlexBoxStyle` lays that
  // percentage out as a flex-grow share of the root MINUS the handle, written to three significant
  // figures. Measured 2026-09-14 at this viewport: root 1216.33, handle 6, pane 254.17 — 1.26 px
  // from the handle's share and 0.57 px from the rounding. So the tolerance is the handle as this
  // page measures it, plus one pixel for the rounding, and it still separates the stored 256 from
  // the fallback 224 by thirty pixels.
  const handleWidth = (await handle.boundingBox())?.width ?? 0;
  expect(handleWidth).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs((await panelPaneWidth(page)) - 256)).toBeLessThan(handleWidth + 1);

  // THE KEYBOARD STEP, the resize every person can perform. The machine's own step is 1 % of the
  // root, so at this viewport it moves the pane by several pixels — well past the rounding the
  // setting applies.
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(262);
  const resized = await panelPaneWidth(page);

  // ACROSS A RELOAD, which is what PERSISTED means: a fresh renderer reads the settings the shim
  // saved, and the width it lays out is the resized one, not 256 and not the fallback.
  await page.reload();
  await page.getByRole('button', { name: 'Open a document' }).click();
  await expect(page.getByRole('separator', { name: 'Resize the document panel' })).toBeVisible();
  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(262);
  expect(Math.abs((await panelPaneWidth(page)) - resized)).toBeLessThan(1.5);
});

test('dragging the handle moves the document panel WHILE the pointer moves, not only on release', async ({
  page,
}) => {
  // A resize a person cannot see until they let go is not a resize they can aim. The machine
  // reports a drag only when it ends (`onResizeEnd`), and the width is a controlled setting, so
  // whether the pane follows the pointer mid-drag is a property of how the two meet — and a
  // keyboard case cannot see it, because every key press ends a resize.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.document-panel-width': 256 }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a document' }).click();

  const handle = page.getByRole('separator', { name: 'Resize the document panel' });
  await expect(handle).toBeVisible();
  const before = await panelPaneWidth(page);
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });
  // MID-DRAG, before the pointer is released.
  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(before + 40);
  await page.mouse.up();

  // AND ON RELEASE it stays where it was dropped, rather than snapping back to the stored width.
  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(before + 40);
});

test("at its MINIMUM width the document panel's strip still holds every tab and the chevron", async ({
  page,
}) => {
  // `DOCUMENT_PANEL_MIN_WIDTH` is 192, derived by adding the strip's padding, six tabs, their gaps,
  // the chevron and the border as the stylesheets declare them: 189. That sum is arithmetic on
  // declarations; this is the rendered strip, which is what a person would see clipped.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.document-panel-width': 192 }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a document' }).click();

  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(191);
  const pane = await page.locator('.m-splitter__pane').first().boundingBox();
  const lastTab = await page.getByRole('tab', { name: 'Search' }).boundingBox();
  const chevron = await page.getByRole('button', { name: 'Collapse the document panel' }).boundingBox();
  expect(pane).not.toBeNull();
  expect(lastTab).not.toBeNull();
  expect(chevron).not.toBeNull();
  const paneRight = (pane?.x ?? 0) + (pane?.width ?? 0);
  // Inside the pane, both of them: a clipped last tab or chevron is the defect.
  expect((lastTab?.x ?? 0) + (lastTab?.width ?? 0)).toBeLessThanOrEqual(paneRight + 0.5);
  expect((chevron?.x ?? 0) + (chevron?.width ?? 0)).toBeLessThanOrEqual(paneRight + 0.5);
});
