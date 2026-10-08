import { pageTransform, pdfPoint, toViewport, type PageTransform } from '@monstera/shared';

import type {
  ContentBounds,
  ContentImage,
  ContentPath,
  ContentRun,
  PageContent,
} from './pageContent.js';
import type { PageSize } from './pageGeometry.js';
import { groupIntoBlocks, settingOf } from './textLines.js';

/**
 * A page's content as slide objects
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * Pure: no XML, no native call, no file. It takes what a page states and a deck's size and answers
 * objects in slide points, or the reason this page is written as Exact look instead. The writer
 * (`editableSlide.ts`) never decides what a page contained, and this never decides how a slide is
 * spelt.
 *
 * ## One conversion, and it is `PageTransform`
 *
 * Every page point reaches a slide point through `toViewport`, which already knows a CropBox whose
 * origin is not zero and a page displayed at a quarter turn. A bare y-flip here would assume
 * neither, and `monstera/no-bare-y-flip` bans it.
 *
 * ## A deck has one size and a page is fitted
 *
 * The page is scaled by one factor, `k`, applied to every object alike, and centred. A text box's
 * font size is multiplied by the same `k`, so a landscape page in a portrait deck is smaller
 * rather than stretched.
 */

/** One run of text inside a box. */
export interface SlideRun {
  readonly text: string;
  readonly font: string;
  readonly serif: boolean;
  readonly mono: boolean;
  /** Points on the slide. */
  readonly size: number;
  /** `RRGGBB`. */
  readonly colour: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** A text box: paragraphs' lines kept as the page broke them, wrapping off. */
export interface SlideTextBox {
  readonly kind: 'text';
  readonly order: number;
  /** The box in its own unrotated frame, in slide points. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Degrees clockwise: the page's quarter turn. */
  readonly rotation: number;
  readonly align: 'l' | 'ctr' | 'r';
  readonly rtl: boolean;
  /** The page's own baseline-to-baseline distance, in slide points. */
  readonly pitch: number;
  /** The left margin of every line after the first, and the first line's offset from it, in slide points. */
  readonly marginLeft: number;
  readonly indent: number;
  readonly lines: readonly (readonly SlideRun[])[];
}

/** Where a picture's pixels come from. */
export type PictureSource =
  | { readonly kind: 'embedded'; readonly extension: 'png' | 'jpeg'; readonly bytes: Uint8Array }
  | { readonly kind: 'cut'; readonly region: ContentBounds }
  | { readonly kind: 'page' };

/** A picture on the slide. */
export interface SlidePicture<S = PictureSource> {
  readonly kind: 'picture';
  readonly order: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly flipV: boolean;
  readonly source: S;
}

/** One drawing command of a custom shape, in slide points from the shape's own top-left. */
export type ShapeCommand =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'curve';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: 'close' };

/** A shape on the slide. */
export interface SlideShape {
  readonly kind: 'shape';
  readonly order: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly geometry:
    | { readonly kind: 'rect' }
    | { readonly kind: 'line'; readonly flipV: boolean }
    | { readonly kind: 'path'; readonly commands: readonly ShapeCommand[] };
  readonly fill: { readonly colour: string; readonly alpha: number } | null;
  readonly line: {
    readonly colour: string;
    readonly alpha: number;
    readonly width: number;
    readonly cap: 'butt' | 'round' | 'square';
    readonly join: 'miter' | 'round' | 'bevel';
  } | null;
}

export type SlideObject<S = PictureSource> = SlideTextBox | SlidePicture<S> | SlideShape;

/** A slide, in drawing order. */
export interface EditableSlide<S = PictureSource> {
  readonly objects: readonly SlideObject<S>[];
}

/** Why a page is written as Exact look. A person reads these by page number, never by this word. */
export type FallbackReason =
  | 'text-not-upright'
  | 'text-not-addressable'
  | 'content-truncated'
  | 'picture-without-text';

export type SlideBuild =
  | { readonly kind: 'editable'; readonly slide: EditableSlide; readonly scan: boolean }
  | { readonly kind: 'fallback'; readonly reason: FallbackReason };

/** How far a line's edges may differ and still be one alignment, as a share of the line's height. */
const ALIGN_TOLERANCE = 0.25;
/** The baseline sits this share of the size below the top of a line's ink. */
const INK_TO_BASELINE = 0.74;
/** The share of the size a line slot holds below its baseline. */
const SLOT_BELOW_BASELINE = 0.21;
/** A line that stands alone is spaced at this multiple of its size. */
const SINGLE_LINE_LEADING = 1.2;
/** A picture whose axes meet at more than this cosine is sheared, which a picture cannot be. */
const SHEAR_COSINE = 0.02;
/** A rectangle is axis aligned when its edges are within this many slide points. */
const AXIS_TOLERANCE = 0.05;
/** A shape whose box is this small in both directions is drawn as nothing and is not written. */
const MIN_EXTENT = 0.01;

