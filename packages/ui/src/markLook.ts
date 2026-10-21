import {
  BUILT_IN_STAMP_NAME,
  OUTLINE_OPS,
  type RequestedSignatureMark,
  fittedPoint,
  outlineFit,
  pictureFit,
  strokesFit,
  type AnnotationColour,
  type AnnotationDraft,
  type AnnotationPoint,
  type AnnotationRect,
  type DispatchableCommand,
  type MeasureCaption,
  measureCaption,
  measureLabel,
} from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import { pdfPoint, toViewport } from '@monstera/shared';

import type { SelectedAnnotation } from './annotations/selectTool.js';
import type { PreviewCaption, ReshapedMark } from './registries/tools.js';

/**
 * A released mark's FINAL LOOK, drawn while the page has not yet drawn it
 * ([ADR-0257](../../../docs/DECISIONS/0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md)).
 *
 * ## From the command, by this one function
 *
 * Every value a new mark will have is in the command the tool returns: `addAnnotation`'s draft carries its colour,
 * opacity, width, ending, border, words, size, family and direction. So the look is read from the COMMAND, never from
 * the drag's preview, which is the gesture's geometry alone — what is held is what was sent. A moved or reshaped mark's
 * style is the selection's, read where the command names the mark; a picture the command names by id is the one the
 * renderer already holds, passed in `context`.
 *
 * ## In the overlay's pixels, as the page draws it
 *
 * Every part is placed through the page's one transform, so a zoomed or turned page draws the look where the page will
 * draw the mark. Widths are points through the same transform. Where MuPDF's appearance follows a rule the contract
 * states — a measurement's reading (`measureCaption`) — the look takes it; otherwise it is drawn from the command's
 * values, and the difference at the handover is measured per tool by the R19 proof rather than assumed away.
 */

/** A colour as the page will draw it, with the mark's opacity. */
export interface LookPaint {
  readonly colour: AnnotationColour;
  readonly opacity: number;
}

/** A stroke: its paint and its width in the overlay's pixels. */
export interface LookStroke extends LookPaint {
  readonly width: number;
}

export interface LookBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One drawn part of a look. A look is several: a line and its reading, a box and its words. */
export type LookPart =
  | { readonly part: 'outline'; readonly shape: 'rect' | 'ellipse'; readonly box: LookBox; readonly stroke: LookStroke }
  | {
      readonly part: 'poly';
      readonly points: readonly (readonly [number, number])[];
      readonly closed: boolean;
      readonly stroke: LookStroke;
      /** A cloud's scalloped border (`/BE /S /C`), drawn as arcs along each edge. */
      readonly cloudy?: true;
      /** A closed arrowhead at the last point. */
      readonly arrow?: true;
    }
  /** A colour laid over the page's words, multiplied as a highlight is drawn. */
  | { readonly part: 'fill'; readonly boxes: readonly LookBox[]; readonly paint: LookPaint }
  /** A text highlight's outline per line, as MuPDF draws one: the box with its ends bulged out (`highlightOutline`). */
  | { readonly part: 'swash'; readonly paths: readonly string[]; readonly paint: LookPaint }
  /** A rule under or through words, one line per line of words, each as MuPDF sets it (`ruleUnder`). */
  | {
      readonly part: 'rule';
      readonly lines: readonly { readonly x1: number; readonly x2: number; readonly y: number; readonly width: number }[];
      readonly paint: LookPaint;
    }
  /** A redaction not yet applied: the page layer's own hatched mark. */
  | { readonly part: 'redact'; readonly boxes: readonly LookBox[] }
  /** A measurement's reading, where the page sets it. */
  | { readonly part: 'caption'; readonly caption: PreviewCaption; readonly paint: LookPaint }
  /** A text mark's words in its box, in its face, size, colour and direction. */
  | {
      readonly part: 'words';
      readonly box: LookBox;
      readonly text: string;
      readonly paint: LookPaint;
      /** Points, through the page's transform. */
      readonly size: number;
      /** {@link TEXT_INSET}, through the page's transform. */
      readonly inset: number;
      readonly font: string;
      readonly family: string | undefined;
      readonly direction: 'left-to-right' | 'right-to-left';
      /** A text box's border, one point wide; a typewriter and a callout's box draw none. */
      readonly border?: LookStroke;
    }
  /** A sticky note's icon, a caret, a built-in stamp: a sign drawn in the mark's colour. */
  | { readonly part: 'sign'; readonly sign: 'note' | 'caret'; readonly box: LookBox; readonly paint: LookPaint }
  /**
   * A built-in stamp as MuPDF draws a rubber stamp (`rubberStamp`): its 190 by 50 box fitted into `box`, the word at the
   * size and baseline MuPDF sets for the stamp's name, both in that box's own units.
   */
  | {
      readonly part: 'stamp';
      readonly box: LookBox;
      readonly word: string;
      readonly size: number;
      readonly baseline: number;
      readonly paint: LookPaint;
    }
  /** A link, as the link layer outlines one where links are made. */
  | { readonly part: 'link'; readonly box: LookBox }
  /** A picture the renderer already holds: a kept stamp picture, a signature's picture or outline. */
  | { readonly part: 'picture'; readonly box: LookBox; readonly src: string }
  /**
   * A signature's mark as the writers draw it (`signatureFit.ts`), in its box's own units: a typed name's outline filled
   * (`pen: 'fill'`), or drawn strokes with that pen.
   */
  | {
      readonly part: 'strokes';
      readonly box: LookBox;
      readonly d: string;
      readonly viewBox: string;
      readonly paint: LookPaint;
      readonly pen: number | 'fill';
    }
  /** A moved mark's selection, where the release put it (R7): its box and handles go on with the mark. */
  | { readonly part: 'selection'; readonly mark: ReshapedMark };

