import { describe, expect, it } from 'vitest';

import { MAX_MERGE_PART_ENTRIES, mergeDocumentSchema } from './commands.js';
import { ENGINE_HOST_FRAME_MAX_BYTES } from './hostProtocol.js';
import {
  MAX_PAGE_INDEX,
  MAX_PAGE_SET_ENTRIES,
  pageSetOf,
  pageSetSchema,
  pagesOfSet,
  withPageRuns,
} from './pageSet.js';
import { WORST_BYTES_PER_CHAR, maxEncodedBytes } from './schemaBound.js';

/**
 * A command's pages as runs (decision D, finding AAA-1). What is under test is that a selection is written short, read
 * back exactly, bounded so every page set fits a frame, and refused — before it is listed — where a run passes the
 * document.
 */

const refuse = (page: number, total: number): never => {
  throw new RangeError(`${String(page)} of ${String(total)}`);
};

describe('pageSetOf — pages as the shortest set in the same order', () => {
  it('writes a stretch of consecutive pages as one run, and a lone page as its number', () => {
    expect(pageSetOf([0, 1, 2, 3, 7, 9, 10])).toStrictEqual([[0, 3], 7, [9, 10]]);
  });

  it('keeps the caller’s order and a page named twice — neither is its to decide', () => {
    expect(pageSetOf([5, 4, 3, 3])).toStrictEqual([5, 4, 3, 3]);
  });

  it('a whole 43,600-page selection — the old list’s frame bound — is ONE entry', () => {
    const everything = Array.from({ length: 43_600 }, (_, page) => page);
    expect(pageSetOf(everything)).toStrictEqual([[0, 43_599]]);
  });

  it('reads back exactly what it wrote', () => {
    const pages = [2, 3, 4, 0, 8, 9, 9, 1];
    expect(pagesOfSet(pageSetOf(pages), 10, refuse)).toStrictEqual(pages);
  });
});

describe('pagesOfSet — the pages a set names, against a document', () => {
  it('REFUSES a run past the document before listing it, naming the run’s last page', () => {
    expect(() => pagesOfSet([[0, MAX_PAGE_INDEX]], 10, refuse)).toThrow(`${String(MAX_PAGE_INDEX)} of 10`);
  });

  it('refuses a single page past the document by the same refusal', () => {
    expect(() => pagesOfSet([3, 10], 10, refuse)).toThrow('10 of 10');
  });

  it('CONTROL: a set inside the document is answered, not refused', () => {
    expect(pagesOfSet([[0, 9]], 10, refuse)).toHaveLength(10);
  });
});

describe('pageSetSchema — bounded, so a command can say its size', () => {
  it('refuses a run that does not end after it starts, which a single page spells as its number', () => {
    expect(pageSetSchema.safeParse([[4, 4]]).success).toBe(false);
    expect(pageSetSchema.safeParse([[5, 4]]).success).toBe(false);
    expect(pageSetSchema.safeParse([[4, 5], 4]).success).toBe(true);
  });

  it('refuses an index past the format’s limit, a negative one and an empty set', () => {
    expect(pageSetSchema.safeParse([MAX_PAGE_INDEX + 1]).success).toBe(false);
    expect(pageSetSchema.safeParse([-1]).success).toBe(false);
    expect(pageSetSchema.safeParse([]).success).toBe(false);
  });

  it(`refuses more than ${String(MAX_PAGE_SET_ENTRIES)} entries, and takes that many`, () => {
    const apart = (count: number): number[] => Array.from({ length: count }, (_, at) => at * 2);
    expect(pageSetSchema.safeParse(apart(MAX_PAGE_SET_ENTRIES)).success).toBe(true);
    expect(pageSetSchema.safeParse(apart(MAX_PAGE_SET_ENTRIES + 1)).success).toBe(false);
  });

  it('its worst encoding fits a frame with room — every page set a schema admits', () => {
    const worst = maxEncodedBytes(pageSetSchema, WORST_BYTES_PER_CHAR);
    expect(worst).toBeLessThan(ENGINE_HOST_FRAME_MAX_BYTES * 0.75);
  });
});

