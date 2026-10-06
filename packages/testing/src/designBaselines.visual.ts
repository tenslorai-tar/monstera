import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';
import { settled } from './settled.js';

/**
 * §10.7's visual baselines: the start screen, each ribbon section, one dialog and
 * one panel, in all three themes.
 *
 * ## What is compared, and what is hidden
 *
 * The chrome — every surface §10.7 names. The PAGE's canvas is hidden (`rasterHidden.css`, never a `mask`, which
 * painted over whatever the canvas's box reached): a page's
 * raster is PDF.js' output at a zoom and a ratio, and §6 gives it its own
 * perceptual proof against reference renders. A chrome baseline that also held a
 * page raster would go red for a rendering change §6 owns, and be ignored.
 *
 * ## The theme applied is asserted before anything is captured
 *
 * A baseline set captured under the wrong theme matches itself for ever, so each
 * set first reads the root's `data-theme` — `hc` arrives from the platform asking
 * for more contrast, never from the setting (`applyAppearance`).
 */

/**
 * The rail's sections, in order, written here as an INDEPENDENT list.
 *
 * `packages/testing` may not import `packages/ui`, and it should not want to: a
 * list derived from the registry agrees with any section that stops rendering. The
 * case asserts the rail shows exactly these, so a section added or lost is a
 * failure that names this list rather than a baseline nobody captured.
 */
const SECTIONS = ['home', 'organize', 'edit', 'comment', 'forms', 'protect', 'review', 'tools'] as const;

/** The page rasters hidden during a capture, never masked — `rasterHidden.css` says why. */
const RASTER_HIDDEN = fileURLToPath(new URL('./rasterHidden.css', import.meta.url));

// THE LOOKS ARE THE BRIDGE'S, not this file's. §10.4's gate checks the same three, and two lists
// would drift the day one gains a fourth — the second-opinion shape B3a forbids (audit IIIIII-2).

