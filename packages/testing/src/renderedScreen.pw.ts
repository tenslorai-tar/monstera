import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// THE NAMED EXPORT. `@axe-core/playwright` publishes
// `export { AxeBuilder, AxeBuilder as default }`, and under this repository's
// `verbatimModuleSyntax` the default import resolves to the namespace rather
// than the class — "this expression is not constructable", at compile time.
import { AxeBuilder } from '@axe-core/playwright';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { AI_SETUP_AT_START_SETTING_ID, blockEditOf, displayLocationSchema } from '@monstera/contract';
import {
  EDGE_HANDLE_WIDTH,
  MINIMUM_WINDOW,
  PAGE_AREA_MIN_WIDTH,
  asDocId,
  asDocVersion,
  asFileHandle,
  channels,
  contrast,
  textContrastFloor,
} from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

// ONE BRIDGE for both Playwright runs — §10.7's baselines drive the renderer the same way (B3a),
// and `LOOKS` is theirs too: §10.4's gate and §10.7's baselines check the same three themes, and
// two lists would drift the day one gains a fourth (audit finding IIIIII-2).
import { LOOKS, type Look, bridge, bridgeUnder } from './pageBridge.js';
import { againstPaper } from './contrast.js';
import { readsAtTextFloor } from './inkOnScreen.js';
import { pageShown, popupPlaced, settled, startScreenListening } from './settled.js';

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
  // THE FIRST RUN (E5's onboarding): a fresh install with no AI key opens the setup over the start
  // screen. Every other case seeds the answered state (`pageBridge.ts`); this one seeds the first.
  test(`${look.name}: the FIRST-RUN AI SETUP opens by itself and has no serious a11y violations`, async ({
    page,
  }) => {
    await bridgeUnder(page, look, { settings: { [AI_SETUP_AT_START_SETTING_ID]: true } });

    await expectNoSeriousViolations(page, look, 'Everything else in Monstera works without one');
    const dialog = page.getByRole('dialog', { name: 'Set up the AI assistant' });
    await expect(dialog.getByRole('button', { name: 'Skip' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Check and save' })).toBeDisabled();

    // SKIP CLOSES IT AND IT STAYS CLOSED: the stored false is what a reload reads.
    await dialog.getByRole('button', { name: 'Skip' }).click();
    await expect(dialog).toBeHidden();
  });

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
  // `var(--space-6) var(--space-12)` and the start screen's Open widens it to v5's 20 px a side, while Chromium's
  // default button padding is 1px 6px — so a missing stylesheet cannot produce these by coincidence.
  await bridge(page);
  await page.goto('/');

  const open = page.getByRole('button', { name: 'Open PDF…' });
  await expect(open).toBeVisible();
  const padding = await open.evaluate((element) => {
    const style = getComputedStyle(element);
    return { top: style.paddingTop, left: style.paddingLeft };
  });
  expect(padding).toStrictEqual({ top: '6px', left: '20px' });
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
  // THE TOKEN IS THERE, or the comparisons below would pass on two empty strings. v5's stack leads with Windows'
  // variable Segoe UI cut, then Segoe UI itself.
  expect(/^['"]Segoe UI/u.test(expected) && expected.includes('Segoe UI')).toBe(true);

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
    recent: [
      {
        handle: asFileHandle('handle-a'),
        name: 'annual report.pdf',
        location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
        openedAt: new Date().toISOString(),
        availability: 'available',
      },
    ],
    lastExitClean: false,
    lastSession: [{ handle: asFileHandle('handle-a'), name: 'annual report.pdf', availability: 'available' }],
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
      // A LOCATION AND A DATE ON EACH, and different kinds, so the card's second line is measured as it reads:
      // a known folder with a folder, and a cloud alone with no date.
      recent: [
        {
          handle: asFileHandle('handle-a'),
          name: 'annual report.pdf',
          location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
          openedAt: new Date().toISOString(),
          availability: 'available',
        },
        {
          handle: asFileHandle('handle-b'),
          name: 'notes.pdf',
          location: displayLocationSchema.parse({ within: 'onedrive', folder: null }),
          openedAt: null,
          availability: 'available',
        },
        {
          handle: asFileHandle('handle-c'),
          name: 'site survey.pdf',
          location: displayLocationSchema.parse({ within: 'documents', folder: 'Surveys' }),
          openedAt: new Date().toISOString(),
          // UNAVAILABLE (ADR-0143). Axe does NOT measure this card's text: its colour-contrast rule skips any node under
          // `aria-disabled="true"` (axe-core 4.13.0, `isDisabled`), so its contrast is measured below, by this case.
          availability: 'unavailable',
        },
      ],
      lastExitClean: false,
      lastSession: [
        { handle: asFileHandle('handle-a'), name: 'annual report.pdf', availability: 'available' },
        { handle: asFileHandle('handle-b'), name: 'notes.pdf', availability: 'available' },
      ],
    });

    await expectNoSeriousViolations(page, look, 'These documents were open:');

    // THE UNAVAILABLE CARD'S WORDS READ AT THE THEME'S TEXT FLOOR, its name and its "Unavailable" line, against what
    // is drawn behind them (`inkOnScreen.ts`): the card is translucent, so its own background colour is not that.
    const card = page.locator('.m-recent-item[data-unavailable="true"]');
    await expect(card).toHaveCount(1);
    await readsAtTextFloor(page, card, look);
  });
}

for (const look of LOOKS) {
  test(`${look.name}: the start screen WITH the rating prompt is clean too, and the prompt takes no focus`, async ({
    page,
  }) => {
    // E3's banner is a composed screen of its own — four buttons over the start screen's foot, one of them
    // on the accent — and nothing about the screen without it measures its contrast or naming.
    await bridgeUnder(page, look, { reviewDue: true });

    await expectNoSeriousViolations(page, look, 'Is Monstera working for you?');
    const region = page.getByRole('region', { name: /A rating in the Microsoft Store/u });
    await expect(region.getByRole('button')).toHaveCount(4);
    // NOT MODAL AND NOT FOCUSED: E3's *never interrupts editing*. Focus inside the region would be the banner
    // taking the keyboard from whatever the reader was doing when it arrived.
    expect(await region.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  });
}

/** A text block's body run and a run set apart inside its line — larger, bold, blue — as `document.textBlocks` answers. */
const BODY_RUN = { size: 12, colour: { r: 30, g: 30, b: 30 }, serif: false, mono: false, italic: false, bold: false };
/** A block no case here is about the shape of: left-aligned with no first-line indent (ADR-0179). */
const LEFT_SHAPE = { align: 'left', firstIndent: 0 } as const;
const SET_APART_RUN = { size: 16, colour: { r: 66, g: 83, b: 149 }, serif: false, mono: false, italic: false, bold: true };

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
  // THE STORED WIDTH IS NOT THE FALLBACK. 300 against a fallback of 260 (v5's; 256 against 224 until
  // 2026-09-26), so a panel that ignored the setting cannot pass the first assertion by drawing its default.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.document-panel-width': 300 }, 2);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const handle = page.getByRole('separator', { name: 'Resize the document panel' });
  await expect(handle).toBeVisible();

  // THE PANE IS THE STORED PIXELS, to the library's rounding. `parsePanelSize` resolves "300px" as
  // 300 / root × 100 %, and `getPanelFlexBoxStyle` lays that percentage out as a flex-grow share of
  // what the flex row has left, to three significant figures. The handles take no room in the row
  // (Splitter.tsx, "the handles take no room"), so what is left is the root and the two agree to
  // under a pixel. The control is the layout before that: with both 8 px handles in the row this
  // pane drew about 3.7 px narrow here (2026-09-27; 257.9 for 260 at 1920 × 1080), which a one-pixel
  // bound refuses — the old bound, the handle's width plus one, admitted exactly that defect.
  const handleWidth = (await handle.boundingBox())?.width ?? 0;
  expect(handleWidth).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs((await panelPaneWidth(page)) - 300)).toBeLessThan(1);

  // THE KEYBOARD STEP, the resize every person can perform. The machine's own step is 1 % of the
  // root, so at this viewport it moves the pane by several pixels — well past the rounding the
  // setting applies.
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(306);
  const resized = await panelPaneWidth(page);

  // ACROSS A RELOAD, which is what PERSISTED means: a fresh renderer reads the settings the shim
  // saved, and the width it lays out is the resized one, not 300 and not the fallback.
  await page.reload();
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.getByRole('separator', { name: 'Resize the document panel' })).toBeVisible();
  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(306);
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
  // STORED WIDTHS THAT ARE NOT THE FALLBACKS: 300 on the right against 340, 280 on the left against
  // 260 (v5's defaults), so a side that ignored its setting cannot pass by drawing its default.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(
    page,
    { 'appearance.document-panel-width': 280, 'appearance.context-panel-width': 300 },
    2,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const right = page.getByRole('separator', { name: 'Resize the properties panel' });
  await expect(right).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  // THE STYLE CONTROLS ARE HERE, out of the row under the status bar — the Properties tab (ADR-0102).
  await expect(page.getByRole('complementary', { name: 'Properties' }).locator('.m-properties')).toBeVisible();

  // Each drawn pane is its stored width to the library's rounding, with both handles open — the
  // case the handles' share of the row once took about 3.7 px from (the case above).
  const handleWidth = (await right.boundingBox())?.width ?? 0;
  expect(handleWidth).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs((await contextPaneWidth(page)) - 300)).toBeLessThan(1);
  await expect.poll(async () => Math.abs((await panelPaneWidth(page)) - 280)).toBeLessThan(1);
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
  // THE LEFT'S STORED WIDTH, not its drawn one. The library draws a pane as its share of the row,
  // each share rounded to three figures (`Splitter.tsx`), so shutting a pane can move another's drawn
  // width while writing none. Measured 2026-09-24 at 1280 × 800, while the handles still took room
  // in the row: root 1166.33 px, the left drawn 236.23 before and 238.61 after — the freed handle's
  // share plus the rounded shares summing to 100.3 before and 100.0 after. The handle's part is gone
  // since 2026-09-27; the rounding's is not. What a collapse must not do is WRITE the
  // other side, and that is in the settings. The collapse's own write is read in the same answer, so
  // an answer from before the click cannot pass.
  await expect
    .poll(async () => (await storedSettings(page))['appearance.context-panel-open'])
    .toBe(false);
  expect((await storedSettings(page))['appearance.document-panel-width']).toBe(280);
});

/**
 * What the shim holds as main's settings file — what a resize or a collapse writes.
 *
 * Asked through the page's own bridge, the route every renderer call takes, rather than by reaching
 * into the shim from here.
 */
async function storedSettings(page: Page): Promise<Readonly<Record<string, unknown>>> {
  const answer = await page.evaluate(() =>
    (window as unknown as { __monsteraInvoke: (channel: string, params: unknown) => Promise<unknown> }).__monsteraInvoke(
      'settings.load',
      {},
    ),
  );
  const parsed = answer as { readonly ok?: boolean; readonly value?: { readonly stored?: Record<string, unknown> } };
  if (parsed.ok !== true || parsed.value?.stored === undefined) throw new Error('the shim refused settings.load');
  return parsed.value.stored;
}

test('at its MINIMUM width the right contextual panel still holds every Properties control, and its whole header', async ({ page }) => {
  // `CONTEXT_PANEL_MIN_WIDTH` is 264, from the HEADER (2026-10-03): at 216 its collapse chevron was cut off, and no case
  // looked at the header. This is the rendered panel at that width, asserting no control runs past the pane — what a
  // person would see clipped — the header's chevron among them, and the tab's min-content width printed.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.context-panel-width': 264 }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const region = page.getByRole('complementary', { name: 'Properties' });
  await expect(region.locator('.m-properties')).toBeVisible();
  await expect.poll(() => contextPaneWidth(page)).toBeGreaterThan(200);
  const measured = await page.evaluate(() => {
    const panes = document.querySelectorAll('.m-splitter__pane');
    const pane = panes[panes.length - 1];
    const tab = pane?.querySelector<HTMLElement>('.m-properties');
    if (pane === undefined || tab === null || tab === undefined) return null;
    const paneRight = pane.getBoundingClientRect().right;
    const overflow = [...tab.querySelectorAll('button, input, textarea, output')].map(
      (control) => control.getBoundingClientRect().right - paneRight,
    );
    // THE TAB'S OWN MIN-CONTENT WIDTH, read by laying it out at that keyword for one frame.
    tab.style.inlineSize = 'min-content';
    const minContent = tab.getBoundingClientRect().width;
    tab.style.inlineSize = '';
    // THE HEADER: its chevron inside the pane, and nothing of it hidden by its own overflow.
    const header = pane.querySelector<HTMLElement>('.m-context-panel__header');
    const chevron = header?.querySelector('button[aria-label="Collapse the properties panel"]');
    const headerFits = header !== null && header.scrollWidth <= header.clientWidth;
    const chevronPast = chevron === null || chevron === undefined ? null : chevron.getBoundingClientRect().right - paneRight;
    // EVERY TAB'S WORD WHOLE: a label its ellipsis cut is a header that fits by hiding what the tabs are called. Read
    // in FRACTIONAL pixels — the text's laid-out width (an ellipsis is painted, so the line keeps the whole word's
    // width) against its box — because `scrollWidth` and `clientWidth` round, and a 71.3 px word in a 71 px box reads
    // as fitting while it draws an ellipsis.
    const cut = [...(header?.querySelectorAll<HTMLElement>('.m-context-panel__tab-label') ?? [])]
      .filter((label) => {
        const text = document.createRange();
        text.selectNodeContents(label);
        return text.getBoundingClientRect().width > label.getBoundingClientRect().width + 0.01;
      })
      .map((label) => label.textContent);
    const labels = header?.querySelectorAll('.m-context-panel__tab-label').length ?? 0;
    return { overflow, minContent, headerFits, chevronPast, cut, labels };
  });
  expect(measured).not.toBeNull();
  console.log(`Properties tab min-content width: ${String(measured?.minContent)} px`);
  // THE CONTROLS WERE FOUND, or the loop below checks nothing.
  expect((measured?.overflow ?? []).length).toBeGreaterThan(10);
  for (const past of measured?.overflow ?? []) expect(past).toBeLessThanOrEqual(0.5);
  expect(measured?.headerFits).toBe(true);
  expect(measured?.chevronPast).not.toBeNull();
  expect(measured?.chevronPast ?? Infinity).toBeLessThanOrEqual(0.5);
  // THE LABEL WAS FOUND — one, the selected tab's — or the empty list below is the reassuring answer from a lookup that saw nothing.
  expect(measured?.labels).toBe(1);
  expect(measured?.cut).toStrictEqual([]);
});

/** How many of the right panel's tabs draw a glyph that has a size, and which tabs draw their name. */
async function contextTabGlyphs(page: Page): Promise<{ readonly glyphs: number; readonly named: readonly string[] }> {
  return await page.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>('.m-context-panel__tab')];
    return {
      glyphs: tabs.filter((tab) => {
        const glyph = tab.querySelector('svg');
        const box = glyph?.getBoundingClientRect();
        return glyph !== null && box !== undefined && box.width > 0 && getComputedStyle(glyph).display !== 'none';
      }).length,
      named: tabs.filter((tab) => tab.querySelector('.m-context-panel__tab-label') !== null).map((tab) => tab.dataset['contextTab'] ?? ''),
    };
  });
}

for (const width of [264, 326]) {
  test(`EVERY right-panel tab draws its glyph at ${String(width)} px, and only the selected tab its name`, async ({ page }) => {
    // THE REGRESSION (found 2026-10-08, 0.1.12.0): a container query hid every tab's glyph below a strip width the default
    // panel (326) is always under, so Properties, Assistant and Spelling were three bare words. The glyph is read by its
    // drawn size, not by being in the markup, which it was all along. 264 is the panel's minimum.
    await page.setViewportSize({ width: 1280, height: 800 });
    await bridgeWithDocument(page, { 'appearance.context-panel-width': width, 'appearance.context-panel-tab': 'spelling' }, 1);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('.m-context-panel__tab').first()).toBeVisible();
    const seen = await contextTabGlyphs(page);
    expect(seen.glyphs).toBe(3);
    expect(seen.named).toStrictEqual(['spelling']);
    // CONTROL: the same measure on a page whose glyphs are hidden the way the old rule hid them reports none, so the
    // count above is a reading of the drawn glyph and not of the markup.
    await page.addStyleTag({ content: '.m-context-panel__tab > svg { display: none; }' });
    expect((await contextTabGlyphs(page)).glyphs).toBe(0);
  });
}

test('the ASSISTANT fits its panel: the message box is inside it and nothing scrolls', async ({ page }) => {
  // The panel was the body's full height PLUS its padding, so at 900 px the body scrolled by the
  // padding and the pane's last line sat past its bottom edge — cut off, with a scroll bar for 8 px. The last line is
  // the message box since 2026-10-01, when the hint under it became text for a screen reader only.
  await page.setViewportSize({ width: 1440, height: 900 });
  await bridgeWithDocument(page, { 'appearance.context-panel-open': true, 'appearance.context-panel-tab': 'assistant' }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-assistant__composer')).toBeVisible();

  const fit = await page.evaluate(() => {
    const body = document.querySelector('.m-assistant')?.parentElement;
    const composer = document.querySelector('.m-assistant__composer');
    if (body === null || body === undefined || composer === null) return null;
    // AND NOTHING RUNS PAST ITS SIDE: Context and Sources share one row, which must stay inside the panel's inner edge.
    const panel = document.querySelector('.m-assistant');
    const inner = panel === null ? 0 : panel.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(panel).paddingRight);
    const rights = [...document.querySelectorAll('.m-assistant .m-choice-menu')].map((item) => item.getBoundingClientRect().right);
    return {
      overflow: body.scrollHeight - body.clientHeight,
      past: composer.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom,
      sideways: Math.max(...rights) - inner,
      choices: rights.length,
    };
  });
  expect(fit).not.toBeNull();
  expect(fit?.overflow).toBeLessThanOrEqual(0);
  expect(fit?.past).toBeLessThanOrEqual(0);
  expect(fit?.choices, 'Context and Sources were found').toBe(2);
  expect(fit?.sideways, 'the farther menu ends past the panel’s inner edge by this many px').toBeLessThanOrEqual(0.5);
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
    // THE INSIDE OF THE PANEL THE LIST FILLS. Since the owner's v5 surfaces (72d1ecc) the canvas area is
    // an inset panel with a 1 px border — measured 2026-09-24, `.m-canvas-area` border-top 1px and the
    // list 1 px below the pane — so the list's box is the area's padding box, not the pane's.
    //
    // UNDER THE HORIZONTAL RULER when one is drawn (on by default): since 2026-10-01 the rulers take grid tracks
    // beside the scroller instead of lying over it, so the list begins exactly at the ruler's foot. The ruler's own
    // box is read, never its token, so a ruler of any height is measured the same way.
    const area = list.closest('.m-canvas-area');
    if (area === null) return null;
    const areaBox = area.getBoundingClientRect();
    const areaStyle = getComputedStyle(area);
    const ruler = area.querySelector('.m-ruler-h');
    return {
      listTop: listBox.top,
      listBottom: listBox.bottom,
      paneTop: ruler === null ? areaBox.top + Number.parseFloat(areaStyle.borderTopWidth) : ruler.getBoundingClientRect().bottom,
      rulerShown: ruler !== null,
      paneBottom: areaBox.bottom - Number.parseFloat(areaStyle.borderBottomWidth),
      statusTop: status.getBoundingClientRect().top,
      paneScrollTop: pane.scrollTop,
      paneSurplus: pane.scrollHeight - pane.clientHeight,
    };
  });
  expect(fit).not.toBeNull();
  // THE PREMISE of the top's reading: the rulers are on by default, so the branch that measures from one is the one
  // this case takes. Without it, a ruler gone missing would be measured as though there were none and still pass.
  expect(fit?.rulerShown).toBe(true);
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

test('the PAGE MENU opens from the keyboard on a focused thumbnail — Shift+F10 AND the Menu key (§7)', async ({
  page,
}) => {
  // The owner's keyboard route. Both keys reach Base UI's trigger as a keyboard-invoked `contextmenu`
  // on the focused element, and neither can be pressed by the screen tool used for live runs, so
  // this is where the Menu key is exercised at all — in the production build, in Chromium.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e2');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const second = page.locator('[data-thumb-page="1"]');
  await expect(second).toBeVisible();
  // THE OPEN MENU'S ITEMS: the menu bar's eleven menus are menuitems too (the WAI-ARIA menubar pattern, ADR-0107).
  const items = page.getByRole('menu').getByRole('menuitem');

  for (const key of ['Shift+F10', 'ContextMenu']) {
    await second.focus();
    await page.keyboard.press(key);
    await expect(items.first(), key).toBeVisible();
    // THE OWNER'S PAGE ITEMS, from the registry, in their placement order.
    await expect(items, key).toHaveText(['Rotate page', 'Insert blank page', 'Extract pages…', 'Delete page']);
    await page.keyboard.press('Escape');
    await expect(items, key).toHaveCount(0);
  }
});

// AN EDIT PDFIUM REFUSED (ADR-0169 Decision 5), in every theme: the step's sentence and the step and number as the
// reference a person can quote, where `internal` shows its incident id. The command is the page menu's Rotate, which
// every document offers; the shim answers it as main answers an edit refused at the read-back.
for (const look of LOOKS) {
  test(`${look.name}: an edit REFUSED AT A STEP says which, with its reference, and passes axe`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await threePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000f1');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      refusals: new Map([[docId, { code: 'edit-refused', detail: { step: 'read-back', engineError: 0 } }]]),
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await page.getByRole('button', { name: 'Open PDF…' }).click();

    const first = page.locator('[data-thumb-page="0"]');
    await expect(first).toBeVisible();
    await first.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menu').getByRole('menuitem', { name: 'Rotate page' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('This page uses a font Monstera can’t rewrite yet, so nothing was changed.')).toBeVisible();
    await expect(dialog.getByText('read-back 0')).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
  });
}

// A REPLACEMENT THAT CHANGED NOTHING, in every theme, for each reason: NOTHING TO REPLACE (ADR-0169 Decision 6), which
// the shim answers as main answers a find no text object holds whole, and one that WOULD MOVE ITS LINE (the owner's
// answer of 2026-10-05, `replaceLineRule.ts`). The sentence is said, the bar does not say the replacement happened, and
// the words the person typed are still in both fields.
const REPLACE_REFUSALS = [
  {
    name: 'NOTHING TO REPLACE',
    code: 'nothing-to-replace',
    sentence: 'Nothing was changed: no text Monstera can replace matched. A word drawn in two pieces can be changed with Edit text.',
  },
  {
    name: 'A MOVED LINE',
    code: 'replace-moves-line',
    sentence:
      'Nothing was changed: the new words are a different width, and the text after them on the line would have to move, which Replace cannot do yet. Edit text can change this line.',
  },
] as const;
for (const refusal of REPLACE_REFUSALS) for (const look of LOOKS) {
  test(`${look.name}: a replacement refused for ${refusal.name} says so, claims nothing, keeps the typed words, and passes axe`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await threePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000f2');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      refusals: new Map([[docId, { code: refusal.code }]]),
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('[data-thumb-page="0"]')).toBeVisible();

    await page.keyboard.press('Control+F');
    const panel = page.getByRole('tabpanel', { name: 'Search' });
    await panel.getByRole('textbox', { name: 'Find text' }).fill('GIZMO');
    await panel.getByRole('textbox', { name: 'Replace with' }).fill('GADGET');
    await panel.getByRole('button', { name: 'Replace everywhere' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(refusal.sentence)).toBeVisible();
    // NOTHING HAPPENED, SO NOTHING IS REPORTED: the bar's after-the-fact note is for a replacement that ran.
    await expect(panel.locator('.m-find-replaced')).toHaveCount(0);
    // AXE ON THE OPEN DIALOG, which is the screen the person is shown.
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);

    // AND THE TYPED WORDS STAY, so the person can change one and send again: read once the dialog is dismissed, since
    // the modal hides the panel behind it from the accessibility tree the locators read.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('textbox', { name: 'Find text' })).toHaveValue('GIZMO');
    await expect(panel.getByRole('textbox', { name: 'Replace with' })).toHaveValue('GADGET');
  });
}

