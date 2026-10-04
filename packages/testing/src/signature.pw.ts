import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * The plain Signature, the way a person places one (ADR-0133): Home › Signature, the dialog in the pattern, *Use
 * Signature*, then a click on the page. What is asserted is the call the page SENT to main — the UI half of the wired
 * pair, crossing the composition the unit cases cannot: the ribbon's command, the dialog's answer held by App, the
 * tool's click and its rectangle. The kernel half (`placedSignature.test.ts`) proves that call puts the mark on the page.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000cd');

/** Opens a ribbon section from the rail, the way a person does. */
async function section(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).first().click();
}

const SIGNATURE = 'annotate.signature';
const SIGN_WITH_CERTIFICATE = 'protect.signature';

/**
 * What the drawn row carries for a command: its own button, or the *More* that holds it. BY ID, because a folded
 * command has no button to find by name — a count of zero buttons named *Sign with certificate* is what a FOLDED one
 * reads as too, so a name could not tell carried from absent.
 */
function carried(page: Page, id: string): ReturnType<Page['locator']> {
  return page.locator(`.m-ribbon__tools :is([data-command="${id}"], [data-holds~="${id}"])`);
}

/**
 * Presses a command the way a person does at this width: its button where the row draws one, else the group's *More*
 * and the command in it. At 1280 Home folds Quick tools since PowerPoint joined Export (C.c), so both routes are real.
 */
async function press(page: Page, id: string): Promise<void> {
  const row = page.locator('.m-ribbon__tools');
  const button = row.locator(`button[data-command="${id}"]`);
  if ((await button.count()) > 0) {
    await button.click();
    return;
  }
  await row.locator(`[data-holds~="${id}"]`).first().click();
  // EITHER ITEM ROLE: a More draws a command that says whether it is on — a tool — as a checkable item (6bc9cd61).
  await page
    .getByRole('menuitem')
    .or(page.getByRole('menuitemcheckbox'))
    .and(page.locator(`[data-command="${id}"]`))
    .click();
}

test('Home › SIGNATURE: the dialog, Use Signature, a click on the page — and the page sends that look there', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  const sent: unknown[] = [];
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'sign.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
    },
    (channel, params) => {
      if (channel === 'document.placeSignature') sent.push(params);
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

  // HOME'S QUICK TOOLS carry the plain Signature, and no longer Sign with certificate (the owner, 2 October).
  await section(page, 'Home');
  await press(page, SIGNATURE);

  const dialog = page.getByRole('dialog', { name: 'Signature' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Type' }).click();
  await dialog.getByRole('textbox', { name: 'Your name' }).fill('Ada Lovelace');
  // THE NAME SET IN ITS FACE, read from the bundle in the built page (ADR-0150): the preview is the outline main is sent.
  await expect(dialog.getByRole('img', { name: 'Your signature, as it will be placed' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use Signature' }).click();
  await expect(dialog).toBeHidden();

  // THE CLICK, a quarter of the way down the page and across its middle: the box is centred there. A position is named
  // because a bare click lands at the centre of the element's VISIBLE part, and the page is taller than the window.
  const surface = page.getByLabel('Draw on page 1');
  const box = await surface.boundingBox();
  if (box === null) throw new Error('the page surface has no box');
  await surface.click({ position: { x: box.width / 2, y: box.height / 4 } });

  await expect.poll(() => sent.length).toBe(1);
  const [request] = sent as {
    readonly page: number;
    readonly rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
    readonly mark: unknown;
    readonly keep: boolean;
  }[];
  expect(request?.page).toBe(0);
  // A TYPED NAME CROSSES AS ITS OUTLINE, made in this page from the default face's own glyphs.
  expect(request?.mark).toMatchObject({ kind: 'outlined', text: 'Ada Lovelace', font: 'dancing-script' });
  const outline = (request?.mark as { readonly outline?: { readonly ops: readonly number[]; readonly points: readonly number[] } })
    .outline;
  expect(outline?.ops[0]).toBe(0);
  expect(outline?.points.length).toBeGreaterThan(1000);
  // SAVE FOR REUSE WAS TICKED, the owner's default, and the page did not untick it.
  expect(request?.keep).toBe(true);
  // THE DEFAULT BOX, 150 by 50 points, centred where the click was on the 612 × 792 page: across its middle, and a
  // quarter down, which in PDF units (y up) is three quarters of 792. The click converted by the one adapter.
  const rect = request?.rect ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  expect(Math.abs(rect.x1 - rect.x0)).toBeCloseTo(150, 0);
  expect(Math.abs(rect.y1 - rect.y0)).toBeCloseTo(50, 0);
  expect((rect.x0 + rect.x1) / 2).toBeCloseTo(306, -1);
  expect((rect.y0 + rect.y1) / 2).toBeCloseTo(594, -1);
});

test('CONTROL: Home no longer carries Sign with certificate, and Protect › Signatures still does', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'sign.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await section(page, 'Home');
  await expect(carried(page, SIGNATURE)).toHaveCount(1);
  await expect(carried(page, SIGN_WITH_CERTIFICATE)).toHaveCount(0);
  await section(page, 'Protect');
  await expect(carried(page, SIGN_WITH_CERTIFICATE)).toHaveCount(1);
});