async function blankPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/** The start screen under `look`, with one document the Open command yields. */
async function openedOn(page: Page, look: Look): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blankPdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000b7');
  await bridgeUnder(page, look, {
    opens: [
      { kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Baseline.pdf' },
    ],
    documentBytes: new Map([[docId, bytes]]),
    // OFF, FOR THIS SUITE ONLY: the status bar's tip (ADR-0159) picks one of several candidates through
    // `Math.random`, which nothing here can seed, so the words — and their width — differ by page load. A
    // baseline captured against one tip and compared against another differs at exactly the status bar,
    // which is what `section-home` did (669-815 pixels, 2026-10-06) whatever the capture otherwise waited
    // on. Scoped here rather than in `pageBridge.ts`'s shared default: `statusTips.pw.ts` tests the tip
    // itself and needs it on.
    settings: { 'appearance.status-tips': false },
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
  await expect(page.getByRole('button', { name: 'Open PDF…' })).toBeVisible();
  await startDrawn(page);
}

/**
 * Waits until the start screen is DRAWN: its faces loaded and its logo decoded. A screen still on a fallback face,
 * or with the logo not yet decoded, is two identical frames too, which is all a screenshot's stability waits for.
 */
async function startDrawn(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect.poll(() => page.locator('.m-start-logo').evaluate((logo) => (logo as HTMLImageElement).complete && (logo as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

/**
 * Waits until `section` is the ribbon's active one and the window has stopped moving.
 *
 * A wait on the document being drawn was already true from the first section on, so it said nothing about the
 * click; and a section's first appearance is drawn unfolded for a frame before the fold measures it (`useRibbonFold`),
 * and a resize re-runs the menu row's fit and the page's fit-zoom through ResizeObservers.
 */
async function sectionDrawn(page: Page, section: string): Promise<void> {
  await expect(page.locator('[data-ribbon-active]')).toHaveAttribute('data-ribbon-active', section);
  await documentDrawn(page);
  await settled(
    page,
    () =>
      page.evaluate(() =>
        ['.m-menu-bar', '[data-ribbon-active]', '.m-context-panel', '.m-page-slot', '.m-page-grid'].map((selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          return box === undefined ? null : [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
        }),
      ),
    () => true,
    `the ${section} section`,
  );
}

/**
 * Waits until the document is DRAWN: the page and its thumbnail each hold a canvas, and the status bar's tip
 * (ADR-0159) has finished its `--motion-fade` opacity transition in, never mid-fade.
 *
 * Measured 2026-09-15, three zero-tolerance comparisons of one build: the first
 * matched all 33 images, the second failed two and the third one — `dark-section-comment`
 * at 0.42 of its pixels, whose received image held no page, no thumbnail and a status
 * bar still laying out. Playwright's stability rule is *two consecutive identical
 * frames*, and a document that has not started drawing is two identical frames. So
 * readiness is asserted on the thing that is late, never on how long to wait.
 *
 * The tip is the same shape of lateness, found the same way: `section-home` differed by 669–815 pixels
 * (2026-10-06, local and CI readings), each time at the tip's own words, which fade in over 400ms starting
 * from a `setTimeout(0)` on mount — so whether the fade has reached full opacity by the time a screenshot is
 * taken depends on timing nothing else here waits on. Asserted on the computed opacity, not a delay, for the
 * same reason as the canvases above: a wait long enough for every machine is a number nobody can read back.
 */
async function documentDrawn(page: Page): Promise<void> {
  await expect.poll(() => page.locator('canvas:visible').count()).toBeGreaterThanOrEqual(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const tip = document.querySelector<HTMLElement>('.m-status-tip');
        return tip === null ? 1 : Number.parseFloat(getComputedStyle(tip).opacity);
      }),
    )
    .toBe(1);
}

/** Runs a command through the palette by its EXACT title — a prefix can match a longer command listed first. */
async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill(title);
  await page.getByRole('option', { name: title, exact: true }).click();
}

/**
 * The dialogs the owner approved on 2026-10-02 — one per group of the dialog pattern — and the footers of that day's
 * round: a report's Close, About's and Components' Close-first rows, Set up AI's single Skip. Each is captured on its
 * own, so a change inside one is not diluted by the window's pixel count. `ready` names what arrives last: a
 * registered dialog is `lazy`, so its title alone is a dialog with an empty body. It is a button OF THE BODY, waited
 * for as the last of its name: the title bar's × is named *Close* too and exists before the body (KKKKKKK-1).
 */
const DIALOGS: readonly { command: string; title: string; file: string; ready: string }[] = [
  { command: 'Delete pages…', title: 'Delete pages', file: 'delete-pages', ready: 'Delete pages' },
  { command: 'Watermark…', title: 'Watermark', file: 'watermark', ready: 'Add watermark' },
  { command: 'Donate', title: 'Support Monstera', file: 'donate', ready: 'Open the donation page' },
  { command: 'Word count', title: 'Word count', file: 'word-count', ready: 'Close' },
  { command: 'About', title: 'About Monstera', file: 'about', ready: 'Close' },
  { command: 'Components', title: 'Components', file: 'components', ready: 'Close' },
  { command: 'Set up AI…', title: 'Set up the AI assistant', file: 'ai-setup', ready: 'Skip' },
];

/**
 * Parks the pointer over the page area, whose raster is hidden from the capture.
 *
 * A pointer left on the control it clicked holds that control's hover state and,
 * after a delay, its tooltip — a capture that depends on how long a run took.
 */
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(640, 420);
}

for (const look of LOOKS) {
  test(`${look.name}: the start screen, one dialog, each ribbon section and one panel match their baselines`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openedOn(page, look);
    await expect(page).toHaveScreenshot(`${look.name}-start.png`);

    // ONE DIALOG: the keyboard shortcuts list, opened the way a reader opens it (Ctrl+/ since ADR-0112).
    await page.keyboard.press('Control+Slash');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    // THE BODY ARRIVES WITH ITS CHUNK, after the title: a registered dialog is `lazy`, so the
    // title alone is a dialog with an empty body — 0.41 of the window's pixels, measured.
    await expect(dialog.getByRole('row').nth(1)).toBeVisible();
    await settled(page, async () => dialog.boundingBox(), (box) => box !== null && box.width > 0, 'the keyboard shortcuts dialog');
    await expect(page).toHaveScreenshot(`${look.name}-dialog-keyboard-shortcuts.png`);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const rail = page.locator('[data-ribbon-section]');
    await expect(rail.first()).toBeVisible();
    expect(await rail.evaluateAll((items) => items.map((item) => item.getAttribute('data-ribbon-section')))).toStrictEqual(
      [...SECTIONS],
    );

    for (const section of SECTIONS) {
      await page.locator(`[data-ribbon-section="${section}"]`).click();
      await parkPointer(page);
      await sectionDrawn(page, section);
      await expect(page).toHaveScreenshot(`${look.name}-section-${section}.png`, { stylePath: RASTER_HIDDEN });
    }

    // ONE PANEL: the right contextual panel, on its own, so a change inside it is not
    // diluted by the whole window's pixel count.
    const panel = page.locator('.m-context-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveScreenshot(`${look.name}-panel-context.png`);

    // THE DOCUMENT-OPEN SCREEN at the design's own size (the owner, 2026-09-26): 1920 × 1080 with Home chosen, so
    // the whole v5 window — the lit ground, the ribbon, the rail, both panels, the floating toolbar, the status bar —
    // is one baseline per theme. The page's raster is hidden for §6's reason above.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.locator('[data-ribbon-section="home"]').click();
    await parkPointer(page);
    await sectionDrawn(page, 'home');
    await expect(page).toHaveScreenshot(`${look.name}-document-open.png`, { stylePath: RASTER_HIDDEN });
  });
}

test('CONTROL: a one-word change on the start screen is reported, so a pass means the screens matched', async ({
  page,
}) => {
  // WITHOUT THIS THE GATE IS UNFALSIFIABLE: a comparison whose tolerance swallows a
  // changed word passes every run, and so does one that compared nothing.
  //
  // Skipped while baselines are regenerated, because Playwright writes what it sees
  // in that mode — and what this case shows is deliberately wrong.
  test.skip(
    test.info().config.updateSnapshots === 'all' || test.info().config.updateSnapshots === 'changed',
    'baselines are being regenerated; the planted change would be written as one',
  );
  const baseline = test.info().snapshotPath('light-start.png');
  // A MISSING BASELINE IS REFUSED, not compared: in the default mode Playwright would
  // write this planted screen as the baseline, and the case would then pass on it.
  expect(existsSync(baseline), `no baseline at ${baseline}; run the theme cases first`).toBe(true);

  await openedOn(page, LOOKS[0]);
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent === 'Open PDF…') node.textContent = 'Open PDFs';
    }
  });
  await expect(page.getByRole('button', { name: 'Open PDFs' })).toBeVisible();

  let reported = '';
  try {
    await expect(page).toHaveScreenshot('light-start.png', { timeout: 5_000 });
  } catch (error) {
    reported = error instanceof Error ? error.message : String(error);
  }
  expect(reported, 'a changed word on the start screen passed the comparison').toMatch(/different/u);
  // THE SIZE OF THE SMALLEST CHANGE THIS GATE MUST SEE, printed, because the tolerance is chosen below it and a
  // figure nobody can read back is a guess wearing a measurement's clothes.
  console.log(`CONTROL planted change: ${/(\d+) pixels/u.exec(reported)?.[1] ?? 'unparsed'} pixels differ`);
});

