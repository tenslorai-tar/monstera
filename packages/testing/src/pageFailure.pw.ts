import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * A page area main cannot serve says why and offers Try again (the owner's Part 7 B, 0.1.14.0).
 *
 * Seven tabs sat on *Opening the document…* with no end while the status bar showed each one's page count: the range
 * transport stopped in silence on any refusal from main, so PDF.js waited for a range that would never come. Here the
 * shim holds a document open with no bytes behind it, which is main's `document-not-open` for every range, and the page
 * area must leave *Opening…* for the failure, which names nothing technical and offers Try again. The bytes are then
 * given to the shim, as main serving the ranges again, and Try again must draw the page.
 *
 * THE CONTROL is the build before the fix, against which the first expectation never holds: *Opening…* stays.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f7');

/** Seven documents, the owner's count, each id distinct in its last two digits. */
const SEVEN = Array.from({ length: 7 }, (_, at) => asDocId(`00000000-0000-4000-8000-0000000001${String(at).padStart(2, '0')}`));

test('SEVEN TABS, AN EDIT, THEN EVERY TAB: each one draws its page, and none is left opening', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  const bytes = await blockedPages([612, 792], 2);
  const executed: unknown[] = [];
  await bridge(
    page,
    {
      opens: SEVEN.map((docId, at) => ({
        kind: 'opened' as const,
        docId,
        version: asDocVersion(1),
        byteLength: bytes.byteLength,
        name: `tab-${String(at + 1)}.pdf`,
      })),
      documentBytes: new Map(SEVEN.map((docId) => [docId, bytes])),
    },
    (channel, params) => {
      if (channel === 'document.execute') executed.push(params);
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const active = page.locator('[data-document-layer="active"]');
  await expect(active.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  for (const docId of SEVEN.slice(1)) {
    await page.getByRole('button', { name: 'Open another document' }).click();
    await expect(page.locator(`[data-tab-select="${docId}"]`)).toBeVisible({ timeout: 20_000 });
  }

  // THE EDIT, on the last document opened: a command that moves its version, as the owner's text edit did.
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Rotate page');
  await page.getByRole('option', { name: /^Rotate page\b/u }).first().click();
  // THE EDIT REACHED MAIN, against the document on screen: without it every tab below is drawn from a version nothing
  // moved, and the case would pass for a build that never edits.
  await expect.poll(() => executed.length, { timeout: 10_000 }).toBe(1);
  expect(JSON.stringify(executed[0])).toContain(SEVEN.at(-1) ?? DOC);

  // EVERY TAB, in the order a person clicks along the strip, and back to the edited one last.
  for (const docId of [...SEVEN.slice(0, -1), SEVEN.at(-1) ?? DOC]) {
    await page.locator(`[data-tab-select="${docId}"]`).click();
    await expect(active.locator('.m-page-list canvas.m-page').first(), `tab ${docId} drew no page`).toBeVisible({
      timeout: 20_000,
    });
    await expect(active.locator('.m-page-opening'), `tab ${docId} is still opening`).toHaveCount(0);
    await expect(active.locator('canvas[data-failed]'), `tab ${docId} failed`).toHaveCount(0);
  }
});

test('a document whose ranges main refuses says it could not be displayed, and Try again draws it once main serves', async ({
  page,
}) => {
  const bytes = await blockedPages([612, 792], 1);
  // THE SHIM READS THIS MAP ON EVERY RANGE, so filling it later is main serving again.
  const documentBytes = new Map<typeof DOC, Uint8Array>();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'refused.pdf' }],
    documentBytes,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const problem = page.getByRole('alert').filter({ hasText: 'This document could not be displayed.' });
  await expect(problem).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.m-page-opening')).toHaveCount(0);
  await expect(page.locator('canvas.m-page[data-failed="true"]')).toHaveCount(1);

  documentBytes.set(DOC, bytes);
  await problem.getByRole('button', { name: 'Try again' }).click();

  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 15_000 });
  await expect(problem).toHaveCount(0);
  await expect(page.locator('canvas[data-failed]')).toHaveCount(0);
});
