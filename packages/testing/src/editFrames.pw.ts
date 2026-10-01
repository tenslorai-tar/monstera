import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * An edit never shows an unfinished screen, read frame by frame in a real browser.
 *
 * ## The mechanism this holds shut
 *
 * Every command moves the document's version, and a new version opens a new view (ADR-0031: the
 * old view's byte offsets belong to bytes that no longer exist). Two things blanked the pages while
 * that happened. The view hook cleared the shown view in its cleanup, before the new one had
 * opened, so the page area rendered empty until the parse finished. And each page draw sized the
 * canvas on screen first, which clears it, and then let PDF.js paint into it across tasks, so a
 * page was transparent, then white, then whole.
 *
 * ## How a frame is read
 *
 * A `requestAnimationFrame` loop inspects the page area once per frame, before that frame paints,
 * from the moment before the command until the edit has settled. A frame is UNFINISHED when the
 * page area holds no page canvas, or when any page or thumbnail canvas on screen is not a whole
 * page: a transparent pixel (cleared, not yet painted) or no dark pixel (painted white, the
 * fixture's black block not drawn yet). The shim answers the same bytes at every version, so the
 * new view's pages are the old pixels again and any frame between them that is not a whole page is
 * the reopen showing through.
 *
 * A frame where a page is still the PREVIOUS version's whole drawing is finished, and that is the
 * point: the old view stays until the new one has something to show.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000e7');

/** Two Letter pages, each a white page with a black block in its middle third. */
async function blockedPages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let at = 0; at < 2; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawRectangle({ x: 156, y: 246, width: 300, height: 300, color: rgb(0, 0, 0) });
  }
  return document.save();
}

interface FrameLog {
  readonly frames: number;
  readonly unfinished: readonly string[];
}

interface Inspector {
  /** Why the screen is not finished right now, one line per reason; empty when it is. */
  readonly unfinished: () => string[];
}

/**
 * Installs the ONE predicate both reads take: the per-frame watcher and the settle before it.
 *
 * Two copies was the first draft, and the settle's copy counted a transparent pixel as dark (its
 * channels are 0), so it passed for pages not drawn yet and the watch started on an unfinished
 * screen. One function cannot disagree with itself.
 */
async function installInspector(page: Page): Promise<void> {
  await page.addInitScript(() => {
    /** Why a canvas on screen is not a whole page, or `undefined` when it is. */
    const incomplete = (canvas: HTMLCanvasElement): string | undefined => {
      if (canvas.width === 0 || canvas.height === 0) return 'zero-sized';
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return 'no context';
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let dark = false;
      // Every eighth pixel each way: the block is hundreds of pixels across and a cleared canvas is
      // transparent everywhere, so this stride cannot miss either and keeps a frame's read short.
      for (let y = 0; y < canvas.height; y += 8) {
        for (let x = 0; x < canvas.width; x += 8) {
          const at = (y * canvas.width + x) * 4;
          if ((data[at + 3] ?? 0) === 0) return 'transparent pixel';
          if ((data[at] ?? 255) < 64 && (data[at + 1] ?? 255) < 64 && (data[at + 2] ?? 255) < 64) dark = true;
        }
      }
      return dark ? undefined : 'no dark pixel (painted, not drawn)';
    };

    const inspector: Inspector = {
      unfinished: () => {
        const reasons: string[] = [];
        const list = document.querySelector('.m-page-list');
        const pages = list === null ? [] : [...list.querySelectorAll<HTMLCanvasElement>('canvas.m-page')];
        if (pages.length === 0) reasons.push('no page canvas');
        const thumbs = [...document.querySelectorAll<HTMLCanvasElement>('canvas.m-thumb-canvas')];
        for (const [kind, canvases] of [
          ['page', pages],
          ['thumbnail', thumbs],
        ] as const) {
          canvases.forEach((canvas, index) => {
            const why = incomplete(canvas);
            if (why !== undefined) reasons.push(`${kind} ${String(index + 1)} ${why}`);
          });
        }
        return reasons;
      },
    };
    (window as unknown as { __inspector: Inspector }).__inspector = inspector;
  });
}

/** Starts the per-frame inspection in the page. */
async function watchFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { __inspector: inspector } = window as unknown as { __inspector: Inspector };
    const state = { frames: 0, unfinished: [] as string[], running: true };
    (window as unknown as { __frames: typeof state }).__frames = state;
    const inspect = (): void => {
      if (!state.running) return;
      state.frames += 1;
      for (const reason of inspector.unfinished()) state.unfinished.push(`frame ${String(state.frames)}: ${reason}`);
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
}

async function stopWatching(page: Page): Promise<FrameLog> {
  return page.evaluate(() => {
    const state = (window as unknown as { __frames: { frames: number; unfinished: string[]; running: boolean } }).__frames;
    state.running = false;
    return { frames: state.frames, unfinished: state.unfinished };
  });
}

/** Why the screen is unfinished now, read once with the watcher's own predicate; empty when it is finished. */
async function unfinishedNow(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __inspector: Inspector }).__inspector.unfinished());
}

test('an EDIT shows the previous pages or the new ones, never a blank or half-drawn frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages();
  /** Every version a range was asked for: a read above 1 is the view the edit reopened. */
  const rangeVersions = new Set<number>();
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'blocks.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
    },
    (channel, params) => {
      if (channel === 'document.readRange') rangeVersions.add((params as { version: number }).version);
    },
  );
  await installInspector(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // GENEROUS, because these wait for a page to rasterise and are not a product bound
  // (`pagePosition.pw.ts` measured the default missing a first draw on a loaded machine).
  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  expect([...rangeVersions]).toStrictEqual([1]);

  await watchFrames(page);

  // A COMMAND, through the palette as a person runs one: the shim moves the version per command
  // (`browserShim.test.ts`), so the view reopens underneath the pages on screen.
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Rotate page');
  await page.locator('.m-palette-item').filter({ hasText: /^Rotate page$/u }).first().click();

  // THE EDIT REOPENED THE VIEW: a range was read at the version the command moved to. Without
  // this the case passes for a command that never ran, which leaves every frame finished.
  await expect.poll(() => [...rangeVersions].some((version) => version > 1), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  // A SETTLE: frames after the last draw are read too, so a late redraw that clears a page is seen.
  await page.waitForTimeout(500);

  const log = await stopWatching(page);
  // THE LOOP RAN across the edit: a handful of frames is a watcher that stopped, not a clean edit.
  expect(log.frames).toBeGreaterThan(10);
  expect({ unfinished: log.unfinished.length, first: log.unfinished.slice(0, 12) }).toStrictEqual({ unfinished: 0, first: [] });
});
