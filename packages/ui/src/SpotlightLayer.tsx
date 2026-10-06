import type { ReactElement } from 'react';

import { type OverlayPage, engineBoxOnScreen } from './annotations/annotationSpace.js';
import type { Spot } from './accessibility/view.js';

/**
 * The place the Accessibility tab marked, drawn over one page (ADR-0183).
 *
 * ## Placed as every engine box is
 *
 * A spot's box is in the page's display space at scale 1, which is where the text layer's lines and the links are
 * reported, so it reaches the screen through `engineBoxOnScreen` — the one conversion every engine box takes. A spot
 * with no box is the page itself, drawn as a frame round the page: the engine could place the problem on the page and
 * no more, and a frame says exactly that.
 *
 * ## Decoration, never a target
 *
 * It takes no pointer and is hidden from assistive technology: the panel is where a result is read and chosen, and the
 * mark is where it is on the page (`DifferenceLayer`'s rule).
 */
export function SpotlightLayer({
  spots,
  page,
  geometry,
}: {
  readonly spots: readonly Spot[];
  readonly page: number;
  readonly geometry: OverlayPage;
}): ReactElement | null {
  if (spots.length === 0) return null;
  return (
    <div aria-hidden="true" className="m-spotlight-layer" data-spotlight-layer={String(page)}>
      {spots.map((spot, index) => {
        if (spot.box === null) return <span className="m-spotlight m-spotlight--page" data-spotlight="page" key={index} />;
        const box = engineBoxOnScreen(spot.box, geometry);
        return (
          <span
            className="m-spotlight"
            data-spotlight="box"
            key={index}
            style={{
              left: `${String(box.left)}px`,
              top: `${String(box.top)}px`,
              width: `${String(box.width)}px`,
              height: `${String(box.height)}px`,
            }}
          />
        );
      })}
    </div>
  );
}