const RIGHT_TO_LEFT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/gu;
const LETTER = /\p{L}/gu;

/** Whether the strong characters of `text` run right to left. */
export function isRightToLeft(text: string): boolean {
  const rtl = (text.match(RIGHT_TO_LEFT) ?? []).length;
  if (rtl === 0) return false;
  const letters = (text.match(LETTER) ?? []).length;
  return rtl * 2 > letters;
}

function hex(colour: { readonly r: number; readonly g: number; readonly b: number }): string {
  const part = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `${part(colour.r)}${part(colour.g)}${part(colour.b)}`.toUpperCase();
}

/** The family PowerPoint knows a PDF base font name by. A subset prefix and a style suffix are not part of it. */
export function typefaceOf(pdfName: string): string {
  const base = pdfName.replace(/^[A-Z]{6}\+/u, '');
  const family = base.split(/[-,]/u)[0] ?? base;
  const known: Readonly<Record<string, string>> = {
    Helvetica: 'Arial',
    Times: 'Times New Roman',
    Courier: 'Courier New',
  };
  const trimmed = family.replace(/(PSMT|MT|PS)$/u, '');
  const mapped = known[trimmed];
  if (mapped !== undefined) return mapped;
  const spaced = trimmed.replace(/([a-z])([A-Z])/gu, '$1 $2');
  return spaced === '' ? 'Arial' : spaced;
}

/** The deck's frame for a page: the transform, the fit factor and the centring offset. */
interface Fit {
  readonly transform: PageTransform;
  readonly k: number;
  readonly ox: number;
  readonly oy: number;
}

function fitOf(content: PageContent, deck: PageSize): Fit {
  const { crop, rotation } = content.frame;
  const transform = pageTransform(crop, rotation, 1);
  const { width, height } = transform.viewport;
  const k = Math.min(deck.width / Math.max(width, 1), deck.height / Math.max(height, 1));
  return { transform, k, ox: (deck.width - width * k) / 2, oy: (deck.height - height * k) / 2 };
}

function at(fit: Fit, x: number, y: number): { readonly x: number; readonly y: number } {
  const point = toViewport(pdfPoint(x, y), fit.transform);
  return { x: fit.ox + point.x * fit.k, y: fit.oy + point.y * fit.k };
}

