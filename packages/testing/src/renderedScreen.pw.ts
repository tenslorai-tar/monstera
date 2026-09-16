// THE NAMED EXPORT. `@axe-core/playwright` publishes
// `export { AxeBuilder, AxeBuilder as default }`, and under this repository's
// `verbatimModuleSyntax` the default import resolves to the namespace rather
// than the class — "this expression is not constructable", at compile time.
import { AxeBuilder } from '@axe-core/playwright';
import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion, asFileHandle } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

// ONE BRIDGE for both Playwright runs — §10.7's baselines drive the renderer the same way (B3a),
// and `LOOKS` is theirs too: §10.4's gate and §10.7's baselines check the same three themes, and
// two lists would drift the day one gains a fourth (audit finding IIIIII-2).
import { LOOKS, type Look, bridge, bridgeUnder } from './pageBridge.js';

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


// ONE CONTROL PER THEME, which is the owner's ruling of 2026-09-16 and not a flourish: a control
// certifies the scan that ran beside it, and the gate now runs three times. A single control under
// the default theme would certify one of the three and read as certifying all of them — the shape
// audit finding IIIIII-2 is about, one layer along.
for (const look of LOOKS) {
  test(`${look.name}: CONTROL: axe reports a planted violation on this very page`, async ({ page }) => {
    await bridgeUnder(page, look);

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
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await page.evaluate(() => {
      const img = document.createElement('img');
      img.setAttribute('src', 'data:,');
      document.body.append(img);
    });

    const results = await new AxeBuilder({ page }).analyze();
    const planted = results.violations.filter((violation) => violation.id === 'image-alt');

    expect(
      planted.length,
      `axe found no image-alt violation for an <img> with no alt text under ${look.name}. It reported: ${
        results.violations.map((v) => v.id).join(', ') || 'nothing at all'
      }. Until this passes, the gate below cannot tell a clean screen from an axe that did not run.`,
    ).toBeGreaterThan(0);

    // AND AT A BLOCKING IMPACT, because the gate filters on impact and a control
    // that ignored the filter would certify a scan whose findings the gate then
    // discards.
    expect(planted.every((violation) => BLOCKING.has(String(violation.impact)))).toBe(true);
  });
}

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
  look: Look,
  present: string,
): Promise<void> {
  const failures: string[] = [];
  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  await page.goto('/');

  // THE THEME IS ASSERTED BEFORE ANYTHING IS ANALYSED, which is §10.7's rule for a capture
  // arriving in §10.4's gate: a clean result reported about the theme the case did not mean to
  // render is the reassuring answer, and the setting and the media query are applied by two
  // different mechanisms (`bridgeUnder`), so either half failing silently leaves the other's
  // screen on the page.
  await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);

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

// EVERY THEME, because contrast is what a static rule cannot see and it is exactly what a theme
// changes. Part M7 names all three; `BUILD-PROMPT.md`:998 holds text to 4.5:1 on every surface it
// may sit on, and §10.2 now asks 7:1 of the high-contrast theme — none of which the default-theme
// run could ever have reported on (audit finding IIIIII-2).
for (const look of LOOKS) {
  test(`${look.name}: the start screen renders through the contract and has no serious a11y violations`, async ({
    page,
  }) => {
    await bridgeUnder(page, look);

    await expectNoSeriousViolations(page, look, 'Built For The Way You Work');
  });
}

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

  const open = page.getByRole('button', { name: 'Open PDF…' });
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
  const open = page.getByRole('button', { name: 'Open PDF…' });
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

