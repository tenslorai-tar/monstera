import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { asDocId, asDocVersion } from '@monstera/shared';
import type { Page } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { PAGE, PICTURE_BOX, PICTURE_PAGES, picturesPdf, undecodablePicturePdf } from './pictureFixtures.js';
import { expect, test } from './renderedTest.js';

/**
 * CCITT, JBIG2 and JPEG 2000 pictures DRAW, under the application's own policy
 * ([ADR-0296](../../../docs/DECISIONS/0296-the-renderer-is-served-from-its-own-scheme-and-a-picture-is-never-dropped-silently.md)).
 *
 * PDF.js 6.2.108 decodes these three only through its image decoders, which the worker imports from `wasmUrl`. None
 * had shipped since PDF.js arrived, so every such picture was dropped whole and a user's PDF, one masked picture a
 * page, drew sixteen blank pages. The fixtures are this repository's own (`pictureFixtures.ts`): one page each, and a
 * fourth shaped like that PDF, a colour picture whose soft mask is CCITT.
 *
 * ## Under the policy the application ships, in the worker too
 *
 * The decoders must run where the policy refuses WebAssembly and eval, in the window and in the PDF.js worker, so
 * every response here carries `CONTENT_SECURITY_POLICY` from the built shell, the constant `proof:rendererpolicy` holds
 * equal to §9.27. A worker takes its policy from its own response, so the case first starts a probe worker of its own
 * through the same route and requires eval to be refused inside it: without that, a route that missed the worker's
 * requests would leave PDF.js's worker free to compile WebAssembly, and the case would pass for the wrong reason.
 *
 * ## The control
 *
 * Without the decoders shipped beside the bundle, or without `wasmUrl`, every picture comes out the page's white and
 * `renderedTest.ts` fails the case on PDF.js's report (measured on this case, 2026-11-17, with the build's decoder step
 * removed). Each page is read at two points, so a picture drawn without its mask fails as surely as one not drawn.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000d1');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The shipped policy, from the built shell: `apps/desktop` is not a dependency of this package, so it is read built. */
async function shippedPolicy(): Promise<string> {
  const policy: unknown = (await import(pathToFileURL(join(REPO_ROOT, 'apps', 'desktop', 'dist', 'windowPolicy.js')).href) as Record<string, unknown>)[
    'CONTENT_SECURITY_POLICY'
  ];
  if (typeof policy !== 'string' || !policy.includes("script-src 'self'")) throw new Error('the built shell carries no policy; run the build first');
  return policy;
}

/** A probe a worker runs: whether eval raised a `script-src` violation inside it. */
const WORKER_PROBE = [
  'const seen = [];',
  "self.addEventListener('securitypolicyviolation', (event) => { seen.push(event.effectiveDirective); });",
  "try { new Function('return 1')(); } catch {}",
  'setTimeout(() => { postMessage(seen); }, 200);',
].join('\n');

/** The colour at a point of the page's picture box, `across` and `down` as fractions of the box from its top left. */
async function colourAt(page: Page, pageIndex: number, across: number, down: number): Promise<string> {
  const canvas = page.locator(`.m-page-list canvas[data-page-canvas="${String(pageIndex)}"]`);
  return canvas.evaluate(
    (element: HTMLCanvasElement, at) => {
      const context = element.getContext('2d');
      if (context === null || element.width === 0) return 'no canvas';
      const [red, green, blue] = context.getImageData(Math.floor(at.x * element.width), Math.floor(at.y * element.height), 1, 1).data;
      return `${String(red)},${String(green)},${String(blue)}`;
    },
    {
      x: (PICTURE_BOX.x + across * PICTURE_BOX.width) / PAGE.width,
      y: (PAGE.height - PICTURE_BOX.y - PICTURE_BOX.height + down * PICTURE_BOX.height) / PAGE.height,
    },
  );
}

