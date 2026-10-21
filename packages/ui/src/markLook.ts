import {
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
  /** A rule under or through words: an underline, a strikeout. */
  | { readonly part: 'rule'; readonly boxes: readonly LookBox[]; readonly at: 'under' | 'through'; readonly stroke: LookStroke }
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
  | { readonly part: 'stamp'; readonly box: LookBox; readonly word: string; readonly paint: LookPaint }
  /** A link, as the link layer outlines one where links are made. */
  | { readonly part: 'link'; readonly box: LookBox }
  /** A picture the renderer already holds: a kept stamp picture, a signature's picture or outline. */
  | { readonly part: 'picture'; readonly box: LookBox; readonly src: string }
  /** A drawn signature's strokes, in their own box's units. */
  | { readonly part: 'strokes'; readonly box: LookBox; readonly d: string; readonly viewBox: string; readonly paint: LookPaint }
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
  /** A built-in stamp's words, as the stamp chooser shows them. */
  readonly stampWord?: (stamp: Extract<AnnotationDraft, { readonly type: 'stamp' }>['stamp']) => string;
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
      return context.selectionBoxes === undefined ? undefined : { parts: [{ part: 'fill', boxes: context.selectionBoxes, paint }] };
    case 'underline':
    case 'strikeout':
      return context.selectionBoxes === undefined
        ? undefined
        : { parts: [{ part: 'rule', boxes: context.selectionBoxes, at: draft.type === 'underline' ? 'under' : 'through', stroke: stroke(1) }] };
    case 'redact':
      if ('rect' in draft) return { parts: [{ part: 'redact', boxes: [boxOf(draft.rect, transform)] }] };
      return context.selectionBoxes === undefined ? undefined : { parts: [{ part: 'redact', boxes: context.selectionBoxes }] };
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
    case 'stamp': {
      const word = context.stampWord?.(draft.stamp);
      return word === undefined ? undefined : { parts: [{ part: 'stamp', box: boxOf(draft.rect, transform), word, paint }] };
    }
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