for (const look of LOOKS) {
  test(`${look.name}: the start screen WITH a recent list and a recovery offer is clean too`, async ({ page }) => {
    // A DIFFERENT COMPOSED SCREEN, which is what §10.4's *every* is about: the
    // offer, the list and the controls together are what a reader meets after a
    // run that did not finish, and nothing about the empty screen's result says
    // anything about this one's contrast, focus order or naming.
    // TWO DOCUMENTS IN THE SESSION, which is the screen tabs made possible: the
    // offer is a list of controls now, and a screen with one row would not
    // exercise the arrangement a reader meets after losing several.
    await bridgeUnder(page, look, {
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

    await expectNoSeriousViolations(page, look, 'Monstera closed unexpectedly. These documents were open:');
  });
}

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
  await page.getByRole('button', { name: 'Open PDF…' }).click();

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
  await page.getByRole('button', { name: 'Open PDF…' }).click();
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
  await page.getByRole('button', { name: 'Open PDF…' }).click();

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

/** The right contextual panel's pane — the last pane of the row — measured width, in CSS pixels. */
async function contextPaneWidth(page: Page): Promise<number> {
  const pane = page.locator('.m-splitter__pane').last();
  await expect(pane).toBeVisible();
  const box = await pane.boundingBox();
  return box?.width ?? 0;
}

test('the RIGHT contextual panel resizes on its own handle, persists, and leaves the left alone', async ({
  page,
}) => {
  // §10.3: "Both side panels are collapsible … State is persisted per panel" and "panels resizable
  // with persisted widths". Two fixed panes around a flexible one is the layout the splitter fills
  // with a hole in its size array (Splitter.tsx), which no component test can lay out — so this is
  // also the case that fails if a library version stops filling that hole.
  //
  // STORED WIDTHS THAT ARE NOT THE FALLBACKS: 300 on the right against 256, 240 on the left against
  // 224, so a side that ignored its setting cannot pass by drawing its default.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(
    page,
    { 'appearance.document-panel-width': 240, 'appearance.context-panel-width': 300 },
    2,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const right = page.getByRole('separator', { name: 'Resize the properties panel' });
  await expect(right).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  // THE STYLE CONTROLS MOVED HERE, out of the row under the status bar.
  await expect(page.getByRole('complementary', { name: 'Properties' }).locator('.m-style-panel')).toBeVisible();

  // Each drawn pane is within its handle's width of its stored width — the library's layout rule,
  // measured for the left pane in the case above; two handles now share the root.
  const handleWidth = (await right.boundingBox())?.width ?? 0;
  expect(handleWidth).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs((await contextPaneWidth(page)) - 300)).toBeLessThan(2 * handleWidth + 1);
  const leftBefore = await panelPaneWidth(page);

  // THE RIGHT HANDLE, BY KEYBOARD. ArrowLeft moves the handle left, which widens the right pane.
  await right.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => contextPaneWidth(page)).toBeGreaterThan(306);
  const rightResized = await contextPaneWidth(page);
  // AND THE LEFT PANE DID NOT MOVE: a resize at one handle writes only its own side.
  expect(Math.abs((await panelPaneWidth(page)) - leftBefore)).toBeLessThan(1.5);

  // ACROSS A RELOAD, both widths as they were left.
  await page.reload();
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.getByRole('separator', { name: 'Resize the properties panel' })).toBeVisible();
  await expect.poll(() => contextPaneWidth(page)).toBeGreaterThan(306);
  expect(Math.abs((await contextPaneWidth(page)) - rightResized)).toBeLessThan(1.5);
  expect(Math.abs((await panelPaneWidth(page)) - leftBefore)).toBeLessThan(1.5);

  // COLLAPSING THE RIGHT leaves the left's width, and the reopen handle is on the canvas's edge.
  await page.getByRole('button', { name: 'Collapse the properties panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show the properties panel' })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize the properties panel' })).toHaveCount(0);
  expect(Math.abs((await panelPaneWidth(page)) - leftBefore)).toBeLessThan(1.5);
});

test('at its MINIMUM width the right contextual panel still holds the widest style row', async ({ page }) => {
  // `CONTEXT_PANEL_MIN_WIDTH` is 216, MEASURED: the style controls' min-content width was 211.39 px,
  // the opacity row's slider being the widest. This is the rendered panel at that width, asserting
  // no style row runs past the pane — what a person would see clipped.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.context-panel-width': 216 }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const region = page.getByRole('complementary', { name: 'Properties' });
  await expect(region.locator('.m-style-panel')).toBeVisible();
  await expect.poll(() => contextPaneWidth(page)).toBeGreaterThan(200);
  const overflow = await page.evaluate(() => {
    const panes = document.querySelectorAll('.m-splitter__pane');
    const pane = panes[panes.length - 1];
    if (pane === undefined) return null;
    const paneRight = pane.getBoundingClientRect().right;
    return [...pane.querySelectorAll('.m-style-row')].map((row) => {
      // The row's LAST control, which is what space-between pushes to the pane's edge.
      const last = row.lastElementChild;
      return (last?.getBoundingClientRect().right ?? 0) - paneRight;
    });
  });
  expect(overflow).not.toBeNull();
  expect((overflow ?? []).length).toBeGreaterThan(0);
  for (const past of overflow ?? []) expect(past).toBeLessThanOrEqual(0.5);
});