test('CCITT, JBIG2 and JPEG 2000 pictures draw under the shipped policy, a CCITT soft mask included (ADR-0296)', async ({ page }) => {
  test.setTimeout(120_000);
  const policy = await shippedPolicy();
  // EVERY RESPONSE, the worker's included, carries the policy, and the probe's file is answered here.
  await page.context().route('**/*', async (route) => {
    if (route.request().url().endsWith('/policy-probe-worker.js')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: WORKER_PROBE, headers: { 'content-security-policy': policy } });
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
  const bytes = await picturesPdf();
  await page.setViewportSize({ width: 1280, height: 900 });
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'pictures.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');

  // THE POLICY REACHES A WORKER: eval is refused inside one, as it is in PDF.js's.
  const inWorker = await page.evaluate(
    () =>
      new Promise<string[]>((done) => {
        const worker = new Worker('./policy-probe-worker.js');
        worker.onmessage = (event: MessageEvent<string[]>) => {
          done(event.data);
        };
        worker.onerror = () => {
          done(['the probe worker did not start']);
        };
      }),
  );
  expect(inWorker.some((directive) => directive.startsWith('script-src'))).toBe(true);

  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const expected: Record<(typeof PICTURE_PAGES)[number], { left: (rgb: number[]) => boolean; right: (rgb: number[]) => boolean }> = {
    ccitt: { left: dark, right: dark },
    jbig2: { left: dark, right: dark },
    // MID-GREY: the codestream's every coefficient is zero, which the level shift makes 128.
    jpx: { left: grey, right: grey },
    // RED WHERE THE MASK IS WHITE, and the page's own white where it is black.
    masked: { left: red, right: white },
  };
  for (const [index, name] of PICTURE_PAGES.entries()) {
    const slot = page.locator('.m-page-list .m-page-slot').nth(index);
    await slot.scrollIntoViewIfNeeded();
    await expect(page.locator(`.m-page-list canvas[data-page-canvas="${String(index)}"]`)).toBeVisible({ timeout: 30_000 });
    const want = expected[name];
    await expect.poll(async () => want.left(rgbOf(await colourAt(page, index, 0.25, 0.5))), { timeout: 30_000, message: `${name}, left` }).toBe(true);
    await expect.poll(async () => want.right(rgbOf(await colourAt(page, index, 0.75, 0.5))), { timeout: 30_000, message: `${name}, right` }).toBe(true);
  }
  await expect(page.locator('.m-page-list canvas[data-failed]')).toHaveCount(0);
});

test.describe('a picture NO decoder can read', () => {
  // THE REPORT IS THIS CASE'S SUBJECT, and the fixture fails the case if PDF.js does NOT make it (`renderedTest.ts`).
  test.use({ undecodedPictures: 'expected' });

  test('is said on its page, not dropped in silence (ADR-0296 Decision 4)', async ({ page }) => {
    test.setTimeout(120_000);
    const bytes = await undecodablePicturePdf();
    await page.setViewportSize({ width: 1280, height: 900 });
    await bridge(page, {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'broken.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    const note = page.locator('.m-page-list [data-page-missing="pictures"]');
    await expect(note).toBeVisible({ timeout: 30_000 });
    await expect(note).toContainText('could not be shown');
    // NOT A FAILED PAGE: the page drew what it could, and says what it lacks.
    await expect(page.locator('.m-page-list canvas[data-failed]')).toHaveCount(0);
  });
});

function rgbOf(text: string): number[] {
  return text.split(',').map(Number);
}
const dark = ([r = 255, g = 255, b = 255]: number[]): boolean => r < 60 && g < 60 && b < 60;
const grey = ([r = 0, g = 0, b = 0]: number[]): boolean => [r, g, b].every((channel) => channel > 100 && channel < 160);
const red = ([r = 0, g = 255, b = 255]: number[]): boolean => r > 200 && g < 60 && b < 60;
const white = ([r = 0, g = 0, b = 0]: number[]): boolean => r > 230 && g > 230 && b > 230;
