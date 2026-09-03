import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { type DocumentSearchProgress, searchDocument } from './documentSearch.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000f1');

/**
 * A client that answers one match per page, recording which pages were asked
 * for and letting a case act between pages.
 *
 * ONE MATCH ON EVERY PAGE, not on one page: a walk that stopped after the first
 * page would find the same single match a correct walk finds on a one-page
 * fixture, and every assertion about *how many pages were visited* would pass.
 */
function clientOverPages(
  pageCount: number,
  options: {
    refuseAt?: number;
    onPage?: (page: number) => void;
    truncateAt?: number;
  } = {},
): { client: ContractClient; asked: number[] } {
  const asked: number[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.searchPage') throw new Error(`unexpected channel ${id}`);
    const { page } = params as { page: number };
    asked.push(page);
    options.onPage?.(page);
    if (options.refuseAt === page) return Promise.resolve(err({ code: 'document-busy' }));
    return Promise.resolve(
      ok({
        version: asDocVersion(1),
        matches: [{ line: 0, offset: page, text: `page ${String(page)} of ${String(pageCount)}` }],
        truncated: options.truncateAt === page,
      }),
    );
  });
  return { client, asked };
}

describe('searchDocument', () => {
  it('walks every page and stamps each match with the page it came from', async () => {
    const { client, asked } = clientOverPages(3);

    const outcome = await searchDocument({ client, docId: DOC, pageCount: 3, query: 'a', perPage: 5 });

    expect(asked).toStrictEqual([0, 1, 2]);
    expect(outcome.kind).toBe('complete');
    if (outcome.kind !== 'complete') return;
    // The page is the walk's, not the channel's — the handler strips it, so a
    // walk that forgot to stamp it would return three matches on page
    // `undefined` and a results surface would send the reader nowhere.
    expect(outcome.matches.map((match) => match.page)).toStrictEqual([0, 1, 2]);
    expect(outcome.truncated).toBe(false);
  });

  it('reports a page that TRUNCATED, so a count is not read as the whole answer', async () => {
    const { client } = clientOverPages(3, { truncateAt: 1 });

    const outcome = await searchDocument({ client, docId: DOC, pageCount: 3, query: 'a', perPage: 5 });

    expect(outcome.kind === 'complete' && outcome.truncated).toBe(true);
  });

  it('A CANCELLED WALK CARRIES NO MATCHES, however many pages it had searched', async () => {
    // The shape of this module. A partial list is indistinguishable from a
    // complete one on screen: it says "four matches" about a document holding
    // forty, and the reader who cancelled has no way to tell.
    const controller = new AbortController();
    const { client, asked } = clientOverPages(10, {
      onPage: (page) => {
        if (page === 2) controller.abort();
      },
    });

    const outcome = await searchDocument({
      client,
      docId: DOC,
      pageCount: 10,
      query: 'a',
      perPage: 5,
      signal: controller.signal,
    });

    expect(outcome.kind).toBe('cancelled');
    // NO `matches` KEY AT ALL, which is B5 rather than an empty array: a
    // caller cannot render what the type does not carry, so "showed a partial
    // result" is unrepresentable rather than avoided.
    expect('matches' in outcome).toBe(false);
    // AND IT STOPPED. Without this the case passes for a walk that searched all
    // ten pages and threw the answer away, which cancels nothing a user would
    // notice — the abort landed during page 2, so pages 3 onward must not have
    // been asked for.
    expect(asked).toStrictEqual([0, 1, 2]);
  });

  it('CONTROL: the same fixture WITHOUT the abort completes with every match', async () => {
    // Without this, the case above passes for a walk that returns `cancelled`
    // unconditionally — and a search that never works looks exactly like a
    // search that cancels correctly.
    const { client } = clientOverPages(10);

    const outcome = await searchDocument({
      client,
      docId: DOC,
      pageCount: 10,
      query: 'a',
      perPage: 5,
      signal: new AbortController().signal,
    });

    expect(outcome.kind === 'complete' && outcome.matches).toHaveLength(10);
  });

  it('does not count the page IN FLIGHT when the cancel lands during it', async () => {
    // The signal is checked twice per page for this: an answer that arrives
    // after the user pressed cancel is an answer to a question they withdrew,
    // and counting it makes `pagesSearched` one higher than what was shown.
    const controller = new AbortController();
    const { client } = clientOverPages(4, {
      onPage: (page) => {
        if (page === 1) controller.abort();
      },
    });

    const outcome = await searchDocument({
      client,
      docId: DOC,
      pageCount: 4,
      query: 'a',
      perPage: 5,
      signal: controller.signal,
    });

    expect(outcome).toStrictEqual({ kind: 'cancelled', pagesSearched: 1 });
  });

  it('STOPS at a refusal and names the page, rather than reporting a short count', async () => {
    // A document that cannot answer page 2 is not a document whose total means
    // anything. Continuing past it would produce a number that reads as
    // complete and is not.
    const { client, asked } = clientOverPages(5, { refuseAt: 2 });

    const outcome = await searchDocument({ client, docId: DOC, pageCount: 5, query: 'a', perPage: 5 });

    expect(outcome).toStrictEqual({ kind: 'refused', code: 'document-busy', page: 2 });
    expect(asked).toStrictEqual([0, 1, 2]);
  });

  it('reports progress per page, after the answer rather than before the call', async () => {
    const progress = vi.fn<(update: DocumentSearchProgress) => void>();
    const { client } = clientOverPages(3);

    await searchDocument({
      client,
      docId: DOC,
      pageCount: 3,
      query: 'a',
      perPage: 5,
      onProgress: progress,
    });

    // Counting BEFORE the call would report 3 of 3 while the last page was
    // still in flight, so a progress bar would sit at 100% waiting.
    expect(progress.mock.calls.map(([entry]) => entry.pagesSearched)).toStrictEqual([1, 2, 3]);
    expect(progress).toHaveBeenLastCalledWith({ pagesSearched: 3, pageCount: 3 });
  });

  it('passes the matching options through to every page', async () => {
    const sent: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push(params);
      if (id !== 'document.searchPage') throw new Error(`unexpected channel ${id}`);
      return Promise.resolve(ok({ version: asDocVersion(1), matches: [], truncated: false }));
    });

    await searchDocument({
      client,
      docId: DOC,
      pageCount: 2,
      query: 'a',
      perPage: 5,
      options: { regex: true, wholeWord: true },
    });

    // EVERY page, not just the first: a walk that built the request once and
    // reused a stale object, or applied the flags only to page 0, would answer
    // a different question on every page after it.
    expect(sent).toStrictEqual([
      { docId: DOC, page: 0, query: 'a', limit: 5, regex: true, wholeWord: true },
      { docId: DOC, page: 1, query: 'a', limit: 5, regex: true, wholeWord: true },
    ]);
  });
});