test('the page list FITS its pane: nothing of it sits above the pane or under the status bar', async ({
  page,
}) => {
  // THE CONTROL FOR A 32 PX OVERFLOW, found 2026-09-14. `.m-page-list` was content-box with
  // `block-size: 100%` and 16 px block padding, so its box was 700 px in a 668 px pane. The pane,
  // `overflow: hidden` but scrollable from script, had been scrolled 16 px into that surplus: the
  // list's top sat 16 px above the pane and its bottom 16 px under the status bar. Before the
  // splitter clipped the pane, the page was drawn over the bar. No component test lays anything
  // out, so the production build is the subject.
  //
  // THE PANE'S scrollTop is asserted, not only the boxes: a pane with 32 px to spare and scrolled
  // back to 0 would pass a box comparison by luck, and the surplus is the defect.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();

  const fit = await page.evaluate(() => {
    const list = document.querySelector('.m-page-list');
    const pane = list?.closest('.m-splitter__pane') ?? null;
    const status = document.querySelector('.m-status-bar');
    if (list === null || pane === null || status === null) return null;
    const listBox = list.getBoundingClientRect();
    const paneBox = pane.getBoundingClientRect();
    return {
      listTop: listBox.top,
      listBottom: listBox.bottom,
      paneTop: paneBox.top,
      paneBottom: paneBox.bottom,
      statusTop: status.getBoundingClientRect().top,
      paneScrollTop: pane.scrollTop,
      paneSurplus: pane.scrollHeight - pane.clientHeight,
    };
  });
  expect(fit).not.toBeNull();
  expect(Math.abs((fit?.listTop ?? 0) - (fit?.paneTop ?? 1))).toBeLessThan(0.5);
  expect(Math.abs((fit?.listBottom ?? 0) - (fit?.paneBottom ?? 1))).toBeLessThan(0.5);
  expect(fit?.listBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((fit?.statusTop ?? 0) + 0.5);
  expect(fit?.paneSurplus).toBe(0);
  expect(fit?.paneScrollTop).toBe(0);
});

/** A three-page document built here, for navigation that needs somewhere to go (B10). */
async function threePagePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  return document.save();
}

