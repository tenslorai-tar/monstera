import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type CompareBox, type ComparePage, type DocId, asDocId, asDocVersion, comparePair, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type CompareRow, type CompareSide, type DrawnPage, MAX_COMPARE_CHANGES, compareSides } from './sideBySideCompare.js';

const LEFT = asDocId('00000000-0000-4000-8000-00000000c1a1');
const RIGHT = asDocId('00000000-0000-4000-8000-00000000c1b2');
const VERSION = asDocVersion(3);

/** A page of the fake documents: its lines, its annotations, and the dark squares its picture has. */
interface FakePage {
  readonly lines: readonly string[];
  readonly notes?: readonly { readonly contents: string; readonly rect: readonly [number, number, number, number] }[];
  readonly squares?: readonly { readonly x: number; readonly y: number; readonly size: number }[];
}

/** Every page is 200 × 200 points, unturned, its crop box at the origin, so display space is PDF space flipped. */
const PAGE = 200;

/** Line `index` of a page: ten points tall, five points a character, from x = 10 and y = 10 + 20 × index. */
function lineBox(text: string, index: number): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: 10, y0: 10 + 20 * index, x1: 10 + text.length * 5, y1: 20 + 20 * index };
}

/**
 * A client answering both documents through the CONTRACT'S schemas, recording each text read as `side:page` — so a
 * case asserts which pages were paired, and an answer the channels cannot carry fails here rather than in the product.
 */
function clientFor(
  documents: ReadonlyMap<DocId, readonly FakePage[]>,
  options: {
    readonly movedAfter?: number;
    readonly refuse?: boolean;
    /** The engine's word boxes for a line, as `document.pageWordBoxes` answers them; absent, the read boxes nothing. */
    readonly words?: (docId: DocId, page: number) => readonly { text: string; box: CompareBox; boxes: number[] }[];
    readonly refuseWords?: boolean;
  } = {},
): { client: ContractClient; reads: string[]; wordReads: string[] } {
  const reads: string[] = [];
  const wordReads: string[] = [];
  const client = createClient(channels, (id, params) => {
    const docId = (params as { docId: DocId }).docId;
    const pages = documents.get(docId) ?? [];
    if (id === 'document.pageWordBoxes') {
      const page = (params as { page: number }).page;
      wordReads.push(`${docId === LEFT ? 'left' : 'right'}:${String(page)}`);
      if (options.refuseWords === true) return Promise.resolve(err({ code: 'document-poisoned' }));
      return Promise.resolve(ok({ version: VERSION, lines: [...(options.words?.(docId, page) ?? [])], truncated: false }));
    }
    if (id === 'document.annotations') {
      return Promise.resolve(
        ok({
          version: VERSION,
          // ONE PART, the last (ADR-0130): the walk reads the list whole through `readWholeList`.
          next: null,
          truncated: false,
          annotations: pages.flatMap((page, at) =>
            (page.notes ?? []).map((note, index) => ({
              page: at,
              index,
              rect: { x0: note.rect[0], y0: note.rect[1], x1: note.rect[2], y1: note.rect[3] },
              style: { colour: [1, 1, 0], opacity: 1, borderWidth: null },
              kind: 'sticky-note' as const,
              contents: note.contents,
              authored: true,
              inReplyTo: null,
              author: '',
              created: null,
              blend: 'normal' as const,
            })),
          ),
        }),
      );
    }
    if (id !== 'document.pageTextLayer') throw new Error(`unexpected channel ${id}`);
    const page = (params as { page: number }).page;
    reads.push(`${docId === LEFT ? 'left' : 'right'}:${String(page)}`);
    if (options.refuse === true) return Promise.resolve(err({ code: 'document-poisoned' }));
    const moved = options.movedAfter !== undefined && reads.length > options.movedAfter;
    return Promise.resolve(
      ok({
        version: moved ? asDocVersion(4) : VERSION,
        lines: (pages[page]?.lines ?? []).map((text, index) => ({ text, box: lineBox(text, index) })),
        truncated: false,
        kind: 'text' as const,
      }),
    );
  });
  return { client, reads, wordReads };
}