test('THUMBNAIL SIZE: a stored Large lays the Pages strip in ONE column of 160 px pictures, drawn at that width', async ({
  page,
}) => {
  // THE APP'S HALF of the setting: under happy-dom the document never parses, so the strip never mounts and
  // nothing there can show the setting reaching it. Here a real PDF.js draws it in the production build.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e7');
  await bridge(page, {
    settings: { 'appearance.thumbnail-size': 'large' },
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const first = page.locator('[data-thumb-page="0"] canvas');
  await expect(first).toHaveCSS('width', '160px');
  const columns = await page.locator('.m-thumbnails').evaluate((strip) => getComputedStyle(strip).gridTemplateColumns);
  // ONE TRACK: a single length, where Medium's two would be two.
  expect(columns.trim().split(/\s+/u)).toHaveLength(1);
});

/**
 * A page's lines WHERE MUPDF PUTS THEM: `readPageText` and `textLayerOf` over a page drawn with pdf-lib — a 22 pt
 * heading, an indented paragraph at 11 on 14, a short paragraph, three bullets, a 14 pt subheading, two columns at 10 on
 * 13 and a footer — read 2026-10-03. The boxes overlap by a point, a bullet is a line of its own, and there are
 * paragraph gaps, a gutter and an empty half page: the geometry a drag crosses, which the shim's even rows have none of.
 */
const PLACED_LINES: readonly { text: string; box: { x0: number; y0: number; x1: number; y1: number } }[] = [
  ['Quarterly report', 72, 28, 239, 58],
  ['The first paragraph opens the report with a sentence that runs to the margin', 90, 80, 458, 95],
  ['and continues onto a second line of ordinary body text, set at eleven points', 72, 94, 436, 109],
  ['with fourteen points of leading.', 72, 108, 221, 123],
  ['A second paragraph, shorter than the first.', 72, 132, 278, 147],
  ['It ends here.', 72, 146, 133, 161],
  ['•', 90, 170, 93, 185],
  ['First item in the list', 104, 170, 195, 185],
  ['•', 90, 186, 93, 201],
  ['Second item, a little longer than the first', 104, 186, 297, 201],
  ['•', 90, 202, 93, 217],
  ['Third', 104, 202, 129, 217],
  ['Two columns', 72, 227, 161, 246],
  ['Column 1 line 1 with some words', 72, 253, 218, 266],
  ['Column 1 line 2 with some words', 72, 266, 218, 279],
  ['Column 1 line 3 with some words', 72, 279, 218, 292],
  ['Column 1 line 4 with some words', 72, 292, 218, 305],
  ['Column 2 line 1 with some words', 320, 253, 466, 266],
  ['Column 2 line 2 with some words', 320, 266, 466, 279],
  ['Column 2 line 3 with some words', 320, 279, 466, 292],
  ['Column 2 line 4 with some words', 320, 292, 466, 305],
  ['Page 1 of 1', 280, 742, 326, 754],
].map(([text, x0, y0, x1, y1]) => ({ text: String(text), box: { x0: Number(x0), y0: Number(y0), x1: Number(x1), y1: Number(y1) } }));

/**
 * The selection now: its text, whether its moving end is in a page's text layer, the element that end is in, and
 * where its fixed end is as `page/line` — or the element it was moved to, when the line it was in has gone.
 */
function selectionNow(page: Page): Promise<{ text: string; inLayer: boolean; where: string; anchor: string }> {
  return page.evaluate(() => {
    const selection = document.getSelection();
    const elementOf = (node: Node | null | undefined): Element | null =>
      node instanceof Element ? node : (node?.parentElement ?? null);
    const element = elementOf(selection?.focusNode);
    const start = elementOf(selection?.anchorNode);
    const line = start?.closest('[data-text-line]') ?? null;
    return {
      text: selection?.toString() ?? '',
      inLayer: element?.closest('[data-text-layer]') !== null,
      where: element === null ? 'none' : `${element.tagName.toLowerCase()}.${element.className}`,
      anchor:
        line === null
          ? `${start?.tagName.toLowerCase() ?? 'none'}.${start?.className ?? ''}`
          : `${line.closest('[data-text-layer]')?.getAttribute('data-text-layer') ?? '?'}/${line.getAttribute('data-text-line') ?? '?'}`,
    };
  });
}

/** {@link PLACED_LINES} open at `zoom`, the pointer pressed at the start of the second paragraph; its line's box. */
async function pressOnSecondParagraph(page: Page, zoom: string): Promise<{ from: Box; layer: Box }> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000f7');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'lines.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    // EVERY PAGE CARRIES TEXT, so a page scrolled into view mounts a layer of its own — the change of set that unmounted
    // the layers under a selection.
    pageLinesPlaced: [PLACED_LINES, PLACED_LINES, PLACED_LINES],
    settings: { 'viewing.starting-zoom': zoom },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const anchor = page.locator('[data-text-layer="0"] [data-text-line="4"]');
  await expect(anchor).toHaveText('A second paragraph, shorter than the first.');
  // THE PANE SHOWN, not only its lines mounted: the lines mount while the pane is still hidden for its first frame,
  // and a press then lands on the loading state.
  await pageShown(page);
  const from = await settled(page, () => anchor.boundingBox(), (box) => box !== null, 'the second paragraph');
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (from === null || layer === null) throw new Error('the paragraph or its layer has no box');
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  return { from, layer };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

for (const zoom of ['100pct', '200pct']) {
  test(`a drag DOWN TO THE WINDOW’S FOOT, held there while the view scrolls, keeps its selection (${zoom})`, async ({
    page,
  }) => {
    // N7, two mechanisms, both measured 2026-10-03 in Chromium 151.
    //
    // LEAVING THE PAGE: at 200% the drag reached the window's grid gap above the status bar, and the selection's end
    // moved to the page's first line. A point on a selectable element with no text of its own resolves into that
    // element's content, whose first text is the page's; the chrome is not text now, and a drag over it holds.
    //
    // HELD AT THE FOOT, the view scrolls under the drag, and every page's text layer UNMOUNTED on each change of the
    // pages in view — the page text was answered with nothing until every page had been read again — so the browser
    // moved the selection's fixed end out of its gone line into the page's slot: from there the selection ran from the
    // next page's top ("Quarterly report…" at 200%) or collapsed to nothing (100%). A page that stays wanted keeps its
    // layer now, and a page holding the selection stays wanted when it scrolls away.
    const { from, layer } = await pressOnSecondParagraph(page, zoom);
    const scrolled = (): Promise<number> => page.locator('.m-page-list').evaluate((list) => {
      let area: Element | null = list;
      while (area !== null && !['auto', 'scroll'].includes(getComputedStyle(area).overflowY)) area = area.parentElement;
      return area?.scrollTop ?? 0;
    });
    const pressedAt = await scrolled();
    const steps: { y: number; text: string; inLayer: boolean; where: string; anchor: string }[] = [];
    const x = layer.x + layer.width * 0.3;
    for (let y = from.y + from.height / 2; y < 790; y += 2) {
      await page.mouse.move(x, y);
      steps.push({ y, ...(await selectionNow(page)) });
    }
    // HELD UNTIL THE VIEW HAS MOVED ONE PAGE FROM THE PRESS, so the pages in view have changed under the selection —
    // the thing the hold is for — and sampled at every poll. Measured FROM THE PRESS, because the moves above already
    // autoscroll once the pointer passes the page area's foot, and how far depends on how long they take: a hold that
    // asked for 400 px more from the END of the moves met the document's last scroll position (1,900 px at 100%) on
    // the Windows CI image, which had scrolled 1,612 px before the hold began (job 111087637711, 2026-10-03).
    await expect
      .poll(
        async () => {
          steps.push({ y: 789, ...(await selectionNow(page)) });
          return (await scrolled()) - pressedAt;
        },
        { intervals: [150] },
      )
      .toBeGreaterThan(layer.height);
    await page.mouse.up();
    // THE DRAG REACHED THE CHROME, or the case is a drag over text and proves nothing about leaving it.
    expect(await page.evaluate(() => document.elementFromPoint(400, 789)?.closest('[data-text-layer]') === null)).toBe(true);
    // IT SELECTED: lines below the anchor were reached on the way, so an empty selection cannot pass below.
    expect(steps.some((step) => step.text.includes('It ends here'))).toBe(true);
    // AND AT NO STEP did the selection lose where the press was — its fixed end still in page 1's fifth line, and its
    // text beginning there: a line above it in the selection is the jump, whichever line — nor its end leave the text.
    expect(
      steps.filter((step) => step.anchor !== '0/4' || !step.text.startsWith('A second paragraph') || !step.inLayer),
    ).toStrictEqual([]);
  });
}

test('a drag PAST A SHORT LINE and on into the side panel holds its selection rather than snapping upward', async ({
  page,
}) => {
  // N7's other half, measured the same day at 100%: on the empty layer beside *It ends here.*, Chromium resolved the
  // point to the end of a LONG line above it — line 2's at 702 px, line 1's at 854 — so the selection's end climbed
  // towards the page's top as the pointer moved right; and on Properties' labels the selection collapsed. Between the
  // lines a drag now meets a cover that is not selectable, and off the page the chrome is not text: both hold.
  await pressOnSecondParagraph(page, '100pct');
  const end = await page.locator('[data-text-layer="0"] [data-text-line="5"]').boundingBox();
  const panel = await page.locator('.m-context-panel').boundingBox();
  if (end === null || panel === null) throw new Error('the paragraph’s end or the panel has no box');
  // THROUGH THE PARAGRAPH'S LAST LINE first, so there is a selection to keep.
  await page.mouse.move(end.x + end.width - 2, end.y + end.height / 2, { steps: 6 });
  const selected = await selectionNow(page);
  expect(selected.text).toContain('It ends');
  // THEN ACROSS INTO THE PANEL, and down it.
  const steps: { text: string; inLayer: boolean; where: string }[] = [];
  for (let x = end.x + end.width; x < panel.x + panel.width / 2; x += 8) {
    await page.mouse.move(x, end.y + end.height / 2);
    steps.push(await selectionNow(page));
  }
  for (let y = end.y; y < panel.y + panel.height - 8; y += 8) {
    await page.mouse.move(panel.x + panel.width / 2, y);
    steps.push(await selectionNow(page));
  }
  await page.mouse.up();
  // THE PANEL WAS REACHED, or this is a drag across the page alone.
  // AN ELEMENT FIRST: a point outside the window finds none, and `undefined !== null` would read as the panel (SSSSSSS-4).
  expect(await page.evaluate(([x, y]) => {
    const found = document.elementFromPoint(x ?? 0, y ?? 0);
    return found !== null && found.closest('.m-context-panel') !== null;
  }, [
    panel.x + panel.width / 2,
    panel.y + panel.height / 2,
  ])).toBe(true);
  expect(
    steps.filter((step) => !step.text.startsWith('A second paragraph') || !step.text.includes('It ends') || !step.inLayer),
  ).toStrictEqual([]);
});

test('SELECTED TEXT opens the selected-text menu above the page’s, in the owner’s order (§7)', async ({ page }) => {
  // A real mouse drag over the text layer, in the production build: the selection is the browser's,
  // `readTextSelection` reads it through the layer's own transform, and the menu's groups are
  // decided from it. Each step asserts on its own, so a failure names the step that broke.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e3');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLines: [['Quarterly totals for the north', 'Nothing further is owed']],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const line = page.locator('[data-text-layer="0"] [data-text-line="0"]');
  await expect(line).toHaveCount(1);
  await pageShown(page);
  const box = await line.boundingBox();
  if (box === null) throw new Error('the first line has no box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => document.getSelection()?.toString().trim() ?? '')).not.toBe('');

  await line.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  // THE OPEN MENU'S ITEMS, not the menu bar's menus, which are menuitems too (ADR-0107).
  const menuItems = page.getByRole('menu').getByRole('menuitem');
  await expect(menuItems.first()).toBeVisible();
  await expect(menuItems).toHaveText([
    // NO CHORD SINCE ADR-0107: Ctrl+C is Edit › Copy's, which copies the selected text through this very command.
    'Copy',
    'Highlight',
    'Underline',
    'Strikethrough',
    // THE OWNER'S ORDER for this menu rather than an order this list invents:
    // copy, highlight, underline, strikethrough, comment, redact, search. The
    // list is exhaustive on purpose — a registration that lands in the wrong
    // group, or a second placement on one command, shows up here as an extra row
    // rather than as nothing.
    'Add comment',
    'Mark for redaction',
    'Search for this',
    // THE ASSISTANT'S FOUR (ADR-0088), after the menu's own seven.
    'Ask AI',
    'Explain',
    'Summarise',
    'Translate',
    'Rotate page',
    'Insert blank page',
    'Extract pages…',
    'Delete page',
  ]);

  // COPY BY POINTER puts the selected text on the clipboard. A sentinel goes there first, so a
  // Copy that copied nothing leaves it standing rather than passing on an empty clipboard — which
  // is what the menu did while pressing an item cleared the selection it was about to copy.
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
  await page.getByRole('menuitem', { name: 'Copy' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
});

test('right-click › ASK AI quotes the selected words in the assistant’s box, the cursor after them, and sends nothing', async ({ page }) => {
  // THE WHOLE PATH in the production build: the command's quote, `App`'s request and the panel's box. The unit cases
  // hold each half; only this one crosses the composition between them.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e4');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLines: [['Quarterly totals for the north', 'Nothing further is owed']],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const line = page.locator('[data-text-layer="0"] [data-text-line="0"]');
  await expect(line).toHaveCount(1);
  await pageShown(page);
  const box = await line.boundingBox();
  if (box === null) throw new Error('the first line has no box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const selected = (await page.evaluate(() => document.getSelection()?.toString() ?? '')).trim();
  expect(selected).not.toBe('');

  await line.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Ask AI' }).click();
  const draft = page.getByLabel('Ask about this document');
  await expect(draft).toHaveValue(`“${selected}” `);
  await expect(draft).toBeFocused();
  const caret = await draft.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd, element.value.length]);
  expect(caret[0]).toBe(caret[2]);
  expect(caret[1]).toBe(caret[2]);
  // THE CONTEXT IS THE SELECTION, which the menu's name carries: its face reads *Context* since the owner's review of
  // 0.1.9.0.
  await expect(page.locator('.m-assistant [data-choice-menu]').first()).toHaveAttribute('aria-label', 'Context: Selection');
});

test('a triple-click on a page’s LAST LINE still opens the selected-text menu, on that line', async ({
  page,
}) => {
  // Found in the live run of 2026-09-21, measured there rather than inferred: a triple-click selects
  // the line and ends the selection at the start of the NEXT block, and after a page's last line
  // that block is the page slot, outside the text layer. The reader required both ends inside one
  // layer, so the right-click fell back to the page menu with the words visibly selected. The same
  // triple-click on the first line kept both ends inside, which is why the case above — a drag
  // within the first line — could not see it.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e9');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLines: [['Quarterly totals for the north', 'Nothing further is owed']],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const line = page.locator('[data-text-layer="0"] [data-text-line="1"]');
  await expect(line).toHaveCount(1);
  await pageShown(page);
  const box = await line.boundingBox();
  if (box === null) throw new Error('the last line has no box');
  await line.click({ clickCount: 3, position: { x: box.width / 2, y: box.height / 2 } });
  // THE TRIPLE-CLICK NOW ENDS IN THE LAYER: the page slot it ended in is not text since N7 (2026-10-03,
  // `.m-document-surface`), so the next block a selection can end at is the layer's own. Asserted, because the
  // spill this case was written for is now a fact about what a selection CAN be rather than what a triple-click does.
  const focusInLayer = (): Promise<boolean> =>
    page.evaluate(() => {
      const focus = document.getSelection()?.focusNode ?? null;
      const element = focus instanceof Element ? focus : (focus?.parentElement ?? null);
      return element?.closest('[data-text-layer]') !== null;
    });
  expect(await focusInLayer()).toBe(true);
  const menuItems = page.getByRole('menu').getByRole('menuitem');
  await line.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await expect(menuItems.first()).toHaveText('Copy');
  await page.keyboard.press('Escape');

  // AND THE SHAPE IT USED TO PRODUCE still opens the menu: the line selected, its far end in the page slot after the
  // layer. `readTextSelection` clips that end to the layer; the premise is asserted, so a pass is the clipping.
  await page.evaluate(() => {
    const words = document.querySelector('[data-text-layer="0"] [data-text-line="1"]')?.firstChild;
    const layer = document.querySelector('[data-text-layer="0"]');
    const slot = layer?.parentElement;
    if (words == null || layer === null || slot == null) throw new Error('no line, layer or slot');
    document.getSelection()?.setBaseAndExtent(words, 0, slot, [...slot.childNodes].indexOf(layer) + 1);
  });
  expect(await focusInLayer()).toBe(false);
  await line.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await expect(menuItems.first()).toBeVisible();
  await expect(menuItems.first()).toHaveText('Copy');
  await expect(page.getByRole('menuitem', { name: 'Explain' })).toBeVisible();
});

test('OPEN SIDE BY SIDE puts the right-clicked tab’s document in Side by Side’s right half (§7, ADR-0131)', async ({
  page,
}) => {
  // The tab menu in the production build, with TWO documents open — which is what makes this case
  // able to fail. The menu rewrites the context's `docId` to the tab that was right-clicked, so a
  // command reading the focused document would put the document already on show on both sides,
  // and the right half's list below would answer with the wrong id rather than with nothing.
  //
  // It is here and not in a live run because a second document can only be opened through the
  // native file dialog, which no instrument drives.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const first = asDocId('00000000-0000-4000-8000-0000000000e7');
  const second = asDocId('00000000-0000-4000-8000-0000000000e8');
  await bridge(page, {
    opens: [
      { kind: 'opened', docId: first, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'first.pdf' },
      { kind: 'opened', docId: second, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'second.pdf' },
    ],
    documentBytes: new Map([
      [first, bytes],
      [second, bytes],
    ]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // THE SECOND FROM THE RIBBON, where a person opens another with one already open: Home › File's
  // Open, whose caption is its short title (the start screen's button is gone once a document is).
  await page.locator('.m-ribbon__tools').getByRole('button', { name: 'Open', exact: true }).click();

  // THE SECOND OPEN IS FOCUSED, so `first.pdf` is the background tab and the one to right-click.
  const background = page.locator('nav.m-tabs button', { hasText: 'first.pdf' }).first();
  await expect(background).toBeVisible();
  await background.click({ button: 'right' });

  const items = page.getByRole('menu').getByRole('menuitem');
  await expect(items.first()).toBeVisible();
  // THE OWNER'S TAB ITEMS, exhaustive so a stray placement shows up as an extra row.
  await expect(items).toHaveText(['Close tabCtrl+W', 'Close other tabs', 'Open side by side']);

  await page.getByRole('menuitem', { name: 'Open side by side' }).click();

  // THE SURFACE, over the ribbon and the page area, and each half's list naming its document by id: a wrong id would
  // still fill a half, so the values are what separates the command from one that reads the wrong document.
  await expect(page.locator('section[data-side-by-side]')).toBeVisible();
  await expect(page.locator('.m-ribbon__tools')).toBeHidden();
  await expect(page.locator('[data-side-pick="left"]')).toHaveValue(second);
  await expect(page.locator('[data-side-pick="right"]')).toHaveValue(first);
  // ESC RETURNS THE WINDOW AS IT WAS.
  await page.keyboard.press('Escape');
  await expect(page.locator('section[data-side-by-side]')).toHaveCount(0);
  await expect(page.locator('.m-ribbon__tools')).toBeVisible();
});

test('SIDE BY SIDE’S COMPARE marks a changed line on BOTH pages and lists it (ADR-0131)', async ({ page }) => {
  // TWO DOCUMENTS WHOSE TEXT DIFFERS ON ONE LINE of page 1, and nowhere else. The same bytes draw both, so the
  // pictures agree and the one difference is the text — a mark on a page the walk did not pair, or on one side only,
  // is what this case exists to catch, and only real layout can show it: happy-dom measures no page.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const first = asDocId('00000000-0000-4000-8000-0000000000e9');
  const second = asDocId('00000000-0000-4000-8000-0000000000ea');
  const text = (owed: string): readonly (readonly string[])[] => [
    ['Quarterly totals for the north', owed],
    ['The second page is the same in both'],
    ['The third page is the same in both'],
  ];
  await bridge(page, {
    opens: [
      { kind: 'opened', docId: first, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'first.pdf' },
      { kind: 'opened', docId: second, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'second.pdf' },
    ],
    documentBytes: new Map([
      [first, bytes],
      [second, bytes],
    ]),
    documentPageLines: new Map([
      [first, text('Nothing further is owed')],
      [second, text('Nothing more is owed')],
    ]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.locator('.m-ribbon__tools').getByRole('button', { name: 'Open', exact: true }).click();
  // REVIEW › COMPARE, the ribbon's route in: `second.pdf` is in front, so it is the left half.
  await page.locator('nav.m-ribbon__rail').getByRole('button', { name: 'Review' }).click();
  await page.locator('.m-ribbon__tools').getByRole('button', { name: 'Compare', exact: true }).click();
  const surface = page.locator('section[data-side-by-side]');
  await expect(surface).toBeVisible();

  await surface.locator('[data-side-compare]').click();
  await expect(surface.locator('[data-side-count]')).toHaveText('1 difference');
  const row = surface.locator('[data-side-row="text"]');
  await expect(row).toContainText('Left page 1 · Right page 1');
  await expect(row).toContainText('“more” → “further”');
  await row.click();

  // ON BOTH HALVES, on page 1, and drawn as the chosen change.
  for (const side of ['left', 'right'] as const) {
    const mark = surface.locator(`[data-side-half="${side}"] [data-difference-layer="0"] .m-difference--text.m-difference--active`);
    await expect(mark).toHaveCount(1);
    await expect(mark).toBeVisible();
  }
  // AND NOWHERE ELSE: pages 2 and 3 are the same in both, so a mark there is a pairing defect.
  await expect(surface.locator('[data-difference-layer="1"], [data-difference-layer="2"]')).toHaveCount(0);
});

test('each TEXT-LAYER LINE’S GLYPHS SPAN ITS BOX, so a selection lands on the ink it covers', async ({ page }) => {
  // The shim boxes every line at 100 x 12 display units, and a 30-character line in the substitute
  // font runs well past that unfitted — so this fixture separates a fitted layer from an unfitted
  // one, which a line the substitute happened to draw at its box's width would not.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e4');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLines: [['Quarterly totals for the north', 'Nothing further is owed']],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(2);

  const spans = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-text-layer="0"] [data-text-line]')].map((line) => {
      const glyphs = document.createRange();
      glyphs.selectNodeContents(line);
      return {
        box: Math.round(Number.parseFloat(getComputedStyle(line).width)),
        glyphs: Math.round(glyphs.getBoundingClientRect().width),
      };
    }),
  );
  expect(spans.every(({ box, glyphs }) => box > 0 && Math.abs(box - glyphs) <= 1), JSON.stringify(spans)).toBe(true);
});

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

  // PAGE NAVIGATION AT THE CENTRE (the owner's list, item 5), the document's line and the zoom at the end.
  const barBox = await bar.boundingBox();
  const navigation = await bar.getByRole('group', { name: 'Page navigation' }).boundingBox();
  const documentLine = await bar.locator('.m-status-document').boundingBox();
  const zoomGroup = await bar.getByRole('group', { name: 'Zoom' }).boundingBox();
  if (barBox === null || navigation === null || documentLine === null || zoomGroup === null) {
    throw new Error('the status bar and its three parts have boxes');
  }
  expect(Math.abs(navigation.x + navigation.width / 2 - (barBox.x + barBox.width / 2))).toBeLessThanOrEqual(1);
  expect(documentLine.x).toBeGreaterThan(navigation.x + navigation.width);
  expect(zoomGroup.x).toBeGreaterThan(documentLine.x);

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

test('a page ZOOMED WIDER THAN ITS PANE can still be scrolled to its left edge', async ({
  page,
}) => {
  // WHAT CENTRING DOES TO AN OVERFLOWING ITEM, which is the defect this exists for.
  // `.m-page-list` is a column flex stack, so `align-items` centres each page on the horizontal
  // cross axis. Centring something WIDER than its container pushes it past both edges, and the
  // start-side overflow has no scroll position that reveals it — `scrollLeft` has no values below
  // zero. Measured in the production build before the fix, one page at 400% in a 1236 px pane:
  // 182 px of the page's left side were unreachable and `scrollWidth` was 1418 against a 1600 px
  // page. `align-items: safe center` falls back to `start` exactly when the item overflows.
  //
  // ONLY THIS CAN SEE IT. The unit suites render into jsdom, which lays nothing out; a page's
  // width, its pane's width and a scroll range are all real layout, so a case that could catch
  // this had to be here.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e4');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // OPEN FIRST: until its first frame the page area shows the loading state and holds no page canvas to measure.
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]')).toHaveCount(1);

  const bar = page.getByRole('status', { name: 'Document status' });
  await bar.getByRole('slider', { name: 'Zoom level' }).fill('4');
  await expect(bar.locator('.m-status-zoom')).toHaveText('400%');

  // THE PAGE'S SLOT, not its canvas: 150 ms after a zoom settles the page is redrawn, and above the tiling threshold
  // the one canvas is replaced by tiles, so a canvas read can find nothing on a slow runner. The slot is the page's
  // box however it is drawn; the reading is taken once it has stopped changing.
  const reach = await settled(page, () => page.evaluate(() => {
    const list = document.querySelector('.m-page-list');
    const canvas = document.querySelector('.m-page-slot');
    if (list === null || canvas === null) return null;
    // SCROLLED HOME FIRST, because the question is whether the left edge can be reached AT ALL:
    // a pane that happens to be scrolled right would hide the defect behind a scroll position.
    list.scrollLeft = 0;
    const pane = list.getBoundingClientRect();
    const drawn = canvas.getBoundingClientRect();
    return {
      pageWiderThanPane: drawn.width > list.clientWidth,
      // How far the page's left edge sits OUTSIDE the pane's content origin with the scroller
      // already home. Anything above zero is page nobody can scroll to.
      unreachableLeft: Math.round(Math.max(0, pane.left + list.clientLeft - drawn.left)),
      scrollWidth: list.scrollWidth,
      pageWidth: Math.round(drawn.width),
    };
  }), (now) => now !== null, 'the page at 400%');

  expect(reach).not.toBeNull();
  // THE VACUITY GUARD, and it is the load-bearing line: with a page NARROWER than its pane there
  // is no overflow, centring is correct, and every assertion below passes for a stylesheet with
  // the defect still in it.
  expect(
    reach?.pageWiderThanPane,
    'this case needs a page wider than its pane, or it asserts nothing',
  ).toBe(true);
  expect(
    reach?.unreachableLeft,
    `${String(reach?.unreachableLeft)} px of the page sit left of the pane with the scroller home`,
  ).toBe(0);
  // THE SAME FACT FROM THE OTHER SIDE: a scrollable width that does not cover the page is the
  // range the start-side overflow was missing from.
  expect(reach?.scrollWidth).toBeGreaterThanOrEqual(reach?.pageWidth ?? 0);
});

test("at its MINIMUM width the document panel's strip still holds every tab and the chevron", async ({
  page,
}) => {
  // `DOCUMENT_PANEL_MIN_WIDTH` is 256, derived by adding the strip's padding, six v5 tabs, their gaps,
  // the chevron and the border as the stylesheets declare them: 250. That sum is arithmetic on
  // declarations; this is the rendered strip, which is what a person would see clipped. (192 until
  // 2026-09-26, for 24 px tabs; this case went red when v5's 34 px tabs arrived, which is its job.)
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.document-panel-width': 256 }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  await expect.poll(() => panelPaneWidth(page)).toBeGreaterThan(255);
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

  const toolbar = page.getByRole('toolbar', { name: 'Float bar' });
  await expect(toolbar).toBeVisible();
  // THE PAGE SHOWN AND THE RULER IN: the bar is visible before the first frame, and it moves 18 px when the vertical
  // ruler mounts with the first page measure (`app.css`), so its box is read once both have happened and it stops.
  await pageShown(page);
  await expect(page.locator('.m-ruler-v')).toBeVisible();
  const box = await settled(page, () => toolbar.boundingBox(), (now) => now !== null, 'the Float bar');
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
  // A PILL: v5's 40 px column. Under 64 px separates that from the 149.64 px of text buttons with room either side.
  expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(64);

  // IT FLOATS OVER THE PAGE AREA and reserves nothing beside it (the owner, 2026-09-26, rejecting the strip of
  // 2026-09-22): the page area has no inline padding with the pill shown, so the pages are laid out in its full
  // width and the pill sits over them, as v5 draws it. A strip coming back reddens this line.
  const padding = await page
    .locator('.m-canvas-area')
    .evaluate((element) => [getComputedStyle(element).paddingInlineStart, getComputedStyle(element).paddingInlineEnd]);
  expect(padding).toStrictEqual(['0px', '0px']);

  // HIDDEN from the status bar's toggle, and RESTORED by the chord — the pill's own controls are gone by then.
  const bar = page.getByRole('status', { name: 'Document status' });
  await bar.getByRole('button', { name: 'Show or hide the Float bar' }).click();
  await expect(toolbar).toHaveCount(0);
  await page.keyboard.press('Control+Shift+Q');
  await expect(toolbar).toBeVisible();
  // AND FROM THE RAIL (the owner, 2026-09-26): the Float bar button at the rail's foot hides it and shows it again.
  const rail = page.getByRole('navigation', { name: 'Sections' });
  await rail.getByRole('button', { name: 'Float bar', exact: true }).click();
  await expect(toolbar).toHaveCount(0);
  await rail.getByRole('button', { name: 'Float bar', exact: true }).click();
  await expect(toolbar).toBeVisible();
});

test('the FLOAT BAR moves by its grip — a drag, the arrow keys — and stays INSIDE the page area when the window shrinks (item 4)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Float bar' });
  const grip = page.getByRole('button', { name: 'Move the Float bar' });
  await expect(grip).toBeVisible();
  // THE RULERS FIRST: they mount once the page is measured, and the docked bar then moves 18 px to clear the vertical
  // one. Measured before that, the press below landed beside the grip and nothing was dragged (1 run in 20,
  // 2026-09-28) — the layout this case acts on has to be the one it measured.
  await expect(page.locator('.m-ruler-v')).toBeVisible();

  interface Box { x: number; y: number; width: number; height: number }
  const boxOf = async (locator: typeof toolbar): Promise<Box> => {
    const box = await locator.boundingBox();
    if (box === null) throw new Error('a box');
    return box;
  };
  const inside = (inner: Box, outer: Box): void => {
    expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
    expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
    expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
  };

  // A DRAG, far past the page area's bottom-right corner: it follows the pointer and stops at the edge.
  const before = await boxOf(toolbar);
  const handle = await boxOf(grip);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 400, handle.y + 60, { steps: 8 });
  await page.mouse.move(5000, 5000, { steps: 8 });
  await page.mouse.up();
  const area = await boxOf(page.locator('.m-canvas-area'));
  const moved = await boxOf(toolbar);
  expect(moved.x).toBeGreaterThan(before.x + 100);
  inside(moved, area);
  // IN THE CORNER: the far drag was clamped, not dropped — the bar's right and bottom edges meet the area's.
  expect(area.x + area.width - (moved.x + moved.width)).toBeLessThan(3);
  expect(area.y + area.height - (moved.y + moved.height)).toBeLessThan(3);

  // IN THE SAME FRAME: the area narrows and both boxes are read in one task, before any observer, effect or render can
  // run. Only a place the stylesheet resolves against the live layout can pass this; a pixel position computed from a
  // measured room is drawn from the old size until a render catches up — 3 px outside on both CI runners, 2026-09-28.
  const sameFrame = await page.evaluate(() => {
    const narrowed = document.querySelector<HTMLElement>('.m-canvas-area');
    const pill = document.querySelector('.m-quick-toolbar');
    if (narrowed === null || pill === null) return null;
    narrowed.style.marginInlineEnd = '300px';
    const areaBox = narrowed.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    narrowed.style.marginInlineEnd = '';
    return { areaRight: areaBox.right, areaWidth: areaBox.width, pillRight: pillBox.right };
  });
  if (sameFrame === null) throw new Error('the page area and the Float bar are drawn');
  // THE PREMISE: the area really narrowed, by the margin, in that task.
  expect(sameFrame.areaWidth).toBeLessThan(area.width - 250);
  expect(sameFrame.pillRight).toBeLessThanOrEqual(sameFrame.areaRight + 0.5);

  // THE WINDOW SHRINKS: the remembered place is a share of the room, so the bar is still inside the smaller area.
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(async () => (await boxOf(page.locator('.m-canvas-area'))).width).toBeLessThan(area.width);
  const smaller = await boxOf(page.locator('.m-canvas-area'));
  inside(await boxOf(toolbar), smaller);

  // THE KEYBOARD: an arrow key moves it one grid step from where it is drawn.
  await grip.focus();
  const atKey = await boxOf(toolbar);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.round((await boxOf(toolbar)).x)).toBe(Math.round(atKey.x - 8));
  // AND HOME PUTS IT BACK where it starts, docked on the left, vertically centred.
  await page.keyboard.press('Home');
  await expect(toolbar).toHaveClass(/m-quick-toolbar--start/u);
});

