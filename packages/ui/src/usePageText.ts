import { type ContractClient, MAX_TEXT_LAYER_LINES } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { TextLayerLine } from './TextLayer.js';

/**
 * One page's answer: its selectable lines, and what the page is made of.
 *
 * **The two arrive together and are kept together.** The attribution exists to
 * explain an empty `lines`, so a shape that let a consumer hold one without the
 * other would put the explanation one lookup away from the thing it explains —
 * and the consumer that forgets the lookup renders a page with nothing on it
 * and nothing said about it, which is the state this row closes.
 */
export interface PageTextAnswer {
  readonly lines: readonly TextLayerLine[];
  /**
   * `'image-only'` is a page a reader can see words on and select none of.
   *
   * The renderer says so; it does not say *scanned*, because the kernel did not
   * (see the channel's own note).
   */
  readonly kind: 'text' | 'image-only' | 'empty';
}

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
 * ## KEPT across a change of the pages wanted, and that is what a selection lives in
 *
 * A page that stays wanted keeps its answer — the same lines, so its layer keeps
 * its nodes — and only a page newly wanted is read. Answering a new set with
 * nothing until every page of it had been read again unmounted every layer on
 * every scroll that moved a page in or out, and a selection's ends are nodes in
 * those layers: the browser moved them to the page's slot, and a drag that
 * scrolled the view went on from the next page's top, or collapsed (measured
 * 2026-10-03, N7). A page that leaves the set leaves the map, so what is held is
 * bounded by what is wanted.
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
): ReadonlyMap<number, PageTextAnswer> {
  // THE SET IS NOT A STABLE VALUE, so everything below keys on a string built
  // from it. A `ReadonlySet` is a new object on every scroll even when the pages
  // have not changed, and an effect depending on it would re-fetch every page on
  // every frame of a scroll — the per-slot arrow defect one layer up, where an
  // inline value in a dependency array turned one render into a full redraw.
  const wanted = [...visible].sort((a, b) => a - b).join(',');
  const key = `${String(docId)}@${String(version)}`;

  /**
   * THE ANSWER CARRIES THE DOCUMENT AND VERSION IT ANSWERS, and that is B5 rather
   * than bookkeeping.
   *
   * A bare map has to be *cleared* when the document or the version changes, and
   * clearing means calling `setState` in an effect body — which React's own lint
   * rule refuses, and rightly: between the change and the clear, a layer from the
   * previous document sits over the new one's raster. Holding the key beside the
   * map makes that state unrepresentable instead: a map whose key is not the
   * current document and version is simply not returned.
   */
  const [answered, setAnswered] = useState<{
    readonly key: string;
    readonly map: ReadonlyMap<number, PageTextAnswer>;
  }>({ key: '', map: EMPTY });
  // WHAT IS HELD FOR THIS QUESTION, read by the effect to skip pages it already has. A ref, because the effect must
  // not re-run when an answer lands — that would be a read per answer; kept current by a layout effect, which runs
  // before the effect below reads it.
  const held = useRef(answered);
  useLayoutEffect(() => {
    held.current = answered;
  }, [answered]);

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
    const already = held.current.key === key ? held.current.map : EMPTY;

    const fetchAll = async (): Promise<void> => {
      const gathered = new Map<number, PageTextAnswer>();
      for (const page of pages) {
        // A PAGE ALREADY ANSWERED AT THIS VERSION is not read again; its answer is carried below.
        if (already.has(page)) continue;
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
        gathered.set(page, { lines: answer.value.lines, kind: answer.value.kind });
      }
      if (stopped()) return;
      // THE PAGES STILL WANTED keep the answer they had — the same object, so their layers keep their nodes — and a
      // page no longer wanted is let go. Nothing new and nothing gone is no new state at all.
      setAnswered((previous) => {
        const before = previous.key === key ? previous.map : EMPTY;
        const kept = [...before].filter(([page]) => pages.includes(page));
        if (gathered.size === 0 && previous.key === key && kept.length === before.size) return previous;
        return { key, map: new Map([...kept, ...gathered]) };
      });
    };

    void fetchAll();
    return (): void => {
      cancelled = true;
    };
  }, [client, docId, key, version, wanted]);

  // ONLY THE PAGES WANTED NOW: an answer held for a page that has just left the set is not shown while its removal
  // is on its way.
  return useMemo(() => {
    if (answered.key !== key) return EMPTY;
    const pages = new Set(wanted === '' ? [] : wanted.split(',').map(Number));
    return [...answered.map.keys()].every((page) => pages.has(page))
      ? answered.map
      : new Map([...answered.map].filter(([page]) => pages.has(page)));
  }, [answered, key, wanted]);
}

/**
 * One shared empty map for every *not this question* answer.
 *
 * A fresh `new Map()` per render is a new identity, which would make every
 * consumer's memoization miss on every render while nothing had changed.
 */
const EMPTY: ReadonlyMap<number, PageTextAnswer> = new Map();
