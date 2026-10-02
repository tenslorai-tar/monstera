import type { Page } from '@playwright/test';

/**
 * Reads, once per frame, whether the screen is FINISHED: the rendered half of the owner's rule *never show an
 * unfinished screen*.
 *
 * ## One predicate, installed once, for every read
 *
 * The per-frame watcher and the settle before it take the same in-page function. Two copies was the first
 * draft, and the settle's copy counted a transparent pixel as dark (its channels are 0), so it passed for pages
 * not drawn yet and the watch started on an unfinished screen. Two rendered cases read frames, so the predicate
 * lives here and both take it (B3a).
 *
 * ## What unfinished means
 *
 * Inside `scope`, among the canvases actually visible: no page canvas at all, or a page or thumbnail canvas that
 * is not a whole page — a transparent
 * pixel (cleared, not yet painted) or no dark pixel (painted white, the fixture's black block not drawn yet). So
 * a fixture for these cases draws a dark block on every page. A `zoom` selector adds the readout's text to each
 * frame's record, for a case asserting the number on show never passes through a wrong value.
 */
export interface FrameLog {
  readonly frames: number;
  readonly unfinished: readonly string[];
  /** Each frame's zoom readout, in order, when a selector was given. */
  readonly zooms: readonly string[];
}

interface Inspector {
  readonly unfinished: () => string[];
  readonly zoom: () => string | undefined;
}

/**
 * Installs the predicate before the page's scripts run.
 *
 * @param scope a selector the canvases must sit inside, e.g. the document layer on show
 * @param zoom a selector for the zoom readout, or `undefined` to record none
 */
export async function installInspector(page: Page, scope: string, zoom?: string): Promise<void> {
  await page.addInitScript(
    ({ within, readout }: { within: string; readout: string | null }) => {
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
          const root = document.querySelector(within);
          // WHAT IS ON SCREEN, not what is in the document: a kept background tab's canvases are laid out under
          // `visibility: hidden` (ADR-0129), and a case must read the same way whether or not a build keeps them.
          const shown = (selector: string): HTMLCanvasElement[] =>
            root === null
              ? []
              : [...root.querySelectorAll<HTMLCanvasElement>(selector)].filter((canvas) =>
                  canvas.checkVisibility({ visibilityProperty: true }),
                );
          // THE LOADING STATE IS A FINISHED SCREEN: a page area saying the document is opening shows no page on purpose
          // (`PageList`'s first frame), where one showing nothing at all is the defect.
          const opening =
            root !== null &&
            [...root.querySelectorAll<HTMLElement>('.m-page-opening')].some((each) =>
              each.checkVisibility({ visibilityProperty: true }),
            );
          const pages = shown('.m-page-list canvas.m-page');
          if (pages.length === 0 && !opening) reasons.push('no page canvas');
          // A THUMBNAIL NOT DRAWN YET is a placeholder in the surface's tone (`app.css`), which reads as loading; one
          // painted the page's white with nothing on it reads as an empty page, and that is still unfinished.
          const pageWhite = ((): string => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--page)';
            document.body.append(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
          })();
          const thumbs = shown('canvas.m-thumb-canvas').filter(
            (canvas) => canvas.dataset['drawn'] !== 'false' || getComputedStyle(canvas).backgroundColor === pageWhite,
          );
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
        zoom: () => (readout === null ? undefined : (document.querySelector(readout)?.textContent ?? '(no readout)')),
      };
      (window as unknown as { __inspector: Inspector }).__inspector = inspector;
    },
    { within: scope, readout: zoom ?? null },
  );
}

/** Starts the per-frame inspection. */
export async function watchFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { __inspector: inspector } = window as unknown as { __inspector: Inspector };
    const state = { frames: 0, unfinished: [] as string[], zooms: [] as string[], running: true };
    (window as unknown as { __frames: typeof state }).__frames = state;
    const inspect = (): void => {
      if (!state.running) return;
      state.frames += 1;
      for (const reason of inspector.unfinished()) state.unfinished.push(`frame ${String(state.frames)}: ${reason}`);
      const zoom = inspector.zoom();
      if (zoom !== undefined) state.zooms.push(zoom);
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
}

export async function stopWatching(page: Page): Promise<FrameLog> {
  return page.evaluate(() => {
    const state = (window as unknown as { __frames: { frames: number; unfinished: string[]; zooms: string[]; running: boolean } })
      .__frames;
    state.running = false;
    return { frames: state.frames, unfinished: state.unfinished, zooms: state.zooms };
  });
}

/** Why the screen is unfinished now, read once with the watcher's own predicate; empty when it is finished. */
export async function unfinishedNow(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __inspector: Inspector }).__inspector.unfinished());
}