test('the PAGES STRIP keeps every thumbnail inside the panel on a long document, drawn or not yet drawn', async ({
  page,
}) => {
  // MEASURED 2026-09-26 at 1920 × 1080: on a 24-page document the thumbnails below the fold had not drawn yet, an
  // undrawn canvas keeps the browser's 300 × 150, the strip's max-content columns took that width — 306 px — and the
  // first thumbnail started at x −87, off the panel. Six pages drew at once and never showed it, which is why the
  // document here is long: the defect needs thumbnails that are not drawn when the strip is laid out.
  await page.setViewportSize({ width: 1920, height: 1080 });
  // NOT `document`: that name is the page's inside `evaluate` below, and shadowing it typed every call there as pdf-lib's.
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 24; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000c9');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'long.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-thumb')).toHaveCount(24);

  const strip = await page.locator('.m-thumbnails').boundingBox();
  expect(strip).not.toBeNull();
  const boxes = await page.locator('.m-thumb').evaluateAll((thumbs) =>
    thumbs.map((thumb) => {
      const box = thumb.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
  );
  const outside = boxes.filter(
    (box) => box.left < (strip?.x ?? 0) - 0.5 || box.right > (strip?.x ?? 0) + (strip?.width ?? 0) + 0.5,
  );
  expect(outside, `thumbnails outside the strip ${JSON.stringify(strip)}: ${JSON.stringify(outside.slice(0, 3))}`).toHaveLength(0);
});

test('a DIALOG taller than the window stays inside it, and its body scrolls to the last control', async ({ page }) => {
  // THE CLASS, found live on 2026-09-15: the camera dialog grew to its stream's native frame and put its buttons
  // outside the window, where a fixed, centred box cannot be scrolled to. The camera itself is not reachable in this
  // harness, so the case uses the KEYBOARD SHORTCUTS dialog — a real dialog whose table is taller than a short window
  // on every theme. It used to use Settings, which since 2026-09-22 sizes itself and scrolls its own page instead, so
  // the premise this case needs — a body taller than the window — lives in the shortcut map now.
  await page.setViewportSize({ width: 1280, height: 420 });
  await bridge(page, {});
  await page.goto('/');
  await startScreenListening(page);
  await page.keyboard.press('Control+Slash');

  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  // THE BODY ARRIVES WITH ITS CHUNK, after the title: `SETTINGS_DIALOG` is `lazy`, so measuring on the dialog's first
  // frame measures a header and an empty body — which fits any window and made the first version of this case fail
  // on the scroll assertion for the wrong reason. `toBeAttached`, not `toBeVisible`: the button may sit below the
  // body's scroll edge, which is the state under test.
  // THE LAST ROW of the map, which sits below the body's scroll edge — the state under test.
  // `toBeAttached`, not `toBeVisible`, for that reason.
  const save = dialog.getByRole('row').last();
  await expect(save).toBeAttached();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  // INSIDE THE WINDOW, top and bottom: the defect put both edges past it.
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(420);

  // THE BODY SCROLLS — the property that makes the bound usable rather than a clip — and the title stays put. A browsed
  // window (the dialog pattern's `DialogScroll`, 2 October) scrolls its list rather than its whole body, so its footer
  // stays in view too.
  const scrolls = await dialog.locator('.m-dialog-scroll').evaluate((region) => region.scrollHeight > region.clientHeight);
  expect(scrolls).toBe(true);
  await save.scrollIntoViewIfNeeded();
  const saveBox = await save.boundingBox();
  expect((saveBox?.y ?? -1) >= 0 && (saveBox?.y ?? 0) + (saveBox?.height ?? 0) <= 420).toBe(true);
  await expect(dialog.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInViewport();
  // THE FOOTER'S OWN CLOSE, the dialog's last control now that the list is read-only (ADR-0191): Reset all is Settings'.
  await expect(dialog.locator('.m-dialog-footer').getByRole('button', { name: 'Close' })).toBeInViewport();
});

test('NOTHING DRAWS OVER A DIALOG: every stacked element of the window sits under the modal layer', async ({ page }) => {
  // THE CLASS, seen live 2026-09-21: the vertical ruler drew over an open dialog. The dialogs and menus are portaled
  // to the end of the body with no z-index, so they win by order alone — and the ruler (1), the loupe (2) and
  // Studio's overlay (2) each carried a z-index into the ROOT stacking context, where any number beats none.
  // The assertion is about every element with a z-index, not about the ruler: a hit test at each one's centre must
  // land on the dialog or its backdrop. The premise that at least one such element exists is asserted, since a window
  // with none would pass by having nothing to test. (The rulers were that element until 2026-10-01; they now sit in
  // grid tracks beside the scroller and carry no z-index. They stay on so a ruler that regains one is probed too.)
  //
  // THE HIT TEST IS BLIND WITHOUT ONE CHANGE, and the first version of this case passed on the broken build for it:
  // the ruler is `pointer-events: none`, so `elementFromPoint` looks straight through it to the backdrop and reports
  // the answer hoped for. The probe turns pointer events on for the element under test, which makes the hit test
  // answer PAINT order — the thing asserted — and the CONTROL below proves it can see the ruler with no dialog open.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'viewing.rulers': true }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-ruler').first()).toBeVisible();

  const probe = (): Promise<{ stacked: number; self: number; over: string[] }> =>
    page.evaluate(() => {
      const stacked = [...document.querySelectorAll<HTMLElement>('#root *')].filter(
        (element) => getComputedStyle(element).zIndex !== 'auto' && element.getBoundingClientRect().width > 0,
      );
      let self = 0;
      const over = stacked.flatMap((element) => {
        const box = element.getBoundingClientRect();
        const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
        const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
        const before = element.style.pointerEvents;
        element.style.pointerEvents = 'auto';
        const hit = document.elementFromPoint(x, y);
        element.style.pointerEvents = before;
        if (hit !== null && element.contains(hit)) self += 1;
        return hit !== null && hit.closest('.m-dialog, .m-dialog__backdrop') === null ? [element.className] : [];
      });
      return { stacked: stacked.length, self, over };
    });

  // CONTROL: with no dialog, the probe finds every stacked element on top at its own centre.
  const alone = await probe();
  expect(alone.stacked).toBeGreaterThan(0);
  expect(alone.self).toBe(alone.stacked);

  await page.keyboard.press('Control+Slash');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  const withDialog = await probe();
  expect(withDialog.stacked).toBe(alone.stacked);
  expect(withDialog.over).toStrictEqual([]);
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
  // ON ITS PAGE (the owner's design, 2026-09-22): the dialog shows one page at a time, and the
  // annotation defaults are *Editing defaults*.
  await dialog.getByRole('button', { name: 'Editing defaults' }).click();
  const auto = dialog.getByRole('checkbox', { name: 'Each tool’s own' });
  const swatch = dialog.getByLabel('Annotation colour');
  await expect(auto).toBeChecked();
  await expect(swatch).toBeDisabled();

  await auto.uncheck();
  await expect(swatch).toBeEnabled();
  // THE SHAPES' RED, never black — what an empty colour input would answer.
  await expect(swatch).toHaveValue('#d92626');
  await swatch.fill('#0000ff');
  // NO SAVE: the change was applied as it was made (ADR-0094), and Done simply closes.
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // REOPENED, it reads the store the command wrote — not the dialog's own draft, which closed with it.
  await page.getByRole('button', { name: 'Settings' }).click();
  const again = page.getByRole('dialog', { name: 'Settings' });
  await again.getByRole('button', { name: 'Editing defaults' }).click();
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
  await expect(page.getByRole('toolbar', { name: 'Float bar' })).toBeVisible();
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

test('STUDIO dismisses its overlay on Escape from a TOOL a person Tabbed to, and on a press on the PAGE', async ({ page }) => {
  // The other two places a person's key or press comes from, driven by the keyboard and the pointer rather than aimed
  // by the case (the palette's defect, 2026-09-17: a route covered from one focus position only).
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.layout-mode': 'studio' }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();
  const overlay = page.locator('.m-ribbon__tools--overlay');

  await page.locator('[data-ribbon-section="home"]').click();
  await expect(overlay).toBeVisible();
  const tool = overlay.getByRole('button').first();
  await tool.focus();
  await expect(tool).toBeFocused();
  // CONTROL: a key that is not Escape, from the same place, leaves it open.
  await page.keyboard.press('Shift');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  await page.locator('[data-ribbon-section="home"]').click();
  await expect(overlay).toBeVisible();
  await page.locator('.m-page-list .m-page').first().click();
  await expect(overlay).toHaveCount(0);
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
  // ABOVE THE RAIL, which is where the tabs' own row used to be — and BELOW THE MENU BAR, the window's top row since
  // v5-14 (ADR-0107), which carries the window controls.
  const rail = await page.locator('.m-ribbon__rail').boundingBox();
  expect(barBox.y + barBox.height).toBeLessThanOrEqual((rail?.y ?? 0) + 0.5);
  const menuBar = await page.locator('.m-menu-bar').boundingBox();
  if (menuBar === null) throw new Error('the menu bar has a box');
  expect(menuBar.y).toBeLessThan(barBox.y);
  expect(menuBar.y + menuBar.height).toBeLessThanOrEqual(barBox.y + 0.5);

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

// A REAL wheel with Control held, which only a browser can send: happy-dom's WheelEvent carries no `ctrlKey`, so the
// component suite proves the button and this proves the wheel reaches the same step (`stepZoom`, one function). From
// 100%, one notch in is 110% by tens and 125% on the ladder — the pair that separates a wheel ignoring the setting.
for (const [chosen, expected] of [
  ['10pct', '110%'],
  [undefined, '125%'],
] as const) {
  test(`Ctrl+WHEEL over the pages steps by the reader’s Zoom step (${chosen ?? 'CONTROL: none chosen, the ladder'})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bridgeWithDocument(page, chosen === undefined ? {} : { 'viewing.zoom-step': chosen }, 1);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const percentage = page.locator('.m-status-bar .m-status-zoom');
    await expect(percentage).toHaveText('100%');
    // THE PAGES SHOWN: the zoom reads 100% before the first frame, while the pane is still hidden for it.
    await pageShown(page);
    const scroller = await page.locator('.m-page-list').first().boundingBox();
    if (scroller === null) throw new Error('the page list is laid out');
    await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(percentage, String(chosen)).toHaveText(expected);
  });
}

test('the status bar’s DOCUMENT LINE gives up its name first and never runs under the controls beside it', async ({
  page,
}) => {
  // Found in the proof locale at the 1024 x 720 floor (2026-09-27): only the name could shorten, so once it was
  // spent the page count, the size and *Saved* kept their width and *Saved* was drawn under the panel toggle. This
  // lengthens the line's facts the way a longer language does, in the ordinary build.
  await page.setViewportSize({ width: 1024, height: 720 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const line = page.locator('.m-status-document');
  await expect(line).toBeVisible();

  const lengthen = (selector: string): Promise<void> =>
    page.evaluate((target) => {
      for (const element of document.querySelectorAll(target)) {
        element.textContent = `${element.textContent} ${'longer words '.repeat(6)}`;
      }
    }, selector);
  const measure = (): Promise<{
    lineEnd: number;
    nextStart: number;
    nameClipped: boolean;
    nameWidth: number;
    shortest: number;
  }> =>
    page.evaluate(() => {
      const document_ = document.querySelector('.m-status-document');
      const next = document_?.nextElementSibling;
      const name = document.querySelector('.m-status-name');
      const saved = document.querySelector('.m-status-saved');
      if (document_ == null || next == null || name === null || saved === null) throw new Error('the line is laid out');
      // THE FURTHEST CHILD, not the line's own box: the line shrinks to its space either way (`min-inline-size: 0`),
      // and the defect is its children running past it.
      return {
        lineEnd: Math.max(...[...document_.children].map((child) => child.getBoundingClientRect().right)),
        nextStart: next.getBoundingClientRect().left,
        nameClipped: name.scrollWidth > name.clientWidth,
        nameWidth: name.getBoundingClientRect().width,
        // EACH OTHER FACT'S BOX AGAINST ITS OWN TEXT: a box narrower than the text it holds has given up width.
        shortest: Math.min(
          ...[...document_.children]
            .filter((child) => child !== name)
            .map((child) => {
              const range = document.createRange();
              range.selectNodeContents(child);
              return child.getBoundingClientRect().width - range.getBoundingClientRect().width;
            }),
        ),
      };
    });

  // THE NAME FIRST, AS AN ORDER: while the name has any width left, no other fact is narrower than its own text.
  // Not "Saved keeps every letter" — whether the facts fit at all at 1024 depends on the fonts, and ubuntu-latest's did
  // not (a3660b8c) — but the order holds on every machine. A proportional shrink (a weight of 1000 against 1) breaks
  // it by a sub-pixel share, measured here 2026-09-28: the name at 6.83 px while *Saved* was 0.03 px under its text.
  await lengthen('.m-status-name');
  const named = await measure();
  expect(named.nameClipped).toBe(true);
  if (named.nameWidth > 0.5) expect(named.shortest).toBeGreaterThan(-0.01);
  expect(named.lineEnd).toBeLessThanOrEqual(named.nextStart + 0.5);

  // AND NEVER UNDER THE CONTROLS: with every fact long, the line still ends before the next cluster begins.
  await lengthen('.m-status-document > span:not(.m-status-name)');
  const long = await measure();
  expect(long.lineEnd).toBeLessThanOrEqual(long.nextStart + 0.5);
});

test('with the RULERS on, the first page begins CLEAR of both of them, and the Float bar docks past the vertical one', async ({
  page,
}) => {
  // The rulers lie over the scroller's start edges. With the list's 16 px padding and v5's 18 px ruler the first
  // page's top was drawn under the ruler (2026-09-27: page at 205, ruler to 207), and the Float bar docked at 12 lay
  // over the vertical ruler. 1280 wide, so a page at 100% is wider than its pane and starts at the scroller's content
  // origin — the shape where the inline start is under the vertical ruler too.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'viewing.rulers': true }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-ruler-h')).toBeVisible();
  await expect(page.locator('.m-page-slot').first()).toBeVisible();

  const box = async (selector: string): Promise<{ x: number; y: number; width: number; height: number }> => {
    const found = await page.locator(selector).first().boundingBox();
    if (found === null) throw new Error(`${selector} is laid out`);
    return found;
  };
  const across = await box('.m-ruler-h');
  const down = await box('.m-ruler-v');
  const slot = await box('.m-page-slot');
  const bar = await box('.m-quick-toolbar');
  expect(slot.y).toBeGreaterThanOrEqual(across.y + across.height);
  expect(slot.x).toBeGreaterThanOrEqual(down.x + down.width);
  expect(bar.x).toBeGreaterThanOrEqual(down.x + down.width);
});

test('DONATE AND RATE US sit at the MENU ROW’s centre while they fit, and after the last menu — never over it — when not (ADR-0113)', async ({
  page,
}) => {
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  const row = page.locator('.m-menu-bar');
  const group = page.locator('.m-menu-bar__commands');
  const lastMenu = page.locator('.m-menu-bar__trigger').last();
  const reserve = page.locator('.m-menu-bar__reserve');
  interface Box { x: number; y: number; width: number; height: number }
  await expect(group.getByRole('button', { name: 'Donate' })).toBeVisible();
  await expect(page.locator('.m-title-bar').getByRole('button', { name: 'Donate' })).toHaveCount(0);

  /** The three boxes, read after the layout has settled at a width. */
  const boxes = async (width: number): Promise<{ group: Box; menu: Box; reserve: Box; row: Box }> => {
    await page.setViewportSize({ width, height: 800 });
    const read = async (locator: typeof row): Promise<Box> => {
      const box = await locator.boundingBox();
      if (box === null) throw new Error(`a box at ${String(width)}`);
      return box;
    };
    // SETTLED, not slept on: the row's fit runs through a ResizeObserver and may take more than one pass, so the four
    // boxes are read once they agree across two frames rather than after a fixed 150 ms.
    return settled(
      page,
      async () => ({ group: await read(group), menu: await read(lastMenu), reserve: await read(reserve), row: await read(row) }),
      (now) => Math.round(now.row.width) === width,
      `the menu row at ${String(width)}`,
    );
  };

  // WIDE: centred on the window to the pixel, which is what the equal outer tracks and the equal padding give. At
  // 1920 the centred box clears the last menu — asserted, so this branch is taken rather than assumed.
  const wide = await boxes(1920);
  expect(1920 / 2 - wide.group.width / 2).toBeGreaterThan(wide.menu.x + wide.menu.width);
  expect(Math.abs(wide.group.x + wide.group.width / 2 - 1920 / 2)).toBeLessThanOrEqual(1);

  // BETWEEN, THE RULE ITSELF rather than a width that happened to fit: centred when the centred box clears the last
  // menu, else after it. v5's menu padding (10, from 8 on 2026-09-27) is what moved 1440 from the first to the second.
  const middle = await boxes(1440);
  const menuEnd = middle.menu.x + middle.menu.width;
  if (1440 / 2 - middle.group.width / 2 >= menuEnd) {
    expect(Math.abs(middle.group.x + middle.group.width / 2 - 1440 / 2)).toBeLessThanOrEqual(1);
  } else {
    expect(middle.group.x).toBeGreaterThanOrEqual(menuEnd);
    expect(middle.group.x + middle.group.width).toBeLessThanOrEqual(middle.reserve.x + 0.5);
  }

  // THE WINDOW'S FLOOR: never over the last menu, never into the reserve (window controls plus the drag minimum).
  const narrow = await boxes(1024);
  expect(narrow.group.x).toBeGreaterThanOrEqual(narrow.menu.x + narrow.menu.width);
  expect(narrow.group.x + narrow.group.width).toBeLessThanOrEqual(narrow.reserve.x + 0.5);
  expect(narrow.reserve.x + narrow.reserve.width).toBeLessThanOrEqual(narrow.row.x + narrow.row.width + 0.5);
});

test('a NARROW MENU ROW stays one line: the words go, then the last menus fold into More, and each is reachable there (ADR-0146)', async ({
  page,
}) => {
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  const row = page.locator('.m-menu-bar');
  const triggers = page.locator('.m-menu-bar__menus .m-menu-bar__trigger');
  await expect(row.getByRole('button', { name: 'Donate' })).toBeVisible();
  const ALL = ['File', 'Edit', 'View', 'Organize', 'Comment', 'Forms', 'Review', 'Protect', 'Tools', 'Window', 'Help'];

  /** The row at a width, once its fit has settled: the triggers drawn, whether it overflows, and each button's fit. */
  const at = async (width: number): Promise<{ names: string[]; spills: boolean; wrapped: boolean[] }> => {
    await page.setViewportSize({ width, height: 800 });
    const read = async (): Promise<{ names: string[]; spills: boolean; wrapped: boolean[] }> => ({
      names: await triggers.allTextContents(),
      spills: await row.evaluate((element) => element.scrollWidth > element.clientWidth),
      // A LABEL ON TWO LINES is a button whose content is taller than its box: the box is a fixed height.
      wrapped: await page
        .locator('.m-menu-bar__commands .m-button')
        .evaluateAll((buttons) => buttons.map((button) => button.scrollHeight > button.clientHeight)),
    });
    return settled(page, read, () => true, `the menu row at ${String(width)}`);
  };

  // CONTROL, WIDE: every menu on the row and no More, so the More below is the narrow width's doing.
  const wide = await at(1920);
  expect(wide.names).toEqual(ALL);
  expect(wide.spills).toBe(false);

  // 960, where the row measured its words as fitting while Rate Us drew on two lines: one line now, at any width.
  for (const width of [1920, 1024, 960, 900, 822, 760]) {
    const now = await at(width);
    expect(now.spills, `the row overflows at ${String(width)}`).toBe(false);
    expect(now.wrapped, `a label wraps at ${String(width)}`).toEqual([false, false]);
  }

  // 760: menus fold from the END into More, which comes last; the drawn ones are the leading part of the order.
  const tight = await at(760);
  expect(tight.names.at(-1)).toBe('More');
  const drawn = tight.names.slice(0, -1);
  expect(drawn).toEqual(ALL.slice(0, drawn.length));
  expect(drawn.length).toBeLessThan(ALL.length);
  const folded = ALL.slice(drawn.length);

  // EVERY FOLDED MENU IS IN MORE, in order, and its commands are there: Help › About opens from inside it.
  await triggers.filter({ hasText: 'More' }).click();
  const inMore = page.locator('[data-folded-menu]');
  await expect(inMore).toHaveCount(folded.length);
  expect(await inMore.allTextContents()).toEqual(folded);
  await page.locator('[data-folded-menu="help"]').hover();
  const about = page.locator('[data-command="app.about"]');
  await expect(about).toBeVisible();
  await about.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a NARROW WINDOW keeps the page: both panels at the minimum window, then the right and the left give way to handles that open sheets (ADR-0146)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  const leftResize = page.getByRole('separator', { name: 'Resize the document panel' });
  const rightResize = page.getByRole('separator', { name: 'Resize the properties panel' });
  const leftHandle = page.getByRole('button', { name: 'Show the document panel' });
  const rightHandle = page.getByRole('button', { name: 'Show the properties panel' });
  // THE SPLITTER'S FLEXIBLE PANE, which is what holds the floor: the canvas area inside it, plus the gaps where the
  // resize handles lie over its edges.
  const pageArea = page.locator('.m-splitter__pane:has(> .m-splitter__middle)');
  const width = async (locator: typeof pageArea): Promise<number> => (await locator.boundingBox())?.width ?? 0;

  // THE MINIMUM WINDOW DRAWS ALL ITS CHROME: both panels in the row, and the page area at its floor or wider.
  await expect(leftResize).toBeVisible();
  await expect(rightResize).toBeVisible();
  await expect(rightHandle).toHaveCount(0);
  expect(await width(pageArea)).toBeGreaterThanOrEqual(PAGE_AREA_MIN_WIDTH - 0.5);

  // NARROWER: the right side gives way to its handle, the left stays, and the page keeps its floor.
  await page.setViewportSize({ width: 960, height: 720 });
  await expect(rightResize).toHaveCount(0);
  await expect(rightHandle).toBeVisible();
  await expect(leftResize).toBeVisible();
  expect(await width(pageArea)).toBeGreaterThanOrEqual(PAGE_AREA_MIN_WIDTH - 0.5);

  // NARROWER STILL: both give way, each handle the width the rule counts it at.
  await page.setViewportSize({ width: 760, height: 560 });
  await expect(leftHandle).toBeVisible();
  for (const handle of ['.m-document-panel-handle', '.m-context-panel-handle']) {
    expect(Math.round(await width(page.locator(handle))), `${handle}'s width`).toBe(EDGE_HANDLE_WIDTH);
  }

  // ASKED FOR, the right side opens as a sheet over the page's edge, holding the panel, and Escape gives it back.
  await rightHandle.click();
  const sheet = page.locator('[data-panel-sheet="end"]');
  await expect(sheet.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  const handleBox = await page.locator('.m-context-panel-handle').boundingBox();
  if (sheetBox === null || handleBox === null) throw new Error('the sheet and its handle are laid out');
  // IT MEETS ITS HANDLE: placed against the handle's padding box, so its edge lies on the handle's 1 px seam.
  const sheetEnd = sheetBox.x + sheetBox.width;
  expect(sheetEnd).toBeGreaterThanOrEqual(handleBox.x - 0.5);
  expect(sheetEnd).toBeLessThanOrEqual(handleBox.x + 1.5);
  // ITS HEADER WHOLE in the sheet too — the chevron the 216 floor cut off.
  expect(await sheet.locator('.m-context-panel__header').evaluate((header) => header.scrollWidth <= header.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show the properties panel' })).toBeFocused();
  // NEITHER OPEN SETTING WAS WRITTEN: the person's choice is what a wider window draws again.
  const stored = await storedSettings(page);
  expect(stored['appearance.context-panel-open']).not.toBe(false);
  expect(stored['appearance.document-panel-open']).not.toBe(false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(rightResize).toBeVisible();
  await expect(leftResize).toBeVisible();
});

test('a SHORT WINDOW folds the rail’s last entries into More, never the active section, and nothing runs past the rail (ADR-0147)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  const rail = page.locator('.m-ribbon__rail');
  const more = page.locator('[data-rail-more]');
  const spills = (): Promise<boolean> => rail.evaluate((element) => element.scrollHeight > element.clientHeight + 0.5);
  const drawnSections = (): Promise<string[]> =>
    rail.locator('button[data-ribbon-section]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-ribbon-section') ?? ''));

  // CONTROL, TALL: every entry on the rail and no More, so the More below is the height's doing.
  await expect(rail.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(more).toHaveCount(0);
  expect(await spills()).toBe(false);

  // SHORT — the work area of a 1080p display at 200% — and nothing runs past the rail.
  await page.setViewportSize({ width: 960, height: 516 });
  await expect(more).toBeVisible();
  await expect.poll(spills).toBe(false);
  const short = await drawnSections();
  expect(short[0]).toBe('home');
  expect(short.length).toBeLessThan(8);

  // MORE HOLDS THE REST in the column's order, and a section chosen there becomes the active one, drawn on the rail.
  await more.click();
  const folded = page.locator('[role="menu"] [data-ribbon-section]');
  await expect(folded.first()).toBeVisible();
  const foldedIds = await folded.evaluateAll((items) => items.map((item) => item.getAttribute('data-ribbon-section') ?? ''));
  expect([...short, ...foldedIds]).toStrictEqual(['home', 'organize', 'edit', 'comment', 'forms', 'protect', 'review', 'tools']);
  await expect(page.locator('[role="menu"] [data-command="app.settings"]')).toBeVisible();
  await page.locator('[role="menu"] [data-ribbon-section="tools"]').click();
  await expect(rail.locator('button[data-ribbon-section="tools"]')).toHaveAttribute('aria-current', 'true');
  await expect.poll(spills).toBe(false);
});

test('a SHORT PAGE AREA folds the Float bar’s last tools into More, inside the area, each still reachable (ADR-0147, extended)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  const strip = page.locator('.m-quick-toolbar');
  const more = page.locator('.m-quick-toolbar__more');
  /** The strip against its page area: inside it at both ends, and the area scrolling nothing. */
  const fits = (): Promise<boolean> =>
    strip.evaluate((element) => {
      const area = element.parentElement;
      if (area === null) return false;
      const own = element.getBoundingClientRect();
      const room = area.getBoundingClientRect();
      return own.top >= room.top - 0.5 && own.bottom <= room.bottom + 0.5 && area.scrollHeight <= area.clientHeight + 0.5;
    });
  const tools = (): Promise<string[]> =>
    strip.locator(':scope > .m-icon-button:not(.m-quick-toolbar__more)').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? ''),
    );

  // CONTROL, TALL: every tool on the strip and no More.
  await expect(strip).toBeVisible();
  await expect(more).toHaveCount(0);
  const all = await tools();
  expect(await fits()).toBe(true);

  // SHORT: inside the area, More at the end, and the drawn tools the leading part of the strip's order.
  await page.setViewportSize({ width: 960, height: 516 });
  await expect(more).toBeVisible();
  await expect.poll(fits).toBe(true);
  const drawn = await tools();
  expect(drawn).toStrictEqual(all.slice(0, drawn.length));

  // MORE HOLDS THE REST, by name and in the strip's order: drawn and folded together are every tool, once.
  await more.click();
  const items = page.locator('[role="menu"] [data-command] .m-menu-bar__title');
  await expect(items.first()).toBeVisible();
  expect([...drawn, ...(await items.allTextContents())]).toStrictEqual(all);
});

test('the STATUS BAR’s document line shows whole facts only, giving up the size and the length first, at every width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

  /** The line's facts as drawn, its dots aside, and whether any of them is cut short. */
  const line = async (width: number, height: number): Promise<{ texts: string[]; cut: string[] }> => {
    await page.setViewportSize({ width, height });
    const read = (): Promise<{ texts: string[]; cut: string[] }> =>
      page.evaluate(() => {
        const drawn = [
          ...document.querySelectorAll<HTMLElement>(
            '.m-status-bar .m-status-document > :not([aria-hidden="true"])',
          ),
        ];
        return {
          texts: drawn.map((fact) => fact.textContent),
          // A FACT CUT SHORT is one whose words are wider than its box. The name may be: it is the one that reads so.
          cut: drawn.filter((fact) => !fact.matches('.m-status-name') && fact.scrollWidth > fact.clientWidth).map((fact) => fact.textContent),
        };
      });
    return settled(page, read, () => true, `the document line at ${String(width)}`);
  };

  // CONTROL, WIDE: all four, so what leaves below is the width's doing.
  const wide = await line(1280, 800);
  expect(wide.texts).toHaveLength(4);
  expect(wide.texts.at(-1)).toBe('Saved');
  expect(wide.cut).toStrictEqual([]);

  // THE MINIMUM WINDOW, where every fact read "8 p… · 1… · Sa…" until 2026-10-03: whole facts, the size and the length
  // gone first, whether it is saved kept.
  const minimum = await line(MINIMUM_WINDOW.width, MINIMUM_WINDOW.height);
  expect(minimum.cut).toStrictEqual([]);
  expect(minimum.texts.at(-1)).toBe('Saved');
  expect(minimum.texts.length).toBeLessThan(4);

  // NARROWER: never a fact cut short, whatever is left.
  for (const [width, height] of [[960, 516], [760, 560]] as const) {
    expect((await line(width, height)).cut, `a fact cut short at ${String(width)}`).toStrictEqual([]);
  }
});

// BOTH BRAND TONES ARE FILLS, in every look (the owner's decision, 2026-10-01): Rate Us was an outline on a translucent
// wash until then, which paints no `background-image` — so a Rate Us drawn as an outline again fails the FILL loop below
// in all three, before anything about its label is asked. Measured against the outline's own code on 2026-10-01: the
// fill loop is first because the label loop also fails there (Donate's label was not solved then), and a case that
// went red on Donate's label would not have said whether it could see Rate Us's outline. Read from Chromium's own
// cascade, because the fill, the label a stylesheet maps and the states are the stylesheet's, which a component test
// does not apply.
for (const look of LOOKS) {
  test(`${look.name}: DONATE AND RATE US are each FILLED in their own colour, their labels clear the theme's floor, and hover, press and focus show`, async ({
    page,
  }) => {
    await bridgeUnder(page, look);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    const floor = textContrastFloor(look.name);
    const commands = page.locator('.m-menu-bar__commands');
    await expect(commands.getByRole('button', { name: 'Rate Us' })).toBeVisible();

    // THE FILLS: a gradient of two opaque stops each, and not the same two.
    const fills = new Map<string, string[]>();
    for (const name of ['Donate', 'Rate Us']) {
      const image = await commands
        .getByRole('button', { name })
        .evaluate((element) => getComputedStyle(element).backgroundImage);
      expect(image, `${name}'s fill`).toMatch(/^linear-gradient\(/u);
      const stops = image.match(/rgba?\([^)]*\)/gu) ?? [];
      expect(stops, `${name}'s stops in ${image}`).toHaveLength(2);
      // OPAQUE, which a wash is not: a translucent stop would be the outline's ground showing through.
      for (const stop of stops) expect(stop.startsWith('rgba('), `${name}'s stop ${stop} is opaque`).toBe(false);
      fills.set(name, stops);
    }
    // EACH IN ITS OWN COLOUR: two fills that matched would be one tone drawn twice.
    expect(fills.get('Donate')).not.toEqual(fills.get('Rate Us'));

    for (const [name, stops] of fills) {
      const button = commands.getByRole('button', { name });
      // SOLVED AT THE POINT OF USE: `useOnColor` writes the label inline once it has read the fill's two stops.
      await expect.poll(() => button.evaluate((element) => element.style.color)).not.toBe('');
      const drawn = await button.evaluate((element) => getComputedStyle(element).color);
      const label = channels(drawn);
      if (label === null) throw new Error(`${name}'s label ${drawn} did not parse`);
      for (const stop of stops) {
        const fill = channels(stop);
        if (fill === null) throw new Error(`${name}'s stop ${stop} did not parse`);
        expect(contrast(label, fill), `${name}'s label on ${stop}`).toBeGreaterThanOrEqual(floor);
      }

      // FOCUS FROM THE KEYBOARD — off the control and back with Tab — because a focus a script gives is not one
      // Chromium shows a ring for, and the ring a keyboard user sees is the state this case is about.
      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      expect(await button.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(await button.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      expect(await button.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
      await button.blur();

      // HOVER and PRESS each change what is drawn, and differently from each other and from rest.
      // EACH READ ONCE THE FILTER HAS STOPPED MOVING: `.m-button` transitions its filter over 140 ms, so a read straight
      // after the hover or the press is a value on the way, and the first frame of a transition is the rest value.
      const filter = (): Promise<string> =>
        settled(page, () => button.evaluate((element) => getComputedStyle(element).filter), () => true, `${name}'s filter`);
      const rest = await filter();
      await button.hover();
      const hovered = await filter();
      // Released off the control, so the press is drawn and no click is sent.
      await page.mouse.down();
      const pressed = await filter();
      await page.mouse.move(0, 0);
      await page.mouse.up();
      expect(new Set([rest, hovered, pressed]).size, `${name}: rest ${rest}, hover ${hovered}, press ${pressed}`).toBe(3);
    }
  });
}

test('the RIBBON FOLDS PER GROUP below 1920, nothing scrolls sideways, and every group keeps a named tool', async ({
  page,
}) => {
  // The owner's `document-light-narrow.png`: at a narrow width each group keeps its first buttons
  // and carries the rest in its own More, and at 1920 every button is on the row. Only a real
  // browser can be asked — happy-dom lays nothing out, so every width is 0 and the fold never runs.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const tools = page.locator('.m-ribbon__tools');
  // A MORE THE WIDTH FILLED, by its count of folded tools. Since ADR-0098's correction every tool in a More is
  // there for width, secondaries included; the count is read rather than the button's presence so this
  // selector means the same thing it always has. The narrow window below asserts at least one More exists,
  // so a selector that matched nothing could not pass this case.
  // `[data-width-folded]` FIRST, because the hidden gauge that measures a More's width carries the class
  // and no count, and matched the negation on its own — measured 2026-09-24, the one "folded" More at
  // 1920 was the gauge.
  const more = tools.locator('.m-ribbon__more[data-width-folded]:not([data-width-folded="0"])');
  // THE RIBBON IS THE SUBJECT, so the wait is on the ribbon: a document opening is what fills it,
  // and waiting on the page list instead would tie this case to a panel it says nothing about.
  await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();

  // AT THE PRIMARY WIDTH, HOME DRAWS NO MORE AT ALL — the owner's design, and what moving Home's secondary tools to
  // the menu bar was for (ADR-0107): every Home tool is on the row at 1920.
  await expect(tools.locator('.m-ribbon__more:not(.m-ribbon__more-gauge)')).toHaveCount(0);
  const wideButtons = await tools.locator('.m-tool-button[data-command]').count();
  expect(wideButtons).toBeGreaterThan(0);
  // AND A SECTION THAT CARRIES A SECONDARY DRAWS IT IN THE ROW while there is room (ADR-0098's correction, the owner's
  // answer of 2 October): Forms › Fields' *Show fields* is a button at 1920, and Forms draws no More. Tools would not
  // do here — it is fuller than 1920, so its secondaries are the first to fold, which is the rule working. The narrow
  // window below is where a More must appear, which is the control that the selector can find one.
  await page.locator('.m-ribbon__tab[data-ribbon-section="forms"]').click();
  await expect(tools.locator('.m-tool-button[data-command="view.show-fields"]')).toBeVisible();
  await expect(tools.locator('.m-ribbon__more:not(.m-ribbon__more-gauge)')).toHaveCount(0);
  await expect(more).toHaveCount(0);
  // EACH SECTION'S WIDEST BUTTON, read at the primary width where (nearly) every button is drawn: the
  // fold below may leave at most that much room unused, or it hid a button that fitted.
  // THE SECTIONS BY THEIR OWN ATTRIBUTE: the rail's foot draws Settings with the same class (ADR-0098),
  // and a loop over the class opened the Settings dialog over the ribbon it was measuring.
  const sections = page.locator('.m-ribbon__tab[data-ribbon-section]:not([disabled])');
  const widest: number[] = [];
  // EACH GROUP'S SMALLEST FOOTPRINT, per section, read here where every group is drawn whole: its first unit, the group's own
  // edge, and the More it would need once anything folded. A group the width cannot hold at all goes to the row's More WHOLE,
  // and the room that leaves must be less than that group's footprint — which is not the widest BUTTON once a group's first
  // unit is a wide column (Tools › Application opens with Help centre, Keyboard shortcuts and Settings, and the widest button
  // of Tools is Keyboard shortcuts). Measured on the ubuntu runner, 2026-10-09: room 130.36 against a widest button of 129.75,
  // with the Application group moved to the row's More, which was right.
  const footprints: number[][] = [];
  for (let index = 0; index < (await sections.count()); index += 1) {
    await sections.nth(index).click();
    await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
    widest.push(
      await tools
        .locator('.m-tool-button[data-command]')
        .evaluateAll((buttons) => Math.max(...buttons.map((button) => button.getBoundingClientRect().width))),
    );
    footprints.push(
      await tools.evaluate((element) => {
        const gauge = element.querySelector('.m-ribbon__more-gauge')?.getBoundingClientRect().width ?? 0;
        return [...element.querySelectorAll('.m-ribbon__group')].map((group) => {
          const row = group.querySelector('.m-ribbon__buttons');
          const first = row?.firstElementChild?.getBoundingClientRect().width ?? 0;
          const gap = Number.parseFloat(getComputedStyle(row ?? group).columnGap) || 0;
          const chrome = group.getBoundingClientRect().width - (row?.getBoundingClientRect().width ?? 0);
          return first + gap + gauge + chrome;
        });
      }),
    );
  }
  await sections.first().click();

  // AT THE NARROWEST WINDOW THE APPLICATION ALLOWS, so the constant `main` refuses sizes below and
  // the row that has to fit inside it are checked against each other rather than separately. A
  // section that outgrows this width fails here instead of on somebody's screen.
  await page.setViewportSize({ width: MINIMUM_WINDOW.width, height: MINIMUM_WINDOW.height });

  // SOMETHING FOLDED, and what is left is fewer buttons than the row had.
  await expect.poll(async () => more.count()).toBeGreaterThan(0);
  await expect.poll(async () => tools.locator('.m-tool-button[data-command]').count()).toBeLessThan(wideButtons);

  // THE GAUGE MEASURES WHAT THE ROW DRAWS. The fold charges every More at the hidden gauge's width, so
  // the two must agree to the pixel. They did not on 3f94567c: the gauge is a `span` and a More is a
  // `button`, the browser gives them different box models, and the same minimum width came out 66 px
  // and 55.2 px. Asserted directly because the room check below only saw it under a wide font — the
  // ubuntu runner's — and passed on this machine's.
  const gaugeAndMore = await tools.evaluate((element) => [
    element.querySelector('.m-ribbon__more-gauge')?.getBoundingClientRect().width ?? -1,
    element.querySelector('.m-ribbon__buttons .m-ribbon__more')?.getBoundingClientRect().width ?? -2,
  ]);
  expect(Math.abs((gaugeAndMore[0] ?? 0) - (gaugeAndMore[1] ?? 0))).toBeLessThan(0.5);

  // NOTHING SCROLLS SIDEWAYS — the order's words. The row's content fits the box it is drawn in.
  const overflow = await tools.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // AND IT FOLDED NO DEEPER THAN IT HAD TO, in EVERY section. The room left after the last group is
  // less than the widest button the row can draw, or some hidden button would have fitted. Until
  // 2026-09-24 the first fold charged every More at the widest button's width, because no More had
  // been drawn to measure — about 200 px of empty ribbon at this width on the Comment section, whose
  // widest button is a long measuring tool. Every section, because the defect's size scales with
  // how wide a section's widest button is, and Home's is not the one that shows it.
  const unusedRoom = (): Promise<number> =>
    tools.evaluate((element) => {
      const last = [...element.querySelectorAll('.m-ribbon__group')].at(-1);
      if (last === undefined) return Number.POSITIVE_INFINITY;
      // THE ROW'S OWN MORE, when a group went to it whole, stands between the last group and the box's edge: the room a
      // hidden group could take is what is left BEFORE it, less the gap the row charges between two items. Measured to
      // the edge, the More's own width read as unused room — 130.36 on the ubuntu runner, against a widest button of 129.75.
      const rest = element.querySelector('.m-ribbon__rest');
      const style = getComputedStyle(element);
      const end =
        rest === null
          ? element.getBoundingClientRect().right - Number.parseFloat(style.paddingRight)
          : rest.getBoundingClientRect().left - (Number.parseFloat(style.columnGap) || 0);
      return end - last.getBoundingClientRect().right;
    });
  let checked = 0;
  for (let index = 0; index < (await sections.count()); index += 1) {
    await sections.nth(index).click();
    await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
    if ((await more.count()) === 0) continue;
    // A SETTLED fold: the room is read once the row stops changing, not on its first frame.
    // THE BOUND IS THE FIRST HIDDEN GROUP'S FOOTPRINT where a group went to the row's More whole, and the widest button
    // where only buttons folded inside the groups that stayed.
    const drawn = await tools.locator('.m-ribbon__group').count();
    const bound = Math.max(widest[index] ?? 0, drawn < (footprints[index]?.length ?? 0) ? (footprints[index]?.[drawn] ?? 0) : 0);
    await expect.poll(unusedRoom).toBeLessThan(bound);
    expect(await unusedRoom()).toBeGreaterThanOrEqual(-1);
    checked += 1;
  }
  // A LOOP THAT CHECKED NOTHING passes for a fold that never ran. AT LEAST ONE, and not *most*:
  // how many sections fold at this width depends on the machine's fonts — more than one on the
  // machine this case was written on, exactly one on both CI runners (the run for 08ec8de,
  // 2026-09-24), which is what a threshold read on one machine costs.
  expect(checked).toBeGreaterThan(0);
  await sections.first().click();

  // EVERY GROUP STILL HAS A NAMED TOOL. A group folded into nothing but a More is a caption over an
  // anonymous control, which the folding module refuses and this asserts on the screen.
  const groups = tools.locator('.m-ribbon__group');
  for (let index = 0; index < (await groups.count()); index += 1) {
    expect(await groups.nth(index).locator('.m-tool-button[data-command]').count()).toBeGreaterThan(0);
  }

  // WHAT THE FOLDED TOOLS ARE IS NOT ASKED HERE, and that is a decision rather than a gap. Opening
  // the overflow menu was part of this case and failed on CI three times — first under a synthetic
  // click, then under Enter on a focused trigger — while opening every time on this machine. Every
  // other assertion in this case passed there, so what CI could not do was drive a third-party
  // menu's popup, which is not what this case is about.
  //
  // The claim it was making — nothing disappears when a group folds — is a property of the split
  // and not of a browser, and `ribbonFolding.test.ts` asserts it as a partition at every depth:
  // shown ++ folded is the group's entries, in order, with nothing lost or duplicated. That is a
  // stronger statement than one menu opening, and it is measurable.

  // BACK AT 1920 the More goes away again, so the fold follows the window rather than latching.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(async () => more.count()).toBe(0);
});

/** How far a ribbon row's content runs past its box: above 1 px, the row's `overflow: hidden` is cutting a tool. */
const ribbonOverflow = (tools: ReturnType<Page['locator']>): Promise<number> =>
  tools.evaluate((element) => element.scrollWidth - element.clientWidth);

test('a CAPTION THAT GROWS after the fold measured it is measured again, so the row never cuts a tool', async ({ page }) => {
  // THE GAP: the fold keeps each button's width, and the row's box is the same size whether its content fits or not,
  // so nothing announced a caption that grew. Measured 2026-10-02 with no group observed: the row ran 61 px past its
  // box for good. Growing the captions is the CONTROL's input — something the absent fix would leave overflowing.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const tools = page.locator('.m-ribbon__tools');
  await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
  // THE ROW SETTLED BEFORE THE GROWTH, which is what makes this a control. Growing the captions while the document is
  // still arriving lets an ordinary re-render re-measure them, and the case then passed with no group observed at all
  // (measured 2026-10-04: 19 tools folding to 17 with both group observations removed). After the page's first frame
  // and a row that reads the same across frames, nothing else measures, so only the observer can answer the growth.
  await pageShown(page);
  const { count: shownBefore } = await settled(
    page,
    async () => ({ count: await tools.locator('.m-tool-button[data-command]').count(), overflow: await ribbonOverflow(tools) }),
    (reading) => reading.overflow <= 1,
    'the ribbon row',
  );
  // THE GROWTH IS DERIVED FROM THE ROOM THE ROW HAS, so it always needs a fold. A fixed 13 px did on Linux's fallback
  // face and stopped doing on Windows' Segoe UI once Home's three Office buttons became one Export (cloud-4 item 9c):
  // the narrower captions then grew into the room left at the row's end, nothing folded, and the case failed for
  // its input rather than the fold. Letter spacing adds exactly its amount for each character a caption draws.
  const { room, characters } = await tools.evaluate((row) => {
    const style = getComputedStyle(row);
    const inner = row.getBoundingClientRect().right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth);
    const groups = [...row.querySelectorAll(':scope > .m-ribbon__group, :scope > .m-ribbon__rest')];
    const labels = [...row.querySelectorAll('.m-tool-button__label')];
    return {
      room: inner - Math.max(...groups.map((group) => group.getBoundingClientRect().right)),
      characters: labels.reduce((sum, label) => sum + label.textContent.length, 0),
    };
  });
  expect(characters).toBeGreaterThan(0);
  const spacing = Math.ceil((room + 24) / characters);
  await page.evaluate((px) => {
    document.styleSheets[0]?.insertRule(`.m-tool-button__label { letter-spacing: ${String(px)}px !important; }`, 0);
  }, spacing);
  // THE GROWTH TOOK: the captions are drawn wider, so the row had something to answer.
  await expect(tools.locator('.m-tool-button__label').first()).toHaveCSS('letter-spacing', `${String(spacing)}px`);
  await expect.poll(() => ribbonOverflow(tools)).toBeLessThanOrEqual(1);
  // AND IT ANSWERED BY FOLDING, not by the browser hiding the excess: fewer tools on the row than before.
  expect(await tools.locator('.m-tool-button[data-command]').count()).toBeLessThan(shownBefore);
});

// EVERY RIBBON TAB AT 1280 × 800, the size this suite reads as the owner's (`window.ts` sets no size of its own). A
// literal list, because this package may not import the registry — and a case below holds it equal to the rail's
// sections, so a tab added without a case here is red rather than unchecked.
const RIBBON_TABS = ['home', 'organize', 'edit', 'comment', 'forms', 'protect', 'review', 'tools'] as const;

test('the ribbon tabs checked at 1280 × 800 are exactly the rail’s sections', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const sections = page.locator('.m-ribbon__tab[data-ribbon-section]');
  await expect(sections.first()).toBeVisible();
  const rail = await sections.evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).dataset['ribbonSection']));
  expect(rail).toStrictEqual([...RIBBON_TABS]);
});

// THE TWO WIDTHS THE OWNER NAMED for the fold (2 October): the laptop size, and full width, where a secondary tool is
// now on the row whenever it fits (ADR-0098's correction).
const FOLD_SIZES = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

for (const size of FOLD_SIZES) for (const tab of RIBBON_TABS) {
  test(`the ${tab.toUpperCase()} ribbon at ${String(size.width)} × ${String(size.height)} cuts no caption and folds no tool while room remains`, async ({ page }) => {
    // THE OWNER'S REPORT OF 2 OCTOBER: Forms showed a More with room to spare and "List box" cut to "List bo".
    // Not reproduced on this machine's fonts; these are the properties, held per tab where they can be seen.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await bridgeWithDocument(page, {}, 1);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const tools = page.locator('.m-ribbon__tools');
    await page.locator(`.m-ribbon__tab[data-ribbon-section="${tab}"]`).click();
    await expect(tools).toHaveAttribute('data-ribbon-active', tab);
    await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
    // THE WIDEST TOOL THIS TAB DRAWS, read where (nearly) everything is drawn: room left at 1280 may not reach it.
    const widest = await tools
      .locator('.m-tool-button[data-command]')
      .evaluateAll((buttons) => Math.max(...buttons.map((button) => button.getBoundingClientRect().width)));
    await page.setViewportSize(size);
    await expect.poll(() => ribbonOverflow(tools)).toBeLessThanOrEqual(1);

    const seen = await tools.evaluate((element) => {
      const caption = (button: HTMLElement): { label: number; room: number } => {
        const label = button.querySelector<HTMLElement>('.m-tool-button__label');
        const style = getComputedStyle(button);
        return {
          label: label?.getBoundingClientRect().width ?? 0,
          room: button.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
        };
      };
      const buttons = [...element.querySelectorAll<HTMLElement>('.m-tool-button[data-command]')];
      const cut = buttons.filter((button) => caption(button).label > caption(button).room + 0.5).map((button) => button.dataset['command']);
      // POSITIVE CONTROL, in the instrument: one tool squeezed on purpose must read as cut, or a clean answer means
      // nothing — a label's own box grows with its text, which made the first version of this check blind.
      const first = buttons[0];
      let sees = false;
      if (first !== undefined) {
        first.style.setProperty('min-inline-size', '0');
        first.style.inlineSize = '20px';
        sees = caption(first).label > caption(first).room + 0.5;
        first.style.removeProperty('inline-size');
        first.style.removeProperty('min-inline-size');
      }
      const last = [...element.querySelectorAll('.m-ribbon__group, .m-ribbon__rest')].at(-1);
      const end = element.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(element).paddingRight);
      return {
        cut,
        sees,
        room: last === undefined ? 0 : end - last.getBoundingClientRect().right,
        widthFolded: [...element.querySelectorAll<HTMLElement>('.m-ribbon__more[data-width-folded]')].reduce(
          (sum, more) => sum + Number(more.dataset['widthFolded'] ?? '0'),
          0,
        ),
        rest: element.querySelector('.m-ribbon__rest') !== null,
      };
    });
    const detail = JSON.stringify({ ...seen, widest });
    expect(seen.sees, `the clip check can see a cut caption: ${detail}`).toBe(true);
    expect(seen.cut, detail).toStrictEqual([]);
    // A TOOL FOLDED only where the room left could not have held one more — secondaries included since ADR-0098's
    // correction, so a More that holds only a group's secondaries with room to spare is the defect this reports.
    if (seen.widthFolded > 0 || seen.rest) expect(seen.room, detail).toBeLessThan(widest);
  });
}

test('BELOW THE FLOOR whole groups fold into the row’s More, nothing scrolls sideways, and every tool is still reachable', async ({
  page,
}) => {
  // The owner's order (28 September, item 3): the window's minimum never exceeds the work area, and below 1024 × 720
  // the ribbon folds into More and never scrolls sideways. 960 × 516 is a 1080p screen's work area at 200% scaling,
  // and 640 about a 1366 × 768 screen's at the same scaling. Measured 2026-09-29: every section still fits at 800
  // with each group at its floor, so it is 640 that runs the second stage.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const tools = page.locator('.m-ribbon__tools');
  await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
  // THE SECTIONS BY ID, read once on the tall window, and each chosen the way a person reaches it: on the rail, or from
  // the rail's More when a short window has folded it there (ADR-0147). By place on the rail, a fold at 640 x 360 made
  // the first place Tools, the active section, and the case compared Tools' row with Home's.
  const ids = await page
    .locator('.m-ribbon__tab[data-ribbon-section]:not([disabled])')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-ribbon-section') ?? ''));
  const choose = async (id: string): Promise<void> => {
    // THE RAIL AS SETTLED, never mid-fold: read in the frame before a fold answers, a section looks drawn and is then
    // folded out from under the click (measured: Home at 640 x 360, detached on every retry).
    const drawn = await settled(
      page,
      () =>
        page
          .locator('.m-ribbon__rail button[data-ribbon-section]')
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-ribbon-section') ?? '')),
      () => true,
      'the rail',
    );
    if (drawn.includes(id)) {
      await page.locator(`.m-ribbon__rail button[data-ribbon-section="${id}"]`).click();
      return;
    }
    await page.locator('[data-rail-more]').click();
    await page.locator(`[role="menu"] [data-ribbon-section="${id}"]`).click();
  };

  // WHAT A SECTION OFFERS, read the same way at every width: the tools drawn on the row, and every tool a More holds.
  // The join is asserted as SET EQUALITY against the wide row, so a tool that vanished at a width fails, and so does
  // one that appeared from nowhere.
  const reachable = (): Promise<string[]> =>
    tools.evaluate((element) =>
      [
        ...[...element.querySelectorAll('.m-tool-button[data-command]:not(.m-ribbon__menu)')].map(
          (button) => button.getAttribute('data-command') ?? '',
        ),
        ...[...element.querySelectorAll('[data-holds]')].flatMap((more) => (more.getAttribute('data-holds') ?? '').split(' ')),
      ]
        .filter((id) => id !== '')
        .sort(),
    );
  expect(ids.length).toBeGreaterThan(1);
  const wide: string[][] = [];
  for (const id of ids) {
    await choose(id);
    await expect(tools).toHaveAttribute('data-ribbon-active', id);
    await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
    wide.push(await reachable());
  }

  let hidden = 0;
  for (const width of [960, 800, 640]) {
    await page.setViewportSize({ width, height: width === 640 ? 360 : 516 });
    for (const [index, id] of ids.entries()) {
      await choose(id);
      // THE SECTION ASKED FOR IS THE ONE DRAWN, so the row compared below is that section's.
      await expect(tools).toHaveAttribute('data-ribbon-active', id);
      await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
      // A SETTLED row: the overflow is read once the fold has answered for this width.
      await expect.poll(() => tools.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      expect(await reachable(), `section ${id} at ${String(width)}`).toStrictEqual(wide[index]);
      const rest = tools.locator('.m-ribbon__rest .m-ribbon__more');
      if ((await rest.count()) > 0) {
        hidden += 1;
        // ITS NAME BEGINS WITH THE WORD ON ITS FACE, and names what it holds (WCAG 2.5.3).
        await expect(rest).toHaveAttribute('aria-label', /^More: \S/u);
      }
    }
  }
  // THE SECOND STAGE RAN. Without this, a ribbon that never hid a group — and so never tested the row's More — would
  // pass every assertion above wherever the sections happen to fit.
  expect(hidden).toBeGreaterThan(0);
});

// THE LIVE CHECKS (the owner's list of 28 September, item 3). The WCAG review of 2026-09-27 named nine checks that
// need the running application and was never saved; FEATURES names three. These are the criteria of that kind,
// reconstructed, run on the BUILT renderer in Chromium — the bundle `npm start` loads, not the Electron shell around it,
// which the desktop-control tool here cannot reach (JOURNAL 2026-09-29).

test('LIVE CHECK 1.4.13: a tooltip shows on hover and on keyboard focus, stays while the pointer is on it, and Escape dismisses it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.locator('.m-ribbon__tab[data-ribbon-section="tools"]').click();
  // A BUTTON WHOSE CAPTION ABBREVIATES ITS TITLE, which is exactly where the ribbon draws a tooltip.
  const trigger = page.locator('.m-ribbon__tools [data-command="document.new-from-office"]');
  await expect(trigger).toBeVisible();
  const tip = page.locator('.m-tooltip');

  await trigger.hover();
  await expect(tip).toHaveText('New PDF from Word, Excel or PowerPoint…');
  // HOVERABLE: the pointer moves onto the tooltip itself and it stays. Its box once PLACED: an unplaced popup sits at
  // the window's origin at opacity 0, which counts as visible, and a move there leaves the trigger.
  const box = await popupPlaced(page, tip, 'the tooltip');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await expect(tip).toBeVisible();
  // DISMISSIBLE without moving the pointer.
  await trigger.hover();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);

  // AND ON KEYBOARD FOCUS, not only on hover: the pointer is parked away first.
  await page.mouse.move(5, 600);
  await trigger.focus();
  await page.keyboard.press('Shift');
  await expect(tip).toHaveText('New PDF from Word, Excel or PowerPoint…');
});

