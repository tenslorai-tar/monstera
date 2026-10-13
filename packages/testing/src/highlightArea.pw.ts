import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Highlight area (the owner's O7), through the ribbon: the button sits in Comment's Markup group beside Highlight text,
 * says what it is under the pointer, and a box dragged on the page sends one highlight over that area. What the kernel
 * makes of it — the box exactly, in the highlighter's blend, listed as a highlight — is `pageAnnotations.test.ts`.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

test('Highlight area is beside Highlight text, has a tooltip, and a box dragged sends one highlight over that area', async ({ page }) => {
  const bytes = await samplePdf();
  const sent: { channel: string; params: unknown }[] = [];
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      settings: { 'appearance.ribbon-section': 'comment' },
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();

  const button = page.locator('[data-command="annotate.highlight-area"]').first();
  await expect(button).toHaveText('Highlight area');
  await button.hover();
  // THE TOOLTIP is the full title, which the ribbon draws where its caption is the short one.
  await expect(page.locator('.m-tooltip')).toHaveText('Highlight an area of the page');
  await button.click();

  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  await page.mouse.move(slot.x + 100 * scale, slot.y + 200 * scale);
  await page.mouse.down();
  await page.mouse.move(slot.x + 300 * scale, slot.y + 320 * scale, { steps: 6 });
  await page.mouse.up();

  const executed = (): unknown[] =>
    sent.filter((call) => call.channel === 'document.execute').map((call) => (call.params as { readonly command: unknown }).command);
  await expect.poll(() => executed().length).toBe(1);
  const [command] = executed() as { kind: string; annotation: { type: string; over?: string; rect: { x0: number; y0: number; x1: number; y1: number } } }[];
  expect(command?.kind).toBe('addAnnotation');
  expect(command?.annotation).toMatchObject({ type: 'highlight', over: 'area' });
  // THE BOX DRAGGED, in PDF space: x 100 to 300, and 200 to 320 down a 792-point page.
  const rect = command?.annotation.rect;
  if (rect === undefined) throw new Error('no box');
  for (const [got, want] of [[rect.x0, 100], [rect.x1, 300], [rect.y0, 592], [rect.y1, 472]] as const) expect(Math.abs(got - want)).toBeLessThan(1);
});
