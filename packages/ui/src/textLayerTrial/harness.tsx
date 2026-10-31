// THE TRIAL'S PAGE (cloud run 29): mounts today's text layer or the SVG trial's copy of it over a page, at a rotation and
// a zoom, from lines given in PDF user space, and exposes each module's own `readTextSelection`. Bundled by esbuild for
// `packages/testing/src/textLayerTrial.measure.ts`; NOTHING the application loads imports this folder.
import { pdfPoint, toViewport } from '@monstera/shared';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { overlayTransform, unscaledTransform, type OverlayPage } from '../annotations/annotationSpace.js';
import { TextLayer, readTextSelection as readSpan } from '../TextLayer.js';
import { SvgTextLayer, readTextSelection as readSvg } from './SvgTextLayer.js';

/** A line as the page draws it: its text, its baseline, each letter's left and the line's box, all in PDF user space. */
export interface PdfLine {
  readonly text: string;
  readonly baseline: number;
  readonly xs: readonly number[];
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  /** The glyph size, for the SVG trial's second variant; absent, the box's height sizes the letters as today. */
  readonly size?: number;
}

export interface Mount {
  readonly kind: 'span' | 'svg';
  readonly pages: readonly (readonly PdfLine[])[];
  readonly size: { readonly width: number; readonly height: number };
  readonly rotation: number;
  readonly zoom: number;
}

let root: Root | undefined;

/** A PDF point in the page's display space at scale 1, the space the channel answers in. */
function display(page: OverlayPage, x: number, y: number): { x: number; y: number } {
  const point = toViewport(pdfPoint(x, y), unscaledTransform(page));
  return { x: point.x, y: point.y };
}

function mount(spec: Mount): void {
  const host = document.getElementById('root');
  if (host === null) throw new Error('no #root');
  root?.unmount();
  root = createRoot(host);
  const geometry: OverlayPage = { crop: [0, 0, spec.size.width, spec.size.height], rotation: spec.rotation, zoom: spec.zoom };
  shownGeometry = geometry;
  const turned = spec.rotation % 180 !== 0;
  const width = (turned ? spec.size.height : spec.size.width) * spec.zoom;
  const height = (turned ? spec.size.width : spec.size.height) * spec.zoom;
  const pages = spec.pages.map((lines) =>
    lines.map((line) => {
      const a = display(geometry, line.box.x0, line.box.y0);
      const b = display(geometry, line.box.x1, line.box.y1);
      return {
        text: line.text,
        box: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) },
        letters: line.xs.map((x) => display(geometry, x, line.baseline)),
        ...(line.size === undefined ? {} : { size: line.size }),
      };
    }),
  );
  flushSync(() => {
    root?.render(
      <div className="trial-pages">
        {pages.map((lines, at) => (
          <div className="trial-page" data-trial-page={String(at)} key={at} style={{ position: 'relative', width, height, background: 'white', marginBottom: 8 }}>
            {spec.kind === 'span' ? (
              <TextLayer lines={lines} page={at} geometry={geometry} search={undefined} painter={null} />
            ) : (
              <SvgTextLayer lines={lines} page={at} geometry={geometry} search={undefined} painter={null} />
            )}
          </div>
        ))}
      </div>,
    );
  });
}

/** What `readTextSelection` answers now, from the module that drew the layer. */
function read(kind: 'span' | 'svg'): ReturnType<typeof readSpan> {
  return kind === 'span' ? readSpan() : readSvg();
}

let shownGeometry: OverlayPage | undefined;

/** A PDF point on page `at` in window pixels, through the transform the layers are placed with. */
function point(at: number, x: number, y: number): { x: number; y: number } {
  const page = document.querySelector(`[data-trial-page="${String(at)}"]`);
  if (page === null || shownGeometry === undefined) throw new Error('nothing mounted');
  const origin = page.getBoundingClientRect();
  const on = toViewport(pdfPoint(x, y), overlayTransform(shownGeometry));
  return { x: origin.left + on.x, y: origin.top + on.y };
}

// NO COPY LISTENER HERE: each layer module registers its own `copySelectedText` as it mounts, as the shipped one does.
Object.assign(globalThis, { trial: { mount, read, point } });
