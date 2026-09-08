import { type ContractClient, MAX_TEXT_LAYER_LINES } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useState } from 'react';

import type { TextLayerLine } from './TextLayer.js';

/**
 * The selectable text for the pages currently on screen.
 *
 * ## Why the scroller holds this and the application does not
 *
 * Which pages are visible is `useVisiblePages`' answer and it lives inside the
 * scroller. Lifting the fetch to a caller would mean lifting that set with it,
 * and the set changes on every scroll — so the application would re-render on
 * scroll in order to hand back something the scroller already knew.
 *
 * ## Keyed on the VERSION, and dropped whole when it moves
 *
 * A text layer over a mutated page is a selection that copies text the document
 * no longer has. The channel stamps its answer with the version it read at, and
 * an answer whose version is not the one being asked about now is discarded
 * rather than shown — which is the same rule `document.viewModel` and the search
 * results follow, for the same reason.
 *
 * **The whole map is dropped when the version moves**, not merged. A map holding
 * some pages at version 4 and some at version 5 is a page of text from two
 * documents, and there is no assertion a consumer could make about it.
 *
 * ## What a refusal does
 *
 * Nothing, deliberately. A page with no entry mounts no layer, so a refused read
 * is a page that cannot be selected — which is the same state as a page whose
 * text has not arrived yet, and is what a document with no session or a busy
 * lane produces. Surfacing it would be an error for something the reader did not
 * ask for; the selection simply is not there, and a later version tries again.
 *
 * That is a deliberate reduction and it is stated rather than left implicit: a
 * page that permanently refuses looks exactly like a page still loading.
 *
 * @param client the contract client, or `undefined` before the bridge exists
 * @param docId the document, or `undefined` when none is open
 * @param version the version the caller is showing
 * @param visible the pages on screen, zero-based
 */
export function usePageText(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
  visible: ReadonlySet<number>,
): ReadonlyMap<number, readonly TextLayerLine[]> {
  // THE SET IS NOT A STABLE VALUE, so everything below keys on a string built
  // from it. A `ReadonlySet` is a new object on every scroll even when the pages
  // have not changed, and an effect depending on it would re-fetch every page on
  // every frame of a scroll — the per-slot arrow defect one layer up, where an
  // inline value in a dependency array turned one render into a full redraw.
  const wanted = [...visible].sort((a, b) => a - b).join(',');
  const key = `${String(docId)}@${String(version)}#${wanted}`;

  /**
   * THE ANSWER CARRIES THE QUESTION IT ANSWERS, and that is B5 rather than
   * bookkeeping.
   *
   * A bare map has to be *cleared* when the document or the version changes, and
   * clearing means calling `setState` in an effect body — which React's own lint
   * rule refuses, and rightly: between the change and the clear, a layer from the
   * previous document sits over the new one's raster. Holding the key beside the
   * map makes that state unrepresentable instead: a map whose key is not the
   * current question is simply not returned.
   */
  const [answered, setAnswered] = useState<{
    readonly key: string;
    readonly map: ReadonlyMap<number, readonly TextLayerLine[]>;
  }>({ key: '', map: EMPTY });

  useEffect(() => {
    if (client === undefined || docId === undefined || version === undefined) return;

    let cancelled = false;
    // READ THROUGH A FUNCTION, which is `runDocumentSearch`'s shape and for a
    // mechanical reason rather than taste: after one `if (cancelled) return`,
    // TypeScript narrows the variable to `false` and does not widen it back
    // across an `await`, so the second check reads as provably dead code and the
    // lint rule says so. The second check is the load-bearing one.
    const stopped = (): boolean => cancelled;
    const pages = wanted === '' ? [] : wanted.split(',').map(Number);

    const fetchAll = async (): Promise<void> => {
      const gathered = new Map<number, readonly TextLayerLine[]>();
      for (const page of pages) {
        // CHECKED BEFORE THE CALL and after it: a teardown between pages costs
        // no round trip, and the answer to the page in flight arrives after the
        // effect was torn down.
        if (stopped()) return;
        const answer = await client['document.pageTextLayer']({
          docId,
          page,
          limit: MAX_TEXT_LAYER_LINES,
        });
        if (stopped()) return;
        // A REFUSAL LEAVES THE PAGE OUT rather than emptying the map: one page
        // that cannot be read must not remove the layer from the pages that can.
        if (!answer.ok) continue;
        // AND SO DOES A STALE VERSION. The lane answers at the version it read
        // at, which can have moved since this effect started — showing it would
        // put a layer from one document over the raster of another.
        if (answer.value.version !== version) continue;
        gathered.set(page, answer.value.lines);
      }
      if (!stopped()) setAnswered({ key, map: gathered });
    };

    void fetchAll();
    return (): void => {
      cancelled = true;
    };
  }, [client, docId, key, version, wanted]);

  return answered.key === key ? answered.map : EMPTY;
}

/**
 * One shared empty map for every *not this question* answer.
 *
 * A fresh `new Map()` per render is a new identity, which would make every
 * consumer's memoization miss on every render while nothing had changed.
 */
const EMPTY: ReadonlyMap<number, readonly TextLayerLine[]> = new Map();
