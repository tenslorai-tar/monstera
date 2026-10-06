/**
 * Which open documents the tab strip draws, as a browser's does (Part A1).
 *
 * Tabs shrink evenly from their widest to their narrowest — CSS does that, `flex-shrink` on every tab alike — and
 * this decides only what happens past the narrowest: how many tabs the row holds there, and which ones they are. The
 * rest are reached through the button that lists every open document, so the row never scrolls.
 */

/**
 * The row as measured: its width, the narrowest a tab is drawn, one end control's width, the gap between two tabs
 * and the gap before each end control. The two gaps are two rules in the stylesheet, so they are read apart.
 */
export interface StripMeasure {
  readonly available: number;
  readonly minimumTab: number;
  readonly control: number;
  readonly tabGap: number;
  readonly controlGap: number;
}

/**
 * How many tabs the row holds at their narrowest, with `count` documents open.
 *
 * Asked first with the one end control every row has (*open another*); only where that does not hold every tab is
 * the second, the list of every document, taken out of the room too — so a row that fits shows no list button. Never
 * fewer than one, because the current document is always drawn.
 */
export function tabCapacity(measure: StripMeasure, count: number): number {
  const fitting = (controls: number): number => {
    const room = measure.available - controls * (measure.control + measure.controlGap);
    // ONE GAP FEWER THAN TABS: `n` tabs at the narrowest take `n * minimum + (n - 1) * gap`.
    return Math.floor((room + measure.tabGap) / (measure.minimumTab + measure.tabGap));
  };
  const withOne = fitting(1);
  if (count <= withOne) return count;
  return Math.max(1, fitting(2));
}

/**
 * The indices of the tabs drawn: the first `capacity` in their own order, with the current one in the last place
 * when it would otherwise be left out — so it is always drawn whole, with its close button, and the row keeps its
 * order for the keyboard and a screen reader.
 */
export function tabsShown(count: number, current: number, capacity: number): readonly number[] {
  if (count <= capacity) return Array.from({ length: count }, (_, at) => at);
  const first = Array.from({ length: capacity }, (_, at) => at);
  if (current < 0 || current < capacity) return first;
  return [...first.slice(0, capacity - 1), current];
}
