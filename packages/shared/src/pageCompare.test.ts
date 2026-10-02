import { describe, expect, it } from 'vitest';

import {
  type CompareAnnotation,
  type CompareLine,
  type ComparePage,
  type CompareRaster,
  FULL_ALIGNMENT_CELLS,
  LAYOUT_MOVE_POINTS,
  alignPages,
  comparePair,
  signPage,
} from './pageCompare.js';

/**
 * Fixtures that SEPARATE each kind of change (ADR-0131): every case changes one thing, and its control is the same
 * page with that one thing left alone, which must report nothing. A fixture the old page-by-number rule would also
 * pass is not used for the page-matching cases: an inserted page in the MIDDLE, so a shift would mark every page after.
 */

const SIZE = { width: 200, height: 200 };

/** A line at `x, y`, ten points tall, five points per character — the estimate's own arithmetic, so boxes are exact. */
function line(text: string, x: number, y: number): CompareLine {
  return { text, box: { x0: x, y0: y, x1: x + text.length * 5, y1: y + 10 } };
}

/** A white raster at one pixel per point, with dark squares where asked. */
function raster(squares: readonly { x: number; y: number; size: number }[] = []): CompareRaster {
  const luminance = new Uint8Array(SIZE.width * SIZE.height).fill(255);
  for (const { x, y, size } of squares) {
    for (let row = y; row < y + size; row += 1) {
      for (let column = x; column < x + size; column += 1) luminance[row * SIZE.width + column] = 0;
    }
  }
  return { width: SIZE.width, height: SIZE.height, pixelsPerPoint: 1, luminance };
}

function page(lines: readonly CompareLine[], extra: Partial<ComparePage> = {}): ComparePage {
  return { size: SIZE, lines, annotations: [], raster: raster(), ...extra };
}

const signature = (lines: readonly CompareLine[], thumbnail?: CompareRaster) => signPage(lines, thumbnail);

describe('page matching — an inserted page is reported as one, and the pages after it still match', () => {
  const a = [line('Section one describes the delivery terms and dates', 10, 10)];
  const b = [line('Section two lists the prices for every service offered', 10, 10)];
  const c = [line('Section three covers termination and notice periods here', 10, 10)];
  const x = [line('An inserted appendix about something else entirely new', 10, 10)];

  it('A B C against A X B C: X inserted, and A, B and C each matched to themselves', () => {
    const steps = alignPages([a, b, c].map((each) => signature(each)), [a, x, b, c].map((each) => signature(each)));
    expect(steps.map((step) => step.kind)).toStrictEqual(['matched', 'inserted', 'matched', 'matched']);
    expect(steps.filter((step) => step.kind === 'matched').map((step) => [step.left, step.right])).toStrictEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
    // AND THE MATCHED PAIRS HAVE NOTHING TO REPORT, which page-by-number could not say: B against X, C against B.
    expect(comparePair(page(b), page(b))).toStrictEqual([]);
  });

  it('CONTROL: compared by page number, the same documents differ on every page after the insertion', () => {
    // WHAT THE OLD RULE WOULD HAVE PAIRED: left page i with right page i.
    expect(comparePair(page(b), page(x)).length).toBeGreaterThan(0);
    expect(comparePair(page(c), page(b)).length).toBeGreaterThan(0);
  });

  it('a removed page is reported as removed, and the rest still match', () => {
    const steps = alignPages([a, b, c].map((each) => signature(each)), [a, c].map((each) => signature(each)));
    expect(steps.map((step) => step.kind)).toStrictEqual(['matched', 'removed', 'matched']);
  });

  it('pages with no words (scans) are matched by their pictures, and a different picture is not matched', () => {
    const scanA = raster([{ x: 20, y: 20, size: 80 }]);
    const scanB = raster([{ x: 120, y: 120, size: 60 }]);
    expect(alignPages([signature([], scanA)], [signature([], scanA)]).map((step) => step.kind)).toStrictEqual(['matched']);
    expect(alignPages([signature([], scanA)], [signature([], scanB)]).map((step) => step.kind)).toStrictEqual([
      'removed',
      'inserted',
    ]);
  });

  it('past the full table, the banded one still reports a single inserted page in the middle', () => {
    // MORE THAN FULL_ALIGNMENT_CELLS cells, so this takes the banded path.
    const count = Math.ceil(Math.sqrt(FULL_ALIGNMENT_CELLS)) + 1;
    const pages = Array.from({ length: count }, (_, at) => [line(`Page ${String(at)} words alpha${String(at)} beta${String(at)} gamma${String(at)}`, 10, 10)]);
    const inserted = [line('A brand new page with entirely different words in it', 10, 10)];
    const right = [...pages.slice(0, 1000), inserted, ...pages.slice(1000)];
    const steps = alignPages(pages.map((each) => signature(each)), right.map((each) => signature(each)));
    expect(steps.flatMap((step) => (step.kind === 'inserted' ? [step.right] : []))).toStrictEqual([1000]);
    expect(steps.filter((step) => step.kind === 'removed')).toStrictEqual([]);
  });
});

