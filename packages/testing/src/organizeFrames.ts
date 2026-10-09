import type { Page } from '@playwright/test';

export type OrganizeFrame = readonly { readonly drawn: string; readonly width: number }[];
export const ORGANIZE_FRAME_COUNT = 120;

/** Records what is actually visible, including an empty frame; shared by Chromium and the built Electron run. */
export async function recordOrganizeFrames(page: Page): Promise<void> {
  await page.evaluate((count) => {
    const frames: { drawn: string; width: number }[][] = [];
    (window as unknown as { organizeFrames: typeof frames }).organizeFrames = frames;
    const tick = (): void => {
      const cards = [...document.querySelectorAll<HTMLElement>('.m-page-grid [data-thumb-page]')].filter((card) => {
        const strip = card.closest('.m-thumbnails')?.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        return getComputedStyle(card).visibility === 'visible' && strip !== undefined && box.bottom > strip.top && box.top < strip.bottom;
      });
      frames.push(cards.map((card) => {
        const canvas = card.querySelector('canvas');
        return { drawn: canvas?.dataset['drawn'] ?? 'none', width: Math.round(canvas?.getBoundingClientRect().width ?? 0) };
      }));
      if (frames.length < count) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ORGANIZE_FRAME_COUNT);
}

export function readOrganizeFrames(page: Page): Promise<OrganizeFrame[]> {
  return page.evaluate(() => (window as unknown as { organizeFrames: OrganizeFrame[] }).organizeFrames);
}