test('LIVE CHECK 1.4.12: under WCAG’s text spacing the ribbon still scrolls nothing and every caption keeps its text', async ({
  page,
}) => {
  // The success criterion's own values, applied before the first paint — the fold measures what it draws, so spacing
  // applied later would test a re-measure the criterion does not ask about.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent =
        '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } ' +
        'p { margin-block-end: 2em !important; }';
      document.head.append(style);
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const tools = page.locator('.m-ribbon__tools');
  const sections = page.locator('.m-ribbon__tab[data-ribbon-section]:not([disabled])');
  // CONTROL: the spacing is on the page. A style that never landed would pass every assertion below.
  await expect(tools.locator('.m-tool-button__label').first()).not.toHaveCSS('letter-spacing', 'normal');
  for (let index = 0; index < (await sections.count()); index += 1) {
    await sections.nth(index).click();
    await expect(tools.locator('.m-tool-button[data-command]').first()).toBeVisible();
    await expect.poll(() => tools.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    // A CAPTION CUT SHORT WITHOUT AN ELLIPSIS is text lost; one with an ellipsis carries its whole text as the button's
    // name, which is the design's own answer for a long label.
    const clipped = await tools.evaluate((element) =>
      [...element.querySelectorAll('.m-tool-button__label, .m-ribbon__caption')]
        .filter((label) => label instanceof HTMLElement && label.scrollWidth > label.clientWidth + 1)
        .filter((label) => getComputedStyle(label).textOverflow !== 'ellipsis')
        .map((label) => label.textContent),
    );
    expect(clipped, `section ${String(index)}`).toStrictEqual([]);
  }
});

test('LIVE CHECK 2.1.2, 2.4.3 and 2.4.7: Tab walks the document screen in reading order, shows a ring at every stop, and traps nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();
  await page.locator('body').click({ position: { x: 2, y: 2 } });

  const REGIONS = ['.m-title-bar', '.m-menu-bar', '.m-ribbon', '.m-document-panel', '.m-page-list', '.m-context-panel', '.m-status-bar'];
  const stops: { region: string; ring: boolean; visible: boolean; key: string }[] = [];
  for (let press = 0; press < 160; press += 1) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate((regions) => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || focused === document.body) return { region: 'none', ring: false, visible: false, key: 'body' };
        const style = getComputedStyle(focused);
        const ring =
          (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
        const box = focused.getBoundingClientRect();
        const region = regions.find((selector) => focused.closest(selector) !== null) ?? 'other';
        const key = `${focused.tagName}|${focused.className}|${focused.getAttribute('aria-label') ?? ''}|${focused.textContent.slice(0, 30)}|${String(Math.round(box.x))},${String(Math.round(box.y))}`;
        return { region, ring, visible: box.width > 0 && box.height > 0, key };
      }, REGIONS),
    );
  }
  const focused = stops.filter((stop) => stop.key !== 'body');
  // CONTROL: a walk that met a handful of controls would pass the rest; the document screen has many more.
  expect(new Set(focused.map((stop) => stop.key)).size).toBeGreaterThan(20);
  // 2.4.7: every stop is on screen and draws a ring.
  expect(focused.filter((stop) => !stop.visible || !stop.ring).map((stop) => stop.key)).toStrictEqual([]);
  // 2.1.2: focus MOVES — no stop repeats on the next press — and the walk comes round again, so nothing holds it.
  expect(stops.filter((stop, index) => index > 0 && stop.key === stops[index - 1]?.key && stop.key !== 'body')).toStrictEqual([]);
  const first = focused[0]?.key;
  expect(focused.slice(1).some((stop) => stop.key === first), 'the walk never returned to its first stop').toBe(true);
  // 2.4.3: the regions are met in the screen's reading order — top chrome, ribbon, the panels and page, status bar.
  const order = [...new Set(focused.map((stop) => stop.region))].filter((region) => region !== 'other');
  const top = order.findIndex((region) => region === '.m-title-bar' || region === '.m-menu-bar');
  const status = order.indexOf('.m-status-bar');
  expect(top, JSON.stringify(order)).toBe(0);
  expect(status, JSON.stringify(order)).toBe(order.length - 1);
});

