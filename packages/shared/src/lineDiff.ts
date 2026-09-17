/**
 * The lines one page's text has that another's does not — D8's *document compare*, its one rule.
 *
 * ## A longest common subsequence of LINES, and nothing tuned
 *
 * Two pages are compared as their reading-order lines: what both have in the same order is
 * common, and the rest is `removed` (only in the first) or `added` (only in the second). A line
 * is the unit because it is what the text substrate reports and what a person reads a change
 * in; a word-level diff inside a changed line would be a second rule with its own questions
 * about what a word is.
 *
 * Lines are compared after {@link comparableLine}: runs of whitespace are one space and the ends
 * are trimmed, because two extractions of the same words differ in spacing that nobody sees.
 *
 * ## The table is only as large as the part that differs
 *
 * The common head and tail are removed before the table is built, so two nearly identical
 * pages cost almost nothing, and the table is `(n + 1) × (m + 1)` 32-bit cells over what is
 * left — a page of 2,048 lines against another, entirely different, is 16.8 MB for the length
 * of one call.
 */

/** One line only one side has, in the order a reader meets the changes. */
export interface LineChange {
  readonly kind: 'removed' | 'added';
  /** The line as it appears on its side, unnormalised. */
  readonly text: string;
}

/** A line as compared: whitespace runs are one space, and the ends are trimmed. */
export function comparableLine(line: string): string {
  return line.replace(/\s+/gu, ' ').trim();
}

/**
 * The changes that turn `before` into `after`: removals and additions, interleaved in reading
 * order, with a removal before the addition that replaces it.
 */
export function diffLines(before: readonly string[], after: readonly string[]): readonly LineChange[] {
  const left = before.map(comparableLine);
  const right = after.map(comparableLine);

  let head = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head += 1;
  let tail = 0;
  while (
    tail < left.length - head &&
    tail < right.length - head &&
    left[left.length - 1 - tail] === right[right.length - 1 - tail]
  ) {
    tail += 1;
  }

  const n = left.length - head - tail;
  const m = right.length - head - tail;
  const width = m + 1;
  // `common[i * width + j]`: the common length of the first-side lines from `head + i` and the
  // second-side lines from `head + j`, to the start of the tail.
  const common = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        left[head + i] === right[head + j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0);
    }
  }

  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && left[head + i] === right[head + j]) {
      i += 1;
      j += 1;
    } else if (j === m || (i < n && (common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0))) {
      changes.push({ kind: 'removed', text: before[head + i] ?? '' });
      i += 1;
    } else {
      changes.push({ kind: 'added', text: after[head + j] ?? '' });
      j += 1;
    }
  }
  return changes;
}