/** The slide box of an axis box in page space. */
function boxOf(fit: Fit, b: ContentBounds): { x: number; y: number; width: number; height: number } {
  const corners = [at(fit, b.left, b.bottom), at(fit, b.right, b.bottom), at(fit, b.left, b.top), at(fit, b.right, b.top)];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

interface StyledRun {
  readonly text: string;
  readonly style: ContentRun['style'];
}

/** A line's runs on the slide, adjacent runs set alike joined and the line's trailing space dropped. */
function runsOf(runs: readonly StyledRun[], k: number): readonly SlideRun[] {
  const out: SlideRun[] = [];
  for (const run of runs) {
    const next: SlideRun = {
      text: run.text,
      font: typefaceOf(run.style.font),
      serif: run.style.serif,
      mono: run.style.mono,
      size: run.style.size * k,
      colour: hex(run.style.colour),
      bold: run.style.bold,
      italic: run.style.italic,
    };
    const last = out[out.length - 1];
    const alike =
      last?.font === next.font &&
      last.size === next.size &&
      last.colour === next.colour &&
      last.bold === next.bold &&
      last.italic === next.italic;
    if (last !== undefined && alike) {
      out[out.length - 1] = { ...last, text: last.text + next.text };
    } else {
      out.push(next);
    }
  }
  const final = out[out.length - 1];
  if (final !== undefined) out[out.length - 1] = { ...final, text: final.text.trimEnd() };
  return out.filter((run) => run.text !== '');
}

function dominantSize(runs: readonly StyledRun[]): number {
  let best = 0;
  let size = 0;
  for (const run of runs) {
    const weight = run.text.replace(/\s/gu, '').length;
    if (weight > best) {
      best = weight;
      size = run.style.size;
    }
  }
  return size > 0 ? size : (runs[0]?.style.size ?? 12);
}

interface BlockLine {
  readonly runs: readonly StyledRun[];
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function textOf(line: BlockLine): string {
  return line.runs.map((run) => run.text).join('');
}

/** How a block's lines align, or `undefined` where they agree on none of left, right and centre. */
function alignmentOf(lines: readonly BlockLine[]): { align: 'l' | 'ctr' | 'r'; indent: number } | undefined {
  const [first] = lines;
  if (first === undefined) return undefined;
  const height = Math.max(first.y1 - first.y0, 1);
  const tolerance = height * ALIGN_TOLERANCE;
  const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
  if (lines.length === 1) return { align: 'l', indent: 0 };
  const rest = lines.slice(1);
  // THE FIRST LINE MAY BE INDENTED, the rest of a paragraph's left edge is the paragraph's.
  if (spread(rest.map((line) => line.x0)) <= tolerance) {
    const restLeft = Math.min(...rest.map((line) => line.x0));
    const indent = first.x0 - restLeft;
    if (Math.abs(indent) <= height * 4) return { align: 'l', indent: Math.abs(indent) <= tolerance ? 0 : indent };
  }
  if (spread(lines.map((line) => line.x1)) <= tolerance) return { align: 'r', indent: 0 };
  if (spread(lines.map((line) => (line.x0 + line.x1) / 2)) <= tolerance) return { align: 'ctr', indent: 0 };
  return undefined;
}

/** One block as one box, or as a box per line where its lines agree on no alignment or on no direction. */
function textBoxesOf(
  fit: Fit,
  rotation: number,
  order: number,
  lines: readonly BlockLine[],
): readonly SlideTextBox[] {
  const directions = new Set(lines.map((line) => isRightToLeft(textOf(line))));
  const alignment = alignmentOf(lines);
  if (alignment === undefined || directions.size > 1) {
    return lines.flatMap((line, at) => {
      const sole = textBoxesOf(fit, rotation, order + at / 1_000, [line]);
      return sole;
    });
  }
  const rtl = directions.has(true);
  const first = lines[0];
  if (first === undefined) return [];
  const size = dominantSize(first.runs);
  const pitch =
    lines.length > 1
      ? (() => {
          const last = lines[lines.length - 1] ?? first;
          const span = (first.y0 - last.y0 + (first.y1 - last.y1)) / 2;
          return Math.max(span / (lines.length - 1), size * 0.5);
        })()
      : size * SINGLE_LINE_LEADING;
  const x0 = Math.min(...lines.map((line) => line.x0));
  const x1 = Math.max(...lines.map((line) => line.x1));
  // THE SLOT'S TOP is where PowerPoint puts the first line's slot: one pitch above the baseline less what a slot holds below it.
  const top = first.y1 + pitch - (INK_TO_BASELINE + SLOT_BELOW_BASELINE) * size;
  const bottom = top - pitch * lines.length;
  const centre = at(fit, (x0 + x1) / 2, (top + bottom) / 2);
  const width = (x1 - x0) * fit.k;
  const height = (top - bottom) * fit.k;
  const rest = lines.slice(1);
  const restLeft = rest.length === 0 ? x0 : Math.min(...rest.map((line) => line.x0));
  return [
    {
      kind: 'text',
      order,
      x: centre.x - width / 2,
      y: centre.y - height / 2,
      width,
      height,
      rotation,
      align: alignment.align,
      rtl,
      pitch: pitch * fit.k,
      marginLeft: alignment.align === 'l' ? Math.max(0, restLeft - x0) * fit.k : 0,
      indent: alignment.align === 'l' ? alignment.indent * fit.k : 0,
      lines: lines.map((line) => runsOf(line.runs, fit.k)),
    },
  ];
}

function textBoxes(fit: Fit, runs: readonly ContentRun[]): readonly SlideTextBox[] {
  const shown = runs.filter((run) => run.text.trim() !== '');
  const blocks = groupIntoBlocks(
    shown.map((run) => ({
      index: run.index,
      text: run.text,
      bottom: run.bottom,
      top: run.top,
      left: run.left,
      right: run.right,
      style: run.style,
      setting: settingOf({ font: run.style.font, size: run.style.size, colour: run.style.colour }),
    })),
  );
  const rotation = fit.transform.rotation;
  return blocks.flatMap((block) => {
    const order = Math.min(...block.lines.flatMap((line) => line.runs.map((run) => run.index)));
    return textBoxesOf(
      fit,
      rotation,
      order,
      block.lines.map((line) => ({
        runs: line.runs.map((run) => ({ text: run.text, style: run.style })),
        x0: line.box.x0,
        y0: line.box.y0,
        x1: line.box.x1,
        y1: line.box.y1,
      })),
    );
  });
}

/** The image's four corners on the slide: top-left, top-right, bottom-left of the PICTURE as drawn. */
function pictureOf(fit: Fit, image: ContentImage): SlidePicture | undefined {
  const [a, b, c, d, e, f] = image.matrix;
  const map = (u: number, v: number): { x: number; y: number } => at(fit, a * u + c * v + e, b * u + d * v + f);
  // The unit square's top row is v = 1: the picture's top-left is (0, 1).
  const topLeft = map(0, 1);
  const topRight = map(1, 1);
  const bottomLeft = map(0, 0);
  const ux = topRight.x - topLeft.x;
  const uy = topRight.y - topLeft.y;
  const vx = bottomLeft.x - topLeft.x;
  const vy = bottomLeft.y - topLeft.y;
  const width = Math.hypot(ux, uy);
  const height = Math.hypot(vx, vy);
  if (width < MIN_EXTENT || height < MIN_EXTENT) return undefined;
  if (Math.abs(ux * vx + uy * vy) / (width * height) > SHEAR_COSINE) return undefined;
  const flipV = ux * vy - uy * vx < 0;
  const rotation = ((Math.atan2(uy, ux) * 180) / Math.PI + 360) % 360;
  const cx = topLeft.x + (ux + vx) / 2;
  const cy = topLeft.y + (uy + vy) / 2;
  return {
    kind: 'picture',
    order: image.index,
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    rotation,
    flipV,
    source: { kind: 'embedded', extension: image.format === 'jpeg' ? 'jpeg' : 'png', bytes: image.bytes },
  };
}

function cutOf(fit: Fit, order: number, region: ContentBounds): SlidePicture | undefined {
  const box = boxOf(fit, region);
  if (box.width < MIN_EXTENT || box.height < MIN_EXTENT) return undefined;
  return { kind: 'picture', order, ...box, rotation: 0, flipV: false, source: { kind: 'cut', region } };
}

/** A path as a shape, or `undefined` where it is not one a shape can be. */
function shapeOf(fit: Fit, path: ContentPath): SlideShape | undefined {
  if (!path.simple) return undefined;
  const moves = path.segments.filter((segment) => segment.kind === 'move').length;
  if (path.fill !== null && moves > 1) return undefined;
  const points = path.segments.flatMap((segment) => {
    switch (segment.kind) {
      case 'move':
      case 'line':
        return [at(fit, segment.x, segment.y)];
      case 'curve':
        return [at(fit, segment.x1, segment.y1), at(fit, segment.x2, segment.y2), at(fit, segment.x, segment.y)];
      case 'close':
        return [];
    }
  });
  if (points.length === 0) return undefined;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  const stroke = path.stroke;
  if (path.fill === null && stroke === null) return undefined;
  if (width < MIN_EXTENT && height < MIN_EXTENT) return undefined;
  const fill = path.fill === null ? null : { colour: hex(path.fill), alpha: path.fill.a / 255 };
  const line =
    stroke === null
      ? null
      : {
          colour: hex(stroke),
          alpha: stroke.a / 255,
          width: stroke.width * fit.k,
          cap: stroke.cap,
          join: stroke.join,
        };
  const flat = path.segments.every((segment) => segment.kind !== 'curve');
  const kinds = path.segments.map((segment) => segment.kind);
  const rel = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x - x, y: p.y - y });

  // A LINE: one move and one line, nothing painted but the stroke.
  if (flat && fill === null && kinds.length === 2 && kinds[0] === 'move' && kinds[1] === 'line') {
    const [from, to] = points;
    if (from !== undefined && to !== undefined) {
      return {
        kind: 'shape',
        order: path.index,
        x,
        y,
        width,
        height,
        geometry: { kind: 'line', flipV: (to.x - from.x) * (to.y - from.y) < 0 },
        fill,
        line,
      };
    }
  }
  // A RECTANGLE: four corners (a fifth that returns to the first, or a close), axis aligned on the slide.
  const corners = points.slice(0, kinds.filter((kind) => kind !== 'close').length);
  const closedBy = corners.length === 5 ? corners[4] : undefined;
  const four = corners.slice(0, 4);
  if (
    flat &&
    four.length === 4 &&
    (corners.length === 4 || (closedBy !== undefined && Math.hypot(closedBy.x - (four[0]?.x ?? 0), closedBy.y - (four[0]?.y ?? 0)) < AXIS_TOLERANCE)) &&
    kinds.every((kind) => kind !== 'curve') &&
    four.every((corner, n) => {
      const next = four[(n + 1) % 4];
      return next !== undefined && (Math.abs(corner.x - next.x) < AXIS_TOLERANCE || Math.abs(corner.y - next.y) < AXIS_TOLERANCE);
    }) &&
    four.every((corner) => (Math.abs(corner.x - x) < AXIS_TOLERANCE || Math.abs(corner.x - (x + width)) < AXIS_TOLERANCE) && (Math.abs(corner.y - y) < AXIS_TOLERANCE || Math.abs(corner.y - (y + height)) < AXIS_TOLERANCE)) &&
    (fill !== null || path.segments.some((segment) => segment.kind === 'close') || corners.length === 5)
  ) {
    return { kind: 'shape', order: path.index, x, y, width, height, geometry: { kind: 'rect' }, fill, line };
  }

  const commands: ShapeCommand[] = path.segments.map((segment): ShapeCommand => {
    switch (segment.kind) {
      case 'move':
      case 'line': {
        const p = rel(at(fit, segment.x, segment.y));
        return { kind: segment.kind, x: p.x, y: p.y };
      }
      case 'curve': {
        const p1 = rel(at(fit, segment.x1, segment.y1));
        const p2 = rel(at(fit, segment.x2, segment.y2));
        const p = rel(at(fit, segment.x, segment.y));
        return { kind: 'curve', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      case 'close':
        return { kind: 'close' };
    }
  });
  return { kind: 'shape', order: path.index, x, y, width, height, geometry: { kind: 'path', commands }, fill, line };
}

/** Whether a page's only text is the invisible layer recognition writes over a scan. */
export function isRecognisedScan(content: PageContent): boolean {
  return content.runs.length > 0 && content.runs.every((run) => run.invisible);
}

/**
 * A page as an editable slide, or the reason it cannot be.
 *
 * ## What each reason protects
 *
 * - `text-not-upright`: a box cannot say a skew, and a run the page set at an angle would be
 *   written level. The page is Exact look rather than wrong.
 * - `text-not-addressable`: PDFium extracted characters no object holds, so words would be missing.
 * - `content-truncated`: a list was cut at its bound.
 * - `picture-without-text`: a page of pictures and no words is a scan nobody recognised. The
 *   caller recognises first where it can; what reaches here is the page recognition could not give
 *   any words to.
 */
export function buildSlide(content: PageContent, deck: PageSize): SlideBuild {
  if (content.truncated) return { kind: 'fallback', reason: 'content-truncated' };
  if (content.unaddressable > 0) return { kind: 'fallback', reason: 'text-not-addressable' };
  const fit = fitOf(content, deck);
  const scan = isRecognisedScan(content);
  const painted = scan ? content.runs : content.runs.filter((run) => !run.invisible);
  if (painted.some((run) => !run.style.upright)) return { kind: 'fallback', reason: 'text-not-upright' };

  if (scan) {
    const page = cutOf(fit, -1, regionOfFrame(content));
    const background: SlidePicture | undefined =
      page === undefined ? undefined : { ...page, source: { kind: 'page' } };
    return {
      kind: 'editable',
      scan: true,
      slide: { objects: [...(background === undefined ? [] : [background]), ...textBoxes(fit, painted)] },
    };
  }
  if (content.runs.length === 0 && content.images.length > 0) {
    return { kind: 'fallback', reason: 'picture-without-text' };
  }

  const objects: SlideObject[] = [...textBoxes(fit, painted)];
  for (const image of content.images) {
    const placed = image.clipped ? undefined : pictureOf(fit, image);
    const picture = placed ?? cutOf(fit, image.index, image.bounds);
    if (picture !== undefined) objects.push(picture);
  }
  for (const path of content.paths) {
    const shape = shapeOf(fit, path);
    const drawn = shape ?? cutOf(fit, path.index, path.bounds);
    if (drawn !== undefined) objects.push(drawn);
  }
  for (const opaque of content.opaque) {
    const cut = cutOf(fit, opaque.index, opaque.bounds);
    if (cut !== undefined) objects.push(cut);
  }
  objects.sort((first, second) => first.order - second.order);
  return { kind: 'editable', scan: false, slide: { objects } };
}

/** The whole visible page as an axis box in page space. */
export function regionOfFrame(content: PageContent): ContentBounds {
  const { crop } = content.frame;
  return {
    left: Math.min(crop.x0, crop.x1),
    right: Math.max(crop.x0, crop.x1),
    bottom: Math.min(crop.y0, crop.y1),
    top: Math.max(crop.y0, crop.y1),
  };
}
