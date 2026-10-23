import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * What is known about each visible page's rotation, AT THIS VERSION.
 *
 * ## One reader, because three surfaces draw pages
 *
 * The spine, the thumbnail strip and the loupe all rasterise a page, and only
 * the spine used to ask the view model how that page is turned. The other two
 * handed `renderPage` nothing, PDF.js fell back to the page's stored `/Rotate`,
 * and a page rotated in the document showed turned in one place and upright in
 * two — found in a live run, with every case green, because each surface's
 * cases asserted the scale and the page and none asserted the rotation. A
 * second copy of this read beside the first is how the two came apart (B3a),
 * so it lives here and each surface takes it.
 *
 * ## Presence means ANSWERED, and the value may still be `undefined`
 *
 * Three states in a shape that looks like two, and each one is load-bearing:
 *
 * - absent: not asked yet, or in flight. **The page does not draw.**
 * - present and a number: the model said so; draw with it.
 * - present and `undefined`: the model was refused, or described another
 *   version. Draw with the page's own `/Rotate`, which is what this renderer
 *   actually knows — never a flat `0`.
 *
 * The first state is finding RRRRR-2: drawing before the answer paints the page
 * at its stored rotation and repaints it a frame later at the real one. A
 * `Map<number, number>` cannot express *answered, and the answer is nothing*.
 *
 * ## KEYED BY VERSION, because a rotate is a new version
 *
 * An answered page used to stay answered for the life of the scroller, so a
 * page rotated after opening kept the rotation it had before the command. The
 * map belongs to one `docId@version`; a new version starts empty and the pages
 * on screen are asked again.
 *
 * ## Only the pages about to be drawn, which is invariant L11
 *
 * One rotation per page scales with the document, so a read of the whole
 * vector would put a document-sized payload on the path a renderer takes after
 * every command. Each read names the visible pages not yet answered.
 */
export function usePageRotations(
  client: ContractClient,
  docId: DocId,
  version: DocVersion,
  visible: ReadonlySet<number>,
): PageRotations {
  const key = `${String(docId)}@${String(version)}`;
  const [answered, setAnswered] = useState<{
    readonly key: string;
    readonly map: ReadonlyMap<number, number | undefined>;
    /** The answers of the versions before this one, newest first: what a page plan turns from (ADR-0261). */
    readonly earlier: readonly { readonly key: string; readonly map: ReadonlyMap<number, number | undefined> }[];
  }>({ key: '', map: EMPTY, earlier: [] });
  const current = answered.key === key ? answered.map : EMPTY;

  useEffect(() => {
    const wanted = [...visible].filter((page) => !current.has(page)).sort((a, b) => a - b);
    if (wanted.length === 0) return;
    let cancelled = false;

    const read = async (): Promise<void> => {
      const answer = await client['document.viewModel']({ docId, pages: wanted });
      if (cancelled) return;

      // A MODEL FROM ANOTHER VERSION IS NOT DRAWN WITH, and neither is a refused
      // one. A command can bump the version while this read is in flight, and a
      // stale rotation over a current page is the class of defect
      // `document.readRange` refuses a range for (ADR-0031) — with nothing
      // thrown, so the comparison is the whole guard.
      //
      // **Both still mark the page ANSWERED.** The page must draw: what this
      // renderer knows in that case is *nothing about the rotation*, and PDF.js
      // falling back to the page's own `/Rotate` is that stated correctly.
      const usable = answer.ok && answer.value.version === version;
      setAnswered((previous) => {
        const same = previous.key === key;
        const next = new Map(same ? previous.map : EMPTY);
        for (const [index, page] of wanted.entries()) {
          next.set(page, usable ? answer.value.rotations[index] : undefined);
        }
        // A NEW VERSION KEEPS THE LAST ONES' ANSWERS, a few deep: a page plan draws the view of an earlier version,
        // and turns each page from the rotation the model gave for THAT version.
        const earlier = same || previous.key === '' ? previous.earlier : [{ key: previous.key, map: previous.map }, ...previous.earlier].slice(0, KEPT_VERSIONS);
        return { key, map: next, earlier };
      });
    };
    void read();

    return (): void => {
      cancelled = true;
    };
  }, [client, current, docId, key, version, visible]);

  const at = useCallback(
    (other: DocVersion): ReadonlyMap<number, number | undefined> | undefined => {
      const wanted = `${String(docId)}@${String(other)}`;
      // THE LATEST ANSWERS ARE STILL THE ONES HELD until the new version's first read lands, so they are asked first.
      if (wanted === answered.key) return answered.map;
      return answered.earlier.find((each) => each.key === wanted)?.map;
    },
    [answered, docId],
  );
  return useMemo(() => ({ now: current, at }), [at, current]);
}

/**
 * The model's rotations: `now`, at the version asked for, in the three states above; and `at`, the answers kept for an
 * earlier version, which is what a page plan's view was drawn with (ADR-0261) — `undefined` where none were kept.
 */
export interface PageRotations {
  readonly now: ReadonlyMap<number, number | undefined>;
  readonly at: (version: DocVersion) => ReadonlyMap<number, number | undefined> | undefined;
}

/** How many earlier versions' answers are kept: the plans a person can stack before the page draws one. */
const KEPT_VERSIONS = 4;

const EMPTY: ReadonlyMap<number, number | undefined> = new Map();
