import type { AnnotationKindName, ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useState } from 'react';

/** One existing annotation as a layer over its page draws it: which one, what kind, and where. */
export interface PageAnnotation {
  /** Its place in the page's walk (ADR-0041) — the layer's React key, never a handle it acts on. */
  readonly index: number;
  readonly kind: AnnotationKindName;
  /** In PDF user space, or `null` where the page displays no region for it. */
  readonly rect: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
}

/**
 * The document's existing annotations, grouped by page, for the layers drawn over each page
 * (§6: *"every annotation type registers … a renderer"*).
 *
 * ## `usePageText`'s shape, for `usePageText`'s reasons
 *
 * Keyed on the version and dropped whole when it moves: a mark drawn over a page from a
 * previous version is a redaction preview over content that may have moved. The answer
 * carries the question it answers, so a map from another document or version is simply not
 * returned — no clearing in an effect body, which React's lint refuses and which would leave a
 * frame of the old layer over the new raster.
 *
 * ## A second READER of `document.annotations`, not a second opinion
 *
 * `AnnotationsPanel` reads the same channel for the comments tab. B3a forbids two
 * implementations of one rule; it does not forbid two surfaces reading one answer. They also
 * differ in what a refusal means, and that is why they are two: the panel must say *could not
 * read*, while a layer over the page draws nothing — the same state as marks not yet arrived,
 * which is `usePageText`'s stated reduction. Folding both into one hook would hand one of them
 * the other's behaviour. When the comments tab is open too, the channel is asked twice per
 * version, and that is the cost.
 *
 * ## A truncated answer draws what it holds
 *
 * The channel is bounded and says when the bound stopped the walk. The panel shows that flag;
 * a layer cannot, so a document past the bound draws previews for the annotations it was told
 * about and none for the rest. Drawing none at all would be the same hole everywhere.
 *
 * @param client the contract client, or `undefined` before the bridge exists
 * @param docId the document, or `undefined` when none is open
 * @param version the version the caller is showing
 */
export function usePageAnnotations(
  client: ContractClient | undefined,
  docId: DocId | undefined,
  version: DocVersion | undefined,
): ReadonlyMap<number, readonly PageAnnotation[]> {
  const key = `${String(docId)}@${String(version)}`;
  const [answered, setAnswered] = useState<{
    readonly key: string;
    readonly map: ReadonlyMap<number, readonly PageAnnotation[]>;
  }>({ key: '', map: EMPTY });

  useEffect(() => {
    if (client === undefined || docId === undefined || version === undefined) return;
    let cancelled = false;

    void client['document.annotations']({ docId }).then(
      (answer) => {
        if (cancelled) return;
        // A REFUSAL AND A STALE VERSION BOTH DRAW NOTHING, and both are recorded as answered
        // for this question so a consumer does not keep a previous version's map.
        if (!answer.ok || answer.value.version !== version) {
          setAnswered({ key, map: EMPTY });
          return;
        }
        const grouped = new Map<number, PageAnnotation[]>();
        for (const annotation of answer.value.annotations) {
          const onPage = grouped.get(annotation.page) ?? [];
          onPage.push({ index: annotation.index, kind: annotation.kind, rect: annotation.rect });
          grouped.set(annotation.page, onPage);
        }
        setAnswered({ key, map: grouped });
      },
      () => {
        if (!cancelled) setAnswered({ key, map: EMPTY });
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [client, docId, key, version]);

  return answered.key === key ? answered.map : EMPTY;
}

/**
 * One shared empty map for every *not this question* answer, for `usePageText`'s reason: a
 * fresh map per render is a new identity, and every consumer's memoization would miss.
 */
const EMPTY: ReadonlyMap<number, readonly PageAnnotation[]> = new Map();
