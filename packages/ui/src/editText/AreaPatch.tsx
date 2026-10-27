import type { DocVersion } from '@monstera/shared';
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { givePixelsBack } from '../pixelLedger.js';
import { RenderCancelledError } from '../renderPage.js';

/** A rectangle over the page in the overlay's CSS pixels, origin at the page's top left corner as it is shown. */
export interface CssArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Draws `area` of the page from the newest view into `canvas`, when that view is newer than `after`; answers the version
 * it drew and the area it covered (rounded out to whole device pixels), or `undefined` while no newer view is loaded.
 *
 * @throws {@link RenderCancelledError} when `signal` aborted, `renderRegion`'s rule.
 */
export type PatchArea = (
  after: DocVersion,
  area: CssArea,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
) => Promise<{ readonly version: DocVersion; readonly at: CssArea } | undefined>;

/**
 * The area a written edit changed, drawn at the new version on its own small canvas
 * ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3,
 * Finishing).
 *
 * ## Why a page's own redraw is not waited for
 *
 * After a write the editor stays over the words until something shows them as written, or the page shows its old
 * words for a moment. The page's own redraw at the new version is a whole page, and on a page of drawn letters it took
 * seconds; this draws only the edited area, so the editor lets go as soon as that much is drawn. The page's own drawing
 * then catches up behind it, and the patch is let go once the page is drawn at its version or later.
 *
 * ## Hidden until drawn
 *
 * The canvas is in place from the write, invisible, and shown in the same render that closes the editor, so no frame
 * shows neither. Where it cannot draw (the draw fails, or the view never moves past `after`) nothing changes from before
 * this existed: the editor lets go when the page's own redraw arrives (ADR-0261 Decision 7).
 */
export function AreaPatch({
  after,
  area,
  patch,
  onDrawn,
}: {
  /** The version of the read the edit was made over: the patch is drawn from a view newer than this. */
  readonly after: DocVersion;
  readonly area: CssArea;
  readonly patch: PatchArea;
  readonly onDrawn: (version: DocVersion) => void;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [at, setAt] = useState<CssArea>();
  // ITS PIXELS GO WITH IT, as a page's and a tile's do (ADR-0247).
  useLayoutEffect(() => {
    const element = canvas.current;
    return (): void => {
      if (element !== null) givePixelsBack(element);
    };
  }, []);
  useEffect(() => {
    const target = canvas.current;
    if (target === null) return;
    const superseded = new AbortController();
    delete target.dataset['failed'];
    void patch(after, area, target, superseded.signal)
      .then((drawn) => {
        if (drawn === undefined || superseded.signal.aborted) return;
        setAt(drawn.at);
        onDrawn(drawn.version);
      })
      .catch((error: unknown) => {
        if (error instanceof RenderCancelledError || superseded.signal.aborted) return;
        // SAID ON THE ELEMENT, as a tile says it: the editor then waits for the page's own redraw, as it did before.
        target.dataset['failed'] = 'true';
      });
    return (): void => {
      superseded.abort();
    };
  }, [after, area, onDrawn, patch]);
  return (
    <canvas
      aria-hidden="true"
      className="m-kit-patch"
      data-kit-patch={at === undefined ? 'drawing' : 'drawn'}
      ref={canvas}
      style={at === undefined ? { visibility: 'hidden' } : { left: at.left, top: at.top, width: at.width, height: at.height }}
    />
  );
}