/** A half drawing its pages from the fixture: white, with dark squares, at one pixel per point. */
function side(docId: DocId, pages: readonly FakePage[], drawn: string[] = []): CompareSide {
  return {
    docId,
    version: VERSION,
    pageCount: pages.length,
    draw: (page): Promise<DrawnPage> => {
      drawn.push(`${docId === LEFT ? 'left' : 'right'}:${String(page)}`);
      const luminance = new Uint8Array(PAGE * PAGE).fill(255);
      for (const { x, y, size } of pages[page]?.squares ?? []) {
        for (let row = y; row < y + size; row += 1) {
          for (let column = x; column < x + size; column += 1) luminance[row * PAGE + column] = 0;
        }
      }
      return Promise.resolve({
        raster: { width: PAGE, height: PAGE, pixelsPerPoint: 1, luminance },
        crop: [0, 0, PAGE, PAGE],
        rotation: 0,
      });
    },
  };
}

async function compare(left: readonly FakePage[], right: readonly FakePage[]): Promise<readonly CompareRow[]> {
  const { client } = clientFor(new Map([[LEFT, left], [RIGHT, right]]));
  const outcome = await compareSides(client, side(LEFT, left), side(RIGHT, right), new AbortController().signal, () => undefined);
  if (outcome.kind !== 'done') throw new Error(`the comparison ended ${outcome.kind}`);
  return outcome.result.rows;
}

const intro: FakePage = { lines: ['The agreement between the parties starts here'] };
const terms: FakePage = { lines: ['Payment is due within thirty days of the invoice'] };
const close: FakePage = { lines: ['Either party may end this agreement with notice'] };
const appendix: FakePage = { lines: ['An appendix that the second version added in'] };

/** A fixture page as the pair comparison takes it, with no picture: what `comparePair` sees of a page alone. */
function comparable(page: FakePage): ComparePage {
  return { size: { width: PAGE, height: PAGE }, lines: page.lines.map((text, index) => ({ text, box: lineBox(text, index) })), annotations: [], raster: undefined };
}

