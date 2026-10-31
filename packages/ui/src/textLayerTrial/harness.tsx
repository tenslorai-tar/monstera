// THE TRIAL'S PAGE (cloud runs 29 and 29b): mounts today's text layer, run 29's SVG copy, or run 29b's two candidates
// over pages, at a rotation and a zoom, from lines given in PDF user space, and exposes each module's own
// `readTextSelection`. Bundled by esbuild for `packages/testing/src/textLayerTrial.measure.ts`; NOTHING the application
// loads imports this folder.
import { pdfPoint, toViewport } from '@monstera/shared';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { overlayTransform, unscaledTransform, type OverlayPage } from '../annotations/annotationSpace.js';
import { TextLayer, readTextSelection as readSpan } from '../TextLayer.js';
import { SETTLE_MS } from '../useSettledPages.js';
import { SvgTextLayer, readTextSelection as readSvg } from './SvgTextLayer.js';
import { BREAK, MOVING_END, PAINTS, TrialTextLayer, readTextSelection as readTrial } from './TrialTextLayer.js';

/** A line as the page draws it: its text, its baseline, each letter's left and the line's box, all in PDF user space. */
export interface PdfLine {
  readonly text: string;
  readonly baseline: number;
  readonly xs: readonly number[];
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  /** The glyph size, for the SVG layers; absent, run 29's SVG copy sizes its letters by the box's height. */
  readonly size?: number;
}

/** `span` today's layer (the control); `svg` run 29's copy; `A` and `B` run 29b's candidates. */
export type Kind = 'span' | 'svg' | 'A' | 'B';

export interface Mount {
  readonly kind: Kind;
  readonly pages: readonly (readonly PdfLine[])[];
  readonly size: { readonly width: number; readonly height: number };
  readonly rotation: number;
  readonly zoom: number;
  /** Mount each page's layer as the application does: for the pages on screen, once the visible set has held for `SETTLE_MS`. */
  readonly settled?: boolean;
}

let root: Root | undefined;
let shownGeometry: OverlayPage | undefined;
/** Each settled mount's cost: how many layers arrived and the render plus layout time they took. */
const ARRIVALS: { pages: number; ms: number }[] = [];

/** A PDF point in the page's display space at scale 1, the space the channel answers in. */
function display(page: OverlayPage, x: number, y: number): { x: number; y: number } {
  const point = toViewport(pdfPoint(x, y), unscaledTransform(page));
  return { x: point.x, y: point.y };
}

interface Shown {
  readonly kind: Kind;
  readonly geometry: OverlayPage;
  readonly pages: readonly ReturnType<typeof linesFor>[];
  readonly width: number;
  readonly height: number;
  readonly settled: boolean;
}

function linesFor(geometry: OverlayPage, lines: readonly PdfLine[], fallbackSize: number): {
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
  letters: { x: number; y: number }[];
  end: { x: number; y: number };
  size: number;
}[] {
  return lines.map((line) => {
    const a = display(geometry, line.box.x0, line.box.y0);
    const b = display(geometry, line.box.x1, line.box.y1);
    return {
      text: line.text,
      box: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) },
      letters: line.xs.map((x) => display(geometry, x, line.baseline)),
      end: display(geometry, line.box.x1, line.baseline),
      size: line.size ?? fallbackSize,
    };
  });
}

function Layer({ kind, lines, page, geometry }: { kind: Kind; lines: ReturnType<typeof linesFor>; page: number; geometry: OverlayPage }): ReactElement {
  if (kind === 'span') return <TextLayer lines={lines} page={page} geometry={geometry} search={undefined} painter={null} />;
  if (kind === 'svg') {
    // RUN 29'S COPY sized its letters by the box's height unless a size was given, which run 29's `TRIAL_SIZED` set.
    return <SvgTextLayer lines={lines} page={page} geometry={geometry} search={undefined} painter={null} />;
  }
  return <TrialTextLayer lines={lines} page={page} geometry={geometry} search={undefined} painter={null} drawn={kind === 'A' ? 'span' : 'svg'} />;
}

/** The pages, each a shell of the page's size; a layer on every page, or only on the pages the scroll settled on. */
function Pages({ shown }: { shown: Shown }): ReactElement {
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => (shown.settled ? new Set() : new Set(shown.pages.keys())));
  const visible = useRef(new Set<number>());
  useEffect(() => {
    if (!shown.settled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      const next = new Set(visible.current);
      const start = performance.now();
      flushSync(() => {
        setMounted(next);
      });
      document.querySelector('[data-text-line]')?.getBoundingClientRect();
      ARRIVALS.push({ pages: next.size, ms: performance.now() - start });
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const at = Number((entry.target as HTMLElement).dataset['trialPage']);
        if (entry.isIntersecting) visible.current.add(at);
        else visible.current.delete(at);
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_MS);
    });
    for (const element of document.querySelectorAll('[data-trial-page]')) observer.observe(element);
    return (): void => {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [shown]);
  return (
    <div className={`trial-pages trial-kind-${shown.kind}`}>
      {shown.pages.map((lines, at) => (
        <div className="trial-page" data-trial-page={String(at)} key={at} style={{ position: 'relative', width: shown.width, height: shown.height, background: 'white', marginBottom: 8 }}>
          {mounted.has(at) ? <Layer kind={shown.kind} lines={lines} page={at} geometry={shown.geometry} /> : null}
        </div>
      ))}
    </div>
  );
}

function mount(spec: Mount): void {
  const host = document.getElementById('root');
  if (host === null) throw new Error('no #root');
  root?.unmount();
  root = createRoot(host);
  const geometry: OverlayPage = { crop: [0, 0, spec.size.width, spec.size.height], rotation: spec.rotation, zoom: spec.zoom };
  shownGeometry = geometry;
  const turned = spec.rotation % 180 !== 0;
  const shown: Shown = {
    kind: spec.kind,
    geometry,
    pages: spec.pages.map((lines) => linesFor(geometry, lines, (lines[0]?.box.y1 ?? 0) - (lines[0]?.box.y0 ?? 0))),
    width: (turned ? spec.size.height : spec.size.width) * spec.zoom,
    height: (turned ? spec.size.width : spec.size.height) * spec.zoom,
    settled: spec.settled === true,
  };
  ARRIVALS.length = 0;
  flushSync(() => {
    root?.render(<Pages shown={shown} />);
  });
}

/** What `readTextSelection` answers now, from the module that drew the layer. */
function read(kind: Kind): ReturnType<typeof readSpan> {
  return kind === 'span' ? readSpan() : kind === 'svg' ? readSvg() : readTrial();
}

/** A PDF point on page `at` in window pixels, through the transform the layers are placed with. */
function point(at: number, x: number, y: number): { x: number; y: number } {
  const page = document.querySelector(`[data-trial-page="${String(at)}"]`);
  if (page === null || shownGeometry === undefined) throw new Error('nothing mounted');
  const origin = page.getBoundingClientRect();
  const on = toViewport(pdfPoint(x, y), overlayTransform(shownGeometry));
  return { x: origin.left + on.x, y: origin.top + on.y };
}

// NO COPY LISTENER HERE: each layer module registers its own `copySelectedText` as it mounts, as the shipped one does.
Object.assign(globalThis, { trial: { mount, read, point, arrivals: ARRIVALS, movingEnd: MOVING_END, paints: PAINTS, breakers: BREAK } });