test('the STATUS BAR projects page navigation and zoom, and each control changes what it says', async ({
  page,
}) => {
  // §10.3: "first / previous / an editable page ⁄ total field / next / last" and "zoom-out button ·
  // slider · zoom-in button · current percentage · fit mode, all real controls". The buttons are a
  // projection (ADR-0067); the page field and the slider are the bar's own. The unit tests prove the
  // bar dispatches the command it was handed; this proves, in the production build, that the
  // command the application registered moves the page and the slider moves the zoom.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e1');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const bar = page.getByRole('status', { name: 'Document status' });
  const field = bar.locator('[data-goto-input]');
  await expect(field).toHaveValue('1');
  await expect(bar.locator('.m-status-total')).toHaveText('/ 3');

  // ALL FOUR navigation buttons are there, from the registry.
  for (const name of ['First page', 'Previous page', 'Next page', 'Last page']) {
    await expect(bar.getByRole('button', { name })).toBeVisible();
  }

  await bar.getByRole('button', { name: 'Last page' }).click();
  await expect(field).toHaveValue('3');
  await bar.getByRole('button', { name: 'Previous page' }).click();
  await expect(field).toHaveValue('2');
  await bar.getByRole('button', { name: 'First page' }).click();
  await expect(field).toHaveValue('1');

  // THE SLIDER, which is not a command: moving it changes the percentage the bar reports.
  const percentage = bar.locator('.m-status-zoom');
  const before = await percentage.textContent();
  await bar.getByRole('slider', { name: 'Zoom level' }).fill('2');
  await expect(percentage).toHaveText('200%');
  expect(before).not.toBe('200%');

  // AND A ZOOM BUTTON from the projection, stepping from what is shown.
  await bar.getByRole('button', { name: 'Zoom out' }).click();
  await expect(percentage).toHaveText('150%');

  // §10.3's ZOOM ORDER, ON SCREEN, from the commands the application registers: zoom-out · slider ·
  // zoom-in · percentage · fit mode (ADR-0067, corrected 2026-09-15). Read as painted left edges
  // rather than DOM order, so a stylesheet reordering the flex row would fail it too. The unit case
  // holds the bar to the placement it is handed; only this holds the real zoom-in to `between`.
  const lefts = await Promise.all(
    [
      bar.getByRole('button', { name: 'Zoom out' }),
      bar.getByRole('slider', { name: 'Zoom level' }),
      bar.getByRole('button', { name: 'Zoom in' }),
      percentage,
      bar.getByRole('button', { name: 'Fit width' }),
      bar.getByRole('button', { name: 'Fit page' }),
    ].map(async (locator) => (await locator.boundingBox())?.x ?? Number.NaN),
  );
  expect(lefts.every((x) => Number.isFinite(x))).toBe(true);
  expect(lefts).toStrictEqual([...lefts].sort((a, b) => a - b));
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
  await page.getByRole('button', { name: 'Open PDF…' }).click();

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

test('the FLOATING TOOLBAR is a pill inside the page area, off the rail and the panel, and hides and returns', async ({
  page,
}) => {
  // §10.3: "a vertical pill on the canvas edge … repositionable and hideable", restored "in the palette, on a
  // shortcut, and as a status-bar toggle". MEASURED BEFORE THE FIX (2026-09-15, this build at 1280 × 800): the
  // toolbar was `position: fixed` at x 16–165.64, over the rail's Organize button (x 4–58.67) and 102 px of the
  // document panel's pane, and 149.64 px wide because it drew text buttons.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const toolbar = page.getByRole('toolbar', { name: 'Document tools' });
  await expect(toolbar).toBeVisible();
  const box = await toolbar.boundingBox();
  const area = await page.locator('.m-canvas-area').boundingBox();
  const organize = await page.getByRole('button', { name: 'Organize' }).boundingBox();
  const panelPane = await page.locator('.m-splitter__pane').first().boundingBox();
  expect(box).not.toBeNull();
  expect(area).not.toBeNull();
  expect(organize).not.toBeNull();
  expect(panelPane).not.toBeNull();
  const right = (b: { x: number; width: number } | null): number => (b?.x ?? 0) + (b?.width ?? 0);
  const bottom = (b: { y: number; height: number } | null): number => (b?.y ?? 0) + (b?.height ?? 0);

  // INSIDE THE PAGE AREA, on every side.
  expect(box?.x ?? 0).toBeGreaterThanOrEqual((area?.x ?? 0) - 0.5);
  expect(right(box)).toBeLessThanOrEqual(right(area) + 0.5);
  expect(box?.y ?? 0).toBeGreaterThanOrEqual((area?.y ?? 0) - 0.5);
  expect(bottom(box)).toBeLessThanOrEqual(bottom(area) + 0.5);
  // AND THEREFORE OFF what it covered, asserted directly, so a page area that itself overlapped them fails too.
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(right(organize) - 0.5);
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(right(panelPane) - 0.5);
  // A PILL: one icon column. Its icon buttons are 16 px glyphs with their padding; under 64 px separates that from
  // the 149.64 px of text buttons with room either side.
  expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(64);

  // HIDDEN from the status bar's toggle, and RESTORED by the chord — the pill's own controls are gone by then.
  const bar = page.getByRole('status', { name: 'Document status' });
  await bar.getByRole('button', { name: 'Show or hide the floating toolbar' }).click();
  await expect(toolbar).toHaveCount(0);
  await page.keyboard.press('Control+Shift+Q');
  await expect(toolbar).toBeVisible();
});

test('a DIALOG taller than the window stays inside it, and its body scrolls to the last control', async ({ page }) => {
  // THE CLASS, found live on 2026-09-15: the camera dialog grew to its stream's native frame and put its buttons
  // outside the window, where a fixed, centred box cannot be scrolled to. The camera itself is not reachable in this
  // harness, so the case uses the Settings dialog — a real dialog whose list is taller than a short window — against the
  // same primitive. A 420 px window is shorter than that list on every theme.
  await page.setViewportSize({ width: 1280, height: 420 });
  await bridge(page, {});
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  // THE BODY ARRIVES WITH ITS CHUNK, after the title: `SETTINGS_DIALOG` is `lazy`, so measuring on the dialog's first
  // frame measures a header and an empty body — which fits any window and made the first version of this case fail
  // on the scroll assertion for the wrong reason. `toBeAttached`, not `toBeVisible`: the button may sit below the
  // body's scroll edge, which is the state under test.
  const save = dialog.getByRole('button', { name: 'Save' });
  await expect(save).toBeAttached();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  // INSIDE THE WINDOW, top and bottom: the defect put both edges past it.
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(420);

  // THE BODY SCROLLS — the property that makes the bound usable rather than a clip — and the title stays put.
  const scrolls = await dialog.locator('.m-dialog__body').evaluate((body) => body.scrollHeight > body.clientHeight);
  expect(scrolls).toBe(true);
  await save.scrollIntoViewIfNeeded();
  const saveBox = await save.boundingBox();
  expect((saveBox?.y ?? -1) >= 0 && (saveBox?.y ?? 0) + (saveBox?.height ?? 0) <= 420).toBe(true);
  await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeInViewport();
});

test('the SETTINGS dialog sets the default annotation colour with NO DOCUMENT open, and it holds when reopened', async ({
  page,
}) => {
  // THE OWNER'S REASON FOR THE CONTROL (ADR-0056, corrected 2026-09-15): the styles panel draws beside a document
  // only, so this runs on the start screen.
  await bridge(page, {});
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const auto = dialog.getByRole('checkbox', { name: 'Each tool’s own' });
  const swatch = dialog.getByLabel('Annotation colour');
  await expect(auto).toBeChecked();
  await expect(swatch).toBeDisabled();

  await auto.uncheck();
  await expect(swatch).toBeEnabled();
  // THE SHAPES' RED, never black — what an empty colour input would answer.
  await expect(swatch).toHaveValue('#d92626');
  await swatch.fill('#0000ff');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // REOPENED, it reads the store the command wrote — not the dialog's own draft, which closed with it.
  await page.getByRole('button', { name: 'Settings' }).click();
  const again = page.getByRole('dialog', { name: 'Settings' });
  await expect(again.getByRole('checkbox', { name: 'Each tool’s own' })).not.toBeChecked();
  await expect(again.getByLabel('Annotation colour')).toHaveValue('#0000ff');
});

test('FOCUS hides the rail, the ribbon and both side panels, and keeps the status bar and the floating toolbar', async ({
  page,
}) => {
  // §10.3: "Focus (chrome hidden except the title bar, floating toolbar and status bar)"; M3: "reopen handles are hidden
  // in Focus". Asserted on the production build, where a stylesheet could still draw what a component omitted.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.layout-mode': 'focus' }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();

  await expect(page.locator('.m-ribbon__rail')).toHaveCount(0);
  await expect(page.locator('.m-ribbon__tools')).toHaveCount(0);
  await expect(page.locator('.m-panel-tab')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  await expect(page.locator('.m-context-panel-handle')).toHaveCount(0);
  await expect(page.getByRole('separator')).toHaveCount(0);
  // WHAT STAYS.
  await expect(page.getByRole('status', { name: 'Document status' })).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Document tools' })).toBeVisible();
});

test('STUDIO opens the tool strip as an OVERLAY on a rail selection, moves nothing, and Escape dismisses it', async ({
  page,
}) => {
  // §10.3: "Studio (the ribbon is auto-hidden; selecting a section opens its full tool set as a temporary overlay below
  // the title bar, dismissed on tool choice, Escape or click-away)".
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.layout-mode': 'studio' }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();

  await expect(page.locator('.m-ribbon__rail')).toBeVisible();
  await expect(page.locator('.m-ribbon__tools')).toHaveCount(0);
  const before = await page.locator('.m-page-list').boundingBox();

  await page.locator('[data-ribbon-section="home"]').click();
  const overlay = page.locator('.m-ribbon__tools--overlay');
  await expect(overlay).toBeVisible();
  // THE OVERLAY TAKES NO ROW: the page list has not moved down under it.
  const after = await page.locator('.m-page-list').boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 1))).toBeLessThan(0.5);

  // PRESSED WHERE FOCUS IS after the click — the rail button — not aimed at the overlay: a person's Escape lands there.
  await page.keyboard.press('Escape');
  await expect(page.locator('.m-ribbon__tools')).toHaveCount(0);
});

