import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

/**
 * Searching every page of a document, one page at a time, cancellably.
 *
 * ## Why the renderer drives the loop
 *
 * ADR-0035: a document's extracted text is 3.59× its bytes, so `main` never
 * holds it and `document.searchPage` answers one page. The loop over pages
 * therefore belongs to whoever decides when to stop — which is the surface a
 * person is looking at, not the process holding the file.
 *
 * ## A CANCELLED WALK PUBLISHES NOTHING
 *
 * The half-built result is discarded rather than returned, and that is the
 * whole shape of this module. A partial list is indistinguishable from a
 * complete one once it is on screen: it says *your word appears four times*
 * about a document where it appears forty, and a reader who cancelled a slow
 * search would have no way to tell. The same argument is why the matches
 * accumulate in a local rather than in state the caller can observe as they
 * arrive — a caller cannot render what it cannot reach, so the illegal state is
 * not merely avoided, it is unrepresentable from outside (B5).
 *
 * Progress is reported, because *how far it got* is honest and is what a
 * progress indicator needs. What is never reported is a MATCH from a walk that
 * did not finish.
 *
 * ## Sequential, not parallel
 *
 * One page in flight at a time. The channel runs in the document's lane, so
 * issuing twenty at once would queue twenty reads behind each other anyway and
 * make cancellation mean *after the twenty already sent* — which is the
 * cancellation a user would notice not working.
 */

/** One match, with the page it was found on. */
export interface DocumentMatch {
  readonly page: number;
  readonly line: number;
  readonly offset: number;
  readonly text: string;
}

/** How a walk ended. */
export type DocumentSearchOutcome =
  | {
      readonly kind: 'complete';
      readonly matches: readonly DocumentMatch[];
      /** Whether a page hit its per-page bound, so the list is not everything. */
      readonly truncated: boolean;
    }
  /** Cancelled. **Carries no matches**, deliberately — see the module header. */
  | { readonly kind: 'cancelled'; readonly pagesSearched: number }
  /** A page refused. The walk stops: a document that cannot answer page 4 is
   * not a document whose count of matches means anything. */
  | { readonly kind: 'refused'; readonly code: string; readonly page: number };

/** What a caller may watch while the walk runs. */
export interface DocumentSearchProgress {
  /** Pages whose answer has arrived. */
  readonly pagesSearched: number;
  readonly pageCount: number;
}

/** How the walk is asked for. */
export interface DocumentSearchRequest {
  readonly client: ContractClient;
  readonly docId: DocId;
  readonly pageCount: number;
  readonly query: string;
  /** The matching options, as `document.searchPage` declares them. */
  readonly options?: {
    readonly caseSensitive?: boolean | undefined;
    readonly wholeWord?: boolean | undefined;
    readonly regex?: boolean | undefined;
  };
  /** Matches asked for per page. The channel's own bound applies over this. */
  readonly perPage: number;
  /** Called after each page's answer, for a progress indicator. */
  readonly onProgress?: (progress: DocumentSearchProgress) => void;
  /** Cancels the walk. Checked before each page and after each answer. */
  readonly signal?: AbortSignal;
}

export async function searchDocument(
  request: DocumentSearchRequest,
): Promise<DocumentSearchOutcome> {
  const { client, docId, pageCount, query, perPage, onProgress, signal } = request;
  const matches: DocumentMatch[] = [];
  let truncated = false;
  // A FUNCTION, not a read of `signal.aborted` at each site. The flag is
  // flipped from outside between the two checks below, which is precisely what
  // the compiler's narrowing assumes cannot happen — reading it inline made the
  // second check "unintentional" and the second check is the load-bearing one.
  const aborted = (): boolean => signal?.aborted === true;

  for (let page = 0; page < pageCount; page += 1) {
    // CHECKED BEFORE THE CALL, so a cancellation between pages costs no round
    // trip. Checked again after it, because the answer to the page in flight
    // arrives after the user pressed cancel and must not be counted.
    if (aborted()) return { kind: 'cancelled', pagesSearched: page };

    const answer = await client['document.searchPage']({
      docId,
      page,
      query,
      limit: perPage,
      ...request.options,
    });

    if (aborted()) return { kind: 'cancelled', pagesSearched: page };

    if (!answer.ok) return { kind: 'refused', code: answer.error.code, page };

    for (const match of answer.value.matches) matches.push({ page, ...match });
    if (answer.value.truncated) truncated = true;
    onProgress?.({ pagesSearched: page + 1, pageCount });
  }

  return { kind: 'complete', matches, truncated };
}