describe('Side by Side — the four fixtures ADR-0131 names, through the walk the overlay runs', () => {
  it('an INSERTED PAGE is one row, and the pages after it are matched to their counterparts and report nothing', async () => {
    const rows = await compare([intro, terms, close], [intro, appendix, terms, close]);
    expect(rows).toStrictEqual([{ kind: 'inserted', right: 1, box: { x0: 0, y0: 0, x1: PAGE, y1: PAGE } }]);
  });

  it('CONTROL: the same documents paired page by NUMBER differ on every page after the insertion, and on none before it', () => {
    // PAGE i AGAINST PAGE i, through the pair comparison itself and no alignment: terms meets the appendix and close
    // meets terms. So the case above reporting one row is the alignment's doing, not a fixture any pairing passes.
    const left = [intro, terms, close];
    const right = [intro, appendix, terms, close];
    const byNumber = left.map((page, at) => {
      const other = right[at];
      if (other === undefined) throw new Error(`no right page ${String(at)}`);
      return comparePair(comparable(page), comparable(other)).map((change) => change.kind);
    });
    expect(byNumber[0]).toStrictEqual([]);
    expect(byNumber.slice(1).map((kinds) => kinds.includes('text'))).toStrictEqual([true, true]);
  });

  it('a TEXT EDIT is a text row naming the words, boxed on both pages', async () => {
    const edited: FakePage = { lines: ['Payment is due within sixty days of the invoice'] };
    const rows = await compare([intro, terms], [intro, edited]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.kind).toBe('text');
    if (row?.kind !== 'text') return;
    expect([row.left, row.right, row.change.removed, row.change.inserted]).toStrictEqual([1, 1, 'thirty', 'sixty']);
    expect(row.change.left).toHaveLength(1);
    expect(row.change.right).toHaveLength(1);
  });

  it('a changed word is marked by the ENGINE’S box (ADR-0137) — and CONTROL: a refused word-box read marks it by the estimate', async () => {
    const edited: FakePage = { lines: ['Payment is due within sixty days of the invoice'] };
    const left = [intro, terms];
    const right = [intro, edited];
    // THE ENGINE SAYS "sixty" is printed at 300–340, which no share of the line's characters would put it at.
    const engine = (docId: DocId, page: number) => {
      const text = (docId === LEFT ? left : right)[page]?.lines[0] ?? '';
      const tokens = text.split(' ').length;
      const boxes = Array.from({ length: tokens }, (_, at) => [at * 20, 10, at * 20 + 10, 20]).flat();
      if (docId === RIGHT && page === 1) boxes.splice(4 * 4, 4, 300, 10, 340, 20);
      return [{ text, box: lineBox(text, 0), boxes }];
    };
    const { client, wordReads } = clientFor(new Map([[LEFT, left], [RIGHT, right]]), { words: engine });
    const done = await compareSides(client, side(LEFT, left), side(RIGHT, right), new AbortController().signal, () => undefined);
    if (done.kind !== 'done') throw new Error(done.kind);
    const [row] = done.result.rows;
    expect(row?.kind === 'text' ? row.change.right : undefined).toStrictEqual([{ x0: 300, y0: 10, x1: 340, y1: 20 }]);
    // READ ONLY FOR THE PAIR WHOSE TEXT CHANGED: the identical first pages ask for no boxes.
    expect(wordReads).toStrictEqual(['left:1', 'right:1']);

    const refused = clientFor(new Map([[LEFT, left], [RIGHT, right]]), { words: engine, refuseWords: true });
    const estimated = await compareSides(refused.client, side(LEFT, left), side(RIGHT, right), new AbortController().signal, () => undefined);
    if (estimated.kind !== 'done') throw new Error(estimated.kind);
    const [kept] = estimated.result.rows;
    expect(kept?.kind === 'text' ? kept.change.inserted : undefined).toBe('sixty');
    expect(kept?.kind === 'text' ? kept.change.right[0]?.x0 : undefined).not.toBe(300);
  });

  it('a MOVED IMAGE is a picture change where it was and where it is, and no text change', async () => {
    const before: FakePage = { ...terms, squares: [{ x: 40, y: 80, size: 24 }] };
    const after: FakePage = { ...terms, squares: [{ x: 120, y: 140, size: 24 }] };
    const rows = await compare([before], [after]);
    expect(rows.map((row) => row.kind)).toStrictEqual(['graphics', 'graphics']);
  });

  it('a CHANGED ANNOTATION is one annotation row, converted to display space, and its pixels are not reported again', async () => {
    // PDF SPACE, y up: 150..170 across and 160..180 up is 20..40 down from the top in display space.
    const note = (contents: string): FakePage => ({
      ...terms,
      notes: [{ contents, rect: [150, 160, 170, 180] }],
      squares: [{ x: 150, y: 20, size: 20 }],
    });
    const rows = await compare([note('Approved')], [note('Rejected')]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (row?.kind !== 'annotation') throw new Error(`expected an annotation row, got ${String(row?.kind)}`);
    expect(row.change.annotation).toStrictEqual({ kind: 'sticky-note', what: 'changed' });
    expect(row.change.left).toStrictEqual([{ x0: 150, y0: 20, x1: 170, y1: 40 }]);
  });

  it('CONTROL: two identical documents report nothing', async () => {
    const picture: FakePage = { ...terms, squares: [{ x: 60, y: 60, size: 30 }], notes: [{ contents: 'Same', rect: [10, 10, 30, 30] }] };
    expect(await compare([intro, picture, close], [intro, picture, close])).toStrictEqual([]);
  });
});

describe('the list and the count', () => {
  it('the LIST stops at MAX_COMPARE_CHANGES and the COUNT does not', async () => {
    // A page whose every other line changed: each changed line sits between two kept ones, so it is its own text
    // change. Five more than the list holds, so the cap is what decides the list.
    const hunks = MAX_COMPARE_CHANGES + 5;
    const before: FakePage = { lines: Array.from({ length: hunks * 2 }, (_, at) => (at % 2 === 0 ? `kept line ${String(at)}` : `old wording ${String(at)}`)) };
    const after: FakePage = { lines: Array.from({ length: hunks * 2 }, (_, at) => (at % 2 === 0 ? `kept line ${String(at)}` : `new phrasing ${String(at)}`)) };
    const { client } = clientFor(new Map([[LEFT, [before]], [RIGHT, [after]]]));
    const outcome = await compareSides(client, side(LEFT, [before]), side(RIGHT, [after]), new AbortController().signal, () => undefined);
    if (outcome.kind !== 'done') throw new Error(`the comparison ended ${outcome.kind}`);
    expect(outcome.result.rows).toHaveLength(MAX_COMPARE_CHANGES);
    expect(outcome.result.found).toBe(hunks);
    expect(outcome.result.more).toBe(true);
  });

  it('CONTROL: under the cap the count and the list agree, and nothing says there is more', async () => {
    const edited: FakePage = { lines: ['Payment is due within sixty days of the invoice'] };
    const { client } = clientFor(new Map([[LEFT, [terms]], [RIGHT, [edited]]]));
    const outcome = await compareSides(client, side(LEFT, [terms]), side(RIGHT, [edited]), new AbortController().signal, () => undefined);
    if (outcome.kind !== 'done') throw new Error(`the comparison ended ${outcome.kind}`);
    expect([outcome.result.rows.length, outcome.result.found, outcome.result.more]).toStrictEqual([1, 1, false]);
  });
});

describe('the walk — what it reads, and when it stops', () => {
  it('draws a page for its signature only when it has too few words, then draws each matched pair', async () => {
    const scan: FakePage = { lines: [], squares: [{ x: 20, y: 20, size: 100 }] };
    const drawn: string[] = [];
    const documents = new Map([[LEFT, [terms, scan]], [RIGHT, [terms, scan]]]);
    const { client } = clientFor(documents);
    await compareSides(client, side(LEFT, [terms, scan], drawn), side(RIGHT, [terms, scan], drawn), new AbortController().signal, () => undefined);
    // SIGNING: only the scans (left:1, right:1). PAIRS: both pairs, both sides.
    expect(drawn).toStrictEqual(['left:1', 'right:1', 'left:0', 'right:0', 'left:1', 'right:1']);
  });

  it('a document that changes during the walk stops it as moved, and a refused read as refused', async () => {
    const documents = new Map([[LEFT, [intro, terms]], [RIGHT, [intro, terms]]]);
    const moved = clientFor(documents, { movedAfter: 2 });
    expect((await compareSides(moved.client, side(LEFT, [intro, terms]), side(RIGHT, [intro, terms]), new AbortController().signal, () => undefined)).kind).toBe('moved');
    const refused = clientFor(documents, { refuse: true });
    expect((await compareSides(refused.client, side(LEFT, [intro, terms]), side(RIGHT, [intro, terms]), new AbortController().signal, () => undefined)).kind).toBe('refused');
  });

  it('a cancelled walk publishes nothing and reads no further', async () => {
    const documents = new Map([[LEFT, [intro, terms, close]], [RIGHT, [intro, terms, close]]]);
    const { client, reads } = clientFor(documents);
    const stop = new AbortController();
    const outcome = await compareSides(client, side(LEFT, [intro, terms, close]), side(RIGHT, [intro, terms, close]), stop.signal, (done) => {
      if (done === 2) stop.abort();
    });
    expect(outcome.kind).toBe('cancelled');
    expect(reads).toStrictEqual(['left:0', 'left:1']);
  });

  // A STOP INSIDE A DRAW: `renderPage` rejects an aborted draw, and the walk read that as a page that could not be
  // drawn — Side by Side's Stop then said *"A page could not be drawn"* (found writing C.b's Stop case, 2026-10-02).
  it('a stop that lands INSIDE a draw is cancelled, not failed; CONTROL: the same rejection unstopped fails the walk', async () => {
    const documents = new Map([[LEFT, [intro, terms]], [RIGHT, [intro, terms]]]);
    const rejecting = (stopNow: AbortController | undefined): CompareSide => ({
      ...side(LEFT, [intro, terms]),
      draw: () => {
        stopNow?.abort();
        return Promise.reject(new Error('the draw was superseded'));
      },
    });
    const stop = new AbortController();
    const stopped = await compareSides(clientFor(documents).client, rejecting(stop), side(RIGHT, [intro, terms]), stop.signal, () => undefined);
    expect(stopped.kind).toBe('cancelled');

    const failing = compareSides(clientFor(documents).client, rejecting(undefined), side(RIGHT, [intro, terms]), new AbortController().signal, () => undefined);
    await expect(failing).rejects.toThrow('the draw was superseded');
  });
});
