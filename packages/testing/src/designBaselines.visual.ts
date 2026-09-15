import { existsSync } from 'node:fs';

import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * §10.7's visual baselines: the start screen, each ribbon section, one dialog and
 * one panel, in all three themes.
 *
 * ## What is compared, and what is masked
 *
 * The chrome — every surface §10.7 names. The PAGE's canvas is masked: a page's
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
const SECTIONS = ['home', 'comment', 'edit', 'organize', 'forms', 'review', 'protect', 'tools'] as const;

const LOOKS = [
  { name: 'light', theme: 'light', contrast: 'no-preference' },
  { name: 'dark', theme: 'dark', contrast: 'no-preference' },
  { name: 'hc', theme: 'dark', contrast: 'more' },
] as const;

type Look = (typeof LOOKS)[number];

async function blankPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/** The start screen under `look`, with one document the Open command yields. */
async function openedOn(page: Page, look: Look): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ contrast: look.contrast, reducedMotion: 'reduce' });
  const bytes = await blankPdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000b7');
  await bridge(page, {
    settings: { 'appearance.theme': look.theme },
    opens: [
      { kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Baseline.pdf' },
    ],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
  await expect(page.getByRole('button', { name: 'Open PDF…' })).toBeVisible();
}

/**
 * Waits until the document is DRAWN: the page and its thumbnail each hold a canvas.
 *
 * Measured 2026-09-15, three zero-tolerance comparisons of one build: the first
 * matched all 33 images, the second failed two and the third one — `dark-section-comment`
 * at 0.42 of its pixels, whose received image held no page, no thumbnail and a status
 * bar still laying out. Playwright's stability rule is *two consecutive identical
 * frames*, and a document that has not started drawing is two identical frames. So
 * readiness is asserted on the thing that is late, never on how long to wait.
 */
async function documentDrawn(page: Page): Promise<void> {
  await expect.poll(() => page.locator('canvas:visible').count()).toBeGreaterThanOrEqual(2);
}

/**
 * Parks the pointer over the masked page area.
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

    // ONE DIALOG: the keyboard shortcuts list, opened the way a reader opens it.
    await page.keyboard.press('F1');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    // THE BODY ARRIVES WITH ITS CHUNK, after the title: a registered dialog is `lazy`, so the
    // title alone is a dialog with an empty body — 0.41 of the window's pixels, measured.
    await expect(dialog.getByRole('row').nth(1)).toBeVisible();
    await expect(page).toHaveScreenshot(`${look.name}-dialog-keyboard-shortcuts.png`);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const rail = page.locator('[data-ribbon-section]');
    await expect(rail.first()).toBeVisible();
    expect(await rail.evaluateAll((items) => items.map((item) => item.getAttribute('data-ribbon-section')))).toStrictEqual(
      [...SECTIONS],
    );

    const canvases = page.locator('canvas');
    for (const section of SECTIONS) {
      await page.locator(`[data-ribbon-section="${section}"]`).click();
      await parkPointer(page);
      await documentDrawn(page);
      await expect(page).toHaveScreenshot(`${look.name}-section-${section}.png`, { mask: [canvases] });
    }

    // ONE PANEL: the right contextual panel, on its own, so a change inside it is not
    // diluted by the whole window's pixel count.
    const panel = page.locator('.m-context-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveScreenshot(`${look.name}-panel-context.png`);
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
