/**
 * Which elements of the Properties tab are CARDS, and which of its controls sit outside one (Addendum 3, 2026-10-18):
 * every property group in its own closed box, in every view the tab shows.
 *
 * ## The card classes are a COPY of `app.css`'s one card rule
 *
 * The rule that draws a card is CSS, which a component cannot import, so the selector list is written in both places and
 * `propertyCards.test.ts` proves them equal: a card class added to one and not the other turns it red.
 */

/** The card rule's selectors, in its order: the E2 card the left panel's lists take, and the Properties groups. */
export const CARD_CLASSES = [
  'm-card',
  'm-list-card',
  'm-properties__row',
  'm-properties__check',
  'm-text-section__row',
  'm-text-section__font',
  'm-text-section__buttons',
  'm-text-section__numbers',
] as const;

/** A control a person operates: what must stand in a card. */
const CONTROL = 'input, select, textarea, button, [role="slider"], [role="radio"], [role="combobox"], [role="switch"], [contenteditable="true"]';

/**
 * Where a control is NOT a property: the panel's head, its foot (Reply, Delete; ADR-0102), which keeps its place, and a
 * section's own title, which stays a title above its cards.
 */
const NOT_A_PROPERTY = '.m-properties__head, .m-properties__foot, summary';

/**
 * Every Properties panel in `document` (`.m-properties`), each control of it outside a card, named by a short piece of
 * its markup: what each view's cases assert empty after every case, so a view a case renders is a view checked.
 */
export function panelControlsOutsideCards(document: Document): string[] {
  return [...document.querySelectorAll('.m-properties')].flatMap((panel) =>
    controlsOutsideCards(panel).map((control) => control.outerHTML.slice(0, 120)),
  );
}

/** Every control under `root` that belongs to a property and has no card around it. */
export function controlsOutsideCards(root: Element): Element[] {
  const card = CARD_CLASSES.map((name) => `.${name}`).join(', ');
  return [...root.querySelectorAll(CONTROL)].filter((control) => control.closest(NOT_A_PROPERTY) === null && control.closest(card) === null);
}
