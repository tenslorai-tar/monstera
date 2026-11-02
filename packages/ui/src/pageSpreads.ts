import type { PageLayout } from './settings/viewing.js';

/**
 * WHICH PAGES FACE EACH OTHER: the one rule the page list's layout, the wheel that turns a spread and the next and
 * previous commands all take ([ADR-0284](../../../docs/DECISIONS/0284-facing-pages-one-pair-at-a-time-and-a-cover-page-on-the-one-layout-setting.md)
 * Decision 4), so no two of them can pair pages differently. Pages are zero-based, as everything that crosses is.
 *
 * Without a cover page the pages pair 0–1, 2–3. With one, page 0 stands alone and 1–2, 3–4 face each other, as in a
 * printed book. A last page with no partner stands alone.
 */

/** Whether a layout shows pages in facing pairs: Facing, one pair at a time, and Continuous facing. */
export function facesPages(layout: PageLayout): boolean {
  return layout === 'pair' || layout === 'facing';
}

/** The first page of the pair holding `page`. */
export function spreadStart(page: number, cover: boolean): number {
  if (page <= 0) return 0;
  return cover ? 1 + 2 * Math.floor((page - 1) / 2) : 2 * Math.floor(page / 2);
}

/** The pages of the pair holding `page`, in reading order: one or two, never past the document's last. */
export function spreadPages(page: number, pageCount: number, cover: boolean): readonly number[] {
  if (pageCount <= 0) return [];
  const start = spreadStart(Math.min(page, pageCount - 1), cover);
  const alone = cover && start === 0;
  return alone || start + 1 >= pageCount ? [start] : [start, start + 1];
}

/**
 * The first page of the pair after (`1`) or before (`-1`) the one holding `page`, held inside the document: the step
 * next and previous take in a facing layout, and the wheel past a pair's edge.
 */
export function stepSpread(page: number, pageCount: number, cover: boolean, direction: 1 | -1): number {
  if (pageCount <= 0) return 0;
  const start = spreadStart(Math.min(page, pageCount - 1), cover);
  const last = spreadStart(pageCount - 1, cover);
  if (direction === 1) {
    const next = start + (cover && start === 0 ? 1 : 2);
    return Math.min(next, last);
  }
  if (start === 0) return 0;
  return spreadStart(start - 1, cover);
}
