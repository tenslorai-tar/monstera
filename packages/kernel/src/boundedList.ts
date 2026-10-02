/**
 * A list a walk fills up to a bound, and whether the walk stopped there — the one place *stop at the bound and say so*
 * is written (ADR-0130 Decision 3).
 *
 * Five walks (annotations, form fields, the outline, layers, a page's links) each wrote the rule by hand, and none was
 * reached by a fixture: their bounds are derived from the 8 MiB answer ceiling (44,100 to 239,600 items), so a document
 * that reaches one is minutes to build (finding AAAAAAA-6). Each walk now takes its bound as a parameter defaulting to
 * that ceiling's, and fills this; the rule is proven here, and each walk's use of it on a document of three items.
 *
 * **`room` is asked when there IS another item**, which is what makes `truncated` mean *there was more*: a walk that
 * ends exactly at the bound never asks a third time, so it answers whole.
 */
export class BoundedList<T> {
  readonly #items: T[] = [];
  #truncated = false;

  constructor(readonly bound: number) {}

  /** Whether one more item may be added; `false` once the bound is reached, which records that the walk stopped. */
  room(): boolean {
    if (this.#items.length < this.bound) return true;
    this.#truncated = true;
    return false;
  }

  /** Adds an item the walk was given room for. Past the bound it throws: a walk that skipped `room` is a bug. */
  add(item: T): void {
    if (this.#items.length >= this.bound) throw new RangeError(`an item past the bound of ${String(this.bound)}`);
    this.#items.push(item);
  }

  /** The items, and whether the walk stopped at the bound with more left. */
  answer(): { readonly items: readonly T[]; readonly truncated: boolean } {
    return { items: this.#items, truncated: this.#truncated };
  }
}