describe('a matched pair — each kind of change, boxed on both pages', () => {
  it('a TEXT edit names the words and boxes them where each side has them', () => {
    const changes = comparePair(page([line('The quick brown fox jumps', 10, 10)]), page([line('The quick red fox jumps', 10, 10)]));
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change?.kind).toBe('text');
    expect(change?.removed).toBe('brown');
    expect(change?.inserted).toBe('red');
    // "brown" starts at character 10 and "red" at character 10, five points a character from x = 10.
    expect(change?.left).toStrictEqual([{ x0: 60, y0: 10, x1: 85, y1: 20 }]);
    expect(change?.right).toStrictEqual([{ x0: 60, y0: 10, x1: 75, y1: 20 }]);
  });

  it('a PUNCTUATION edit is a text change, and a CJK edit boxes the character rather than the line', () => {
    const stop = comparePair(page([line('The quick brown fox.', 10, 10)]), page([line('The quick brown fox,', 10, 10)]));
    expect(stop.map((change) => [change.removed, change.inserted])).toStrictEqual([['.', ',']]);
    // TEN CHARACTERS AND NO SPACE: a whitespace split makes this one token, so the edit would box all fifty points.
    const cjk = comparePair(page([line('今天天气很好我们去公园', 10, 10)]), page([line('今天天气很坏我们去公园', 10, 10)]));
    expect(cjk).toHaveLength(1);
    const width = (cjk[0]?.left[0]?.x1 ?? 0) - (cjk[0]?.left[0]?.x0 ?? 0);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(50);
  });

  it('CONTROL: the same page reports nothing', () => {
    const same = page([line('The quick brown fox jumps', 10, 10)], { raster: raster([{ x: 100, y: 100, size: 20 }]) });
    expect(comparePair(same, same)).toStrictEqual([]);
  });

  it('a MOVED IMAGE is a picture change where it was and where it is, with no text change', () => {
    const words = [line('A caption that does not change', 10, 10)];
    const changes = comparePair(
      page(words, { raster: raster([{ x: 40, y: 60, size: 24 }]) }),
      page(words, { raster: raster([{ x: 120, y: 140, size: 24 }]) }),
    );
    expect(changes.map((change) => change.kind)).toStrictEqual(['graphics', 'graphics']);
    // EACH REGION ON BOTH PAGES, at the same place, so the reader sees where it left and where it arrived.
    for (const change of changes) expect(change.left).toStrictEqual(change.right);
    expect(changes.map((change) => change.left[0]?.y0)).toStrictEqual([56, 136]);
  });

  it('a CHANGED ANNOTATION is one change, and its own pixels are not reported again as a picture', () => {
    const note = (contents: string): CompareAnnotation => ({ kind: 'text', box: { x0: 150, y0: 20, x1: 170, y1: 40 }, contents, colour: [1, 1, 0] });
    const words = [line('An unchanged paragraph of words', 10, 10)];
    const changes = comparePair(
      page(words, { annotations: [note('Approve')], raster: raster([{ x: 150, y: 20, size: 20 }]) }),
      page(words, { annotations: [note('Reject')], raster: raster([{ x: 152, y: 22, size: 16 }]) }),
    );
    expect(changes).toStrictEqual([
      {
        kind: 'annotation',
        left: [{ x0: 150, y0: 20, x1: 170, y1: 40 }],
        right: [{ x0: 150, y0: 20, x1: 170, y1: 40 }],
        annotation: { kind: 'text', what: 'changed' },
      },
    ]);
  });

  it('an annotation only one side has is added or removed; CONTROL: the same annotation reports nothing', () => {
    const mark: CompareAnnotation = { kind: 'highlight', box: { x0: 10, y0: 50, x1: 90, y1: 60 }, contents: '', colour: [1, 1, 0] };
    const words = [line('Words under a highlight here', 10, 50)];
    expect(comparePair(page(words, { annotations: [mark] }), page(words)).map((change) => change.annotation?.what)).toStrictEqual(['removed']);
    expect(comparePair(page(words), page(words, { annotations: [mark] })).map((change) => change.annotation?.what)).toStrictEqual(['added']);
    expect(comparePair(page(words, { annotations: [mark] }), page(words, { annotations: [mark] }))).toStrictEqual([]);
  });

  it(`LAYOUT: the same line moved more than ${String(LAYOUT_MOVE_POINTS)} points is a layout change, and a smaller move is not`, () => {
    const text = 'A paragraph that keeps its words';
    const far = comparePair(page([line(text, 10, 10)]), page([line(text, 10, 40)]));
    expect(far.map((change) => change.kind)).toStrictEqual(['layout']);
    expect(far[0]?.left).toStrictEqual([line(text, 10, 10).box]);
    expect(far[0]?.right).toStrictEqual([line(text, 10, 40).box]);
    expect(comparePair(page([line(text, 10, 10)]), page([line(text, 12, 12)]))).toStrictEqual([]);
  });

  it('a page that changed size is a layout change of the page, reported first', () => {
    const words = [line('Same words on a larger sheet', 10, 10)];
    const changes = comparePair(page(words), { ...page(words), size: { width: 200, height: 260 } });
    expect(changes[0]?.kind).toBe('layout');
    expect(changes[0]?.pageSize).toBe(true);
  });
});
