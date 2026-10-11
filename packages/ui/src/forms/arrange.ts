import type { AnnotationRect, FormFieldHandle } from '@monstera/contract';

/**
 * Lining several form fields up, and making them one size (the owner's *align and same size*, ADR-0193).
 *
 * ## Rectangles are in PDF user space, where UP is a larger y
 *
 * A field's `rect` is the writer's own space (`formFieldEdit.ts` writes `/Rect` as it is given), so *top* is the largest
 * `y1` and *bottom* the smallest `y0`, and nothing here flips a y (`monstera/no-bare-y-flip`).
 *
 * ## The anchor
 *
 * The edges align to the extreme of the selection (all left edges to the leftmost), and a centring or a size follows the
 * FIRST field selected, which is the one the pane shows and the one a person picked first. A resize keeps each field's
 * top left corner where it is.
 *
 * ## Only the fields that change
 *
 * A field already where it should be is left out, so aligning an aligned form is no command at all (and no undo step).
 */
export const ARRANGEMENTS = [
  'align-left',
  'align-right',
  'align-top',
  'align-bottom',
  'centre-horizontally',
  'centre-vertically',
  'same-width',
  'same-height',
  'same-size',
] as const;

export type Arrangement = (typeof ARRANGEMENTS)[number];

/**
 * Spreading three or more fields evenly (the owner's B3 *Distribute*): the two outermost stay where they are and the
 * ones between are moved so every gap between neighbours is the same. Across from left to right, or down the page from
 * the top, which in user space is from the LARGEST y.
 */
export const DISTRIBUTIONS = ['distribute-horizontally', 'distribute-vertically'] as const;

export type Distribution = (typeof DISTRIBUTIONS)[number];

/** The fewest fields a distribution has anything to do with: two have no field between them to move. */
export const DISTRIBUTE_AT_LEAST = 3;

function distribute(kind: Distribution, all: readonly PlacedField[]): readonly PlacedField[] {
  if (all.length < DISTRIBUTE_AT_LEAST) return [];
  const across = kind === 'distribute-horizontally';
  const start = (rect: AnnotationRect): number => (across ? rect.x0 : -rect.y1);
  const size = (rect: AnnotationRect): number => (across ? rect.x1 - rect.x0 : rect.y1 - rect.y0);
  const ordered = [...all].sort((a, b) => start(a.rect) - start(b.rect));
  const firstOne = ordered[0];
  const lastOne = ordered[ordered.length - 1];
  if (firstOne === undefined || lastOne === undefined) return [];
  const span = start(lastOne.rect) + size(lastOne.rect) - start(firstOne.rect);
  const gap = (span - ordered.reduce((sum, each) => sum + size(each.rect), 0)) / (ordered.length - 1);
  const moved: PlacedField[] = [];
  let at = start(firstOne.rect);
  for (const each of ordered) {
    const shift = at - start(each.rect);
    const next = across
      ? { ...each.rect, x0: each.rect.x0 + shift, x1: each.rect.x1 + shift }
      : { ...each.rect, y0: each.rect.y0 - shift, y1: each.rect.y1 - shift };
    if (!same(next, each.rect)) moved.push({ field: each.field, rect: next });
    at += size(each.rect) + gap;
  }
  return moved;
}

/** A selected field and where it is. */
export interface PlacedField {
  readonly field: FormFieldHandle;
  readonly rect: AnnotationRect;
}

/** A rectangle with its corners in order: the smaller x and y first. */
function normal(rect: AnnotationRect): AnnotationRect {
  return {
    x0: Math.min(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    x1: Math.max(rect.x0, rect.x1),
    y1: Math.max(rect.y0, rect.y1),
  };
}

/** Where one field goes for an arrangement, given the first field and the extremes of the selection. */
function placed(kind: Arrangement, rect: AnnotationRect, anchor: AnnotationRect, extent: AnnotationRect): AnnotationRect {
  const width = rect.x1 - rect.x0;
  const height = rect.y1 - rect.y0;
  switch (kind) {
    case 'align-left':
      return { ...rect, x0: extent.x0, x1: extent.x0 + width };
    case 'align-right':
      return { ...rect, x0: extent.x1 - width, x1: extent.x1 };
    case 'align-top':
      return { ...rect, y0: extent.y1 - height, y1: extent.y1 };
    case 'align-bottom':
      return { ...rect, y0: extent.y0, y1: extent.y0 + height };
    case 'centre-horizontally': {
      const centre = (anchor.x0 + anchor.x1) / 2;
      return { ...rect, x0: centre - width / 2, x1: centre + width / 2 };
    }
    case 'centre-vertically': {
      const centre = (anchor.y0 + anchor.y1) / 2;
      return { ...rect, y0: centre - height / 2, y1: centre + height / 2 };
    }
    case 'same-width':
      return { ...rect, x1: rect.x0 + (anchor.x1 - anchor.x0) };
    case 'same-height':
      return { ...rect, y0: rect.y1 - (anchor.y1 - anchor.y0) };
    case 'same-size':
      return { ...rect, x1: rect.x0 + (anchor.x1 - anchor.x0), y0: rect.y1 - (anchor.y1 - anchor.y0) };
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/** Whether two rectangles are the same place, to a thousandth of a point. */
function same(a: AnnotationRect, b: AnnotationRect): boolean {
  const close = (x: number, y: number): boolean => Math.abs(x - y) < 0.001;
  return close(a.x0, b.x0) && close(a.y0, b.y0) && close(a.x1, b.x1) && close(a.y1, b.y1);
}

/**
 * The new place of each field that moves or changes size, or none where the selection is already as asked.
 *
 * @param fields the selected fields in the order they were chosen; the first is the anchor
 */
export function arrange(kind: Arrangement | Distribution, fields: readonly PlacedField[]): readonly PlacedField[] {
  const first = fields[0];
  if (first === undefined || fields.length < 2) return [];
  const all = fields.map((each) => ({ field: each.field, rect: normal(each.rect) }));
  if (kind === 'distribute-horizontally' || kind === 'distribute-vertically') return distribute(kind, all);
  const extent: AnnotationRect = {
    x0: Math.min(...all.map((each) => each.rect.x0)),
    y0: Math.min(...all.map((each) => each.rect.y0)),
    x1: Math.max(...all.map((each) => each.rect.x1)),
    y1: Math.max(...all.map((each) => each.rect.y1)),
  };
  const anchor = normal(first.rect);
  const moved: PlacedField[] = [];
  for (const each of all) {
    const next = placed(kind, each.rect, anchor, extent);
    if (!same(next, each.rect)) moved.push({ field: each.field, rect: next });
  }
  return moved;
}
