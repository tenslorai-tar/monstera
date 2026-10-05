import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { readWholeList } from './readWholeList.js';

/** One link on a page as the page layer draws it: where it is, and where it goes (ADR-0167). */
export type PageLinkOnPage =
  | {
      readonly kind: 'internal';
      readonly page: number;
      readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
    }
  | {
      readonly kind: 'external';
      /** As the listing shows it, shortened past 2,048: shown, never followed — `main` reads the address to open. */
      readonly uri: string;
      readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
    };

/**
 * The links on each visible page, at the document's version (ADR-0167 Decision 1).
 *
 * `usePageText`'s shape and its reasons: keyed on a string built from the set, so a scroll that keeps the pages reads
 * nothing; an answer carrying another version is left out; the map is returned only for the question it answers. A
 * page's links are read whole, in parts (ADR-0130), because a link's PLACE in that list is how it is followed.
 */
export function usePageLinks(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
  visible: ReadonlySet<number>,
): ReadonlyMap<number, readonly PageLinkOnPage[]> {
  const wanted = [...visible].sort((a, b) => a - b).join(',');
  const key = `${String(docId)}@${String(version)}`;
  const [answered, setAnswered] = useState<{
    readonly key: string;
    readonly map: ReadonlyMap<number, readonly PageLinkOnPage[]>;
  }>({ key: '', map: EMPTY });
  const held = useRef(answered);
  useLayoutEffect(() => {
    held.current = answered;
  }, [answered]);

  useEffect(() => {
    if (client === undefined || docId === undefined || version === undefined) return;
    let cancelled = false;
    // `usePageText`'s function rather than the bare flag, for its reason: the second check after an await is the one
    // that matters, and a narrowed flag reads to the compiler as dead.
    const stopped = (): boolean => cancelled;
    const pages = wanted === '' ? [] : wanted.split(',').map(Number);
    const already = held.current.key === key ? held.current.map : EMPTY;

    const fetchAll = async (): Promise<void> => {
      const gathered = new Map<number, readonly PageLinkOnPage[]>();
      for (const page of pages) {
        if (already.has(page)) continue;
        if (stopped()) return;
        const answer = await readWholeList(
          (from) => client['document.pageLinks']({ docId, page, from }),
          (part) => part.links,
        ).catch(() => undefined);
        if (stopped()) return;
        // A REFUSAL OR ANOTHER VERSION LEAVES THE PAGE OUT: no links drawn is what a page that could not be read shows,
        // and links placed by another version's list would follow the wrong one.
        if (answer?.ok !== true || answer.value.version !== version) continue;
        gathered.set(page, answer.value.items);
      }
      if (stopped()) return;
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

  return useMemo(() => {
    if (answered.key !== key) return EMPTY;
    const pages = new Set(wanted === '' ? [] : wanted.split(',').map(Number));
    return [...answered.map.keys()].every((page) => pages.has(page))
      ? answered.map
      : new Map([...answered.map].filter(([page]) => pages.has(page)));
  }, [answered, key, wanted]);
}

const EMPTY: ReadonlyMap<number, readonly PageLinkOnPage[]> = new Map();
