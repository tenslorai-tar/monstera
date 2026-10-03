import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * The FIRST OPEN of a document, read frame by frame in a real browser (the owner's review of 0.1.8.0: after choosing a
 * 2-page PDF, seconds of empty dark placeholders and blank thumbnails, then a flash of the lower part of page 2, then
 * blank, then page 1).
 *
 * ## What every frame is held to
 *
 * Between the click and the moment page 1 is on screen, every frame shows either the loading state or finished pages:
 * no page slot on screen without its drawing, no white thumbnail standing for a page, and no page but page 1 before
 * page 1 has been seen. Then the first frame with a page shows page 1 at its top, at the zoom the reader stays at.
 *
 * ## Main is slow here on purpose
 *
 * The shim answers at once, which would leave too few frames between the click and the page to separate anything.
 * The view model is held back 600 ms, the order of what the engine host took on the owner's 210 MB scan, and the
 * byte ranges 150 ms each, so the open runs through every stage the defect showed in.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f1');

interface Frame {
  readonly opening: boolean;
  /** Each page whose slot is on screen, with whether its drawing is finished. */
  readonly slots: readonly { readonly page: number; readonly finished: boolean; readonly top: number }[];
  readonly whiteThumbs: number;
  readonly zoom: string;
}

/** Records every animation frame from the moment it is called, until `stop` reads the record. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: Frame[] = [];
    const state = { frames, running: true };
    (window as unknown as { __open: typeof state }).__open = state;
    const pageWhite = ((): string => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--page)';
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    })();
    /** Whether a canvas holds a whole page: no transparent pixel, and the fixture's dark block drawn. */
    const finished = (canvas: HTMLCanvasElement): boolean => {
      if (canvas.width === 0 || canvas.height === 0) return false;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return false;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let dark = false;
      for (let y = 0; y < canvas.height; y += 8) {
        for (let x = 0; x < canvas.width; x += 8) {
          const at = (y * canvas.width + x) * 4;
          if ((data[at + 3] ?? 0) === 0) return false;
          if ((data[at] ?? 255) < 64 && (data[at + 1] ?? 255) < 64 && (data[at + 2] ?? 255) < 64) dark = true;
        }
      }
      return dark;
    };
    const step = (): void => {
      if (!state.running) return;
      const scroller = document.querySelector<HTMLElement>('.m-page-list');
      const view = scroller?.getBoundingClientRect();
      const slots: { page: number; finished: boolean; top: number }[] = [];
      if (scroller !== null && view !== undefined && scroller.checkVisibility({ visibilityProperty: true })) {
        [...scroller.querySelectorAll<HTMLElement>('.m-page-slot')].forEach((slot, page) => {
          const box = slot.getBoundingClientRect();
          if (box.height === 0 || box.bottom <= view.top || box.top >= view.bottom) return;
          if (!slot.checkVisibility({ visibilityProperty: true })) return;
          const canvas = slot.querySelector<HTMLCanvasElement>('canvas.m-page');
          slots.push({ page, finished: canvas !== null && finished(canvas), top: Math.round(box.top - view.top) });
        });
      }
      const whiteThumbs = [...document.querySelectorAll<HTMLCanvasElement>('canvas.m-thumb-canvas')].filter(
        (canvas) =>
          canvas.checkVisibility({ visibilityProperty: true }) &&
          !finished(canvas) &&
          (canvas.dataset['drawn'] !== 'false' || getComputedStyle(canvas).backgroundColor === pageWhite),
      ).length;
      frames.push({
        opening: [...document.querySelectorAll<HTMLElement>('.m-page-opening')].some((each) =>
          each.checkVisibility({ visibilityProperty: true }),
        ),
        slots,
        whiteThumbs,
        zoom: document.querySelector('.m-status-zoom')?.textContent ?? '',
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function stop(page: Page): Promise<readonly Frame[]> {
  return page.evaluate(() => {
    const state = (window as unknown as { __open: { frames: Frame[]; running: boolean } }).__open;
    state.running = false;
    return state.frames;
  });
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 1600, height: 852 },
]) {
  test(`FIRST OPEN at ${String(size.width)} × ${String(size.height)}: the loading state, then page 1 finished — never an empty slot, a white thumbnail or page 2 first`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const bytes = await blockedPages([612, 792], 2);
    const asked: string[] = [];
    await bridge(
      page,
      {
        opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'two.pdf' }],
        documentBytes: new Map([[DOC, bytes]]),
        delays: { 'document.viewModel': 600, 'document.readRange': 150 },
      },
      (channel, params) => {
        if (channel === 'document.viewModel' || channel === 'document.pageTextLayer' || channel === 'document.annotations') {
          asked.push(`${channel} ${JSON.stringify((params as { pages?: unknown }).pages ?? '')}`);
        }
      },
    );
    await page.goto('/');
    await record(page);
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    // SETTLED ON WHAT A PERSON SEES, page 1 drawn on screen — never on this build's own marker, so the case reads the
    // same against a build that has none, which is what lets it be its own control.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { __open: { frames: Frame[] } }).__open.frames.some((frame) =>
              frame.slots.some((slot) => slot.page === 0 && slot.finished),
            ),
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.waitForTimeout(800);
    const frames = await stop(page);
    // WHAT EACH STEP COST HERE, printed for the record and asserted only in order: the shim's times are the delays set
    // above, and the real ones are read from the same marks on the machine that runs the build.
    const marks = await page.evaluate(() =>
      performance
        .getEntriesByType('mark')
        .filter((mark) => mark.name.startsWith('monstera:'))
        .map((mark) => ({ name: mark.name, at: Math.round(mark.startTime) })),
    );
    console.log(`first open at ${String(size.width)}: ${JSON.stringify(marks)}`);
    const at = (name: string): number => marks.find((mark) => mark.name === name)?.at ?? Number.NaN;
    expect(at('monstera:parsed')).toBeLessThanOrEqual(at('monstera:rotation'));
    expect(at('monstera:rotation')).toBeLessThanOrEqual(at('monstera:page-box'));
    expect(at('monstera:page-box')).toBeLessThanOrEqual(at('monstera:first-frame'));

    const firstPage = frames.findIndex((frame) => frame.slots.length > 0);
    expect(firstPage).toBeGreaterThan(0);
    const problems: string[] = [];
    frames.forEach((frame, at) => {
      for (const slot of frame.slots) {
        if (!slot.finished) problems.push(`frame ${String(at)}: page ${String(slot.page + 1)} on screen, not drawn`);
      }
      if (frame.whiteThumbs > 0) problems.push(`frame ${String(at)}: ${String(frame.whiteThumbs)} white thumbnail(s)`);
    });
    expect(problems.slice(0, 10)).toStrictEqual([]);
    // PAGE 1 FIRST, AT ITS TOP: the first frame with a page shows page 1 from the scroller's top.
    expect(frames[firstPage]?.slots[0]).toStrictEqual({ page: 0, finished: true, top: frames[firstPage]?.slots[0]?.top });
    expect(frames[firstPage]?.slots[0]?.top).toBeLessThanOrEqual(24);
    // NO JUMP: from the first frame with a page on, page 1's top and the zoom readout never move.
    const after = frames.slice(firstPage);
    expect(new Set(after.map((frame) => frame.slots.find((slot) => slot.page === 0)?.top)).size).toBe(1);
    expect(new Set(after.map((frame) => frame.zoom)).size).toBe(1);
    // THE LOADING STATE WAS SHOWN in the frames before: the case saw the open's stages, not a document already there.
    expect(frames.slice(0, firstPage).filter((frame) => frame.opening).length).toBeGreaterThan(5);
    // THE FIRST PAGE FIRST in main's lane: the spine's view model is asked before any page's text, any mark, or the
    // strip's pages.
    expect(asked[0]).toMatch(/^document\.viewModel \[0/u);
  });
}