test('the TITLE BAR holds the tabs, the command search and the switcher on one row, stays in Focus, and Studio opens below it', async ({
  page,
}) => {
  // §10.3: "Title bar: integrated document tabs …, the Ctrl+K command search, and the layout switcher"; Studio's overlay
  // opens "below the title bar"; Focus keeps "the title bar". Painted geometry, which happy-dom cannot lay out.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');

  // WITH NO DOCUMENT the bar is there with both controls and no tabs.
  const bar = page.locator('.m-title-bar');
  const search = bar.getByRole('button', { name: /Search commands/u });
  const switcher = bar.getByRole('group', { name: 'Layout' });
  await expect(search).toBeVisible();
  await expect(switcher).toBeVisible();
  await expect(bar.getByRole('navigation', { name: 'Open documents' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();

  // ONE ROW: each part's vertical middle lies inside the bar's box.
  const barBox = await bar.boundingBox();
  if (barBox === null) throw new Error('the title bar has a box');
  for (const part of [bar.getByRole('navigation', { name: 'Open documents' }), search, switcher]) {
    const box = await part.boundingBox();
    if (box === null) throw new Error('each part of the title bar has a box');
    const middle = box.y + box.height / 2;
    expect(middle).toBeGreaterThan(barBox.y);
    expect(middle).toBeLessThan(barBox.y + barBox.height);
  }
  // ABOVE THE RAIL, which is where the tabs' own row used to be.
  const rail = await page.locator('.m-ribbon__rail').boundingBox();
  expect(barBox.y + barBox.height).toBeLessThanOrEqual((rail?.y ?? 0) + 0.5);

  await search.click();
  await expect(page.locator('.m-palette-query')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.m-palette-query')).toHaveCount(0);

  await switcher.getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('.m-ribbon__rail')).toHaveCount(0);
  await expect(bar).toBeVisible();
  await expect(switcher.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');

  await switcher.getByRole('button', { name: 'Studio' }).click();
  await page.locator('[data-ribbon-section="home"]').click();
  const overlay = await page.locator('.m-ribbon__tools--overlay').boundingBox();
  if (overlay === null) throw new Error('the Studio overlay opened');
  // BELOW THE TITLE BAR, never over it.
  expect(overlay.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 0.5);
});

test('the START SCREEN draws the supplied logo, the hero lines, one primary Open with its chord, and a footer', async ({
  page,
}) => {
  // §10.3's start screen; ADR-0002: the supplied artwork, in a portrait box, never stretched. The production build is
  // the subject — an asset route is proven only where the bundle and its CSP load it.
  await bridge(page);
  await page.goto('/');

  const measure = async (image: import('@playwright/test').Locator): Promise<{ natural: number; width: number; height: number }> =>
    image.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { natural: (element as HTMLImageElement).naturalWidth, width: box.width, height: box.height };
    });

  const hero = page.getByRole('img', { name: 'Monstera' });
  await expect(hero).toBeVisible();
  const drawn = await measure(hero);
  // DECODED — a broken source is still a laid-out box, with a natural width of zero.
  expect(drawn.natural).toBeGreaterThan(0);
  expect(drawn.height).toBeCloseTo(84, 0);
  // PORTRAIT AND UNSTRETCHED: the master is 1652 × 2050.
  expect(drawn.width / drawn.height).toBeCloseTo(1652 / 2050, 1);

  const title = await measure(page.locator('.m-title-bar__logo'));
  expect(title.natural).toBeGreaterThan(0);
  expect(title.height).toBeCloseTo(26, 0);

  await expect(page.getByText('PDF EDITOR')).toBeVisible();
  await expect(page.getByText('Built For The Way You Work')).toBeVisible();

  // ONE PRIMARY BUTTON, carrying its chord, and still named by its label alone.
  await expect(page.locator('.m-start-primary').getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open PDF…', exact: true })).toContainText('Ctrl+O');

  const footer = page.locator('.m-start-footer');
  await expect(footer.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(footer.getByRole('button', { name: 'About' })).toBeVisible();
  await expect(footer).toContainText('© Tenslor Inc.');
  await expect(footer).toContainText('Version ');
});

test('F1 opens the KEYBOARD SHORTCUTS list from the registry, and the start screen footer names the key', async ({
  page,
}) => {
  // §10.3's footer: "Press F1 for keyboard shortcuts". In Chromium, because a browser may claim F1 for itself before a
  // page's listener sees it — the production build is where that would show.
  await bridge(page);
  await page.goto('/');

  await expect(page.locator('.m-start-footer')).toContainText('Press F1 for keyboard shortcuts');

  await page.keyboard.press('F1');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const table = dialog.getByRole('table');
  await expect(table.getByRole('row').filter({ hasText: 'Open PDF…' })).toContainText('Ctrl+O');
  await expect(table.getByRole('row').filter({ hasText: 'Keyboard shortcuts' })).toContainText('F1');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a START SCREEN SHORTCUT opens a document and lands on its feature’s section', async ({ page }) => {
  // §10.3: six feature shortcuts, "each a real entry point" — BUILD-PROMPT :1106, "opens a file then routes to that
  // feature". Encrypt & sign is the separating tile: Protect is neither the fallback section nor the first.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');

  await expect(page.locator('.m-start-shortcuts').getByRole('button')).toHaveCount(6);
  await page.getByRole('button', { name: 'Encrypt & sign' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();
  await expect(page.locator('[data-ribbon-section="protect"]')).toHaveClass(/is-active/u);
  await expect(page.locator('[data-ribbon-section="home"]')).not.toHaveClass(/is-active/u);
});

test('a DIALOG opened from the keyboard closes on the FIRST Escape', async ({ page }) => {
  // Found 2026-09-15 by the F1 case above. Base UI puts a dialog's initial focus on its first tabbable — the header's
  // Close icon button — whose tooltip opens on focus, and the tooltip's own dismiss handler, attached to that button,
  // closes the tooltip and stops the key. The first Escape closed an invisible tooltip; the dialog needed a second.
  // OPENED FROM THE KEYBOARD, the path the defect is on, and a different dialog from the F1 case's, so the finding is
  // about the one mount point rather than about one dialog.
  await bridge(page);
  await page.goto('/');
  const about = page.locator('.m-start-footer').getByRole('button', { name: 'About' });
  await about.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('an existing REDACT mark is drawn as a SOLID preview over the region it covers, and a square beside it is not', async ({
  page,
}) => {
  // FEATURES row 131's owed half. Measured 2026-09-15 in this build: PDF.js paints MuPDF's Redact appearance as a thin
  // outline and nothing else, so the content a burn-in will remove stayed fully visible. The preview is chrome the
  // renderer draws — §10.2's overlay-on-page context — in `--redact-mark`.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await onePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000d3');
  // PDF USER SPACE, off-centre and clear of every edge, so a preview drawn unscaled, unshifted or with the y axis the
  // wrong way up lands somewhere else and the position assertions below say where.
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'marked.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    annotations: [
      { page: 0, index: 0, kind: 'redact', rect: { x0: 100, y0: 600, x1: 300, y1: 700 } },
      { page: 0, index: 1, kind: 'square', rect: { x0: 350, y0: 100, x1: 450, y1: 200 } },
    ],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const canvas = page.locator('canvas[data-page-canvas="0"]');
  await expect(canvas).toBeVisible();

  const preview = page.locator('[data-annotation-layer="0"] .m-redact-preview');
  await expect(preview).toHaveCount(1);
  // THE CONTROL: a square is drawn by the page raster from its own appearance, so the layer draws nothing for it. A
  // layer that drew every kind would pass everything above and paint a black box over every square a person drew.
  await expect(page.locator('[data-annotation-kind="square"]')).toHaveCount(0);

  // THE TOKEN, resolved in the production build: black, which is what the burn-in paints.
  expect(await preview.evaluate((node) => getComputedStyle(node).fill)).toBe('rgb(0, 0, 0)');

  // WHERE, against the canvas the page is drawn in: 612 pt across the canvas's width is the scale, and the top of the
  // box is 792 − y1 down from the top of the page.
  const pageBox = await canvas.boundingBox();
  const box = await preview.boundingBox();
  expect(pageBox).not.toBeNull();
  expect(box).not.toBeNull();
  const scale = (pageBox?.width ?? 0) / 612;
  const expected = {
    x: (pageBox?.x ?? 0) + 100 * scale,
    y: (pageBox?.y ?? 0) + (792 - 700) * scale,
    width: 200 * scale,
    height: 100 * scale,
  };
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs((box?.[key] ?? Number.NaN) - expected[key]),
      `${key}: drawn ${String(box?.[key])}, expected ${String(expected[key])} at scale ${String(scale)}`,
    ).toBeLessThan(2);
  }
});