export interface MarkLook {
  readonly parts: readonly LookPart[];
  /**
   * The mark on this page, by its place in the walk, that the page must draw WITHOUT while this look stands: a moved or
   * reshaped mark (R17), and an erased one, whose final look is its absence.
   */
  readonly leaves?: number;
  /** The reading a reshaped measurement shows, which the Properties tab's Comment shows too (the owner's B1). */
  readonly reading?: { readonly index: number; readonly text: string };
}

/** What a look may need that the command does not carry. */
export interface LookContext {
  /** The marks a move or a reshape names, as the selection read them: their kind and style. */
  readonly selected?: readonly SelectedAnnotation[];
  /** A text selection's boxes on screen at its release, for a markup the command names by its two ends. */
  readonly selectionBoxes?: readonly LookBox[];
}

/** The box MuPDF draws a rubber stamp in, in its own units, before fitting it to the annotation's rectangle. */
export const RUBBER_STAMP = { width: 190, height: 50 } as const;

/**
 * The word, type size and baseline MuPDF 1.28.0 sets for a rubber stamp's `/Name` (`pdf_write_stamp_appearance_rubber`,
 * read in `source/pdf/pdf-appearance.c`): its standard names drawn in capitals at their own size, any other name drawn as
 * written at 20 on a baseline of 17. Only the names a built-in stamp writes (`BUILT_IN_STAMP_NAME`) are listed.
 */
const RUBBER_WORDS: Readonly<Record<string, readonly [word: string, baseline: number, size: number]>> = {
  Approved: ['APPROVED', 13, 30],
  Confidential: ['CONFIDENTIAL', 17, 20],
  Final: ['FINAL', 13, 30],
  NotApproved: ['NOT APPROVED', 17, 20],
  Draft: ['DRAFT', 13, 30],
};

/**
 * A built-in stamp's look in `rect` on screen, as MuPDF lays one out: the 190 by 50 box scaled to fit, keeping its
 * proportions and centred on the rectangle — measured on the engine, a 240 by 60 box came back 228 by 60 — and the word
 * for its name.
 */
export function rubberStamp(name: string, rect: LookBox, paint: LookPaint): Extract<LookPart, { part: 'stamp' }> {
  const [word, baseline, size] = RUBBER_WORDS[name] ?? [name, 17, 20];
  const scale = Math.min(rect.width / RUBBER_STAMP.width, rect.height / RUBBER_STAMP.height);
  const width = RUBBER_STAMP.width * scale;
  const height = RUBBER_STAMP.height * scale;
  return {
    part: 'stamp',
    box: { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height },
    word,
    size,
    baseline,
    paint,
  };
}

