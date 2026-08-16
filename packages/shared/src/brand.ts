/**
 * Nominal typing for values that are structurally identical but must never be
 * interchanged.
 *
 * Five coordinate spaces exist in this application — PdfPoint (y-up),
 * FitzPoint (y-down), ViewportPoint (CSS px), XObjectPoint and RasterPoint —
 * and every one of them is `{x: number, y: number}`. Structural typing happily
 * accepts any of them wherever another is expected, and the resulting bug is
 * invisible: a y-flip that silently assumes rotation 0 and a zero CropBox
 * origin renders correctly on the majority of documents and wrongly on the
 * rest. Branding turns that into a compile error (rule B5, invariant L3).
 *
 * The brand exists only in the type system. `Brand<number, 'Zoom'>` is a
 * `number` at runtime with no wrapper and no cost.
 */
declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

/**
 * Attaches a brand. Deliberately unexported at the barrel: each branded type
 * exposes its own constructor that validates before branding, so there is no
 * general-purpose escape hatch for asserting a value into a space it does not
 * belong to.
 */
export function brandValue<T, TBrand extends string>(value: T): Brand<T, TBrand> {
  return value as Brand<T, TBrand>;
}