test('CONTROL: a change in the Properties panel is reported where the page’s box overlaps it', async ({ page }) => {
  // THE CHROME BESIDE AN OVERFLOWING PAGE IS COMPARED. A `mask` painted the page canvas's whole box, and at 1280 a page
  // at 100% is wider than its pane, so the Properties panel lay under the paint in every section baseline and a change
  // there passed (2026-09-27; this case, run against masked captures, fails). With the raster hidden rather than
  // masked, a control hidden inside the canvas's box must be reported.
  test.skip(
    test.info().config.updateSnapshots === 'all' || test.info().config.updateSnapshots === 'changed',
    'baselines are being regenerated; the planted change would be written as one',
  );
  const look = LOOKS[0];
  const name = `${look.name}-section-protect.png`;
  const baseline = test.info().snapshotPath(name);
  expect(existsSync(baseline), `no baseline at ${baseline}; run the theme cases first`).toBe(true);

  await openedOn(page, look);
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.locator('[data-ribbon-section="protect"]').click();
  await parkPointer(page);
  await sectionDrawn(page, 'protect');

  // THE HARD SHAPE, asserted rather than assumed: the planted change lies WHOLLY inside the page canvas's box, which is
  // what a mask painted over. A change reaching past that box would be reported under either mechanism, and so would
  // separate nothing — the first version of this case planted a longer word whose last letter did exactly that.
  // THE PREMISE WAITED FOR, not read once: `documentDrawn` counts canvases, and a page canvas read before it takes its
  // laid-out size (CI's Windows runner has read one at its default 300 × 150) reaches under no control at all — which
  // failed this case at 13f12520 and passed it at 93618f48 on the same code. The page at 100% reaches under the panel.
  const pageCanvas = page.locator('.m-page-list canvas[data-page-canvas="0"]');
  await expect
    .poll(async () => {
      const box = await pageCanvas.boundingBox();
      const panel = await page.locator('.m-context-panel').boundingBox();
      return box !== null && panel !== null && box.x + box.width > panel.x;
    })
    .toBe(true);
  const canvasBox = await pageCanvas.boundingBox();
  if (canvasBox === null) throw new Error('the page canvas is laid out');
  const hidden = await page.evaluate((canvasRight) => {
    const panel = document.querySelector('.m-context-panel');
    if (panel === null) return null;
    const left = panel.getBoundingClientRect().left;
    for (const element of panel.querySelectorAll<HTMLElement>('button, input, [role="radio"]')) {
      const box = element.getBoundingClientRect();
      if (box.left > left && box.right < canvasRight && box.width > 8 && box.height > 8) {
        element.style.visibility = 'hidden';
        return { left: box.left, right: box.right };
      }
    }
    return null;
  }, canvasBox.x + canvasBox.width);
  if (hidden === null) throw new Error('a control of the Properties panel lies wholly inside the page canvas’s box');
  expect(hidden.left).toBeGreaterThanOrEqual(canvasBox.x);
  expect(hidden.right).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);

  let reported = '';
  try {
    await expect(page).toHaveScreenshot(name, { stylePath: RASTER_HIDDEN, timeout: 5_000 });
  } catch (error) {
    reported = error instanceof Error ? error.message : String(error);
  }
  expect(reported, 'a control hidden in the Properties panel passed the comparison').toMatch(/different/u);
});