/** Pixels per point on this page as drawn: the length of one point along the page's own x axis. */
function pixelsPerPoint(transform: PageTransform): number {
  const a = toViewport(pdfPoint(0, 0), transform);
  const b = toViewport(pdfPoint(1, 0), transform);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function at(point: AnnotationPoint, transform: PageTransform): readonly [number, number] {
  const shown = toViewport(pdfPoint(point.x, point.y), transform);
  return [shown.x, shown.y];
}

function boxOf(rect: AnnotationRect, transform: PageTransform): LookBox {
  const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
  const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * A reading set at `set` (PDF space) as it shows on screen: its baseline's start, the turn of its baseline as drawn —
 * clockwise in the overlay's pixels — and its size in pixels, each read from the page's own transform, so a turned or
 * zoomed page sets it where the page does. The one place a page-set reading is placed: the select tool's drag and a
 * held look both take it.
 */
export function placedCaption(set: MeasureCaption, transform: PageTransform): { x: number; y: number; placed: { angle: number; size: number } } {
  const turn = (set.angle * Math.PI) / 180;
  const start = toViewport(pdfPoint(set.x, set.y), transform);
  const along = toViewport(pdfPoint(set.x + Math.cos(turn), set.y + Math.sin(turn)), transform);
  const pixels = Math.hypot(along.x - start.x, along.y - start.y);
  return {
    x: start.x,
    y: start.y,
    placed: { angle: (Math.atan2(along.y - start.y, along.x - start.x) * 180) / Math.PI, size: set.size * pixels },
  };
}

/**
 * The room between a FreeText's edge and its words, in points: MuPDF sets them 2 in from the box, measured in its
 * appearance stream (`textTools.ts`' `INSET` adds the border's half point). The writer's words and a held text mark's
 * both start where the page's will, from this one figure.
 */
export const TEXT_INSET = 2;

/** A sticky note's icon as MuPDF draws `/Name /Comment`: a 20 by 20 point sign at its top left. */
const NOTE_SIZE = 20;

/**
 * A text highlight over one line's box, as MuPDF 1.28.0 draws it (`pdf_write_highlight_appearance`, read in
 * `source/pdf/pdf-appearance.c`): the box filled, its two ends bulged out by cubic curves whose control points sit
 * `h / 4.2425` beyond and inside each corner — *"magic number that matches adobe's appearance"*. In the page's pixels,
 * where y runs down, for an upright line.
 */
export function highlightOutline(box: LookBox): string {
  const m = box.height / 4.2425;
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const at = (x: number, y: number): string => `${String(x)},${String(y)}`;
  return [
    `M${at(left, bottom)}`,
    `C${at(left - m, bottom - m)} ${at(left - m, top + m)} ${at(left, top)}`,
    `L${at(right, top)}`,
    `C${at(right + m, top + m)} ${at(right + m, bottom - m)} ${at(right, bottom)}`,
    'Z',
  ].join(' ');
}

/**
 * An underline (`share` 1/7) or a strikeout (3/7) of one line's box, as MuPDF 1.28.0 sets it
 * (`pdf_write_underline_appearance`, `pdf_write_strike_out_appearance`): a line that share of the box's height above its
 * bottom, `h / 16` thick — *"Acrobat draws the line at 1/7 of the box width from the bottom"*.
 */
export function ruleUnder(box: LookBox, share: number): { x1: number; x2: number; y: number; width: number } {
  return { x1: box.x, x2: box.x + box.width, y: box.y + box.height - box.height * share, width: box.height / 16 };
}

/** A text markup's look over a selection's line boxes: one place for the tool's route and the menu's. */
function markupParts(type: 'highlight' | 'underline' | 'strikeout' | 'redact', boxes: readonly LookBox[], paint: LookPaint): LookPart[] {
  if (type === 'highlight') return [{ part: 'swash', paths: boxes.map(highlightOutline), paint }];
  if (type === 'redact') return [{ part: 'redact', boxes }];
  return [{ part: 'rule', lines: boxes.map((box) => ruleUnder(box, type === 'underline' ? 1 / 7 : 3 / 7)), paint }];
}

/**
 * The final look of a markup made from a text selection — the tool's or the selected-text menu's — over the
 * selection's own line boxes, which `readTextSelection` measured where the words are drawn.
 */
export function selectionLook(command: DispatchableCommand, boxes: readonly LookBox[]): MarkLook | undefined {
  if (command.kind !== 'addAnnotation' || boxes.length === 0) return undefined;
  const draft = command.annotation;
  const paint = { colour: draft.colour, opacity: draft.opacity };
  if (draft.type === 'highlight' && !('rect' in draft)) return { parts: markupParts('highlight', boxes, paint) };
  if (draft.type === 'underline' || draft.type === 'strikeout') return { parts: markupParts(draft.type, boxes, paint) };
  if (draft.type === 'redact' && !('rect' in draft)) return { parts: markupParts('redact', boxes, paint) };
  return undefined;
}

/**
 * A look drawn from the page as it is drawn NOW: for a route that knows where its mark goes in the page's own space and
 * not on screen — a signature or a picture placed from the application, whose rectangle is the command's. The page
 * calls it with its own transform each time it draws the look, so a zoom between the hold and the handover moves the
 * look with the page.
 */
export type LookAt = (transform: PageTransform) => MarkLook | undefined;

/**
 * A placed picture's final look in `rect` (`applyPlaceImage`): the picture stretched to fill the box as the page is
 * seen, upright, the `cm` that scales the unit square into `[0, 0, seenWide, seenTall]`. `src` is a `blob:` address the
 * renderer already holds.
 */
export function pictureLook(rect: AnnotationRect, src: string): LookAt {
  return (transform) => ({ parts: [{ part: 'picture', box: boxOf(rect, transform), src }] });
}

/** A signature's ink, black as both writers draw it (`0 g`, `0 G`). */
const SIGNATURE_INK: LookPaint = { colour: [0, 0, 0], opacity: 1 };

/**
 * A plain signature's final look in `rect`, drawn through the page as it is then (`LookAt`): the mark fitted by the
 * writers' own rule (`signatureFit.ts`), in the box as the page is SEEN — its width and height on screen in points —
 * since the writers draw it upright on a turned page. A typed name's outline is filled; drawn strokes take the writers'
 * pen. `undefined` for a mark the renderer does not hold the ink of: a kept one named by its id, or a picture.
 */
export function signatureLook(
  mark: RequestedSignatureMark,
  rect: AnnotationRect,
  /**
   * The ink of a mark main is sent by name — a kept drawing by its id, a picture by its handle — which the dialog held
   * and handed on: the drawing's strokes, or the picture's address and its size in pixels.
   */
  shown?:
    | { readonly kind: 'drawn'; readonly strokes: Extract<RequestedSignatureMark, { kind: 'drawn' }>['strokes'] }
    | { readonly kind: 'picture'; readonly src: string; readonly width: number; readonly height: number },
): LookAt | undefined {
  const ink = mark.kind === 'outlined' || mark.kind === 'drawn' ? mark : shown;
  if (ink === undefined) return undefined;
  return (transform) => {
    const box = boxOf(rect, transform);
    const scale = pixelsPerPoint(transform);
    const wide = box.width / scale;
    const tall = box.height / scale;
    if (ink.kind === 'picture') {
      // THE WRITERS' PICTURE FIT, its bottom-left corner y up: the look's top is the box's height less its top edge.
      const fit = pictureFit(ink, wide, tall);
      const placed = { x: box.x + fit.x * scale, y: box.y + (tall - fit.y - fit.tall) * scale, width: fit.wide * scale, height: fit.tall * scale };
      return { parts: [{ part: 'picture', box: placed, src: ink.src }] };
    }
    // THE FIT IS Y-UP, as a form is; the look's box runs down.
    const at = ([x, y]: readonly [number, number]): string => `${String(x)},${String(tall - y)}`;
    const viewBox = `0 0 ${String(wide)} ${String(tall)}`;
    if (ink.kind === 'drawn') {
      const fit = strokesFit(ink.strokes, wide, tall);
      const d = ink.strokes
        .map((line) => line.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${at(fittedPoint(fit, x, y))}`).join(' '))
        .join(' ');
      return { parts: [{ part: 'strokes', box, d, viewBox, paint: SIGNATURE_INK, pen: fit.pen }] };
    }
    const fit = outlineFit(ink.outline, wide, tall);
    const { ops, points } = ink.outline;
    let next = 0;
    const take = (): string => {
      const point = fittedPoint(fit, points[next] ?? 0, points[next + 1] ?? 0);
      next += 2;
      return at(point);
    };
    // SVG HAS THE QUADRATIC the writers turn into its exact cubic, so each operator is drawn as itself.
    const d = ops
      .map((code) => {
        const op = OUTLINE_OPS[code];
        if (op === 'M' || op === 'L') return `${op}${take()}`;
        if (op === 'Q') return `Q${take()} ${take()}`;
        if (op === 'C') return `C${take()} ${take()} ${take()}`;
        return 'Z';
      })
      .join(' ');
    return { parts: [{ part: 'strokes', box, d, viewBox, paint: SIGNATURE_INK, pen: 'fill' }] };
  };
}

/** The look of one new mark, from its draft. */
function draftLook(draft: AnnotationDraft, transform: PageTransform, context: LookContext): MarkLook | undefined {
  const scale = pixelsPerPoint(transform);
  const paint = { colour: draft.colour, opacity: draft.opacity };
  const stroke = (width: number): LookStroke => ({ ...paint, width: Math.max(width, 0.5) * scale });
  switch (draft.type) {
    case 'square':
    case 'circle':
      return { parts: [{ part: 'outline', shape: draft.type === 'square' ? 'rect' : 'ellipse', box: boxOf(draft.rect, transform), stroke: stroke(draft.borderWidth) }] };
    case 'line':
      return {
        parts: [
          {
            part: 'poly',
            points: [at(draft.from, transform), at(draft.to, transform)],
            closed: false,
            stroke: stroke(draft.borderWidth),
            ...(draft.ending === 'closed-arrow' ? { arrow: true as const } : {}),
          },
        ],
      };
    case 'ink':
      return { parts: [{ part: 'poly', points: draft.points.map((point) => at(point, transform)), closed: false, stroke: stroke(draft.borderWidth) }] };
    case 'polygon':
      return {
        parts: [
          {
            part: 'poly',
            points: draft.points.map((point) => at(point, transform)),
            closed: true,
            stroke: stroke(draft.borderWidth),
            ...(draft.border === 'cloudy' ? { cloudy: true as const } : {}),
          },
        ],
      };
    case 'polyline':
      return { parts: [{ part: 'poly', points: draft.points.map((point) => at(point, transform)), closed: false, stroke: stroke(draft.borderWidth) }] };
    case 'measure-distance':
    case 'measure-area':
    case 'measure-perimeter': {
      const text = measureLabel(draft.type, draft.points, draft.scale);
      const set = measureCaption(draft.type, draft.points, text);
      const parts: LookPart[] = [
        { part: 'poly', points: draft.points.map((point) => at(point, transform)), closed: draft.type === 'measure-area', stroke: stroke(draft.borderWidth) },
      ];
      if (set !== undefined) parts.push({ part: 'caption', caption: { ...placedCaption(set, transform), text }, paint });
      return { parts };
    }
    case 'highlight':
      if ('rect' in draft) return { parts: [{ part: 'fill', boxes: [boxOf(draft.rect, transform)], paint }] };
      return context.selectionBoxes === undefined ? undefined : { parts: markupParts('highlight', context.selectionBoxes, paint) };
    case 'underline':
    case 'strikeout':
      return context.selectionBoxes === undefined ? undefined : { parts: markupParts(draft.type, context.selectionBoxes, paint) };
    case 'redact':
      if ('rect' in draft) return { parts: [{ part: 'redact', boxes: [boxOf(draft.rect, transform)] }] };
      return context.selectionBoxes === undefined ? undefined : { parts: markupParts('redact', context.selectionBoxes, paint) };
    case 'text-box':
    case 'typewriter':
    case 'callout': {
      const words: LookPart = {
        part: 'words',
        box: boxOf(draft.rect, transform),
        text: draft.text,
        paint,
        size: draft.fontSize * scale,
        inset: TEXT_INSET * scale,
        font: draft.font,
        family: draft.family,
        direction: draft.direction,
        ...(draft.type === 'text-box' ? { border: stroke(1) } : {}),
      };
      if (draft.type !== 'callout') return { parts: [words] };
      // THE LEADER, from the point it names to the box's nearer edge's middle.
      const box = words.box;
      const from = at(draft.at, transform);
      const toward: readonly [number, number] = [
        Math.min(Math.max(from[0], box.x), box.x + box.width),
        Math.min(Math.max(from[1], box.y), box.y + box.height),
      ];
      return { parts: [{ part: 'poly', points: [from, toward], closed: false, stroke: stroke(1) }, words] };
    }
    case 'sticky-note': {
      const corner = at(draft.at, transform);
      return { parts: [{ part: 'sign', sign: 'note', box: { x: corner[0], y: corner[1], width: NOTE_SIZE * scale, height: NOTE_SIZE * scale }, paint }] };
    }
    case 'caret': {
      const centre = at(draft.at, transform);
      const size = (draft.size ?? 14) * scale;
      return { parts: [{ part: 'sign', sign: 'caret', box: { x: centre[0] - size / 2, y: centre[1] - size / 2, width: size, height: size }, paint }] };
    }
    case 'stamp':
      return { parts: [rubberStamp(BUILT_IN_STAMP_NAME[draft.stamp], boxOf(draft.rect, transform), paint)] };
    default: {
      const unhandled: never = draft;
      return unhandled;
    }
  }
}

/** A selected mark's paint, from the style the listing read: a mark with no colour is drawn in the page's ink. */
function paintOf(mark: SelectedAnnotation): LookPaint {
  const [r = 0, g = 0, b = 0] = mark.style.colour;
  return { colour: [r, g, b], opacity: mark.style.opacity };
}

/** The look of an existing mark at a new box or new points: the same parts its kind draws, where the command puts it. */
function movedLook(
  mark: SelectedAnnotation,
  where: { readonly rect: AnnotationRect } | { readonly points: readonly AnnotationPoint[] },
  transform: PageTransform,
): LookPart[] {
  const scale = pixelsPerPoint(transform);
  const paint = paintOf(mark);
  const stroke: LookStroke = { ...paint, width: Math.max(mark.style.borderWidth ?? 1, 0.5) * scale };
  const points =
    'points' in where
      ? where.points
      : mark.points?.map((point) => ({ x: point.x + (where.rect.x0 - mark.rect.x0), y: point.y + (where.rect.y0 - mark.rect.y0) }));
  if (points !== undefined) {
    const parts: LookPart[] = [
      { part: 'poly', points: points.map((point) => at(point, transform)), closed: mark.kind === 'polygon' || mark.kind === 'measure-area', stroke },
    ];
    if (mark.measured !== undefined) {
      const text = measureLabel(mark.measured.kind, points, mark.measured.scale);
      const set = measureCaption(mark.measured.kind, points, text);
      if (set !== undefined) parts.push({ part: 'caption', caption: { ...placedCaption(set, transform), text, of: mark.index }, paint });
    }
    return parts;
  }
  const rect = 'rect' in where ? where.rect : mark.rect;
  const box = boxOf(rect, transform);
  if (mark.kind === 'highlight') return [{ part: 'fill', boxes: [box], paint }];
  if (mark.kind === 'redact') return [{ part: 'redact', boxes: [box] }];
  if (mark.kind === 'circle') return [{ part: 'outline', shape: 'ellipse', box, stroke }];
  // EVERY OTHER MARK PLACED BY ITS BOX is drawn as that box in its colour while it moves.
  return [{ part: 'outline', shape: 'rect', box, stroke }];
}

/**
 * The final look of what `command` does to the page, or `undefined` where it adds nothing to draw — a command that is
 * not a mark's, or a markup whose selection boxes were not passed.
 */
export function lookOf(command: DispatchableCommand, transform: PageTransform, context: LookContext = {}): MarkLook | undefined {
  if (command.kind === 'addAnnotation') return draftLook(command.annotation, transform, context);
  if (command.kind === 'placeAnnotation') {
    const parts = command.placements.flatMap((placement) => {
      const mark = context.selected?.find((each) => each.index === placement.index);
      return mark === undefined ? [] : movedLook(mark, { rect: placement.rect }, transform);
    });
    const first = command.placements[0];
    return parts.length === 0 || first === undefined ? undefined : { parts, ...(command.placements.length === 1 ? { leaves: first.index } : {}) };
  }
  if (command.kind === 'reshapeAnnotation') {
    const mark = context.selected?.find((each) => each.index === command.index);
    if (mark === undefined) return undefined;
    const parts = movedLook(mark, { points: command.points }, transform);
    const caption = parts.find((part): part is Extract<LookPart, { part: 'caption' }> => part.part === 'caption');
    return { parts, leaves: command.index, ...(caption === undefined ? {} : { reading: { index: command.index, text: caption.caption.text } }) };
  }
  if (command.kind === 'removeAnnotation') {
    // AN ERASURE'S LOOK IS ITS ABSENCE: nothing drawn, and the page drawn without the mark.
    const [only] = command.indices;
    return command.indices.length === 1 && only !== undefined ? { parts: [], leaves: only } : undefined;
  }
  // A LINK IS DRAWN BY THE APPLICATION'S LINK LAYER, not by the page: its look is that layer's own outline.
  if (command.kind === 'addLink') return { parts: [{ part: 'link', box: boxOf(command.rect, transform) }] };
  // A COMMAND THAT IS NOT A MARK'S draws nothing while it lands.
  return undefined;
}
