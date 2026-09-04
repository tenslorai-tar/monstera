import { describe, expect, it } from 'vitest';

import { parsePageRanges } from './pageRanges.js';

/**
 * The one parser for a page-range expression.
 *
 * ## The fixtures are all on a TEN-page document, and none of them is `1`
 *
 * A one-page fixture makes "converted from 1-based" and "did not convert"
 * indistinguishable for the first page, and a range whose ends coincide with
 * the document's makes an out-of-range check that never fires look correct.
 */
const PAGES = 10;

/** The value, refusing a parse this case expected to succeed. */
function parsed(text: string, pageCount = PAGES): readonly number[] {
  const outcome = parsePageRanges(text, pageCount);
  if (!outcome.ok) throw new Error(`expected a parse, got ${outcome.error.kind}`);
  return outcome.value;
}

/** The problem, refusing a parse this case expected to fail. */
function refused(text: string, pageCount = PAGES): string {
  const outcome = parsePageRanges(text, pageCount);
  if (outcome.ok) throw new Error(`expected a refusal, got [${outcome.value.join(', ')}]`);
  return outcome.error.kind;
}

describe('parsePageRanges', () => {
  it('CONVERTS FROM ONE-BASED, which a fixture starting at page 1 cannot show', () => {
    // `3` is the third page a person sees and index 2 in the document model. A
    // parser that skipped the conversion answers [3], which is a real page and
    // the wrong one — the exact class of defect `pageNumbering.ts` exists for.
    expect(parsed('3')).toStrictEqual([2]);
  });

  it('expands a range INCLUSIVELY at both ends', () => {
    // An exclusive upper end answers [1, 2] here, which is a plausible list of
    // real pages — so the last element is the whole assertion.
    expect(parsed('2-4')).toStrictEqual([1, 2, 3]);
  });

  it('takes several parts, and tolerates the spacing a person types', () => {
    expect(parsed('1-3, 5')).toStrictEqual([0, 1, 2, 4]);
    expect(parsed(' 1-3 ,5 ')).toStrictEqual([0, 1, 2, 4]);
  });

  it('ANSWERS A SET: sorted, de-duplicated, and independent of the order typed', () => {
    // Three spellings of one request. A parser that returned them in the order
    // given would make `5,1` and `1,5` different answers to the same question,
    // and every consumer would have to sort — which is the second opinion this
    // module exists to prevent.
    expect(parsed('5, 1')).toStrictEqual([0, 4]);
    expect(parsed('1, 1, 5')).toStrictEqual([0, 4]);
    expect(parsed('1-3, 2-4')).toStrictEqual([0, 1, 2, 3]);
  });

  it('REFUSES a part it cannot read rather than dropping it', () => {
    // The whole point of the refusal: `1, x` parses `1` perfectly well, and a
    // parser that returned [0] would delete a page out of an expression the
    // user believed said something else.
    expect(refused('1, x')).toBe('not-a-number');
    // `12abc` is what `Number.parseInt` reads as 12, which is why the parser
    // uses a pattern instead.
    expect(refused('12abc')).toBe('not-a-number');
    expect(refused('1-2-3')).toBe('not-a-number');
    expect(refused('')).toBe('empty');
    expect(refused('  ,  ')).toBe('empty');
  });

  it('REFUSES a backwards range rather than reversing it', () => {
    // Reading `5-3` as `3-5` deletes three pages the user did not name, which
    // is the same quiet helpfulness as dropping an unreadable part.
    expect(refused('5-3')).toBe('backwards');
  });

  it('REFUSES a page the document does not have, at either end', () => {
    expect(refused('11')).toBe('out-of-range');
    expect(refused('8-11')).toBe('out-of-range');
    // Zero is not a page anybody sees, and it converts to index -1.
    expect(refused('0')).toBe('out-of-range');
    // CONTROL: the last page itself is in range. Without this, a bound written
    // as `>=` would pass every case above.
    expect(parsed('10')).toStrictEqual([9]);
  });
});
