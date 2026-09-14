import { useLingui } from '@lingui/react';
import { normalizeProps, useMachine } from '@zag-js/react';
import * as splitter from '@zag-js/splitter';
import type { MessageKey } from '@monstera/shared';
import { useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { pixelsOfRoot } from './splitterSize.js';

/**
 * Two panes side by side, the first resizable by dragging or by keyboard (§10.3: *"panels
 * resizable with persisted widths"*).
 *
 * `@zag-js/splitter` is ADR-0005's machine for this, and ADR-0005 wraps every Zag machine in a
 * primitive so no feature imports one. This is that wrapper.
 *
 * ## HORIZONTAL AND WITHOUT A REGISTRY, and invariant 27 is why
 *
 * The machine appends a `<style>` element on every drag. Invariant 27 admits it by hash, and only
 * the three texts a horizontal splitter with no registry writes
 * ([ADR-0066](../../../../docs/DECISIONS/0066-the-splitters-drag-cursor-is-admitted-by-hash.md)).
 * A vertical orientation or a `registry` would inject texts no hash covers, so neither is a prop
 * here: a caller cannot pick a configuration the policy refuses.
 *
 * ## Pixels in, pixels out — and the pane is not quite those pixels, by the library's rule
 *
 * `width`, `minWidth` and `maxWidth` are CSS pixels and go to the machine as `"Npx"` strings,
 * which it resolves against its root itself. It reports a finished resize as percentages, and
 * `pixelsOfRoot` turns that back into the pixels `onWidthChange` receives, over the same root the
 * inward rule divides by — so a stored width maps back to the same percentage and does not drift
 * across launches.
 *
 * **The rendered pane is narrower than `width` by a pixel or two, and that is not this module's
 * to correct.** The inward rule divides by the whole root, while `getPanelFlexBoxStyle` lays the
 * percentage out as a flex-grow share of the root minus the handle, written to three significant
 * figures. Measured 2026-09-14 in the production build at 1280 × 800: root 1216.33 px, handle 6,
 * `width` 256 drew a 254.17 px pane. Correcting it here would be a second opinion about the
 * library's layout; the persisted value is exact, and the drawn one is within the handle's width.
 *
 * ## THE LIVE SIZE IS HELD HERE DURING A RESIZE, because a controlled machine does not hold it
 *
 * `size` is passed, so the machine is controlled, and `splitter.machine.mjs` `setSize` then does
 * NOT move its own size: it calls `onResize` and waits for the owner to hand the new size back as
 * `size`. The first version handled only `onResizeEnd`, and measured in the production build a
 * pointer drag moved nothing — the pane stayed at 254.17 px through a 60 px drag — while the
 * keyboard looked fine, only because every key press also ends a resize and the stored width came
 * back round.
 *
 * So `onResize` keeps the live percentages in state and they are `size` until the resize ends;
 * then the stored width is written once and `size` is that width again. One resize is still one
 * write to whatever owns `width`.
 */
export interface SplitterProps {
  /** The resize handle's accessible name. The handle is a `role="separator"`. */
  readonly label: MessageKey;
  /** The first pane's width in CSS pixels. */
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  /** A finished resize, in whole CSS pixels within `minWidth`–`maxWidth`. */
  readonly onWidthChange: (width: number) => void;
  /** The resizable pane. */
  readonly start: ReactNode;
  /** The pane that takes the rest. */
  readonly end: ReactNode;
}

export function Splitter({
  label,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  start,
  end,
}: SplitterProps): ReactElement {
  const { i18n } = useLingui();
  // THE MACHINE'S ID IS REQUIRED (`@zag-js/types` `CommonProperties`) and names the elements it
  // looks up; a literal would collide the day two splitters are on screen.
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  // THE SIZE WHILE A RESIZE IS IN PROGRESS, in the machine's percentages. `null` between resizes,
  // when the stored `width` is the size. See the header for why the machine needs this handed back.
  const [live, setLive] = useState<number[] | null>(null);

  const service = useMachine(splitter.machine, {
    id,
    orientation: 'horizontal',
    panels: [
      {
        id: 'start',
        minSize: `${String(minWidth)}px`,
        maxSize: `${String(maxWidth)}px`,
        resizeBehavior: 'preserve-pixel-size',
      },
      { id: 'end' },
    ],
    size: live ?? [`${String(width)}px`],
    onResize: (details) => {
      setLive(details.size);
    },
    onResizeEnd: (details) => {
      const percent = details.size[0];
      const measured = root.current?.getBoundingClientRect().width ?? 0;
      // Cleared first and whatever happens next: a resize that could not be converted must not
      // leave the pane pinned to its last live size and deaf to the stored width.
      setLive(null);
      if (percent === undefined) return;
      const pixels = pixelsOfRoot(percent, measured);
      if (pixels === undefined) return;
      onWidthChange(Math.min(maxWidth, Math.max(minWidth, Math.round(pixels))));
    },
  });
  const api = splitter.connect(service, normalizeProps);

  return (
    <div {...api.getRootProps()} ref={root} className="m-splitter">
      <div {...api.getPanelProps({ id: 'start' })} className="m-splitter__pane">
        {start}
      </div>
      <div
        {...api.getResizeTriggerProps({ id: 'start:end' })}
        aria-label={i18n._(label)}
        className="m-splitter__handle"
      />
      <div {...api.getPanelProps({ id: 'end' })} className="m-splitter__pane m-splitter__pane--end">
        {end}
      </div>
    </div>
  );
}
