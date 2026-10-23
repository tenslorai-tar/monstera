import type { Matrix } from './textOperators.js';

/**
 * What an edit of one object in a page's content writes with
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)):
 * a number as a content stream says one, a matrix's inverse, and a box. Kept apart from the writer that splices, so the
 * text block's writer can take the same spellings when it carries a block (B3a).
 */

/** A box in page space. */
export interface PageBox {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

/**
 * A number as a content stream writes one: no exponent, no trailing zeros, and TEN decimals, because a matrix in an
 * object's own space is scaled by that space: six decimals under a 120-point photo moved it by 6e-5 pt (ADR-0240).
 */
export function written(value: number): string {
  const fixed = value.toFixed(10).replace(/\.?0+$/u, '');
  return fixed === '-0' ? '0' : fixed;
}

/** A matrix's inverse, or `null` for one that collapses the page. */
export function inverse([a, b, c, d, e, f]: Matrix): Matrix | null {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** The box of some points. */
export function boxOfPoints(points: readonly (readonly [number, number])[]): PageBox {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}
