/**
 * Which of the document's facts the status bar's line holds at a width: its name, its length, its size and whether it
 * is saved.
 *
 * ## A fact is shown whole or not at all
 *
 * Every fact used to shorten with an ellipsis, so at 1024 × 720 — the application's own minimum window — the line read
 * *"8 p… · 1… · Sa…"* (measured in Chromium 151 on 2026-10-03): three facts present and none of them readable. A
 * shortened number says nothing. So the line gives up whole facts instead: the size first, then the length, then the
 * name. Whether the document is saved goes last, because it is the one a person acts on, and only where not even it
 * fits whole — the document's tab says it as well. The name is the one fact that still reads shortened — *Annual
 * rep…* — so while it is shown it may give way down to `nameMin` before the others leave.
 *
 * ## Measured against a ruler, so what is hidden cannot move the answer
 *
 * The widths are each fact as a hidden ruler draws it, and the room is what the bar's end region has once its other
 * controls are drawn, so the answer is a function of the width alone — the menu row's rule (`menuRowFit.ts`).
 */
export type DocumentFact = 'name' | 'pages' | 'size' | 'saved';

/** The line's order on screen. */
export const FACT_ORDER: readonly DocumentFact[] = ['name', 'pages', 'size', 'saved'];

/** The order the facts leave a line too narrow for them. Saved is not in it: it is the last, and leaves only alone. */
export const FACT_DROP_ORDER: readonly DocumentFact[] = ['size', 'pages', 'name'];

/**
 * @param widths each fact as the ruler draws it, whole
 * @param nameMin the least the name may be shortened to while it is shown
 * @param separator the dot between two facts
 * @param gap the space either side of a dot
 * @param room the width the line may take
 */
export function factsThatFit(
  widths: Readonly<Record<DocumentFact, number>>,
  nameMin: number,
  separator: number,
  gap: number,
  room: number,
): ReadonlySet<DocumentFact> {
  const need = (shown: readonly DocumentFact[]): number =>
    shown.reduce((sum, fact) => sum + (fact === 'name' ? Math.min(widths.name, nameMin) : widths[fact]), 0) +
    Math.max(0, shown.length - 1) * (separator + 2 * gap);
  for (let dropped = 0; dropped <= FACT_DROP_ORDER.length; dropped += 1) {
    const gone = new Set(FACT_DROP_ORDER.slice(0, dropped));
    const shown = FACT_ORDER.filter((fact) => !gone.has(fact));
    if (need(shown) <= room) return new Set(shown);
  }
  // NOT EVEN SAVED FITS WHOLE, and a shortened *Sa…* is the defect this module exists to end: the line is empty, and the
  // document's tab still says whether it is saved, from the same answer (`savedState.ts`).
  return new Set();
}