describe('withPageRuns — the renderer’s one place a command’s pages are written short', () => {
  it('rewrites a command’s page list as runs and keeps every other field', () => {
    expect(withPageRuns({ kind: 'rotatePages', pages: [0, 1, 2], quarterTurns: 1 })).toStrictEqual({
      kind: 'rotatePages',
      pages: [[0, 2]],
      quarterTurns: 1,
    });
  });

  it('leaves `all`, a set already holding runs, and a command with no pages as they came', () => {
    const all = { kind: 'cropPages', pages: 'all' as const };
    const runs = { kind: 'deletePages', pages: [[0, 4] as [number, number]] };
    const none = { kind: 'movePage', from: 1, to: 2 };
    expect(withPageRuns(all)).toBe(all);
    expect(withPageRuns(runs)).toBe(runs);
    expect(withPageRuns(none)).toBe(none);
  });

  it('writes a SECOND document’s page list short too, so a long source range fits the set’s bound', () => {
    // 9,000 pages listed one by one is past `MAX_PAGE_SET_ENTRIES`; as one run it is one entry.
    const many = Array.from({ length: 9000 }, (_, page) => page);
    expect(withPageRuns({ kind: 'replacePage', pages: [3, 4], sourcePages: many })).toStrictEqual({
      kind: 'replacePage',
      pages: [[3, 4]],
      sourcePages: [[0, 8999]],
    });
    // CONTROL: `'all'` is a choice, not a list, and stays as it came.
    const every = { kind: 'mergeDocument', documents: [{ source: 'a', sourcePages: 'all' as const }], at: 0 };
    expect(withPageRuns(every)).toBe(every);
  });

  it('writes EACH merge part’s page list short, and keeps a part already short as it came (ADR-0152)', () => {
    const short = { source: 'b', sourcePages: [[0, 1] as [number, number]] };
    const command = { kind: 'mergeDocument', documents: [{ source: 'a', sourcePages: [4, 5, 6, 9] }, short], at: 2 };
    const written = withPageRuns(command);
    expect(written).toStrictEqual({
      kind: 'mergeDocument',
      documents: [{ source: 'a', sourcePages: [[4, 6], 9] }, short],
      at: 2,
    });
    expect(written.documents[1]).toBe(short);
  });
});

describe('mergeDocumentSchema — a merge of several documents may choose pages of each (ADR-0195)', () => {
  const DOC = '00000000-0000-4000-8000-000000000001';
  const merge = (documents: readonly { source: string; sourcePages: unknown }[]): unknown => ({ kind: 'mergeDocument', documents, at: 0 });

  it('takes each part whole or with its own pages, and a part’s set up to the bound', () => {
    expect(mergeDocumentSchema.safeParse(merge([{ source: DOC, sourcePages: [1, 3] }, { source: DOC, sourcePages: 'all' }])).success).toBe(true);
    const atBound = Array.from({ length: MAX_MERGE_PART_ENTRIES }, (_, page) => page * 2);
    expect(mergeDocumentSchema.safeParse(merge([{ source: DOC, sourcePages: atBound }, { source: DOC, sourcePages: 'all' }])).success).toBe(true);
  });

  it('REFUSES a part with more entries than the bound, and CONTROL: a single document may still hold the paired bound', () => {
    const past = Array.from({ length: MAX_MERGE_PART_ENTRIES + 1 }, (_, page) => page * 2);
    expect(mergeDocumentSchema.safeParse(merge([{ source: DOC, sourcePages: past }, { source: DOC, sourcePages: 'all' }])).success).toBe(false);
    // The ONE-document shape is Insert from PDF's, and its bound is the paired set's — unchanged.
    expect(mergeDocumentSchema.safeParse(merge([{ source: DOC, sourcePages: past }])).success).toBe(true);
  });

  it('the worst message a merge can be fits the frame with the margin one page set has', () => {
    const worst = maxEncodedBytes(mergeDocumentSchema, WORST_BYTES_PER_CHAR, 'input');
    expect(worst).toBeLessThan((ENGINE_HOST_FRAME_MAX_BYTES * 3) / 4);
  });
});