/** Two documents whose first lines differ by two words, so Side by Side has something to mark. */
const LEFT = asDocId('00000000-0000-4000-8000-0000000000c1');
const RIGHT = asDocId('00000000-0000-4000-8000-0000000000c2');

for (const look of LOOKS) {
  test(`${look.name}: the approved dialogs, the round's footers, Signature's Upload row and Side by Side match their baselines`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const left = await blankPdf();
    const right = await blankPdf();
    await bridgeUnder(page, look, {
      opens: [
        { kind: 'opened', docId: LEFT, version: asDocVersion(1), byteLength: left.byteLength, name: 'Before.pdf' },
        { kind: 'opened', docId: RIGHT, version: asDocVersion(1), byteLength: right.byteLength, name: 'After.pdf' },
      ],
      documentBytes: new Map([
        [LEFT, left],
        [RIGHT, right],
      ]),
      documentPageLines: new Map([
        [LEFT, [['The quick brown fox jumps over the lazy dog.']]],
        [RIGHT, [['The quick red fox leaps over the lazy dog.']]],
      ]),
      // OFF: `openedOn`'s reason above.
      settings: { 'appearance.status-tips': false },
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await documentDrawn(page);
    await page.getByRole('button', { name: 'Open another document' }).click();
    await expect(page.locator('[data-tab-select]')).toHaveCount(2);
    await documentDrawn(page);

    // EDIT › TEXT WITH TEXT SELECTED: its one Copy (`edit.copy`) shows only while something is selected, so the section's
    // own baseline, which selects nothing, cannot show the round's change to this group.
    // THE LINE'S TEXT SELECTED THROUGH THE DOCUMENT'S SELECTION, which is what the application reads (`selectionchange`);
    // what is captured is the ribbon's answer to a selection, not the gesture that made one.
    await page.locator('[data-ribbon-section="edit"]').click();
    const line = page.locator('[data-document-layer="active"] [data-text-layer="0"] [data-text-line="0"]');
    await expect(line).toHaveCount(1);
    await line.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    });
    expect(await page.evaluate(() => document.getSelection()?.toString().trim() ?? '')).not.toBe('');
    const textGroup = page.locator('.m-ribbon__group').filter({ has: page.locator('.m-ribbon__caption', { hasText: /^Text$/u }) });
    await expect(textGroup.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
    await parkPointer(page);
    await expect(textGroup).toHaveScreenshot(`${look.name}-ribbon-edit-text-selected.png`);

    for (const { command, title, file, ready } of DIALOGS) {
      await runCommand(page, command);
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible();
      // THE BODY'S BUTTON, the last of its name: the title bar's × comes first in the dialog and is named *Close* too,
      // and it is there before a lazily loaded body, so `.first()` was satisfied by a dialog with no body — CI at
      // 024602b2 photographed About as a 200 x 92 px frame (KKKKKKK-1).
      await expect(dialog.getByRole('button', { name: ready, exact: true }).last()).toBeVisible();
      // THE HARNESS'S CONTROL: a *Close*-ready dialog holds that name twice, the × and its own, so the wait above is
      // for the body's; and no other ready name is the ×'s.
      await expect(dialog.getByRole('button', { name: ready, exact: true })).toHaveCount(ready === 'Close' ? 2 : 1);
      await parkPointer(page);
      await expect(dialog).toHaveScreenshot(`${look.name}-dialog-${file}.png`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }

    // SIGNATURE'S UPLOAD ROW: the picture is chosen in the dialog and previewed before it is used (ADR-0133).
    await runCommand(page, 'Signature');
    const signature = page.getByRole('dialog', { name: 'Signature' });
    await expect(signature).toBeVisible();
    // A SEGMENT IS A TOGGLE BUTTON (`SegmentedControl` is Base UI's ToggleGroup, `aria-pressed`), not a radio.
    await signature.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(signature.getByRole('button', { name: 'Choose picture…' })).toBeVisible();
    await parkPointer(page);
    await expect(signature).toHaveScreenshot(`${look.name}-dialog-signature-upload.png`);
    await page.keyboard.press('Escape');
    await expect(signature).toBeHidden();

    // SIDE BY SIDE, before a comparison and so without its Differences list, which changes next round.
    // FROM THE TAB MENU, where the command lives (`openSideBySideCommand`): on the tab NOT on show, beside the one that is
    // — and the one on show goes LEFT, so Before is brought forward first and the picture reads Before | After.
    await page.locator(`[data-tab-select="${LEFT}"]`).click();
    await documentDrawn(page);
    await page.locator(`[data-tab-select="${RIGHT}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open side by side' }).click();
    const side = page.locator('[data-side-by-side]');
    await expect(side).toBeVisible();
    await expect(side.locator('[data-side-compare]')).toBeEnabled();
    await parkPointer(page);
    await expect(page).toHaveScreenshot(`${look.name}-side-by-side.png`, { stylePath: RASTER_HIDDEN });

    // AND ITS WORD MARKS, each half on its own so the list beside them is not in either picture.
    await side.locator('[data-side-compare]').click();
    await expect(side.locator('[data-difference]').first()).toBeVisible();
    await parkPointer(page);
    for (const half of ['left', 'right'] as const) {
      await expect(side.locator(`[data-side-half="${half}"]`)).toHaveScreenshot(`${look.name}-side-by-side-marks-${half}.png`, {
        stylePath: RASTER_HIDDEN,
      });
    }
  });
}