for (const [theme, offers] of [
  ['light', 'Switch to dark theme'],
  ['dark', 'Switch to light theme'],
] as const) {
  test(`${theme}: the TITLE BAR's light and dark switch offers the other theme, and the search keeps its words at 1280 × 800`, async ({
    page,
  }) => {
    // ADR-0132 at the owner's size, with a document open so the tabs take their share of the row.
    await page.setViewportSize({ width: 1280, height: 800 });
    await bridgeWithDocument(page, { 'appearance.theme': theme }, 1);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const bar = page.locator('.m-title-bar');
    await expect(bar.getByRole('button', { name: offers })).toBeVisible();
    // THE DOCUMENT'S TAB IN THE ROW, which is what the fit is measured WITH: the theme and the switch are both there
    // before the tab arrives, so a row read on them alone is measured without the share the tabs take.
    await expect(bar.getByRole('navigation', { name: 'Open documents' }).getByText('width.pdf')).toBeVisible();

    const fit = await bar.evaluate((element) => {
      const search = element.querySelector<HTMLElement>('.m-command-search');
      const chord = element.querySelector<HTMLElement>('.m-command-search__chord');
      const words = search?.querySelector<HTMLElement>('span');
      const searchBox = search?.getBoundingClientRect();
      const chordBox = chord?.getBoundingClientRect();
      return {
        // THE PLACEHOLDER WHOLE: its own text fits the box it is laid out in.
        placeholder: words !== null && words !== undefined && words.scrollWidth <= words.clientWidth + 1,
        // THE CHORD INSIDE THE SEARCH, not pushed past its edge.
        chord: searchBox !== undefined && chordBox !== undefined && chordBox.right <= searchBox.right + 0.5,
        // AND THE ROW ITSELF scrolls nothing sideways: every control is laid out inside it.
        row: element.scrollWidth <= element.clientWidth + 1,
      };
    });
    expect(fit).toStrictEqual({ placeholder: true, chord: true, row: true });
    // NARROW: the owner's review (2026-10-08) found the field wider than what it does, which only opens the palette.
    const searchWidth = (await bar.locator('.m-command-search').boundingBox())?.width ?? 0;
    expect(searchWidth).toBeLessThanOrEqual(210);

    // A CLICK writes the other theme, through View › Theme's command.
    await bar.getByRole('button', { name: offers }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'light' ? 'dark' : 'light');
  });
}

test('LIVE CHECK toasts: a toast never covers the assistant’s Send button', async ({ page }) => {
  // The review's "toasts over Send": the toast strip sits at the window's bottom-right, which is where the assistant's
  // composer ends. A save's toast is the one this screen raises on its own.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, {}, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();
  await page.locator('.m-context-panel__tab[data-context-tab="assistant"]').click();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeVisible();
  await page.keyboard.press('Control+S');
  const toast = page.locator('.m-toast').first();
  await expect(toast).toBeVisible();
  // ITS BOX ONCE IT HAS ARRIVED: a toast slides 8 px up over 160 ms (`m-toast-in`), so a read on appearance is a
  // point on the way.
  const a = await settled(page, () => toast.boundingBox(), (box) => box !== null, 'the toast');
  const b = await send.boundingBox();
  if (a === null || b === null) throw new Error('a box is missing');
  const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps, `toast ${JSON.stringify(a)} against Send ${JSON.stringify(b)}`).toBe(false);
  // THE CLASS, not the one button: the strip sits in the page area, so NO control of the panel can be under it. It
  // missed Send by a guessed offset until the composer lost a line and the guess covered Send by 0.56 px on Windows.
  const [pane, panel] = [await page.locator('.m-page-pane').last().boundingBox(), await page.locator('.m-context-panel').boundingBox()];
  if (pane === null || panel === null) throw new Error('the page pane and the context panel');
  expect(a.x + a.width, 'the toast ends inside the page area').toBeLessThanOrEqual(pane.x + pane.width);
  expect(a.y + a.height, 'and above its foot').toBeLessThanOrEqual(pane.y + pane.height);
  expect(a.x + a.width, 'so it stops short of the panel').toBeLessThanOrEqual(panel.x);
});

test('LIVE CHECK Studio: the overlay goes when focus leaves it for another part of the window', async ({ page }) => {
  // The named check the review listed: Studio's overlay on focus loss. Escape and a press on the page are held by the
  // cases above; this is focus moving on without either — a person Tabbing past the overlay's last tool. (A click on
  // the panel beside it cannot happen: the overlay lies over the panel's tabs, measured 2026-09-29.)
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeWithDocument(page, { 'appearance.layout-mode': 'studio' }, 1);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();
  const overlay = page.locator('.m-ribbon__tools--overlay');
  await page.locator('[data-ribbon-section="home"]').click();
  await expect(overlay).toBeVisible();
  const last = overlay.locator('button:visible').last();
  await last.focus();
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  // WHEREVER FOCUS WENT, it is not in the overlay any more — and the overlay is gone with it, so nothing it covers
  // is being focused behind it (2.4.3).
  expect(await page.evaluate(() => document.activeElement?.closest('.m-ribbon__tools--overlay') === null)).toBe(true);
  await expect(overlay).toHaveCount(0);
});

test('the START SCREEN draws the supplied logo, the hero lines, one primary Open with its chord, and a footer', async ({
  page,
}) => {
  // §10.3's start screen; ADR-0002: the supplied artwork, never stretched. The production build is the subject — an
  // asset route is proven only where the bundle and its CSP load it.
  await bridge(page);
  await page.goto('/');

  const measure = async (
    image: import('@playwright/test').Locator,
  ): Promise<{ natural: number; naturalRatio: number; width: number; height: number }> =>
    image.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const img = element as HTMLImageElement;
      return {
        natural: img.naturalWidth,
        naturalRatio: img.naturalHeight === 0 ? 0 : img.naturalWidth / img.naturalHeight,
        width: box.width,
        height: box.height,
      };
    });

  // THE ARTWORK IS DECORATIVE NOW (ADR-0100): the heading below it carries the name, so the picture is found by
  // its place rather than by a name it no longer has.
  const hero = page.locator('.m-start-logo');
  await expect(hero).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Monstera' })).toBeVisible();
  // THE WORDMARK'S FACE ARRIVED: a rule naming Marcellus is satisfied by a fallback serif too, so the case asks
  // the page whether the font itself loaded — the file, through `font-src 'self'`, decoded.
  // The FACE'S OWN STATUS, not `document.fonts.check`, which answers true for a list with nothing left to load —
  // including one whose only face failed.
  const marcellus = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((face) => face.family.replaceAll('"', '') === 'Marcellus').map((face) => face.status);
  });
  expect(marcellus).toStrictEqual(['loaded']);
  // DECODED BEFORE IT IS MEASURED: a visible image may not have decoded yet, and its natural width is then 0.
  await expect.poll(() => hero.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.m-menu-bar__logo').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const drawn = await measure(hero);
  // DECODED — a broken source is still a laid-out box, with a natural width of zero.
  expect(drawn.natural).toBeGreaterThan(0);
  // 142: the owner's 118 (84 × 1.4, review of 0.1.6.0), then about 142 on 2 October; `--logo-hero`.
  expect(drawn.height).toBeCloseTo(142, 0);
  // AND THE ARTWORK HAS THE PIXELS FOR IT at this display's scale, 1: a derivative smaller than the drawn height is
  // upscaled, which is blur that no layout assertion sees. The 2x display's file is the case below.
  expect(drawn.natural).toBeGreaterThanOrEqual(drawn.height);
  // UNSTRETCHED: drawn at the image's OWN ratio. This asserted the portrait master's 1652 × 2050 until the owner's
  // square masters replaced it on 2026-09-19 and it failed on a correct drawing — a ratio written down is a claim about
  // one artwork, and the image's own ratio is the property ADR-0002 states for any.
  expect(drawn.width / drawn.height).toBeCloseTo(drawn.naturalRatio, 1);

  // THE MARK IN THE MENU BAR since v5-14 (ADR-0107), at the design's 18 px — the title bar draws none.
  const mark = await measure(page.locator('.m-menu-bar__logo'));
  expect(mark.natural).toBeGreaterThan(0);
  expect(mark.height).toBeCloseTo(18, 0);
  expect(mark.width / mark.height).toBeCloseTo(mark.naturalRatio, 1);
  await expect(page.locator('.m-title-bar img')).toHaveCount(0);

  await expect(page.getByText('PDF EDITOR')).toBeVisible();
  await expect(page.getByText('Built For The Way You Work')).toBeVisible();

  // ONE PRIMARY BUTTON, carrying its chord, and still named by its label alone.
  await expect(page.locator('.m-start-primary').getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open PDF…', exact: true })).toContainText('Ctrl+O');

  const footer = page.locator('.m-start-footer');
  await expect(footer.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(footer.getByRole('button', { name: 'About' })).toBeVisible();
  await expect(footer).toContainText('© Tenslor Inc.');
  await expect(footer).toContainText('Monstera ');
  // v5-01'S BAR: pinned to the window's foot while the screen is short, links on the left, the build on the right.
  // A WINDOW TALLER THAN THE SCREEN'S CONTENT, and the bottom edge EXACT: at the default size the content overflows,
  // the footer follows it below the fold, and *its bottom is near the window's* held without the pin (measured
  // 2026-09-25 with `margin-block-start: auto` removed).
  // Measured against the START AREA's bottom, not the window's: the shell pads the body's grid area, so the window
  // edge is 8 px further down whether or not the footer is pinned.
  await page.setViewportSize({ width: 1280, height: 1100 });
  const bar = await footer.boundingBox();
  const area = await page.locator('.m-start-area').boundingBox();
  const viewport = page.viewportSize();
  if (bar === null || area === null || viewport === null) throw new Error('the footer has no box');
  expect(Math.abs(bar.y + bar.height - (area.y + area.height))).toBeLessThanOrEqual(1);
  const links = await footer.locator('.m-start-footer__commands').boundingBox();
  const build = await footer.locator('.m-start-footer__build').boundingBox();
  if (links === null || build === null) throw new Error('a footer region has no box');
  expect(links.x).toBeLessThan(viewport.width / 4);
  expect(build.x + build.width).toBeGreaterThan((viewport.width * 3) / 4);
});

test('the START SCREEN draws its 2x artwork on a 2x display, and its tiles fit a 1280 × 800 window', async ({ browser }) => {
  // A `srcset`'s choice is the browser's, so the case reads which file was DECODED, not which was named: a 1x file on a
  // 2x display draws at 142 from 142 pixels, which is the blur this file exists to stop and passes every layout check.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await bridge(page);
  await page.goto('/');
  const hero = page.locator('.m-start-logo');
  await expect(hero).toBeVisible();
  await expect.poll(() => hero.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // THE FILE'S OWN PIXELS, decoded apart: the element's `naturalWidth` is divided by the candidate's density (HTML's
  // "density-corrected natural width"), so a 284 px file chosen as 2x reads 142 there, the same as the 1x file.
  const decoded = await hero.evaluate(async (image) => {
    const img = image as HTMLImageElement;
    const file = new Image();
    file.src = img.currentSrc;
    await file.decode();
    return { source: img.currentSrc, natural: file.naturalWidth, height: img.getBoundingClientRect().height };
  });
  expect(decoded.source).toContain('logo-hero@2x');
  expect(decoded.natural).toBeGreaterThanOrEqual(2 * decoded.height);

  // THE LOGO GREW 24 PX and the room it took came from the drop zone and the top padding, so at the size the owner works
  // at the first screen still holds the hero, Open and every tile, unscrolled. Measured against the area that scrolls,
  // not the footer: the footer FOLLOWS the content (`margin-block-start: auto`), so "the last tile is above the footer"
  // holds at any height and separates nothing. The recent list below the tiles scrolls; the footer stays at the window's
  // foot over it, which the case after this one holds.
  const fit = await page.locator('.m-start-card').last().evaluate((card) => {
    let area: HTMLElement | null = card.parentElement;
    while (area !== null && !['auto', 'scroll'].includes(getComputedStyle(area).overflowY)) area = area.parentElement;
    return area === null
      ? null
      : { top: area.scrollTop, tile: card.getBoundingClientRect().bottom, room: area.getBoundingClientRect().bottom };
  });
  if (fit === null) throw new Error('the start area has no scrolling ancestor');
  expect(fit.top).toBe(0);
  expect(fit.tile).toBeLessThanOrEqual(fit.room);
  await context.close();
});

for (const look of LOOKS) {
  test(`${look.name}: the START SCREEN's footer COVERS what scrolls under it, so no card shows through its text`, async ({
    page,
  }) => {
    // MEASURED 2026-10-03 in high contrast: the footer's ground was the ambient gradient alone, which is `none` there, so a
    // recent card scrolled under the bar was drawn through "Press F1 for help". The ground is the window's colour with
    // the gradient over it, as `.m-document-surface` lays it, and what the bar must do in every look is cover.
    await page.setViewportSize({ width: 1280, height: 800 });
    await bridgeUnder(page, look, {
      recent: ['Annual report.pdf', 'Board minutes.pdf', 'Supplier contract.pdf', 'Lease.pdf'].map((name, at) => ({
        handle: asFileHandle(`handle-${String(at)}`),
        name,
        location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
        openedAt: new Date(Date.now() - at * 3_600_000).toISOString(),
        availability: 'available' as const,
      })),
    });
    await page.goto('/');
    const footer = page.locator('.m-start-footer');
    await expect(footer).toBeVisible();
    // A CARD UNDER THE BAR, so the case is about a screen where something can show through.
    const card = await page.locator('.m-recent-item').first().boundingBox();
    const bar = await footer.boundingBox();
    expect((card?.y ?? 0) + (card?.height ?? 0)).toBeGreaterThan(bar?.y ?? Infinity);
    // COVERS means an opaque colour or a gradient laid over the bar — the ground's own colours are opaque hex — and
    // neither is what high contrast had, where the colour was transparent and `--ambient` is `none`.
    const ground = await footer.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.backgroundColor, image: style.backgroundImage };
    });
    const alpha = /^rgba\([^)]*,\s*([\d.]+)\)$/u.exec(ground.color)?.[1];
    const opaque = alpha === undefined || Number(alpha) === 1;
    expect(opaque || ground.image !== 'none', JSON.stringify(ground)).toBe(true);
  });
}

