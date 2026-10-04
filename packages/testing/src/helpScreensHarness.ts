import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect } from '@playwright/test';

import type { createBrowserShim } from './browserShim.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { settled } from './settled.js';

/**
 * What every Help centre screenshot scene shares (the Help centre row's *screenshots owed*; ADR-0112).
 *
 * ## One look, one size, one document
 *
 * The screenshots are taken in the LIGHT look at 1280 × 800 against one sample document, so the 138 pictures read as
 * one set. A person in the dark or high-contrast look sees light pictures: tripling the set to follow the theme would
 * triple what the renderer bundles, and a picture of a control is still the control.
 *
 * ## Written where the Help centre bundles them
 *
 * Each capture lands as `packages/ui/src/help/screenshots/<id>.png`, the id the article names in
 * `![alt](screenshot:<id>)`. `articles.ts` bundles that folder, so a capture added is a picture drawn — and
 * `HELP_SCREENS_OUT` sends them elsewhere for a run that should not touch the tree.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = process.env['HELP_SCREENS_OUT'] ?? join(REPO_ROOT, 'packages', 'ui', 'src', 'help', 'screenshots');

/** The light look — the one the set is taken in. */
const LIGHT = LOOKS[0];

/** The version `apps/desktop/package.json` declares, read rather than written here, so a picture cannot go stale. */
const APP_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'desktop', 'package.json'), 'utf8')) as { version: string }
).version;

/** The shim's options, as a scene may set them: stored settings, a library, refusals to show, and so on. */
export type SceneShim = NonNullable<Parameters<typeof createBrowserShim>[0]>;

/** The document every scene opens: eight Letter pages of an ordinary report, text on each. */
export async function samplePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let at = 0; at < 8; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Annual report — page ${String(at + 1)}`, { x: 72, y: 700, size: 22, font: bold });
    for (let line = 0; line < 22; line += 1) {
      page.drawText('Revenue grew across all three regions, led by the northern accounts and renewals.', {
        x: 72,
        y: 660 - line * 24,
        size: 11,
        font,
      });
    }
  }
  return document.save();
}

/** The id the shim gives the sample document, for an option keyed by document such as `saveRefusals`. */
export const SAMPLE_DOC_ID = '00000000-0000-4000-8000-0000000000a1';

/**
 * Loads the application in the light look at the set's size, with the sample document ready to open.
 *
 * @param shim anything a scene needs the shim to hold — merged over the document it opens
 * @param observe `bridge`'s observer, passed through: what the page asked main
 */
export async function openApp(
  page: Page,
  shim: SceneShim = {},
  observe?: (channel: string, params: unknown) => void,
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await samplePdf();
  const docId = asDocId(SAMPLE_DOC_ID);
  await bridgeUnder(
    page,
    LIGHT,
    {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Annual report.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      // THE APPLICATION'S OWN VERSION, never the shim's marker: a picture in the Help centre is of the product.
      version: APP_VERSION,
      ...shim,
    },
    observe,
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}

/** Opens the sample document from the start screen and waits for its pages to draw. */
export async function openDocument(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect.poll(() => page.locator('canvas:visible').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
}

/** Brings a rail section to the front by its name — *Home*, *Comment*, *Organize* and so on. */
export async function openSection(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click();
}

/** Runs a command by its title through the command palette (Ctrl+K), as a person may. */
export async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.keyboard.type(title);
  await page.getByRole('option', { name: title }).first().click();
}

/**
 * Takes screenshot `id`, framed on `target` with `pad` pixels around it — or the whole window.
 *
 * The pointer is parked in a corner and the screen given a moment to settle first, so no hover state and no
 * half-drawn transition is in the picture. The frame is clamped to the window.
 */
export async function shoot(page: Page, id: string, target: Locator | 'window', pad = 16): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.mouse.move(2, 2);
  // THE FACES LOADED AND THE TARGET STILL, in place of a 300 ms sleep: a capture is of what a person sees once it has
  // arrived, and a box read while a popup is placed or a toast slides in is a point on the way.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = join(OUT, `${id}.png`);
  if (target === 'window') {
    await settled(page, () => page.evaluate(() => document.body.getBoundingClientRect().height), () => true, id);
    await page.screenshot({ path });
    return;
  }
  const box = await settled(page, () => target.boundingBox(), (now) => now !== null, id);
  if (box === null) throw new Error(`screenshot ${id}: its target is not on screen`);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const width = Math.min(viewport.width, box.x + box.width + pad) - x;
  const height = Math.min(viewport.height, box.y + box.height + pad) - y;
  await page.screenshot({ path, clip: { x, y, width, height } });
}
