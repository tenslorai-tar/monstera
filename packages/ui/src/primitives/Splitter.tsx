import { useLingui } from '@lingui/react';
import { normalizeProps, useMachine } from '@zag-js/react';
import * as splitter from '@zag-js/splitter';
import type { MessageKey } from '@monstera/shared';
import { Fragment, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { pixelsOfRoot } from './splitterSize.js';

/**
 * A row of panes: an optional fixed-width pane at each side, and one flexible pane between them
 * that takes the rest. Each fixed pane is resizable by dragging or by keyboard (§10.3: *"panels
 * resizable with persisted widths"*), and each can be shut.
 *
 * `@zag-js/splitter` is ADR-0005's machine for this, and ADR-0005 wraps every Zag machine in a
 * primitive so no feature imports one. This is that wrapper.
 *
 * ## THE SHAPE IS THE TYPE: at most one fixed pane per side, exactly one flexible pane
 *
 * `start` and `end` are optional and `middle` is not, so a row with two flexible panes, or a
 * handle between two fixed ones, cannot be written. Each handle sits between the flexible pane and
 * one fixed pane, and resizes exactly that pair (`resizeByDelta` pivots on the handle's two panes).
 *
 * ## A SHUT SIDE IS STILL A PANE, at zero, and the machine never sees its pane set change
 *
 * Measured 2026-09-15 (CI 35002592538, ubuntu-latest): the left pane drew 81.92 px wider right after
 * the right side shut. The machine re-syncs its size list from props in a React effect
 * (`@zag-js/react` `track.mjs`, a `useEffect`), and `connect` lays each pane out from that list BY
 * INDEX (`splitter.connect.mjs`). A commit that renders a different NUMBER of panes before the
 * re-sync indexes the old list with the new panes: the surviving shares stop summing to 100 and every
 * pane widens until the effect runs. `Splitter.test.tsx` reproduces it in the commit itself — shares
 * 24 and 46 after the end pane left, a 0.343 share where 0.24 was stored.
 *
 * So `open: false` keeps the pane in the machine, sized, bounded and laid out at `0px`, with no
 * content and no handle beside it. The pane list keeps its length, so a commit before the re-sync
 * holds the previous sizes of the SAME panes — the shut side's content already gone and its width
 * not yet zero until the machine re-syncs — and no other pane's share moves. That the re-sync does
 * replace the list is read from the source (`utils/fuzzy.mjs` `fuzzySizeEqual` is false for lists
 * of different lengths); how long the window lasts in a browser is not measured. The rejected routes: a resync
 * sent from a layout effect (`send` queues a microtask, so nothing puts it before a paint), and
 * remounting the machine when the set changes (it would remount the flexible pane, which is the
 * document view).
 *
 * The machine's own collapse is still not used: *"is this side open"* has one writer, the caller's
 * setting (B3), and the machine only ever receives a size.
 *
 * ## HORIZONTAL AND WITHOUT A REGISTRY, and invariant 27 is why
 *
 * The machine appends a `<style>` element on every drag. Invariant 27 admits it by hash, and only
 * the three texts a horizontal splitter with no registry writes
 * ([ADR-0066](../../../../docs/DECISIONS/0066-the-splitters-drag-cursor-is-admitted-by-hash.md)).
 * A vertical orientation or a `registry` would inject texts no hash covers, so neither is a prop
 * here: a caller cannot pick a configuration the policy refuses.
 *
 * ## Pixels in, pixels out — and a pane is not quite those pixels, by the library's rule
 *
 * Widths are CSS pixels and go to the machine as `"Npx"` strings, which it resolves against its
 * root itself. It reports a finished resize as percentages, and `pixelsOfRoot` turns each fixed
 * pane's back into pixels over the same root the inward rule divides by — so a stored width maps
 * back to the same percentage and does not drift across launches.
 *
 * **A drawn pane is narrower than its width by a pixel or two, and that is not this module's to
 * correct.** The inward rule divides by the whole root, while `getPanelFlexBoxStyle` lays the
 * percentage out as a flex-grow share of the root minus the handles, to three significant figures.
 * Measured 2026-09-14 in the production build at 1280 × 800: root 1216.33 px, one 6 px handle, a
 * stored 256 drew a 254.17 px pane. Correcting it here would be a second opinion about the
 * library's layout; the persisted value is exact.
 *
 * ## THE FLEXIBLE PANE IS A HOLE IN `size`, and that takes one cast
 *
 * The flexible pane has no stored size: it is the rest. The library's `resolvePanelSizes` is written
 * for exactly that — it splits the remainder across the entries that did not parse — and
 * `getPanelFlexBoxStyle` gives an unresolved hole `flex-grow: 1` before the first measurement. But
 * `PanelSize[]` cannot type a hole, and with a fixed pane at the END the hole is in the middle,
 * where it cannot be left off the array. The package exports no resolver to compute it with, and
 * computing it here would be a second `parsePanelSize` (B3a). So the array is built with the hole
 * and cast once, below; the rendered three-pane case fails loudly if a version stops filling it.
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
 * then each open fixed pane whose width changed is written once, and `size` is the stored widths
 * again. A shut pane is never written: its zero is not a width anybody chose.
 */
export interface FixedPane {
  readonly content: ReactNode;
  /** The accessible name of the handle between this pane and the flexible one. */
  readonly label: MessageKey;
  /** CSS pixels, kept while the pane is shut and drawn again when it opens. */
  readonly width: number;
  readonly minWidth: number;
  /** The widest a STORED width may be, in CSS pixels — the bound on what a setting can hold. */
  readonly maxWidth: number;
  /**
   * The widest the pane may be DRAWN, as a percentage of the row: handed to the machine as `"N%"`, which it resolves
   * against its root itself (`utils/size.mjs` `percentRegex`), so the pane follows the window rather than a pixel
   * figure chosen for one size of monitor. Never below `minWidth`: a row too narrow for both leaves the minimum.
   */
  readonly maxShare: number;
  /** Whether the pane is drawn. Shut, it stays a zero-width pane with no content and no handle. */
  readonly open: boolean;
  /** A finished resize that changed this pane, in whole CSS pixels within its bounds. */
  readonly onWidthChange: (width: number) => void;
}

export interface SplitterProps {
  readonly start?: FixedPane | undefined;
  /** The flexible pane, which takes whatever the fixed panes leave. */
  readonly middle: ReactNode;
  readonly end?: FixedPane | undefined;
}

type PaneId = 'start' | 'middle' | 'end';

/** A shut pane's size and both its bounds: the machine lays it out at nothing and cannot resize it. */
const SHUT = '0px';

export function Splitter({ start, middle, end }: SplitterProps): ReactElement {
  const { i18n } = useLingui();
  // THE MACHINE'S ID IS REQUIRED (`@zag-js/types` `CommonProperties`) and names the elements it
  // looks up; a literal would collide the day two splitters are on screen.
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  // THE SIZE WHILE A RESIZE IS IN PROGRESS, in the machine's percentages. `null` between resizes,
  // when the stored widths are the size. See the header for why the machine needs this handed back.
  const [live, setLive] = useState<number[] | null>(null);

  // In DOCUMENT order, which is the order the machine indexes sizes by. A shut side is still listed
  // (header, "a shut side is still a pane").
  const panes: readonly { readonly id: PaneId; readonly fixed: FixedPane | undefined }[] = [
    ...(start === undefined ? [] : [{ id: 'start' as const, fixed: start }]),
    { id: 'middle' as const, fixed: undefined },
    ...(end === undefined ? [] : [{ id: 'end' as const, fixed: end }]),
  ];

  const stored = panes.map((pane) => {
    if (pane.fixed === undefined) return undefined;
    return pane.fixed.open ? `${String(pane.fixed.width)}px` : SHUT;
  });

  const service = useMachine(splitter.machine, {
    id,
    orientation: 'horizontal',
    panels: panes.map((pane) =>
      pane.fixed === undefined
        ? { id: pane.id }
        : {
            id: pane.id,
            minSize: pane.fixed.open ? `${String(pane.fixed.minWidth)}px` : SHUT,
            maxSize: pane.fixed.open ? `${String(pane.fixed.maxShare)}%` : SHUT,
            resizeBehavior: 'preserve-pixel-size' as const,
          },
    ),
    // THE ONE CAST, and it is one fact: the flexible pane's entry is a hole the library fills with
    // the remainder, which `PanelSize[]` cannot express (header, "a hole in size").
    size: live ?? (stored as splitter.PanelSize[]),
    onResize: (details) => {
      setLive(details.size);
    },
    onResizeEnd: (details) => {
      const measured = root.current?.getBoundingClientRect().width ?? 0;
      // Cleared first and whatever happens next: a resize that could not be converted must not
      // leave the panes pinned to their last live sizes and deaf to the stored widths.
      setLive(null);
      panes.forEach((pane, index) => {
        if (!pane.fixed?.open) return;
        const percent = details.size[index];
        if (percent === undefined) return;
        const pixels = pixelsOfRoot(percent, measured);
        if (pixels === undefined) return;
        const shareBound = Math.max(pane.fixed.minWidth, Math.floor((pane.fixed.maxShare / 100) * measured));
        const next = Math.min(pane.fixed.maxWidth, shareBound, Math.max(pane.fixed.minWidth, Math.round(pixels)));
        // ONLY THE PANE THAT MOVED: a resize at one handle leaves the other side's width exactly
        // where it was, and writing it back unchanged would be a second change nobody made.
        if (next !== pane.fixed.width) pane.fixed.onWidthChange(next);
      });
    },
  });
  const api = splitter.connect(service, normalizeProps);

  return (
    <div {...api.getRootProps()} ref={root} className="m-splitter">
      {panes.map((pane, index) => {
        const next = panes[index + 1];
        const pairFixed = pane.fixed ?? next?.fixed;
        return (
          <Fragment key={pane.id}>
            <div {...api.getPanelProps({ id: pane.id })} className="m-splitter__pane">
              {pane.fixed === undefined ? middle : pane.fixed.open ? pane.fixed.content : null}
            </div>
            {next === undefined || !pairFixed?.open ? null : (
              <div
                {...api.getResizeTriggerProps({ id: `${pane.id}:${next.id}` })}
                aria-label={i18n._(pairFixed.label)}
                className="m-splitter__handle"
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
