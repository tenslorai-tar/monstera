import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { SELECT_TOOL, armTool, samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * An insertion mark sized from Properties (the owner's O5), through the application's own wiring: the Size field of a
 * selected caret sends one `placeAnnotation` whose box is the caret's own scaled about its centre. The kernel half — the
 * size kept through MuPDF's redraw, in the file and in a reader — is `pageAnnotations.test.ts`; this crosses the
 * composition between the field and the dispatch, which neither half reaches.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');
/** A caret as MuPDF draws one, 20 wide by 14 tall, on the sample's first page. */
const CARET = { x0: 290, y0: 593, x1: 310, y1: 607 };

test('a selected caret’s Size, typed in Properties, sends its box at that height about its centre', async ({ page }) => {
  const bytes = await samplePdf();
  const sent: { channel: string; params: unknown }[] = [];
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      annotations: [{ page: 0, index: 0, kind: 'caret', rect: CARET }],
      settings: { 'appearance.ribbon-section': 'comment' },
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  await armTool(page, 'Select', SELECT_TOOL);
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  await page.mouse.click(slot.x + 300 * scale, slot.y + (792 - 600) * scale);
  await page.getByRole('tab', { name: 'Properties' }).click();
  const size = page.getByRole('spinbutton', { name: 'Size' });
  await expect(size).toHaveValue('14');
  await size.fill('28');
  await size.press('Enter');

  const executed = (): unknown[] =>
    sent.filter((call) => call.channel === 'document.execute').map((call) => (call.params as { readonly command: unknown }).command);
  await expect.poll(() => executed().length).toBe(1);
  expect(executed()[0]).toStrictEqual({
    kind: 'placeAnnotation',
    page: 0,
    placements: [{ index: 0, rect: { x0: 280, y0: 586, x1: 320, y1: 614 } }],
    version: 1,
  });
});