test('the START SCREEN keeps its footer at the window’s foot at 1280 × 800, with recent files under the tiles', async ({
  page,
}) => {
  // THE OWNER'S ITEM 1f: the footer ended 48 px below the window, and with recent files it followed them further. The
  // rhythm tightens on a short window and the footer is stuck to the area's foot, so it is in the window either way.
  // WITH RECENT FILES, because that is the screen the owner sees, and it makes the content taller than the window — a
  // case without them would hold for the tightening alone.
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridge(page, {
    recent: ['Annual report.pdf', 'Board minutes.pdf', 'Supplier contract.pdf', 'Lease.pdf'].map((name, at) => ({
      handle: asFileHandle(`handle-${String(at)}`),
      name,
      location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
      openedAt: new Date(Date.now() - at * 3_600_000).toISOString(),
      availability: 'available' as const,
    })),
  });
  await page.goto('/');
  const footer = page.locator('.m-start-footer');
  await expect(footer).toBeVisible();
  await expect(page.locator('.m-recent')).toBeAttached();
  const read = await footer.evaluate((element) => {
    const area = element.closest('.m-start-area');
    return {
      bottom: element.getBoundingClientRect().bottom,
      window: window.innerHeight,
      // THE CONTENT IS TALLER THAN THE AREA, or the case separates nothing: a short screen pins its footer anyway.
      overflows: area === null ? null : area.scrollHeight > area.clientHeight,
    };
  });
  expect(read.overflows).toBe(true);
  expect(read.bottom).toBeLessThanOrEqual(read.window);
  // AND IT COVERS NO TILE: stuck to the foot over the design's own rhythm, the footer cut the last row of tiles in half
  // (measured 2026-10-03). The tightening on a short window is what makes room for it.
  const tile = await page.locator('.m-start-card').last().boundingBox();
  const bar = await footer.boundingBox();
  expect((tile?.y ?? Infinity) + (tile?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? -Infinity);

  // CONTROL: on a window with room the design's own rhythm is kept — the tightening is the short window's alone.
  await page.setViewportSize({ width: 1280, height: 881 });
  expect(await page.locator('.m-start-screen').evaluate((element) => getComputedStyle(element).rowGap)).toBe('24px');
});

test('F1 opens the HELP CENTRE, Ctrl+/ the keyboard shortcuts, and the start screen footer names F1', async ({ page }) => {
  // ADR-0112: F1 is help, and the footer says so. In Chromium, because a browser may claim F1 for itself before a
  // page's listener sees it — the production build is where that would show.
  await bridge(page);
  await page.goto('/');

  await startScreenListening(page);

  await page.keyboard.press('F1');
  const help = page.getByRole('dialog', { name: 'Help centre' });
  await expect(help).toBeVisible();
  // THE START SCREEN'S ARTICLES FIRST, then every article: the list is the bundled articles, not an empty shell.
  await expect(help.getByRole('heading', { name: 'Suggested for you' })).toBeVisible();
  await expect(help.locator('.m-help__item').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);

  await page.keyboard.press('Control+Slash');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const table = dialog.getByRole('table');
  await expect(table.getByRole('row').filter({ hasText: 'Open PDF…' })).toContainText('Ctrl+O');
  await expect(table.getByRole('row').filter({ hasText: 'Keyboard shortcuts' })).toContainText('Ctrl+/');
  await expect(table.getByRole('row').filter({ hasText: 'Help centre' })).toContainText('F1');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('KEYBOARD SHORTCUTS: the changes end under their header, each key is its own chip, and the prompt is one line', async ({ page }) => {
  // THE GALLERY'S READING, 2026-10-03, at the minimum window: `.m-shortcuts td` outranked the actions' own class, so the
  // buttons sat at the cell's start under a header at its end; two keys were two words a gap apart, "Ctrl+W Ctrl+F4",
  // which reads as one chord; and the waiting prompt wrapped "cancel" onto a line of its own.
  await page.setViewportSize({ width: 760, height: 560 });
  await bridge(page);
  await page.goto('/');
  await startScreenListening(page);
  // THE EDITING LIST is Settings' Keyboard page since ADR-0191; Help's is read-only, which `the keyboard shortcuts list`
  // case above holds.
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keyboard' }).click();

  // THE PROMPT FIRST, then a key for it: a changed row gains *Reset*, which widens the column of changes, and only then
  // does a row with two buttons have room to sit at the start. With every row alike the column hugs them, start and end
  // coincide, and the alignment below holds under the old rule too — measured, so the order is the control.
  await dialog.getByRole('row').filter({ hasText: 'Open PDF…' }).getByRole('button', { name: 'Change', exact: true }).click();
  const prompt = dialog.locator('.m-shortcuts__capture');
  await expect(prompt).toBeFocused();
  const lines = await prompt.evaluate((element) => {
    const style = getComputedStyle(element);
    const inner = element.getBoundingClientRect().height - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
    return inner / Number.parseFloat(style.lineHeight === 'normal' ? String(Number.parseFloat(style.fontSize) * 1.2) : style.lineHeight);
  });
  expect(lines, 'the prompt is drawn on one line').toBeLessThan(1.5);
  await page.keyboard.press('Control+Shift+9');
  const openPdf = dialog.getByRole('row').filter({ hasText: 'Open PDF…' });
  await expect(openPdf.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();

  const closeTab = dialog.getByRole('row').filter({ hasText: 'Close tab' });
  const ends = await closeTab.evaluate((row) => {
    const cell = row.querySelector<HTMLElement>('.m-shortcuts__actions');
    const buttons = cell?.querySelectorAll('button') ?? [];
    const last = buttons[buttons.length - 1];
    if (cell === null || last === undefined) return null;
    const style = getComputedStyle(cell);
    return { content: cell.getBoundingClientRect().right - Number.parseFloat(style.paddingRight), button: last.getBoundingClientRect().right };
  });
  expect(ends, 'the row has an actions cell with a button').not.toBeNull();
  expect(Math.abs((ends?.content ?? 0) - (ends?.button ?? Number.POSITIVE_INFINITY))).toBeLessThanOrEqual(1);

  // A COMMAND WITH TWO KEYS, whichever it is in this build: the case is about two keys side by side, not a command.
  const twoKeys = dialog.getByRole('row').filter({ has: page.locator('kbd + kbd') }).first();
  const keys = twoKeys.locator('kbd');
  expect(await keys.count(), 'some command shows two keys').toBeGreaterThanOrEqual(2);
  for (const key of await keys.all()) {
    expect(await key.evaluate((element) => getComputedStyle(element).borderTopStyle)).not.toBe('none');
  }
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

test('an existing REDACT mark is drawn as PENDING over the region it covers, labelled, and a square beside it is not', async ({
  page,
}) => {
  // FEATURES row 131's owed half. Measured 2026-09-15 in this build: PDF.js paints MuPDF's Redact appearance as a thin
  // outline and nothing else, so the content a burn-in will remove stayed fully visible. The mark is chrome the
  // renderer draws — §10.2's overlay-on-page context — in `--redact-mark`, and since the owner's item N1 it must not
  // look like the black box an APPLIED redaction is: hatched, not filled, and labelled *Marked for redaction*.
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

  const preview = page.locator('[data-annotation-layer="0"] [data-annotation-kind="redact"]');
  await expect(preview).toHaveCount(1);
  // THE CONTROL: a square is drawn by the page raster from its own appearance, so the layer draws nothing for it. A
  // layer that drew every kind would pass everything above and paint a mark over every square a person drew.
  await expect(page.locator('[data-annotation-kind="square"]')).toHaveCount(0);

  // NOT THE BURN-IN'S LOOK, resolved in the production build: the edge is the token's black, the inside is NOT filled
  // (an applied redaction is a black box), and the hatching drawn instead is the token's black at 45%, so the words
  // under it can still be checked.
  const mark = preview.locator('.m-redact-mark');
  const look = await mark.evaluate((node) => {
    const style = getComputedStyle(node);
    return { fill: style.backgroundColor, hatch: style.backgroundImage, edge: style.borderTopColor };
  });
  expect(look.fill).toBe('rgba(0, 0, 0, 0)');
  expect(look.hatch).toContain('repeating-linear-gradient');
  expect(look.hatch).toContain('color(srgb 0 0 0 / 0.45)');
  expect(look.edge).toBe('rgb(0, 0, 0)');

  // THE LABEL, on the mark (it fits: 200 × 100 points), in an ink solved against its chip at the text floor.
  const label = preview.locator('[data-annotation-label]');
  await expect(label).toHaveText('Marked for redaction');
  await expect(label).toHaveAttribute('data-place', 'inside');
  const ink = await label.evaluate((node) => {
    const style = getComputedStyle(node);
    return { colour: style.color, chip: style.backgroundColor };
  });
  expect(ink.chip).toBe('rgb(0, 0, 0)');
  const [colour, chip] = [channels(ink.colour), channels(ink.chip)];
  expect(colour, `the label's ink ${ink.colour} did not parse — was it solved at all?`).not.toBeNull();
  expect(contrast(colour ?? [0, 0, 0], chip ?? [0, 0, 0])).toBeGreaterThanOrEqual(textContrastFloor('light'));
  // AND THE INK IS THE SOLVED ONE, not an inherited colour that happens to clear the floor: this bridge's text colour
  // is light, so on a black chip an unsolved label passes the line above too (measured, 3 October, with the solve
  // pointed at another property). The layer carries the answer inline and the label draws in it.
  const solved = await preview.evaluate((node) => {
    const layer = node.closest<HTMLElement>('[data-annotation-layer]');
    return layer === null ? '' : layer.style.getPropertyValue('color');
  });
  expect(solved, 'the layer carries no solved colour').not.toBe('');
  expect(channels(solved)).toStrictEqual(colour);

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

test('the SIGNATURES dialog keeps a 256-character unbroken name inside itself, and Close in view, at the narrowest window', async ({
  page,
}) => {
  // F row 14 lets a signature whose strings are past 256 characters be READ, each shortened by the reader to 256 and an
  // ellipsis; before it, such a document failed the read and the dialog never opened. Measured 2026-10-03 in Chromium
  // 151: one unbroken signer name then ran past the dialog's edge, cut off, and its body scrolled sideways at 760, 1280
  // and 1920 in every look.
  await page.setViewportSize({ width: 760, height: 560 });
  const bytes = await onePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000d9');
  const unbroken = `${'R'.repeat(255)}…`;
  const words = `${'Approved for release by the regional board '.repeat(6).slice(0, 255)}…`;
  const shown = {
    notBefore: '2026-01-01T00:00:00Z',
    notAfter: '2027-01-01T00:00:00Z',
    coversDocument: true,
    coversWholeFile: true,
  };
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'signed.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    // TWO SIGNATURES, long enough together to be taller than the window: what put Close below the fold.
    signatures: {
      signatures: [
        { ...shown, signer: unbroken, organisation: words, reason: unbroken, location: words },
        { ...shown, signer: 'Ada Lovelace', organisation: '', reason: 'Approved', location: 'London' },
      ],
      unreadable: false,
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Check signatures');
  await page.getByRole('option', { name: 'Check signatures' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Signatures' });
  // THE BODY IS LOADED when the signer's line is there; an empty frame measures as fitting.
  const signer = dialog.locator('[data-signature] .m-dialog-section__title').first();
  await expect(signer).toContainText('RRRR');
  // CLOSE IS IN THE WINDOW, and the list is what scrolls — CONTROL: the list is taller than its region, or a dialog
  // short enough to fit would pass this without the layout doing anything.
  const close = dialog.locator('.m-dialog-footer').getByRole('button', { name: 'Close', exact: true });
  const closeBox = await close.boundingBox();
  expect(closeBox === null ? Infinity : closeBox.y + closeBox.height).toBeLessThanOrEqual(560);
  expect(
    await dialog.locator('.m-dialog-scroll').evaluate((scroll) => scroll.scrollHeight - scroll.clientHeight),
  ).toBeGreaterThan(100);
  const measured = await dialog.evaluate((node) => {
    // THE SCROLL PART'S OWN OVERFLOW, which is what would scroll sideways: the body is `overflow: visible` beside a
    // `DialogScroll`, and its scroll width counts the part's negative inline margin. Not the paragraphs: a paragraph's
    // box stays at its parent's width while its text runs past it, so measuring them reads 0 with the defect present
    // (measured, the same day).
    const scroll = node.querySelector('.m-dialog-scroll');
    return {
      sideways: scroll === null ? null : scroll.scrollWidth - scroll.clientWidth,
      // THE WHOLE NAME IS SHOWN, wrapped rather than cut: a fix that clipped it would also stop the overflow.
      signerText: node.querySelector('[data-signature] .m-dialog-section__title')?.textContent ?? '',
    };
  });
  expect(measured).toStrictEqual({ sideways: 0, signerText: `${unbroken} — ${words}` });
  // AND IT WRAPPED, so the case cannot pass on a window wide enough to hold the name on one line.
  expect((await signer.boundingBox())?.height ?? 0).toBeGreaterThan(40);
});

test('the COMMENTS panel at its default width sets each row on one line, with the remove control beside it', async ({
  page,
}) => {
  // Found in the Stage 9 close's live run (JOURNAL 2026-09-24): at the default width each row's label ran one word to
  // a line and *Remove this annotation* was drawn across it. Measured in Chromium because the defect is layout, which
  // happy-dom does not do.
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await onePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000d4');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'marked.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    annotations: [
      { page: 0, index: 0, kind: 'highlight', rect: { x0: 100, y0: 600, x1: 300, y1: 620 } },
      { page: 0, index: 1, kind: 'square', rect: { x0: 350, y0: 100, x1: 450, y1: 200 } },
      { page: 0, index: 2, kind: 'strikeout', rect: { x0: 100, y0: 400, x1: 300, y1: 420 } },
    ],
    settings: { 'appearance.document-panel': 'comments' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const rows = page.locator('.m-annotations-row');
  await expect(rows).toHaveCount(3);
  // MEASURED ON THE ROW'S JUMP BUTTON, which the build before this fix also has — so the same case run against that
  // build fails on the layout, rather than on a class it never had (which is how its first draft failed).
  for (let at = 0; at < 3; at += 1) {
    const row = rows.nth(at);
    const item = row.locator('.m-annotations-item');
    const jump = await item.boundingBox();
    const remove = await row.getByRole('button', { name: 'Remove this annotation' }).boundingBox();
    // One line of the item's own text, plus its padding and border: what a row with no author and no note is.
    const oneLine = await item.evaluate((node) => {
      const style = getComputedStyle(node);
      const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
      return (
        line +
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom) +
        Number.parseFloat(style.borderTopWidth) +
        Number.parseFloat(style.borderBottomWidth)
      );
    });
    if (jump === null || remove === null) throw new Error(`row ${String(at)} has no jump or no remove control`);
    expect(jump.height, `row ${String(at)}: ${String(jump.height)} px against one line of ${String(oneLine)} px`).toBeLessThanOrEqual(oneLine + 1);
    // AND NOTHING DRAWN OVER IT: the remove control starts where the jump has ended.
    expect(remove.x, `row ${String(at)}`).toBeGreaterThanOrEqual(jump.x + jump.width - 1);
  }
});

// THE ORGANIZE GRID (ADR-0104), in every theme: drawn in place of the reading view, its cards drawn, and clean.
for (const look of LOOKS) {
  test(`${look.name}: the ORGANIZE GRID draws the pages as cards, a ticked one marked, and passes axe`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000e4');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'organize.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      settings: { 'appearance.ribbon-section': 'organize' },
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();

    const grid = page.getByRole('region', { name: 'Pages to organize' });
    await expect(grid).toBeVisible();
    await expect(page.locator('.m-page-list')).toHaveCount(0);
    const card = grid.locator('[data-thumb-page="0"]');
    // DRAWN, not an empty slot: the card's canvas carries the page's pixels at the grid's width.
    await expect(card.locator('canvas')).toHaveJSProperty('width', 110);
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(grid).toContainText('1 selected');

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
  });
}

/** A page covered in lines of text, so any region of it holds ink — a seam anywhere has pixels to disagree about. */
async function inkedPdf(size: readonly [number, number]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([size[0], size[1]]);
  for (let y = size[1] - 20; y > 10; y -= 11) {
    page.drawText('Tenant shall pay the Base Rent monthly in advance; a seam must not show. '.repeat(Math.ceil(size[0] / 330)), {
      x: 4,
      y,
      size: 9,
      font,
    });
  }
  page.drawLine({ start: { x: 0, y: 0 }, end: { x: size[0], y: size[1] }, thickness: 1.5 });
  return document.save();
}

/** Opens `bytes` with `settings`, and waits until the first page's slot has something drawn in it. */
async function openAt(page: Page, bytes: Uint8Array, settings: Record<string, unknown>): Promise<void> {
  const docId = asDocId('00000000-0000-4000-8000-0000000000e6');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'sheet.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
}

// E1's TILES (BUILD-PROMPT.md:533): above the threshold a page is drawn in pieces, and the memory follows the WINDOW.
// A canvas's backing store is width × height × 4 bytes whatever it holds, so the canvases' pixel count is the bound.
test('above the tile threshold a page is drawn in TILES, whose pixels follow the window and not the sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // A0, 841 × 1189 mm: at 400% on a display at 1× a whole-page canvas would be 9,536 × 13,480 — 128 million pixels.
  await openAt(page, await inkedPdf([2384, 3370]), { 'viewing.starting-zoom': '400pct' });
  const tiles = page.locator('[data-page-tiles="0"] canvas.m-page-tile');
  await expect(tiles.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('canvas[data-page-canvas="0"]')).toHaveCount(0);

  const drawn = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.m-page-list canvas')];
    const slot = document.querySelector('[data-page-tiles="0"]')?.parentElement?.getBoundingClientRect();
    return {
      pixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
      tiles: canvases.filter((canvas) => canvas.classList.contains('m-page-tile')).length,
      wholePage: slot === undefined ? 0 : slot.width * slot.height * window.devicePixelRatio ** 2,
    };
  });
  // THE BOUND: a 1280 × 800 window touches at most 4 × 3 cells of 512, plus a margin of one each side — 6 × 5 tiles.
  expect(drawn.tiles).toBeGreaterThan(0);
  expect(drawn.pixels, `${String(drawn.tiles)} tiles hold ${String(drawn.pixels)} px`).toBeLessThanOrEqual(6 * 5 * 512 * 512);
  // THE CONTROL FOR THE BOUND: the sheet itself is over a hundred million pixels, so the figure above is the window's.
  expect(drawn.wholePage).toBeGreaterThan(100_000_000);
});

test('CONTROL: at or below the threshold the same sheet is ONE whole-page canvas, as before tiles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAt(page, await inkedPdf([2384, 3370]), { 'viewing.starting-zoom': '100pct' });
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('canvas.m-page-tile')).toHaveCount(0);
});

// PAGE SHARPNESS (E1's explicit renderQuality) from the stored setting, through the real application: the canvas holds
// twice the pixels its box shows at 2×, and exactly the box's at Exact — the default.
for (const [quality, factor] of [
  ['double', 2],
  ['exact', 1],
] as const) {
  test(`PAGE SHARPNESS ${quality} draws ${String(factor)} backing pixel(s) per CSS pixel, at the same size on screen`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openAt(page, await inkedPdf([612, 792]), { 'viewing.starting-zoom': '100pct', 'rendering.quality': quality });
    const canvas = page.locator('canvas[data-page-canvas="0"]');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const measured = await canvas.evaluate((element: HTMLCanvasElement) => ({
      backing: element.width,
      shown: element.getBoundingClientRect().width,
      density: window.devicePixelRatio,
    }));
    // US LETTER at 100% is 612 CSS pixels wide whatever the sharpness — the setting moves pixels, never the page.
    expect(Math.round(measured.shown)).toBe(612);
    expect(measured.backing).toBe(Math.ceil(612 * measured.density * factor));
  });
}

// PAGE NUMBERS ON PAGES from the stored setting, in every look: the badge sits at the page's foot, centred and inside
// it. Its colours are `--text` on `--surface`, the pair `check:tokencontrast` holds in every theme — axe is not asked,
// because the badge is aria-hidden and a contrast rule that skips hidden text would pass it having read nothing.
for (const look of LOOKS) {
  test(`${look.name}: PAGE NUMBERS ON PAGES sit at each page’s foot, centred and inside it`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await inkedPdf([612, 792]);
    const docId = asDocId('00000000-0000-4000-8000-0000000000e7');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'badges.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      settings: { 'viewing.page-badges': true },
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const badge = page.locator('[data-page-badge="0"]');
    await expect(badge).toHaveText('1');
    const placed = await badge.evaluate((element) => {
      const slot = element.parentElement?.getBoundingClientRect();
      const own = element.getBoundingClientRect();
      return slot === undefined
        ? null
        : { inside: own.left >= slot.left && own.right <= slot.right && own.bottom <= slot.bottom, fromFoot: slot.bottom - own.bottom, centre: own.left + own.width / 2 - (slot.left + slot.width / 2) };
    });
    expect(placed?.inside).toBe(true);
    expect(placed?.fromFoot).toBeLessThanOrEqual(12);
    expect(Math.abs(placed?.centre ?? 99)).toBeLessThanOrEqual(1);
  });
}

// PAGE LAYOUT from the stored setting, in Chromium's own layout: FACING pairs pages 1–2 on one row with page 3 below
// the first, and SINGLE PAGE shows one page, which a wheel past its end turns — the grid and the hidden slots are the
// stylesheet's, which happy-dom does not lay out.
test('FACING PAGES pair side by side, and SINGLE PAGE shows one page that a wheel turns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePagePdf();
  await openAt(page, bytes, { 'viewing.page-layout': 'facing', 'viewing.starting-zoom': '50pct' });
  const slot = (n: number) => page.locator(`.m-page-slot[data-page="${String(n)}"]`);
  // PAGE 2 DRAWN, which a single column at 50% also draws — so the control (the grid removed) fails on the geometry
  // below, not on a page that was never reached.
  await expect(slot(1).locator('canvas.m-page')).toBeVisible({ timeout: 20_000 });
  const boxes = await Promise.all([0, 1, 2].map(async (n) => slot(n).boundingBox()));
  const [first, second, third] = boxes;
  expect(Math.abs((first?.y ?? 0) - (second?.y ?? 99))).toBeLessThanOrEqual(1);
  expect(second?.x ?? 0).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0));
  expect(third?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0));
  expect(Math.abs((third?.x ?? 0) - (first?.x ?? 99))).toBeLessThanOrEqual(1);

  const single = await page.context().newPage();
  await single.setViewportSize({ width: 1280, height: 800 });
  await openAt(single, bytes, { 'viewing.page-layout': 'single', 'viewing.starting-zoom': '50pct' });
  const singleSlot = (n: number) => single.locator(`.m-page-slot[data-page="${String(n)}"]`);
  await expect(singleSlot(0).locator('canvas.m-page')).toBeVisible({ timeout: 20_000 });
  await expect(singleSlot(1)).toBeHidden();
  await expect(singleSlot(2)).toBeHidden();
  const list = single.locator('.m-page-list').first();
  const at = await list.boundingBox();
  await single.mouse.move((at?.x ?? 0) + (at?.width ?? 0) / 2, (at?.y ?? 0) + (at?.height ?? 0) / 2);
  await single.mouse.wheel(0, 300);
  await expect(singleSlot(1)).toBeVisible();
  await expect(singleSlot(0)).toBeHidden();
});

// AUTOSCROLL through the shell: Ctrl+Shift+H — the command's own chord, projected from the registry — starts the pages
// moving at the stored speed, and Esc stops them. CONTROL: the same wait with nothing pressed moves nothing.
test('AUTOSCROLL: its chord moves the pages at the chosen speed, and Esc stops them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAt(page, await threePagePdf(), { 'viewing.autoscroll-speed': 'fast' });
  const list = page.locator('.m-page-list').first();
  await expect(page.locator('[data-page="0"] canvas.m-page')).toBeVisible({ timeout: 20_000 });
  const top = async (): Promise<number> => list.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(1000);
  expect(await top()).toBe(0);

  await page.keyboard.press('Control+Shift+H');
  await page.waitForTimeout(1000);
  const moved = await top();
  // FAST is 120 px a second; a second of it, allowing for the frames either side of the wait.
  expect(moved).toBeGreaterThan(60);
  expect(moved).toBeLessThan(200);

  await page.keyboard.press('Escape');
  const stopped = await top();
  await page.waitForTimeout(600);
  expect(await top()).toBe(stopped);
});

// A TILE IS THE PAGE, CUT — never a different drawing of it. The same page at 300% drawn whole (threshold 300%) and in
// tiles (threshold 200%), and the pixels either side of a seam between two tiles compared with the whole page's.
test('a TILE SEAM draws exactly what the whole page draws there: no line, no shift, no resampling', async ({ browser }) => {
  const bytes = await inkedPdf([612, 792]);
  const readTiled = async (): Promise<{ seams: { x: number; y: number }[]; pixels: number[][] }> => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await openAt(page, bytes, { 'viewing.starting-zoom': '300pct', 'rendering.tile-threshold': 'above-200' });
    await expect(page.locator('[data-page-tiles="0"] canvas.m-page-tile').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => {
      const at = (canvas: HTMLCanvasElement, x: number, y: number): number[] => [
        ...(canvas.getContext('2d')?.getImageData(x, y, 1, 1).data ?? []),
      ];
      // THE SEAMS OF THE TILED DRAWING, chosen from tiles actually drawn: a vertical boundary between two drawn
      // neighbours, sampled 8 px either side, down 40 rows of its row of cells.
      const drawnTiles = [...document.querySelectorAll<HTMLCanvasElement>('[data-page-tiles="0"] canvas.m-page-tile')].filter(
        (tile) => tile.style.visibility !== 'hidden',
      );
      const byKey = new Map(drawnTiles.map((tile) => [tile.dataset['tile'] ?? '', tile]));
      {
        const pair = drawnTiles.find((tile) => {
          const [c, r] = (tile.dataset['tile'] ?? '').split(',').map(Number);
          return byKey.has(`${String((c ?? 0) + 1)},${String(r ?? 0)}`);
        });
        if (pair === undefined) return { seams: [], pixels: [] };
        const [c = 0, r = 0] = (pair.dataset['tile'] ?? '').split(',').map(Number);
        const right = byKey.get(`${String(c + 1)},${String(r)}`);
        if (right === undefined) return { seams: [], pixels: [] };
        const seams: { x: number; y: number }[] = [];
        const pixels: number[][] = [];
        for (let dy = 0; dy < 40; dy += 1) {
          for (let dx = -8; dx < 8; dx += 1) {
            const x = (c + 1) * 512 + dx;
            const y = r * 512 + 100 + dy;
            seams.push({ x, y });
            pixels.push(dx < 0 ? at(pair, 512 + dx, 100 + dy) : at(right, dx, 100 + dy));
          }
        }
        return { seams, pixels };
      }
    });
    await context.close();
    return result;
  };
  const tiled = await readTiled();
  expect(tiled.seams.length, 'two drawn tiles side by side were found').toBeGreaterThan(0);

  // THE WHOLE PAGE, read at the same device pixels.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const whole = await context.newPage();
  await openAt(whole, bytes, { 'viewing.starting-zoom': '300pct', 'rendering.tile-threshold': 'above-300' });
  await expect(whole.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await whole.waitForTimeout(1500);
  const reference = await whole.evaluate((points) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-page-canvas="0"]');
    const context2d = canvas?.getContext('2d');
    return points.map(({ x, y }) => [...(context2d?.getImageData(x, y, 1, 1).data ?? [])]);
  }, tiled.seams);
  await context.close();

  // INK AT THE SEAM, or the comparison below is white against white and proves nothing.
  expect(reference.some((pixel) => (pixel[0] ?? 255) < 160), 'the sampled region holds ink').toBe(true);
  const worst = Math.max(
    ...reference.map((pixel, at) => Math.max(...pixel.map((channel, index) => Math.abs(channel - (tiled.pixels[at]?.[index] ?? -999))))),
  );
  expect(worst, 'the largest channel difference between a tile and the whole page at the same pixel').toBeLessThanOrEqual(0);
});

// THE LOUPE DRAWS A SQUARE ROUND THE POINTER, not the whole page at twice the zoom — and the square must lie under
// the window, which only the running layout can show: the arithmetic places a bitmap, and a wrong sign shows paper.
test('the LOUPE at 400% draws a square three windows wide, lying under its window, with the page’s ink in it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAt(page, await inkedPdf([612, 792]), { 'viewing.starting-zoom': '400pct', 'viewing.loupe': true });
  const slot = page.locator('[data-page-tiles="0"]');
  await expect(slot.locator('canvas.m-page-tile').first()).toBeVisible({ timeout: 20_000 });
  const box = await slot.boundingBox();
  if (box === null) throw new Error('the first page has no box');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.move(box.x + 330, box.y + 320);
  const canvas = page.locator('.m-loupe-canvas');
  await expect(canvas).toHaveCSS('width', '540px', { timeout: 10_000 });

  const seen = await page.evaluate(() => {
    const window = document.querySelector('.m-loupe')?.getBoundingClientRect();
    const drawn = document.querySelector<HTMLCanvasElement>('.m-loupe-canvas');
    const square = drawn?.getBoundingClientRect();
    if (window === undefined || drawn === null || square === undefined) return null;
    // THE WINDOW'S PIXELS in the square's bitmap, and whether any of them is ink.
    const ratio = drawn.width / square.width;
    const data = drawn
      .getContext('2d')
      ?.getImageData(
        Math.round((window.left - square.left) * ratio),
        Math.round((window.top - square.top) * ratio),
        Math.round(window.width * ratio),
        Math.round(window.height * ratio),
      ).data;
    let ink = 0;
    for (let at = 0; data !== undefined && at < data.length; at += 4) if ((data[at] ?? 255) < 128 && (data[at + 3] ?? 0) > 0) ink += 1;
    return {
      backing: drawn.width * drawn.height,
      inside:
        square.left <= window.left + 0.5 &&
        square.top <= window.top + 0.5 &&
        square.right >= window.right - 0.5 &&
        square.bottom >= window.bottom - 0.5,
      ink,
    };
  });
  expect(seen).not.toBeNull();
  expect(seen?.inside, 'the square lies under the whole window').toBe(true);
  expect(seen?.ink, 'the window shows the page’s ink').toBeGreaterThan(20);
  // THE BOUND: 540 × 540 at a density of 1 — where the whole A4 page at 800% would be 4,896 × 6,336.
  expect(seen?.backing).toBeLessThanOrEqual(540 * 540);
});

/** The one landscape page in the Organize grid's fixture. */
const LANDSCAPE = 1;

