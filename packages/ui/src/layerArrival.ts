/**
 * When a document layer COMING FORWARD may be shown (`App.arrived`): once every picture it shows at once is drawn.
 *
 * That is its page area's viewport (`PageList.onViewDrawn`) and, where the Pages strip is mounted, the strip's cards in
 * view (`Thumbnails`). The page area alone was the rule, and a parked layer — rebuilt from nothing on its way forward
 * (ADR-0129's correction of 2026-10-17) — then came forward with its strip still drawing: measured 2026-10-21 by
 * `blinkWalk.mjs`, the first card blank for a frame and the others missing for one to five, every time. A layer that was
 * never parked keeps its strip drawn behind it, so only the rebuilt one showed it.
 *
 * The strip TAKES PART BY MOUNTING, not by being named: a panel closed, collapsed, or showing another tab mounts no
 * strip, and a gate that waited for one there would hold the layer back for ever.
 */

/** The part a Pages strip plays: it registers while mounted, and says when its cards in view are drawn. */
export interface StripArrival {
  /** Registers the strip as a part to wait for; the returned function takes it back out (the strip unmounting). */
  readonly mounted: () => () => void;
  /** Every card in the strip's view is drawn, or failed and shown as failed. */
  readonly drawn: () => void;
}

export interface LayerArrival {
  /** The page area's viewport is drawn. */
  readonly page: () => void;
  readonly strip: StripArrival;
}

/** A gate that calls `told` once, when the page area is drawn and every mounted strip has drawn its view. */
export function layerArrival(told: () => void): LayerArrival {
  let pageDrawn = false;
  let strips = 0;
  let stripDrawn = false;
  let done = false;
  const settle = (): void => {
    if (done || !pageDrawn || (strips > 0 && !stripDrawn)) return;
    done = true;
    told();
  };
  return {
    page: (): void => {
      pageDrawn = true;
      settle();
    },
    strip: {
      mounted: (): (() => void) => {
        strips += 1;
        return (): void => {
          strips -= 1;
          settle();
        };
      },
      drawn: (): void => {
        stripDrawn = true;
        settle();
      },
    },
  };
}