// THE ORGANIZE GRID SPANS THE PAGE AREA (v5-09): measured 2026-09-28, it was a row flexbox's item with no grow, as wide
// as its content — 631 of 1215 px at 1920, four columns and an empty half.
test('the ORGANIZE GRID spans the whole page area at 1920 × 1080, as many columns as fit', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  // NOT `document`: that name is the page's inside `evaluate` below, and shadowing it typed every call there as pdf-lib's.
  const pdf = await PDFDocument.create();
  // PAGE 2 IS LANDSCAPE, and it is the case's control for the row's alignment: a shorter card that must still share
  // its row's top. With every page portrait, centring and top-alignment place the cards identically.
  for (let at = 0; at < 24; at += 1) pdf.addPage(at === LANDSCAPE ? [792, 612] : [612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e5');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'lease.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings: { 'appearance.ribbon-section': 'organize' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const grid = page.getByRole('region', { name: 'Pages to organize' });
  await expect(grid.locator('[data-thumb-page="23"]')).toBeAttached();
  // THE LANDSCAPE CARD DRAWN, so it is genuinely shorter when the row is read — undrawn, it is a portrait slot.
  await expect(grid.locator(`[data-thumb-page="${String(LANDSCAPE)}"] canvas[data-drawn="true"]`)).toBeAttached();

  // SETTLED WITH THE ROW DRAWN FOR ITS WIDTH: the strip gaining a scrollbar re-measures the grid, which redraws the
  // cards (`stale` meanwhile), so one card drawn says nothing about the row being read.
  const measured = await settled(page, () => page.evaluate(() => {
    const area = document.querySelector('.m-canvas-area')?.getBoundingClientRect();
    const region = document.querySelector('.m-page-grid')?.getBoundingClientRect();
    const all = [...document.querySelectorAll('.m-page-grid [data-thumb-page]')];
    const strip = document.querySelector('.m-page-grid .m-thumbnails');
    const columns = strip === null ? '' : getComputedStyle(strip).gridTemplateColumns;
    const count = columns.split(' ').filter((track) => track !== '').length;
    const row = all.slice(0, count);
    // WHAT THE GRID WAS AT THE MOMENT OF READING, for the failure messages.
    const state = {
      tops: row.map((card) => Math.round(card.getBoundingClientRect().top)),
      heights: row.map((card) => Math.round(card.getBoundingClientRect().height)),
      drawn: row.map((card) => card.querySelector('canvas')?.dataset['drawn'] ?? 'none'),
      columns,
    };
    return { area: area?.width ?? 0, region: region?.width ?? 0, count, state };
  }), (now) => now.state.drawn.length > 0 && now.state.drawn.every((drawn) => drawn === 'true'), 'the Organize grid’s first row');
  const detail = JSON.stringify(measured.state);
  expect(measured.area, 'the page area was measured').toBeGreaterThan(1000);
  expect(measured.region, `the grid is ${String(measured.region)} px of a ${String(measured.area)} px page area`).toBeGreaterThanOrEqual(
    measured.area - 2,
  );
  // SIX, v5-09's count at this window with the Medium cards — and more than the four a content-wide grid laid. Read as
  // the columns the browser resolved, not from the cards' tops: a card standing out of its row made that reading 1.
  expect(measured.count, detail).toBeGreaterThanOrEqual(6);
  // THE ROW SHARES ONE TOP, the landscape card included. `align-items: center` (the strip's column-layout rule) put a
  // shorter card lower, and an undrawn card beside a drawn one — 142 px against 168, measured 2026-09-29 — the same.
  expect(new Set(measured.state.tops).size, detail).toBe(1);
  // AND EVERY PORTRAIT CARD ONE HEIGHT, drawn or not, to within ONE pixel: a drawn canvas is `Math.ceil` of the page's
  // height (`renderPage.ts`), an undrawn one the exact ratio. This bites where some are still undrawn when read, which a
  // loaded run produced 5 times in 8.
  const portrait = measured.state.heights.filter((_height, at) => at !== LANDSCAPE);
  expect(Math.max(...portrait) - Math.min(...portrait), detail).toBeLessThanOrEqual(1);
  // CONTROL: the landscape card IS shorter, so the shared top above was a fact about alignment and not about equal cards.
  expect(measured.state.heights[LANDSCAPE] ?? 0, detail).toBeLessThan(Math.min(...portrait) - 10);
});

// THE GRID'S SUMMARY WRAPS BETWEEN ITEMS AND NO LINE STARTS WITH A DOT. Measured 2026-10-05 at 1280 × 800, where the
// grid is about 575 px wide: the tips were one string with the dot on it, so a wrapped line began "·" and the last tip
// broke between its two words. Read from real layout, since happy-dom lays nothing out: each item's dot is its first
// box, so it shows exactly when the item starts inside the clipping box.
test('the ORGANIZE GRID’s summary wraps between whole tips, and no wrapped line starts with a separator', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 6; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000f2');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'lease.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings: { 'appearance.ribbon-section': 'organize' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-grid__hint').first()).toBeVisible();

  const items = await page.evaluate(() => {
    const clip = document.querySelector('.m-page-grid__summary')?.getBoundingClientRect();
    return [...document.querySelectorAll('.m-page-grid__items > *')].map((item) => {
      const box = item.getBoundingClientRect();
      return {
        text: item.textContent,
        top: Math.round(box.top),
        // THE DOT IS VISIBLE when the item's own box, which begins with it, starts inside the clip.
        dotShown: clip !== undefined && box.left >= clip.left - 0.5,
        boxes: item.getClientRects().length,
      };
    });
  });
  const detail = JSON.stringify(items);
  // THE CASE'S PRECONDITION: the count, four tips, and a wrap at this width, or a line start is only ever the first.
  expect(items.length, detail).toBe(5);
  expect(new Set(items.map((item) => item.top)).size, detail).toBeGreaterThanOrEqual(2);
  for (const [at, item] of items.entries()) {
    const startsALine = at === 0 || item.top > (items[at - 1]?.top ?? 0);
    // A LINE START SHOWS NO DOT, and every other item shows one between it and the item before.
    expect(item.dotShown, `${item.text} ${startsALine ? 'starts' : 'continues'} a line: ${detail}`).toBe(!startsALine);
    // AND EACH TIP WHOLE: one box per item. Flex wraps between items, and every tip fits a line at this width; one
    // string, as the tips were, broke "Enter opens" across two lines here.
    expect(item.boxes, detail).toBe(1);
  }
});

// ORGANIZE'S FULL PAGE (the owner's review of 0.1.9.0): ONE page to a row at the grid's whole width, read top to
// bottom as the Home view reads, and the grid's gestures still act on it. Only real layout can show this — the width
// is read from the laid-out grid, and happy-dom lays nothing out. At 1280 × 800 and at 1920 × 1080, because the
// defect was two pages side by side, which only a strip wider than two height-fitted pages draws.
for (const size of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test(`ORGANIZE’S FULL PAGE shows ONE page to a row at the grid’s width at ${String(size.width)} × ${String(size.height)}, scrolling down`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const pdf = await PDFDocument.create();
    for (let at = 0; at < 6; at += 1) pdf.addPage(at === LANDSCAPE ? [792, 612] : [612, 792]);
    const bytes = await pdf.save();
    const docId = asDocId('00000000-0000-4000-8000-0000000000eb');
    const sent: unknown[] = [];
    await bridge(
      page,
      {
        opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'lease.pdf' }],
        documentBytes: new Map([[docId, bytes]]),
        settings: { 'appearance.ribbon-section': 'organize' },
      },
      (channel, params) => {
        if (channel === 'document.execute') sent.push(params);
      },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const grid = page.getByRole('region', { name: 'Pages to organize' });
    const firstCanvas = grid.locator('[data-thumb-page="0"] canvas');
    // CONTROL FOR THE WAIT BELOW: this case once waited for the first canvas to be drawn, and that is ALREADY TRUE in
    // thumbnail view, before Full page is chosen — so it could pass at once and the reading was of thumbnails (CI,
    // ubuntu-latest, 6b7a6bd9: first card 143 px). Asserted here so the old wait is shown to mean nothing about Full page.
    await expect(firstCanvas).toHaveAttribute('data-drawn', 'true');
    await expect(grid).toHaveAttribute('data-page-view', 'thumbnail');
    await grid.getByRole('button', { name: 'Full page' }).click();

    const read = (): Promise<{
      view: string | null;
      drawn: string | null;
      strip: { left: number; right: number; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
      cards: { left: number; top: number; width: number }[];
      canvas: number;
    }> =>
      page.evaluate(() => {
        const strip = document.querySelector<HTMLElement>('.m-page-grid .m-thumbnails');
        const box = strip?.getBoundingClientRect();
        const cards = [...document.querySelectorAll('.m-page-grid [data-thumb-page]')].map((card) => {
          const r = card.getBoundingClientRect();
          return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
        });
        return {
          view: document.querySelector('.m-page-grid')?.getAttribute('data-page-view') ?? null,
          drawn: document.querySelector('.m-page-grid [data-thumb-page="0"] canvas')?.getAttribute('data-drawn') ?? null,
          strip: {
            left: box?.left ?? 0,
            right: box?.right ?? 0,
            scrollWidth: strip?.scrollWidth ?? 0,
            clientWidth: strip?.clientWidth ?? 0,
            scrollHeight: strip?.scrollHeight ?? 0,
            clientHeight: strip?.clientHeight ?? 0,
          },
          cards,
          canvas: document.querySelector('.m-page-grid [data-thumb-page="0"] canvas')?.getBoundingClientRect().width ?? 0,
        };
      });
    // WHAT THE READING MEANS: the grid in Full page, its first page drawn FOR THE WIDTH NOW ASKED (`data-drawn` reads
    // `stale` while a drawing made for the thumbnail width is still shown), and nothing moving across two frames — the
    // strip's scrollbar arriving re-measures the width once more.
    const measured = await settled(page, read, (now) => now.view === 'full-page' && now.drawn === 'true', 'Organize’s Full page');
    const detail = JSON.stringify(measured);
    // ONE TO A ROW: every card's top below the one before it, and every card in the same column.
    for (let at = 1; at < measured.cards.length; at += 1) {
      expect(measured.cards[at]?.top ?? 0, detail).toBeGreaterThan(measured.cards[at - 1]?.top ?? Infinity);
      expect(measured.cards[at]?.left, detail).toBe(measured.cards[0]?.left);
    }
    // AT THE GRID'S WIDTH: the page takes most of the strip, and nothing scrolls sideways.
    expect(measured.canvas, detail).toBeGreaterThan(measured.strip.clientWidth * 0.85);
    expect(measured.strip.scrollWidth, detail).toBeLessThanOrEqual(measured.strip.clientWidth);
    // SCROLLING DOWN: six pages at that width are taller than the strip.
    expect(measured.strip.scrollHeight, detail).toBeGreaterThan(measured.strip.clientHeight * 2);

    // THE GRID'S GESTURES ACT ON IT: a click ticks a page, and Delete asks for that page (CR-COR-06), then sends it.
    await grid.getByRole('button', { name: 'Page 3', exact: true }).click();
    await expect(grid.getByRole('button', { name: 'Page 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Delete');
    const asked = page.getByRole('dialog', { name: 'Delete pages' });
    await expect(asked.getByRole('textbox')).toHaveValue('3');
    expect(JSON.stringify(sent)).not.toContain('"deletePages"');
    await asked.getByRole('button', { name: 'Delete pages' }).click();
    await expect.poll(() => JSON.stringify(sent)).toContain('"deletePages"');
    expect(JSON.stringify(sent)).toContain('[2]');
  });
}

// ONE CURRENT PAGE FOR THE WHOLE APP (the owner's item 13a). Organize's grid wrote no current page: Full page's scroll
// left the status bar on page 1, and its Next counted from that page and moved nothing on screen. Measured before the
// fix in this harness: scrolled two and a half pages, the page box said 1; Next said 2 and the grid stayed where it was.
test('ORGANIZE shares ONE current page with the status bar and Home: Full page’s scroll, Next, a click', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 8; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000ec');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'pages.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings: { 'appearance.ribbon-section': 'organize', 'appearance.organize-grid-size': 'full-page' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const grid = page.getByRole('region', { name: 'Pages to organize' });
  await expect(grid).toHaveAttribute('data-page-view', 'full-page');
  await expect(grid.locator('[data-thumb-page="0"] canvas')).toHaveAttribute('data-drawn', 'true');
  const box = page.getByRole('textbox', { name: 'Go to page' });
  const strip = grid.locator('.m-thumbnails');
  /** Where card `index`'s top sits against the top of the strip's view, in pixels. */
  const offset = (index: number): Promise<number> =>
    page.evaluate((at) => {
      const view = document.querySelector('.m-page-grid .m-thumbnails')?.getBoundingClientRect();
      const card = document.querySelector(`.m-page-grid [data-thumb-page="${String(at)}"]`)?.getBoundingClientRect();
      return view === undefined || card === undefined ? Number.NaN : Math.round(card.top - view.top);
    }, index);

  // SCROLLED TO PAGE 3: the box follows, as Home's does.
  await strip.evaluate((element) => {
    const card = element.querySelector<HTMLElement>('[data-thumb-page="2"]');
    if (card !== null) element.scrollTop += card.getBoundingClientRect().top - element.getBoundingClientRect().top;
  });
  await expect(box).toHaveValue('3');
  // A ONE-PAGE SELECTION GOES WITH IT: the card the box names is the card a page command acts on.
  await expect(grid.getByRole('button', { name: 'Page 3', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // NEXT counts from the page on screen and moves the grid, its card's top at the top of the view: no strip of page 3.
  await page.getByRole('status', { name: 'Document status' }).getByRole('button', { name: 'Next page' }).click();
  await expect(box).toHaveValue('4');
  await expect.poll(() => offset(3)).toBe(0);
  await expect(grid.getByRole('button', { name: 'Page 4', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(grid.getByRole('button', { name: 'Page 3', exact: true })).toHaveAttribute('aria-pressed', 'false');

  // IN THUMBNAIL VIEW a click names the page.
  await grid.getByRole('button', { name: 'Thumbnail' }).click();
  await grid.getByRole('button', { name: 'Page 6', exact: true }).click();
  await expect(box).toHaveValue('6');

  // AND HOME OPENS THERE: one current page, not one per view.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('canvas.m-page').first()).toBeVisible();
  await expect(box).toHaveValue('6');
});

// ORGANIZE'S FULL PAGE IS SHOWN FINISHED (the owner's item 13h: "flickers and builds up in steps when switching and
// scrolling"). Two mechanisms, each measured frame by frame here before the fix with reads slowed to 150 ms:
// - choosing Full page widened every card at once while its canvas held the thumbnail, so the first card was the small
//   drawing stretched (`stale`) for about 100 ms, then sharp;
// - the strip's observer had no root, so its margin applied to the window while the strip's own box clipped every
//   card outside its view: the next page, 180 px below, was never drawn ahead and came in blank on a scroll.
// THE SAMPLER READS WHAT IS ON SHOW, by computed visibility rather than by the grid's own markup, so it reads the old
// single strip and the prepared one alike — the control is the code before the fix, which fails both assertions.
test('ORGANIZE’S FULL PAGE is shown finished: no stale or blank card on show as it is chosen, the next page drawn ahead', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 8; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000ee');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'pages.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings: { 'appearance.ribbon-section': 'organize' },
    delays: { 'document.readRange': 150 },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const grid = page.getByRole('region', { name: 'Pages to organize' });
  // EVERY THUMBNAIL DRAWN before Full page is chosen, since the sampler judges every card on show from its first frame
  // and all eight are on show at this size. Waiting on page 0 alone let the other seven still be arriving, each range
  // 150 ms late, and a frame of thumbnails still loading failed the case before the switch it is about (ubuntu,
  // 9a6e4c81: eight cards 110 px wide, only page 0 drawn).
  await expect(grid.locator('[data-thumb-page] canvas[data-drawn="true"]')).toHaveCount(8);

  /** Starts recording, every frame, each card on show in its strip's view: its page, its drawn state, its width. */
  const record = (): Promise<void> =>
    page.evaluate(() => {
      const frames: { page: string; drawn: string; width: number }[][] = [];
      (window as unknown as { frames13h: typeof frames }).frames13h = frames;
      const tick = (): void => {
        const region = document.querySelector('[aria-label="Pages to organize"]');
        const cards = [...(region?.querySelectorAll<HTMLElement>('[data-thumb-page]') ?? [])].filter((card) => {
          const strip = card.closest('.m-thumbnails')?.getBoundingClientRect();
          const box = card.getBoundingClientRect();
          return getComputedStyle(card).visibility === 'visible' && strip !== undefined && box.bottom > strip.top && box.top < strip.bottom;
        });
        frames.push(
          cards.map((card) => {
            const canvas = card.querySelector('canvas');
            return {
              page: card.dataset['thumbPage'] ?? '',
              drawn: canvas?.dataset['drawn'] ?? 'none',
              width: Math.round(canvas?.getBoundingClientRect().width ?? 0),
            };
          }),
        );
        if (frames.length < 240) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const recorded = (): Promise<{ page: string; drawn: string; width: number }[][]> =>
    page.evaluate(() => (window as unknown as { frames13h: { page: string; drawn: string; width: number }[][] }).frames13h);

  await record();
  await grid.getByRole('button', { name: 'Full page' }).click();
  await expect(grid).toHaveAttribute('data-page-view', 'full-page');
  await expect.poll(async () => (await recorded()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(240);
  const switching = await recorded();
  const shown = switching.flat();
  // THE SAMPLER SAW BOTH ENDS (its positive control): thumbnails drawn, then a Full page card drawn at the grid's width.
  const thumbnail = shown.find((card) => card.drawn === 'true')?.width ?? Infinity;
  expect(thumbnail, JSON.stringify(switching.slice(0, 3))).toBeLessThan(200);
  expect(shown.some((card) => card.drawn === 'true' && card.width > thumbnail * 3), JSON.stringify(switching.slice(-3))).toBe(true);
  const unfinished = switching.findIndex((frame) => frame.some((card) => card.drawn !== 'true'));
  expect(unfinished, JSON.stringify(switching[unfinished])).toBe(-1);

  // THE NEXT PAGE, below the view, is drawn without a scroll reaching it — and so a wheel scroll down a page and a half,
  // a notch at a time, never brings a blank one in.
  await expect(grid.locator('[data-thumb-page="1"] canvas')).toHaveAttribute('data-drawn', 'true');
  const strip = await grid.locator('.m-thumbnails').boundingBox();
  if (strip === null) throw new Error('the Full page strip has no box');
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
  await record();
  for (let notch = 0; notch < 10; notch += 1) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(50);
  }
  await expect.poll(async () => (await recorded()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(240);
  const scrolling = await recorded();
  expect(scrolling.flat().some((card) => card.page === '2'), JSON.stringify(scrolling.slice(-3))).toBe(true);
  const blank = scrolling.findIndex((frame) => frame.some((card) => card.drawn !== 'true'));
  expect(blank, JSON.stringify(scrolling[blank])).toBe(-1);
});

// NO CARD RUNS INTO THE ONE BELOW IT, in any strip of pages. Measured 2026-10-03 in Organize's Full page at 1280 × 800:
// rows of 613.4 px under cards of 637, because a scroll container whose cards overflow it sizes an `auto` row by its
// card's minimum contribution — so each card ran 24 px into the gap and its page number showed over the next card.
test('NO PAGE CARD RUNS INTO THE ONE BELOW IT: Full page, the thumbnail grid and the Pages strip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 12; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000ed');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'pages.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings: { 'appearance.ribbon-section': 'organize', 'appearance.organize-grid-size': 'full-page' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const grid = page.getByRole('region', { name: 'Pages to organize' });
  await expect(grid.locator('[data-thumb-page="0"] canvas')).toHaveAttribute('data-drawn', 'true');
  /**
   * The most any card in `selector` reaches past the top of a card in the row below it, in pixels; 0 when none does.
   * Rows are told apart by their tops, so a two-column strip compares a card with the cards of the next row only.
   */
  const deepest = (selector: string): Promise<{ overlap: number; cards: number }> =>
    page.evaluate((within) => {
      const boxes = [...document.querySelectorAll(`${within} [data-thumb-page]`)].map((card) => card.getBoundingClientRect());
      const tops = [...new Set(boxes.map((box) => Math.round(box.top)))].sort((a, b) => a - b);
      let overlap = 0;
      for (const box of boxes) {
        const next = tops.find((top) => top > Math.round(box.top));
        if (next !== undefined) overlap = Math.max(overlap, box.bottom - next);
      }
      return { overlap: Math.round(overlap * 10) / 10, cards: boxes.length };
    }, selector);
  const full = await deepest('.m-page-grid');
  expect(full.cards).toBe(12);
  expect(full.overlap, JSON.stringify(full)).toBeLessThanOrEqual(0);
  await grid.getByRole('button', { name: 'Thumbnail' }).click();
  await expect(grid).toHaveAttribute('data-page-view', 'thumbnail');
  expect((await deepest('.m-page-grid')).overlap).toBeLessThanOrEqual(0);
  // THE SIDE STRIP is the same grid with two columns, and Home is where a person meets it.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('canvas.m-page').first()).toBeVisible();
  const strip = await deepest('.m-thumbnails:not(.m-thumbnails--grid)');
  expect(strip.cards).toBe(12);
  expect(strip.overlap, JSON.stringify(strip)).toBeLessThanOrEqual(0);
});

// THE MENU BAR (ADR-0107), in every theme: the window's top row above the title bar, reached from the keyboard by F10,
// walked with the arrows, an open menu marking the current theme and disabling what cannot run — and passing the gate
// with a menu OPEN, which is the state a screen reader meets it in.
for (const look of LOOKS) {
  test(`${look.name}: the MENU BAR opens from the keyboard, marks and disables its items, and passes axe`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bridgeWithDocument(page, { 'appearance.theme': look.theme }, 1);
    await page.emulateMedia({ contrast: look.contrast, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('.m-page-list .m-page').first()).toBeVisible();

    const bar = page.getByRole('menubar', { name: 'Menu bar' });
    const gate = async (scan: AxeBuilder): Promise<void> => {
      const results = await scan.analyze();
      const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
      expect(
        blocking,
        blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
      ).toEqual([]);
    };
    // THE WHOLE WINDOW WITH THE BAR CLOSED, nothing excluded.
    await gate(new AxeBuilder({ page }));
    await expect(bar.getByRole('menuitem')).toHaveText([
      'File',
      'Edit',
      'View',
      'Organize',
      'Comment',
      'Forms',
      'Review',
      'Protect',
      'Tools',
      'Window',
      'Help',
    ]);

    // F10, then Right twice and Down: the keyboard route to View, with no pointer.
    await page.keyboard.press('F10');
    await expect(bar.getByRole('menuitem', { name: 'File' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const view = page.getByRole('menu');
    await expect(view.getByRole('menuitemcheckbox', { name: 'Ribbon layout' })).toBeVisible();
    // THE CURRENT LAYOUT IS MARKED and the others are not — the mark is a state, not decoration.
    await expect(view.getByRole('menuitemcheckbox', { name: 'Ribbon layout' })).toHaveAttribute('aria-checked', 'true');
    await expect(view.getByRole('menuitemcheckbox', { name: 'Focus layout' })).toHaveAttribute('aria-checked', 'false');

    // THE OPEN MENU ITSELF, which is what is new on screen. Not the whole window while a menu is open, and the reason is
    // Base UI's, measured here on 2026-09-26 (1.7.0): an open menu renders a placeholder `<span aria-owns>` where its
    // `Menu.Portal` sits — inside the menubar, in the library's own documented structure — which axe reports as a child
    // a menubar may not have; and the open menu makes the rest of the window inert, so the page list is reported as a
    // scrollable region with nothing focusable. Neither is on screen with the bar closed, which the scan above covers
    // whole.
    await gate(new AxeBuilder({ page }).include('[role="menu"]'));

    // EDIT, with nothing selected and no field focused: Cut is DISABLED rather than hidden.
    await page.keyboard.press('Escape');
    await bar.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Cut' })).toHaveAttribute('aria-disabled', 'true');
    // CONTROL: Undo's neighbour Redo is there too, so the disabled item is one of a drawn menu, not of an empty one.
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Redo' })).toBeVisible();
  });
}

// TRANSLATE THIS PAGE (ADR-0097), in every theme: the dialog says what it sends before the control
// that sends it, passes the gate, and a translation ends in ONE edit and its toast.
for (const look of LOOKS) {
  test(`${look.name}: TRANSLATE THIS PAGE says what it sends, passes axe, and writes the translation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000e2');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'translate.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      // A STORED KEY IS WHAT OFFERS A PROVIDER; the value is a fixture no provider sees.
      secrets: { 'ai.openai-key': 'a-fixture-key' },
      aiModels: { source: 'fetched', models: [{ id: 'fixture-model', label: 'Fixture', capabilities: { vision: null, streaming: null } }] },
      translation: {
        kind: 'translated',
        version: asDocVersion(1),
        edit: blockEditOf([{ lines: [[3]], soft: [false], text: 'Bonjour' }]),
        rewrite: 'objects',
      },
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

    await page.keyboard.press('Control+K');
    await page.keyboard.type('Translate this page');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Translate', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('The text you choose below is sent to the AI provider named here', { exact: false })).toBeVisible();
    // THE FOUR SCOPES (2026-10-08), with the selected text not choosable while no words are selected.
    for (const scope of ['This page', 'Whole document', 'Pages']) await expect(dialog.getByRole('button', { name: scope })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Selected text' })).toBeDisabled();
    // NO LANGUAGE CHOSEN FOR THE PERSON: the start waits.
    await expect(dialog.getByRole('button', { name: 'Translate', exact: true })).toBeDisabled();

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);

    await dialog.locator('[data-translate-language]').selectOption('fr');
    await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
    // THE WRITE'S OWN TOAST, which only a document.execute that answered produces.
    await expect(page.getByText('Page translated. Undo puts the original back.')).toBeVisible();
  });
}

// THE AUTHOR A NEW MARK CARRIES, as the App composes it (ADR-0103; finding QQQQQQ-13). `authorFor` is unit-tested and
// every command case injects its own stamp, so the one line that joins the setting to the Windows user name — `App`'s
// `stamp` — was crossed by nothing: `authorFor(typedAuthor, '')` passed the whole suite. This places a mark the way a
// person does and reads the author off the command the page SENT, which no screen shows.
//
// THE SECOND ROW IS THE CONTROL: nothing typed, so the author is the user name `app.info` answers — the shim's
// `Shim User`. It is the row the broken join fails, since an empty user name gives an empty author; the first row
// alone would pass it.
for (const [typed, expected] of [
  ['Ada Lovelace', 'Ada Lovelace'],
  ['', 'Shim User'],
] as const) {
  test(`a new mark names ${expected} as its author when the name setting is "${typed}"`, async ({ page }) => {
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000c9');
    const sent: unknown[] = [];
    await bridge(
      page,
      {
        settings: typed === '' ? {} : { 'editing.author-name': typed },
        opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'author.pdf' }],
        documentBytes: new Map([[docId, bytes]]),
      },
      (channel, params) => {
        if (channel === 'document.execute') sent.push(params);
      },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

    // THE INSERTION MARK, because it is a click that commits at once — no dialog between the gesture and the send.
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Insertion mark');
    await page.keyboard.press('Enter');
    await page.getByLabel('Draw on page 1').click();

    const authors = (): unknown[] =>
      sent.flatMap((params) => {
        const command = (params as { readonly command?: { readonly kind?: string; readonly stamp?: { readonly author?: unknown } } })
          .command;
        return command?.kind === 'addAnnotation' ? [command.stamp?.author] : [];
      });
    await expect.poll(authors).toStrictEqual([expected]);
  });
}

// THE FACE A NEW TEXT BOX IS SET IN, as the App composes it: `editing.annotation-font` read into the tools' style and
// carried on the command the page SENDS. The kernel's case proves each face lands in the document; this one crosses
// the join between the stored setting and the tool, which no unit case holds. The first row is the control — nothing
// stored, the sans default.
for (const [stored, expected] of [
  [undefined, 'sans'],
  ['mono', 'mono'],
] as const) {
  test(`a new text box is set in ${expected} when the font setting is ${stored ?? 'unset'}`, async ({ page }) => {
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000ca');
    const sent: unknown[] = [];
    await bridge(
      page,
      {
        settings: stored === undefined ? {} : { 'editing.annotation-font': stored },
        opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'font.pdf' }],
        documentBytes: new Map([[docId, bytes]]),
      },
      (channel, params) => {
        if (channel === 'document.execute') sent.push(params);
      },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

    await page.keyboard.press('Control+K');
    await page.keyboard.type('Text box');
    await page.keyboard.press('Enter');
    const surface = page.getByLabel('Draw on page 1');
    const box = await surface.boundingBox();
    const x = (box?.x ?? 0) + 60;
    const y = (box?.y ?? 0) + 60;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 160, y + 60, { steps: 4 });
    await page.mouse.up();
    // TYPED IN THE BOX ON THE PAGE (ADR-0154), which is set in the chosen face as the words will be.
    const typed = page.getByRole('textbox', { name: 'Text box' });
    await expect(typed).toHaveClass(new RegExp(`m-inline-writer__block--${expected}\\b`, 'u'));
    await typed.fill('see figure 3');
    await page.keyboard.press('Escape');

    const fonts = (): unknown[] =>
      sent.flatMap((params) => {
        const command = (params as { readonly command?: { readonly kind?: string; readonly annotation?: { readonly font?: unknown } } })
          .command;
        return command?.kind === 'addAnnotation' ? [command.annotation?.font] : [];
      });
    await expect.poll(fonts).toStrictEqual([expected]);
  });
}

// THE STAMP LIBRARY'S BUILT-INS, in every look: the Stamp tool, a drag, the chooser — each stamp shown as its word, and
// nothing on that screen failing axe — and the chosen stamp on the command the page SENDS. The kernel's case proves the
// word lands in the document; this crosses the tool, the dialog and the App's composition, which no unit case holds.
for (const look of LOOKS) {
  test(`${look.name}: the STAMP tool asks which stamp, passes axe, and sends the one chosen`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000cb');
    const sent: unknown[] = [];
    await bridgeUnder(
      page,
      look,
      {
        opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'stamp.pdf' }],
        documentBytes: new Map([[docId, bytes]]),
      },
      (channel, params) => {
        if (channel === 'document.execute') sent.push(params);
      },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

    await page.keyboard.press('Control+K');
    await page.keyboard.type('Stamp');
    await page.keyboard.press('Enter');
    const surface = page.getByLabel('Draw on page 1');
    const box = await surface.boundingBox();
    const x = (box?.x ?? 0) + 60;
    const y = (box?.y ?? 0) + 60;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y + 60, { steps: 4 });
    await page.mouse.up();

    const dialog = page.getByRole('dialog', { name: 'Choose a stamp' });
    await expect(dialog.getByRole('radio')).toHaveCount(8);
    // EXACT: *APPROVED* is inside *NOT APPROVED*.
    await expect(dialog.getByRole('radio', { name: 'APPROVED', exact: true })).toBeChecked();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);

    await dialog.getByRole('radio', { name: 'VOID', exact: true }).check();
    await dialog.getByRole('button', { name: 'Add stamp' }).click();
    const stamps = (): unknown[] =>
      sent.flatMap((params) => {
        const command = (params as { readonly command?: { readonly kind?: string; readonly annotation?: { readonly stamp?: unknown } } })
          .command;
        return command?.kind === 'addAnnotation' ? [command.annotation?.stamp] : [];
      });
    // VOID, not the APPROVED the chooser started on: the choice reached the command.
    await expect.poll(stamps).toStrictEqual(['void']);
  });
}

// THE STAMP LIBRARY'S OWN PICTURES: *Add a picture…* keeps the one main's picker answers, the chooser opens again
// showing it, and choosing it sends `document.placeImage` naming it — no picker, no command built on this side.
// CONTROL: before the add, the chooser shows no picture of the person's.
test('a KEPT stamp picture is added from the chooser, shown in it, and placed by its id', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await onePagePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000cc');
  // A 1 × 1 PNG, so the chooser's <img> has real pixels to decode.
  const png = new Uint8Array(
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  );
  const sent: { channel: string; params: unknown }[] = [];
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'kept.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      library: { pick: { name: 'Paid', bytes: png } },
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

  await page.keyboard.press('Control+K');
  await page.keyboard.type('Stamp');
  await page.keyboard.press('Enter');
  const box = await page.getByLabel('Draw on page 1').boundingBox();
  const x = (box?.x ?? 0) + 60;
  const y = (box?.y ?? 0) + 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y + 60, { steps: 4 });
  await page.mouse.up();

  const dialog = page.getByRole('dialog', { name: 'Choose a stamp' });
  await expect(dialog.getByRole('img', { name: 'Paid' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add a picture…' }).click();
  // ASKED AGAIN, with the library as it now is: the picture decoded, not a broken image.
  const kept = dialog.getByRole('img', { name: 'Paid' });
  await expect(kept).toBeVisible();
  expect(await kept.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await dialog.locator('[data-stamp-picture] input').check();
  await dialog.getByRole('button', { name: 'Add stamp' }).click();

  const placed = (): unknown[] =>
    sent
      .filter((call) => call.channel === 'document.placeImage')
      .map((call) => (call.params as { readonly picture?: unknown }).picture);
  await expect.poll(placed).toStrictEqual([expect.stringMatching(/^[0-9a-f-]{36}$/u)]);
  // AND NOTHING WAS BUILT HERE: no addAnnotation for a picture.
  expect(sent.filter((call) => call.channel === 'document.execute')).toStrictEqual([]);
});

// A SAVE THAT WOULD BREAK SIGNATURES, in every look: Ctrl+S on such a document opens the warning — axe clean — and
// *Save anyway* sends the save again saying so. CONTROL in the same case: until the person agrees, only the held-back
// save was sent.
for (const look of LOOKS) {
  test(`${look.name}: a save that breaks signatures ASKS first, passes axe, and saves once agreed`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000cd');
    const saves: unknown[] = [];
    await bridgeUnder(
      page,
      look,
      {
        opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'signed.pdf' }],
        documentBytes: new Map([[docId, bytes]]),
        saveBreaksSignatures: new Map([[docId, 1]]),
      },
      (channel, params) => {
        if (channel === 'document.save') saves.push((params as { readonly breakSignatures?: unknown }).breakSignatures);
      },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

    await page.keyboard.press('Control+S');
    const dialog = page.getByRole('dialog', { name: 'This save will break signatures' });
    await expect(dialog).toBeVisible();
    expect(saves).toStrictEqual([false]);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);

    await dialog.getByRole('button', { name: 'Save anyway' }).click();
    await expect.poll(() => saves).toStrictEqual([false, true]);
  });
}

// REDACTION MARKS NOBODY APPLIED, in every look (the owner's item N1): the pending mark draws with its label, Ctrl+S
// asks *2 parts of this document are marked for redaction* — axe clean — and each answer sends what it says. CONTROL in the same
// case: until the person answers, nothing was saved and nothing burnt in.
for (const look of LOOKS) {
  test(`${look.name}: a save with marks pending ASKS first, passes axe, and each answer does its job`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000ce');
    const sent: { channel: string; params: unknown }[] = [];
    await bridgeUnder(
      page,
      look,
      {
        opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'marked.pdf' }],
        documentBytes: new Map([[docId, bytes]]),
        annotations: [
          { page: 0, index: 0, kind: 'redact', rect: { x0: 100, y0: 600, x1: 300, y1: 700 } },
          { page: 0, index: 1, kind: 'redact', rect: { x0: 100, y0: 300, x1: 160, y1: 312 } },
          { page: 0, index: 2, kind: 'square', rect: { x0: 350, y0: 100, x1: 450, y1: 200 } },
        ],
      },
      (channel, params) => {
        sent.push({ channel, params });
      },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

    // THE MARKS, in this look: the large one labelled ON it, inside its box; the small one too small for the label,
    // which is then not drawn at all — outside the mark it covered words nobody marked (3 October).
    const labels = page.locator('[data-annotation-layer="0"] [data-annotation-label]');
    await expect(labels).toHaveCount(2);
    await expect(labels.nth(0)).toHaveAttribute('data-place', 'inside');
    await expect(labels.nth(0)).toBeVisible();
    const [labelBox, markBox] = await Promise.all([
      labels.nth(0).boundingBox(),
      page.locator('[data-annotation-layer="0"] [data-annotation-kind="redact"]').nth(0).boundingBox(),
    ]);
    if (labelBox === null || markBox === null) throw new Error('the label or its mark has no box');
    expect(labelBox.x >= markBox.x - 0.5 && labelBox.y >= markBox.y - 0.5).toBe(true);
    expect(labelBox.x + labelBox.width <= markBox.x + markBox.width + 0.5).toBe(true);
    expect(labelBox.y + labelBox.height <= markBox.y + markBox.height + 0.5).toBe(true);
    await expect(labels.nth(1)).toHaveAttribute('data-place', 'none');
    await expect(labels.nth(1)).toBeHidden();

    const writes = (): string[] =>
      sent
        .map((call) => call.channel)
        .filter((channel) => channel === 'document.save' || channel === 'document.execute');

    // CANCEL: nothing written, nothing burnt in.
    await page.keyboard.press('Control+S');
    const dialog = page.getByRole('dialog', { name: 'Redactions not applied' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('2 parts of this document are marked for redaction, but they have not been removed yet.');
    expect(writes()).toStrictEqual([]);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes()).toStrictEqual([]);

    // SAVE WITHOUT APPLYING: the save, and no burn-in.
    await page.keyboard.press('Control+S');
    await dialog.getByRole('button', { name: 'Save without applying' }).click();
    await expect.poll(writes).toStrictEqual(['document.save']);

    // APPLY: the burn-in over every page, THEN the save.
    await page.keyboard.press('Control+S');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(writes).toStrictEqual(['document.save', 'document.execute', 'document.save']);
    const burnt = sent.find((call) => call.channel === 'document.execute')?.params as
      | { readonly command?: unknown }
      | undefined;
    expect(burnt?.command).toStrictEqual({
      kind: 'applyRedactions',
      pages: 'all',
      cover: 'solid',
      images: 'pixels',
      keepTitle: false,
    });
  });
}

// AN EDIT REFUSED IN THE EDITOR (ADR-0169 Decision 5), in every theme: the editor stays over the block with the words
// typed, and says the step's sentence, its reference and the way out beneath them, where a dialog used to close it.
for (const look of LOOKS) {
  test(`${look.name}: an edit REFUSED IN THE EDITOR keeps the words typed, says why beneath them, and passes axe`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000f2');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'edit.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      refusals: new Map([[docId, { code: 'edit-refused', detail: { step: 'read-back', engineError: 0 } }]]),
      textBlocks: [
        {
          box: { x0: 100, y0: 600, x1: 400, y1: 700 },
          lines: [
            {
              runs: [{ index: 3, text: 'A paragraph of words', style: BODY_RUN }],
              box: { x0: 100, y0: 686, x1: 400, y1: 700 },
              soft: false,
            },
          ],
          style: BODY_RUN,
          shape: LEFT_SHAPE,
        },
      ],
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Edit text on the page');
    await page.keyboard.press('Enter');
    await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').click();
    const editor = page.locator('[data-text-editor]');
    await expect(editor).toBeFocused();
    await page.keyboard.type(' typed here');
    await page.keyboard.press('Escape');

    const said = page.locator('.m-text-editor-problem');
    await expect(said).toContainText('This page uses a font Monstera can’t rewrite yet, so nothing was changed.');
    await expect(said).toContainText('read-back 0');
    await expect(said).toContainText('press Esc to put the text back');
    // THE WORDS STAY, as typed.
    expect(await editor.evaluate((element) => (element as HTMLElement).innerText)).toBe('A paragraph of words typed here');

    // CLEARLY READABLE OVER THE PAPER, not merely passing (the owner, 2026-10-05): the note sits on the page, so its
    // background is composited over the page's own colour, and every line, the reference included, holds 7:1. Axe
    // cannot judge this: the note's ground is a canvas, and it marks such text as needing review.
    const read = await said.evaluate((note) => ({
      paper: getComputedStyle(document.documentElement).getPropertyValue('--page').trim(),
      ground: getComputedStyle(note).backgroundColor,
      lines: [...note.querySelectorAll('p, dt, dd')].map((line) => ({
        text: line.textContent.slice(0, 24),
        colour: getComputedStyle(line).color,
      })),
    }));
    const paper = channels(read.paper);
    const ground = paper === null ? null : channels(read.ground, paper);
    if (ground === null) throw new Error(`could not read the note's ground: ${JSON.stringify(read)}`);
    const ratios = read.lines.map(({ text, colour }) => {
      const ink = channels(colour, ground);
      return { text, ratio: ink === null ? 0 : Math.round(contrast(ink, ground) * 100) / 100 };
    });
    expect(ratios.length, JSON.stringify(read)).toBe(4);
    for (const { text, ratio } of ratios) expect(ratio, `${look.name}: "${text}" over the paper, ${JSON.stringify(ratios)}`).toBeGreaterThanOrEqual(7);

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
  });
}

// EDIT TEXT IN PLACE (ADR-0096), in every theme: the outlines sit over their words on the drawn
// page, the editor opens over a block, and nothing on that screen fails the gate.
for (const look of LOOKS) {
  test(`${look.name}: EDIT TEXT outlines each block ON the page, opens an editor over one, and passes axe`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000e1');
    // PDF USER SPACE, off-centre, so an outline drawn unscaled or with y the wrong way up lands
    // somewhere the position assertion names.
    const box = { x0: 100, y0: 600, x1: 400, y1: 700 };
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'edit.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      textBlocks: [
        {
          box,
          lines: [
            {
              runs: [
                { index: 3, text: 'A paragraph of words ', style: BODY_RUN },
                { index: 5, text: 'set on the page', style: SET_APART_RUN },
              ],
              box: { x0: 100, y0: 686, x1: 400, y1: 700 },
              soft: false,
            },
            {
              runs: [{ index: 8, text: 'and a second line.', style: BODY_RUN }],
              box: { x0: 100, y0: 600, x1: 260, y1: 614 },
              soft: false,
            },
          ],
          style: BODY_RUN,
          shape: LEFT_SHAPE,
        },
      ],
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const canvas = page.locator('canvas[data-page-canvas="0"]');
    await expect(canvas).toBeVisible();

    await page.keyboard.press('Control+K');
    await page.keyboard.type('Edit text on the page');
    await page.keyboard.press('Enter');
    const outline = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
    // SELF-DESCRIBING ON FAILURE. This failed once on the Linux runner at 940133c (dark only) and passed 30 of 30
    // here; the one output readable without a token is the step's annotation, so a failure carries the page's
    // state rather than only the count. The palette-focus race was tested and rejected (focused at 12x CPU
    // throttle), so this is what should say what the mechanism is if it recurs.
    await expect(outline)
      .toHaveCount(1)
      .catch(async (cause: unknown) => {
        const state = await page.evaluate(() => ({
          palette: document.querySelector('.m-palette') !== null,
          query: document.querySelector<HTMLInputElement>('.m-palette-query')?.value ?? null,
          focused: document.activeElement?.className ?? null,
          layers: document.querySelectorAll('[data-text-edit-layer]').length,
          blocks: document.querySelectorAll('[data-text-block]').length,
          problem: document.querySelector('[role="alert"]')?.textContent ?? null,
          toasts: [...document.querySelectorAll('.m-toast')].map((toast) => toast.textContent),
        }));
        throw new Error(`the page when the outline did not appear: ${JSON.stringify(state)}`, { cause });
      });

    const pageBox = await canvas.boundingBox();
    const drawn = await outline.boundingBox();
    expect(pageBox).not.toBeNull();
    expect(drawn).not.toBeNull();
    const scale = (pageBox?.width ?? 0) / 612;
    expect(Math.abs((drawn?.x ?? Number.NaN) - ((pageBox?.x ?? 0) + box.x0 * scale))).toBeLessThan(2);
    expect(Math.abs((drawn?.y ?? Number.NaN) - ((pageBox?.y ?? 0) + (792 - box.y1) * scale))).toBeLessThan(2);
    // THE OUTLINE IS ON THE PAPER and clears 3:1 against it in every look (`contrast.ts`; the accent itself is 2.54:1
    // in dark and 1.49:1 in high contrast).
    expect(await againstPaper(outline, 'border-top-color')).toBeGreaterThanOrEqual(3);

    await outline.click();
    const editor = page.locator('[data-text-editor]');
    await expect(editor).toBeFocused();
    expect(await againstPaper(page.locator('.m-text-editor-frame'), 'outline-color')).toBeGreaterThanOrEqual(3);
    expect(await editor.evaluate((element) => (element as HTMLElement).innerText)).toBe(
      'A paragraph of words set on the page\nand a second line.',
    );
    // EACH RUN AS THE PAGE SETS IT (ADR-0145): its size at the scale the page is drawn at, its fill, its weight —
    // computed, so it is what the browser draws and not what was asked of it.
    const runs = await editor.locator('.m-text-editor__run').evaluateAll((spans) =>
      spans.map((span) => {
        const style = getComputedStyle(span);
        return { size: Number.parseFloat(style.fontSize), colour: style.color, weight: style.fontWeight };
      }),
    );
    expect(runs.map((run) => run.colour)).toStrictEqual(['rgb(30, 30, 30)', 'rgb(66, 83, 149)', 'rgb(30, 30, 30)']);
    expect(runs.map((run) => run.weight)).toStrictEqual(['400', '700', '400']);
    const sizes = [BODY_RUN.size, SET_APART_RUN.size, BODY_RUN.size];
    expect(runs.map((run, at) => Math.abs(run.size - (sizes[at] ?? 0) * scale) < 0.05)).toStrictEqual([true, true, true]);
    // EVERY HANDLE'S TARGET LIES OUTSIDE THE BLOCK'S FRAME and is 24 px a side, so a press on a letter can never land on a
    // handle. Eight handles are required first: no handle at all would leave the overlap list empty for the wrong reason.
    // CONTROL: the target the handles had before, 24 px centred on the frame's corner, overlaps the frame by a quarter of
    // itself, which is what this measure reports for it.
    const placerBox = await page.locator('.m-text-editor-placer').boundingBox();
    expect(placerBox).not.toBeNull();
    const frame = placerBox ?? { x: 0, y: 0, width: 0, height: 0 };
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof frame) =>
      Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const targets = await page.locator('[data-handle]').evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { handle: button.getAttribute('data-handle') ?? '', x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    expect(targets.map((target) => target.handle).sort()).toStrictEqual(['e', 'n', 'ne', 'nw', 'r', 'se', 'sw', 'w']);
    expect(targets.filter((target) => overlap(target, frame) > 0.5).map((target) => target.handle)).toStrictEqual([]);
    expect(targets.filter((target) => target.width < 23.5 || target.height < 23.5).map((target) => target.handle)).toStrictEqual([]);
    expect(overlap({ x: frame.x - 12, y: frame.y - 12, width: 24, height: 24 }, frame)).toBeCloseTo(144, 0);
    // THE FIRST LETTERS OF EACH LINE are the editor's, read at the point four pixels in from the line's start.
    const startsOfLines = await editor.locator('.m-text-editor__line').evaluateAll((lines) =>
      lines.map((line) => {
        const rect = line.getBoundingClientRect();
        const found = document.elementFromPoint(rect.x + 4, rect.y + rect.height / 2);
        return found !== null && found.closest('[data-text-editor]') !== null;
      }),
    );
    expect(startsOfLines).toStrictEqual([true, true]);
    // TYPED AT THE END, the words go into the last run and take its style, and are read back as typed. THE CARET IS
    // MOVED THERE: the editor opens with it where the page was pressed (ADR-0179), which is the middle of the block
    // for `outline.click()`, and typing there put the words inside the first line.
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' More');
    expect(await editor.evaluate((element) => (element as HTMLElement).innerText)).toBe(
      'A paragraph of words set on the page\nand a second line. More',
    );
    // IN THE LAST RUN'S OWN SPAN, read by which span holds the caret. Its colour could not say so: the last run is set
    // as the block's base, which the editor root and each line carry too, so words typed beside the run, into the
    // line or the root, read the same colour.
    expect(
      await editor.evaluate((root) => {
        const focus = document.getSelection()?.focusNode;
        const element = focus instanceof Element ? focus : (focus?.parentElement ?? null);
        const run = element?.closest('.m-text-editor__run') ?? null;
        const spans = [...root.querySelectorAll('.m-text-editor__run')];
        return { inRun: run !== null, last: run !== null && run === spans[spans.length - 1], text: run?.textContent ?? '' };
      }),
    ).toStrictEqual({ inRun: true, last: true, text: 'and a second line. More' });

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
  });
}

// A BLOCK WHOSE WORDS RUN PAST THE PAGE (the owner's Q7), in every theme: outlined apart and said on the page, and
// open, every line in the editor, the one below the page's foot included and SEEN, with the sentence beside them.
for (const look of LOOKS) {
  test(`${look.name}: a block PAST THE PAGE is outlined apart, said, and opens with every line visible`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000e2');
    // EIGHT LINES FROM 60 POINTS ABOVE THE FOOT, six of them below it, as a write that grew past the page reads: far
    // enough that the last is out of the window until it is scrolled to.
    const lines = [
      'A paragraph near the foot',
      'and its second line',
      'a third line past the page',
      'a fourth line',
      'a fifth line',
      'a sixth line',
      'a seventh line',
      'THE LAST LINE TYPED',
    ];
    const box = { x0: 100, y0: -115, x1: 340, y1: 60 };
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'past.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      textBlocks: [
        {
          box: { x0: 100, y0: 600, x1: 400, y1: 700 },
          lines: [
            {
              runs: [{ index: 1, text: 'A block that fits', style: BODY_RUN }],
              box: { x0: 100, y0: 600, x1: 400, y1: 700 },
              soft: false,
            },
          ],
          style: BODY_RUN,
          shape: LEFT_SHAPE,
        },
        {
          box,
          lines: lines.map((text, at) => ({
            runs: [{ index: 10 + at, text, style: BODY_RUN }],
            box: { x0: 100, y0: 46 - at * 23, x1: 340, y1: 60 - at * 23 },
            soft: false,
          })),
          style: BODY_RUN,
          shape: LEFT_SHAPE,
        },
      ],
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Edit text on the page');
    await page.keyboard.press('Enter');

    const past = page.locator('[data-text-edit-layer="0"] [data-text-block="1"]');
    const fits = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
    await expect(past).toHaveCount(1);
    // TOLD APART BY ITS LINE, which clears 3:1 against the paper as the dashed one does; CONTROL: the block that fits.
    const lineOf = (outline: typeof past) =>
      outline.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.borderTopStyle} ${style.borderTopWidth}`;
      });
    expect(await lineOf(past)).toBe('solid 2px');
    expect(await lineOf(fits)).toBe('dashed 1px');
    expect(await againstPaper(past, 'border-top-color')).toBeGreaterThanOrEqual(3);
    // SAID WHERE IT IS SEEN: the block is scrolled to, and its sentence is in the window with it. A note at the page's
    // top passed a text assertion here while it was scrolled out of sight.
    await past.scrollIntoViewIfNeeded();
    const said = page.locator('[data-text-block-past="1"]');
    await expect(said).toHaveText('This text no longer fits on the page');
    await expect(said).toBeInViewport();

    await past.click();
    const editor = page.locator('[data-text-editor]');
    await expect(editor).toBeFocused();
    expect(await editor.evaluate((element) => (element as HTMLElement).innerText)).toBe(lines.join('\n'));
    const status = page.locator('.m-text-editor-frame [role="status"]');
    await expect(status).toHaveText('This text no longer fits on the page');
    // IN THE WINDOW, above the words: below them it was past the foot they ran off, and out of sight.
    await expect(status).toBeInViewport();
    // THE LAST LINE CAN BE SEEN, not only present: scrolled to, it is in the window, and the point at its middle is the
    // editor's, so nothing between the editor and the window clips it below the page's foot.
    const lastLine = editor.locator('.m-text-editor__line').last();
    await lastLine.scrollIntoViewIfNeeded();
    await expect(lastLine).toBeInViewport();
    const last = await lastLine.boundingBox();
    expect(last).not.toBeNull();
    const hit = await page.evaluate(
      // A POINT OUTSIDE THE WINDOW finds no element, and `undefined !== null` would read that as the editor (SSSSSSS-4).
      ({ x, y }) => {
        const found = document.elementFromPoint(x, y);
        return {
          editors: found !== null && found.closest('[data-text-editor]') !== null,
          found: found === null ? 'nothing' : `${found.tagName} ${String(found.getAttribute('class'))}`,
        };
      },
      // FOUR PIXELS IN FROM THE LINE'S START, where the south-west handle's target used to reach (a 24 px target centred
      // on the frame's corner, measured 2026-10-06 on Chromium 151: this point answered that handle). The handles lie
      // outside the frame now, so it answers the editor; the element is named in the message when it does not.
      { x: (last?.x ?? 0) + 4, y: (last?.y ?? 0) + (last?.height ?? 0) / 2 },
    );
    expect(hit.editors, `the point at the last line's middle belongs to ${hit.found}`).toBe(true);

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
  });
}

// A RUN DRAWN IN ITS OWN FONT (ADR-0175), in a real browser and every look: the font crosses as bytes, loads as a face
// under the renderer's own policy, and the run is DRAWN in it, while the run beside it with none keeps its kind of face.
// LIBERATION SANS from pdfjs-dist, which every install has, given to a MONO run: a proportional face and a monospace one
// set the same words to different widths, so the width says which face drew them — a family name alone would pass for a
// face that never loaded.
const RUN_FONT = new Uint8Array(
  readFileSync(createRequire(import.meta.url).resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')),
);
const MONO_RUN = { ...BODY_RUN, mono: true };

for (const look of LOOKS) {
  test(`${look.name}: a run is DRAWN in the font the host rebuilt, its neighbour in its kind, and the face leaves with the editor`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000e3');
    // NARROW LETTERS ONLY, so the two faces differ by more than either platform's monospace can close: `iiiiiiii WWWW`
    // measured 69.97 px against Consolas' 85.78 on windows-latest (run 37416673829, 2026-10-06), 0.82 of it, where a
    // fifth narrower was asked. An `i` is 0.222 em in Liberation Sans against 0.55 in Consolas and 0.602 in DejaVu Sans Mono.
    const words = 'iiiiiiiiiiii';
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'fonts.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      textBlocks: [
        {
          box: { x0: 100, y0: 600, x1: 400, y1: 700 },
          lines: [
            { runs: [{ index: 1, text: words, style: MONO_RUN }], box: { x0: 100, y0: 680, x1: 400, y1: 700 }, soft: false },
            { runs: [{ index: 2, text: words, style: MONO_RUN }], box: { x0: 100, y0: 650, x1: 400, y1: 670 }, soft: false },
          ],
          style: MONO_RUN,
          shape: LEFT_SHAPE,
        },
      ],
      runFonts: { fonts: [RUN_FONT], runs: new Map([[1, 0]]) },
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Edit text on the page');
    await page.keyboard.press('Enter');
    await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').click();

    const own = page.locator('[data-text-editor] .m-text-editor__run[data-run="1"]');
    const kind = page.locator('[data-text-editor] .m-text-editor__run[data-run="2"]');
    await expect(own).toHaveAttribute('data-run-font', /^m-run-[a-zA-Z0-9]+-0$/u);
    const family = (await own.getAttribute('data-run-font')) ?? '';
    const faceOf = (run: typeof own) =>
      run.evaluate((element) => ({ family: getComputedStyle(element).fontFamily, width: element.getBoundingClientRect().width }));
    const drawn = await faceOf(own);
    const kept = await faceOf(kind);
    // ITS OWN FONT FIRST and the kind behind it; the neighbour with none is the kind alone.
    expect(drawn.family.startsWith(family)).toBe(true);
    expect(drawn.family).toContain('monospace');
    expect(kept.family.startsWith('Consolas')).toBe(true);
    // DRAWN IN IT: the same words, set proportionally, are under three fifths of the kind's monospace (about 0.4 on
    // both platforms; a face that never loaded falls back to the monospace and measures 1).
    expect(drawn.width).toBeLessThan(kept.width * 0.6);
    const loaded = (name: string) =>
      page.evaluate((wanted) => [...document.fonts].some((face) => face.family === wanted && face.status === 'loaded'), name);
    expect(await loaded(family)).toBe(true);

    await page.screenshot({ path: test.info().outputPath(`run-font-${look.name}.png`) });
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);

    // THE FACE LEAVES WITH THE EDITOR: Escape with nothing changed closes it, and the document holds the face no more.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);
    expect(await loaded(family)).toBe(false);
  });
}

// EDIT OBJECT ON THE PAGE (ADR-0153), in a real browser and every look: the filter outlines its kind, a press selects,
// a drag sends the move, Delete removes, and the Properties tab shows the object with its foot inside the panel. The
// component case drives the layer in happy-dom, which has no pointer capture and lays nothing out; this is the
// browser's capture, the page's own layout and the tab's real height.
for (const look of LOOKS) {
  test(`EDIT OBJECT outlines, selects, moves and removes an object on the page — ${look.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bytes = await onePagePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000ec');
    const sent: unknown[] = [];
    await bridgeUnder(
      page,
      look,
      {
        opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'photos.pdf' }],
        documentBytes: new Map([[docId, bytes]]),
        settings: { 'appearance.ribbon-section': 'edit' },
        pageObjects: [
          { index: 0, kind: 'text', left: 72, bottom: 700, right: 400, top: 720, fill: { red: 0, green: 0, blue: 0, alpha: 255 } },
          { index: 1, kind: 'path', left: 72, bottom: 680, right: 540, top: 682, fill: { red: 37, green: 99, blue: 235, alpha: 255 } },
          // NOT THE FIRST, so a layer that offered a position in its own list would send the wrong index.
          { index: 2, kind: 'image', left: 72, bottom: 420, right: 300, top: 640, fill: null },
        ],
      },
      (channel, params) => {
        if (channel === 'document.execute') sent.push(params);
      },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('canvas.m-page').first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Edit object' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Edit images' }).click();
    const layer = page.getByRole('group', { name: 'Objects on page 1' });
    // ONLY THE IMAGE under Images: the text and the rule are not outlined.
    await expect(layer.locator('.m-object')).toHaveCount(1);
    const photo = layer.getByRole('button', { name: 'Image, 1 of 1' });
    // THE OUTLINE AND, ONCE SELECTED, ITS HANDLES ARE ON THE PAPER and clear 3:1 against it in every look.
    expect(await againstPaper(layer.locator('.m-object'), 'border-top-color')).toBeGreaterThanOrEqual(3);
    await photo.click();
    await expect(photo).toHaveAttribute('aria-pressed', 'true');
    expect(await againstPaper(layer.locator('.m-object-handle').first(), 'border-top-color')).toBeGreaterThanOrEqual(3);

    // THE PROPERTIES TAB names it, and its foot is INSIDE the panel. CONTROL, measured 2026-10-04: a content-box tab
    // of 100% height plus its padding was 654 px in a 622 px body, so Delete sat below the panel's edge, cut off.
    const properties = page.locator('.m-properties').first();
    await expect(properties.getByRole('heading', { name: 'Object' })).toBeVisible();
    const fit = await properties.evaluate((section) => {
      const body = section.parentElement?.getBoundingClientRect();
      const foot = section.querySelector('.m-properties__foot')?.getBoundingClientRect();
      return { foot: foot?.bottom ?? Number.POSITIVE_INFINITY, body: body?.bottom ?? 0 };
    });
    expect(fit.foot, JSON.stringify(fit)).toBeLessThanOrEqual(fit.body);

    // A DRAG straight across, in the browser's own pointer capture: one move of the image, by its own index, with no
    // vertical part.
    const box = await photo.boundingBox();
    if (box === null) throw new Error('the outline is not on screen');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => sent.length).toBe(1);
    const moved = sent[0] as { command: { kind: string; index: number; moveBy: { x: number; y: number } } };
    expect(moved.command.kind).toBe('placePageObject');
    expect(moved.command.index).toBe(2);
    expect(moved.command.moveBy.x).toBeGreaterThan(0);
    expect(moved.command.moveBy.y).toBeCloseTo(0, 6);

    // DELETE, by the one Delete command, removes it through PDFium's command.
    await photo.focus();
    await page.keyboard.press('Delete');
    await expect.poll(() => sent.length).toBe(2);
    expect((sent[1] as { command: unknown }).command).toMatchObject({ kind: 'deletePageObjects', indices: [2] });

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
  });
}

// THE COMPONENTS DIALOG'S TALLEST STATE, in a 760 by 560 window: a component whose files changed, with the note that
// every file was checked and the repair line, beside the other six rows. The dialog pattern bounds a dialog at four
// fifths of the window (the owner, 2026-09-25), which is 448 px here, and this body asked for 481: the repair line
// was cut by 33 px and had to be scrolled to (the owner's item R4). Nothing in the body may scroll now.
for (const look of LOOKS) {
  test(`${look.name}: the COMPONENTS dialog's changed state fits a 760 by 560 window with nothing to scroll to`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 560 });
    await bridgeUnder(page, look, { changedComponents: ['ghostscript'] });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await startScreenListening(page);
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Components');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Components' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Verify files' }).click();
    // THE REOPENED DIALOG, with the changed row and both notes: the state under test, not the cheap first look.
    await expect(dialog.getByText('1 missing, 2 altered, 0 unexpected')).toBeVisible();
    const repair = dialog.getByText(/repair or reinstall Monstera/u);
    await expect(repair).toBeVisible();
    await expect(dialog.getByText('Every file was checked against the list this build of Monstera was made with.')).toBeVisible();

    // NOTHING INSIDE IT SCROLLS: every element of the dialog that can scroll has no surplus. The premise that the dialog
    // has a scroller at all is not asserted; the surplus is read off every element whose overflow could produce one.
    const surpluses = await dialog.evaluate((element) =>
      [...element.querySelectorAll('*'), element]
        .filter((candidate) => ['auto', 'scroll'].includes(getComputedStyle(candidate).overflowY))
        .map((candidate) => candidate.scrollHeight - candidate.clientHeight),
    );
    expect(Math.max(0, ...surpluses), `scroll surplus of each scrolling element: ${JSON.stringify(surpluses)}`).toBeLessThanOrEqual(1);
    // THE LAST LINE IS WHOLLY IN THE WINDOW, which a clipped scroller would fail: the viewport check counts clipping.
    await expect(repair).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Verify files' })).toBeInViewport({ ratio: 1 });

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(
      blocking,
      blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
    ).toEqual([]);
  });
}
