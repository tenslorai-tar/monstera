import type { PDFPage, StrokeState } from './mupdfRaw.js';
import * as mupdf from './mupdfRaw.js';

import type { AnnotationRect } from '@monstera/contract';
import { type PageTransform, toPdf, viewportPoint } from '@monstera/shared';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { frameOf, pageAt } from './pageAnnotations.js';

/**
 * Where a flat page's form fields probably are
 * (`scripts/research/flatFieldDetection.mjs`, 2026-09-08).
 *
 * ## A FIELD AND AN EMPTY TABLE CELL ARE THE SAME RECTANGLE
 *
 * That is the row's whole difficulty and the measurement's finding. Six
 * fixtures with ground truth in the generator, and four candidate rules:
 *
 * | rule | flat form | mixed | empty grid ×2 | blank timesheet |
 * |---|---|---|---|---|
 * | holds no text | 1.00 / 1.00 | 1.00 / 1.00 | **36 false** | **24 false** |
 * | under 3 column siblings | 1.00 / **0.43** | 1.00 / 1.00 | **12 false** | none |
 * | a label to its left | 1.00 / 0.57 | 1.00 / 1.00 | none | **7 false** |
 * | **no text AND a label either side** | **1.00 / 1.00** | **1.00 / 1.00** | **none** | 6 false |
 *
 * So this uses the last, and the two rules it does **not** use are worth as much
 * as the one it does:
 *
 * - **Column siblings are backwards for the commonest field shape.** A form's
 *   rule lines all begin after the labels and end at the same margin, so they
 *   are themselves a column — and the threshold cannot be set anyway, since an
 *   eight-row grid gives seven siblings and a three-row grid gives two.
 * - **The label has to be read on both sides.** `☐ Yes` puts the word to the
 *   right of the square, and a left-only rule finds no tick box at all.
 *
 * ## It PROPOSES, and that is the measurement rather than caution
 *
 * The best rule still calls six cells of a blank timesheet fields — and the
 * label *cell* there is the fixture's assumption, not the page's fact: somebody
 * prints a blank timesheet in order to write in the cells. A filled cell is not
 * a field because it holds a value already; an empty ruled box beside a label is
 * a place to write, which is what a field is.
 *
 * So the distinction is not a property of the page, and this answers candidates
 * a person accepts rather than fields it has created. `createFormField` takes a
 * list for exactly that reason: accepting twenty is one decision, one log entry
 * and one undo.
 */

/** How many candidates one page may answer. `MAX_CREATED_FIELDS`' bound. */
export const MAX_FLAT_CANDIDATES = 256;

/** How long a label may be. A caption, not a paragraph. */
const MAX_LABEL = 128;

/**
 * How far to either side a label may sit, in points.
 *
 * Wide enough for the gap between a label and the rule that follows it, narrow
 * enough that the next column's heading is not read as this box's label. 60 was the
 * measurement's, from six synthetic pages, and it was too short for a real form: on
 * the owner's form-test.pdf (read 2026-10-07 from its widgets' rectangles and its
 * labels' boxes) a field starts 55 to 75 points after the end of its label, so a
 * 60 reached some and missed the rest. 120 is twice the largest gap read there, and
 * is still shorter than a column of the narrowest table the fixtures draw (140).
 */
const LABEL_REACH = 120;

/** How far a label's line may sit off the box's middle before it is elsewhere. */
const LABEL_SLACK = 6;

/**
 * The smallest box worth proposing, in points.
 *
 * A hairline of rule between two table cells is a path; a field nobody can
 * click is not a proposal. `MINIMUM_BOX` in `formFieldTools.ts` is the same
 * number for the same reason on the drawing side.
 */
const MINIMUM_EXTENT = 4;

/**
 * The largest share of the page a candidate may cover.
 *
 * A page border and a table's outer frame are paths like any other, and both
 * hold no text and sit beside a heading. Neither is a field, and the thing that
 * separates them from one is size rather than shape.
 */
const MAXIMUM_COVERAGE = 0.5;

/**
 * How far above a box its caption may sit, in points: a heading over a writing box or over a table's first row. Two lines
 * of ten-point text, so the line above the caption is not read as it.
 */
const ABOVE_REACH = 24;

/**
 * How far apart two stacked cells may be and still be one column of a table, in points. Read 2026-10-10 from the owner's
 * form-test.pdf and its built twin (`formTestForm.ts`): rows 28 points apart, cells 22 tall, so a 6 point gap; 8 keeps
 * one and stops short of the next block of the page.
 */
const CELL_GAP = 8;

/**
 * How far left of the FIRST box of a row of tick boxes the row's word may sit, in points: past {@link LABEL_REACH},
 * because a row's word names the row and sits where a field's label would, before a run of boxes a person reads as one
 * question (the built twin's *Grid*: 125 points). Only a row of three or more takes it.
 */
const ROW_REACH = 160;

/** How far apart two radios' middles may be, up and down, and still be one row of one group, in points. */
const ROW_SLACK = 4;

/** One place a field could go, and what to call it. */
export interface FlatFieldCandidate {
  /** Where it goes, in PDF user space — what `createFormField` takes. */
  readonly rect: AnnotationRect;
  /** The text beside it, as a person reads it. Empty when there is none. */
  readonly label: string;
  /**
   * A field name derived from the label, unique within this page's answer AND among the fields the document has. For a
   * radio it is its GROUP's name, which every option of the group shares.
   */
  readonly name: string;
  /**
   * A small square with its word beside it is a tick box; a small circle is a radio; a line or a wider box is a text
   * field (the owner's F1).
   */
  readonly kind: 'text' | 'checkbox' | 'radio';
  /** A radio's own value within its group, from the word beside it; absent for every other kind. */
  readonly option?: string | undefined;
  /** Where it is in the page's display space at scale 1, which is what a preview marks on the page. */
  readonly shown: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

/** A box in the page's DISPLAY space, which is what the device reports. */
interface Displayed {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A drawn path: where it is, and whether it is round (drawn with curves), which is what a radio's circle is. */
interface Drawn extends Displayed {
  readonly round: boolean;
}

/**
 * `getBounds` needs a stroke state and a fill has none.
 *
 * `new StrokeState()` with no argument throws inside the library — measured while writing the instrument — so *no
 * outset* is spelt as a zero width, once, rather than at each call site.
 */
function hairline(): StrokeState {
  return new mupdf.StrokeState({
    lineCap: 'Butt',
    lineJoin: 'Miter',
    lineWidth: 0,
    miterLimit: 10,
    dashPhase: 0,
    dashes: [],
  });
}

/**
 * A path's box from the points it passes THROUGH, and whether it curves.
 *
 * `getBounds` answers the box of a curve's CONTROL points too, and a circle drawn with four curves has its control
 * points well outside it: measured 2026-10-10 on a flattened radio, a 16 point circle reported a 35 point box, so a
 * radio was proposed at twice its size over its own label. A curve's end points are on it, and a circle's four are its
 * extremes, so they are its box.
 */
function drawnOf(path: mupdf.Path, ctm: mupdf.Matrix, fallback: Displayed): Drawn {
  const [a, b, c, d, e, f] = ctm;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let curves = 0;
  const take = (x: number, y: number): void => {
    const px = a * x + c * y + e;
    const py = b * x + d * y + f;
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px);
    y1 = Math.max(y1, py);
  };
  path.walk({
    moveTo: take,
    lineTo: take,
    curveTo: (_x1, _y1, _x2, _y2, x3, y3) => {
      curves += 1;
      take(x3, y3);
    },
  });
  if (curves < 2 || !Number.isFinite(x0)) return { ...fallback, round: false };
  return { x0, y0, x1, y1, round: true };
}

/**
 * Every path and every line of text the page draws, in display space.
 *
 * **The paths come from a DEVICE and the text from `toStructuredText`**, and the split is a correction rather than a
 * preference. `Text.getBounds` answers the FONT's box scaled to the run, not the glyphs' ink: measured 2026-09-08, a run
 * drawn at `x=66` inside a cell spanning 59.5–200.5 reported `x0=55.69`, outside its own cell. `toStructuredText`
 * answers where the glyphs are, which is the question and MuPDF's own answer to it (B3a).
 */
function draws(loaded: PDFPage): {
  readonly paths: Drawn[];
  readonly text: (Displayed & { readonly words: string })[];
} {
  const paths: Drawn[] = [];
  const text: (Displayed & { readonly words: string })[] = [];
  const stroke = hairline();

  const device = new mupdf.Device({
    fillPath: (path, _evenOdd, ctm) => {
      const [x0, y0, x1, y1] = path.getBounds(stroke, ctm);
      paths.push(drawnOf(path, ctm, { x0, y0, x1, y1 }));
    },
    strokePath: (path, state, ctm) => {
      const [x0, y0, x1, y1] = path.getBounds(state, ctm);
      paths.push(drawnOf(path, ctm, { x0, y0, x1, y1 }));
    },
  });
  // THE PAGE'S OWN CONTENT ONLY. `run` also draws the page's annotations, and a field's widget is one: its border and its
  // background are paths, so on a form that already had fields every one of them was proposed again, beside its own
  // label (measured 2026-10-07 on the owner's form-test.pdf: 33 candidates over three pages, none of them a new place).
  loaded.runPageContents(device, mupdf.Matrix.identity);
  device.close();

  const structured = JSON.parse(loaded.toStructuredText().asJSON()) as {
    blocks?: { lines?: { bbox?: { x: number; y: number; w: number; h: number }; text?: string }[] }[];
  };
  for (const block of structured.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const box = line.bbox;
      if (box === undefined) continue;
      text.push({ x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h, words: (line.text ?? '').slice(0, MAX_LABEL) });
    }
  }
  return { paths, text };
}

/** The area two boxes share. */
function sharedArea(a: Displayed, b: Displayed): number {
  const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return width > 0 && height > 0 ? width * height : 0;
}

function areaOf(box: Displayed): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

/**
 * Whether two boxes are the same place: each covers most of the other.
 *
 * A path painted with a fill AND a stroke (a rectangle with a border and a background) reaches the device twice, once
 * for each, with the same outline. Each arrival made a candidate, so one box was proposed twice and the second was
 * named with a `_2` (reported 2026-10-07). A box that holds another is not the same place, so the test is mutual.
 */
function samePlace(a: Displayed, b: Displayed): boolean {
  const shared = sharedArea(a, b);
  const smaller = Math.min(areaOf(a), areaOf(b));
  if (smaller === 0) {
    // TWO HAIRLINES (a rule drawn twice): the same place when they lie on each other along their length.
    const along = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const across = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
    return along > 0 && across < 1 && areaOf(a) === areaOf(b);
  }
  return shared / Math.max(areaOf(a), areaOf(b)) > 0.8;
}

/** Whether a box is the size of a tick box or a radio: small, and about as wide as it is high. */
function tickSized(box: Displayed): boolean {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  return width >= 6 && width <= 26 && height >= 6 && height <= 26 && width / height > 0.7 && width / height < 1.43;
}

/** Whether any line of text sits inside this box. */
function holdsText(box: Displayed, text: readonly Displayed[]): boolean {
  return text.some(
    (line) =>
      line.x0 > box.x0 - 1 && line.x1 < box.x1 + 1 && line.y0 > box.y0 - 1 && line.y1 < box.y1 + 1,
  );
}

/**
 * How tall a box is before its label sits level with its FIRST line rather than its middle: three lines of ten-point
 * text. A comments box's label is beside its top, where writing starts, and its middle can be a hundred points lower.
 */
const TALL_BOX = 36;

/** The lines of text level with a box's middle, or with its top line where the box is tall. */
function levelWith<T extends Displayed>(box: Displayed, text: readonly T[]): T[] {
  const middle = (box.y0 + box.y1) / 2;
  const level = (y: number): T[] => text.filter((line) => line.y0 - LABEL_SLACK <= y && line.y1 + LABEL_SLACK >= y);
  const beside = level(middle);
  if (beside.length > 0 || box.y1 - box.y0 < TALL_BOX) return beside;
  // DISPLAY SPACE IS Y-DOWN, so the top line is the SMALLEST y plus half a line.
  return level(box.y0 + LABEL_SLACK * 2);
}

/** The line of text immediately to the LEFT of this box, or `null`. */
function labelLeft<T extends Displayed>(box: Displayed, text: readonly T[], reach = LABEL_REACH): T | null {
  return (
    levelWith(box, text)
      .filter((line) => line.x1 <= box.x0 + 1 && box.x0 - line.x1 < reach)
      .sort((a, b) => b.x1 - a.x1)[0] ?? null
  );
}

/** The line of text immediately to the RIGHT of this box, or `null`: a tick box's or a radio's own word. */
function labelRight<T extends Displayed>(box: Displayed, text: readonly T[]): T | null {
  return (
    levelWith(box, text)
      .filter((line) => line.x0 >= box.x1 - 1 && line.x0 - box.x1 < LABEL_REACH)
      .sort((a, b) => a.x0 - b.x0)[0] ?? null
  );
}

/** Whether a line of text sits over a box: it shares at least a third of the narrower of the two widths. */
function over(line: Displayed, box: Displayed): boolean {
  const shared = Math.min(line.x1, box.x1) - Math.max(line.x0, box.x0);
  return shared > 0 && shared >= Math.min(line.x1 - line.x0, box.x1 - box.x0) / 3;
}

/**
 * The caption ABOVE a box (the owner's F1: *cells beside labels*, and a writing box under its heading), or `null`.
 *
 * Directly above within {@link ABOVE_REACH}; or, for a cell of a table, above the column the cell heads down: the empty
 * cells of one width stacked over it, gap by gap, to the heading over the top one. A table's later rows have no word
 * near them, and their column heading is the word a person reads for them.
 */
function labelAbove<T extends Displayed>(box: Displayed, text: readonly T[], boxes: readonly Displayed[]): T | null {
  let top = box;
  for (;;) {
    const caption = text
      .filter((line) => line.y1 <= top.y0 + 1 && top.y0 - line.y1 <= ABOVE_REACH && over(line, top))
      .sort((a, b) => b.y1 - a.y1)[0];
    if (caption !== undefined) return caption;
    const cell = top;
    const higher = boxes.find(
      (each) =>
        Math.abs(each.x0 - cell.x0) < 2 &&
        Math.abs(each.x1 - cell.x1) < 2 &&
        each.y1 <= cell.y0 + 1 &&
        cell.y0 - each.y1 <= CELL_GAP &&
        each.y1 - each.y0 >= MINIMUM_EXTENT,
    );
    if (higher === undefined || higher === cell) return null;
    top = higher;
  }
}

/**
 * The box a field would occupy, given the path and the label beside it.
 *
 * **A RULE LINE HAS NO HEIGHT**, and a field with none is a field nobody can click. A printed form's line is where
 * somebody writes *above* it, so the box sits on the line and is as tall as the label beside it.
 */
function boxFor(path: Displayed, label: Displayed | null): Displayed {
  const height = path.y1 - path.y0;
  if (height >= MINIMUM_EXTENT) return path;
  const tall = label === null ? MINIMUM_EXTENT * 3 : label.y1 - label.y0;
  // DISPLAY SPACE IS Y-DOWN, so *above the line* is a SMALLER y.
  return { x0: path.x0, y0: path.y0 - tall, x1: path.x1, y1: path.y1 };
}

/**
 * A field name derived from a label, or a positional one when there is none.
 *
 * **Dots are removed rather than kept**, because a dot makes a parent in the field tree, so `Mr. Smith` as a label would
 * propose a field under a parent called `Mr`.
 */
function nameFrom(label: string, at: number): string {
  const cleaned = label
    .replaceAll(/[^\p{L}\p{N} _-]/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, '_')
    .slice(0, 64);
  return cleaned === '' ? `field_${String(at + 1)}` : cleaned;
}

/** The same name twice is a collision the create refuses, so the second is suffixed. */
function unique(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${name}_${String(suffix)}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** A display-space box as the user-space rectangle a create takes. */
function asRect(box: Displayed, transform: PageTransform): AnnotationRect {
  // THE ONE CONVERSION, through the transform every pointer event already goes through. A flip written here would be
  // the banned inline one, and it would be wrong on a rotated page and on a page whose CropBox starts anywhere but zero.
  const first = toPdf(viewportPoint(box.x0, box.y0), transform);
  const second = toPdf(viewportPoint(box.x1, box.y1), transform);
  return {
    x0: Math.min(first.x, second.x),
    y0: Math.min(first.y, second.y),
    x1: Math.max(first.x, second.x),
    y1: Math.max(first.y, second.y),
  };
}

/** A place found, before it is named: where, what kind, and the words that will name it. */
interface Found {
  readonly box: Displayed;
  readonly kind: FlatFieldCandidate['kind'];
  readonly words: string;
  /** A radio's group: which row of circles it is in, and the words left of the row's first circle. Set when gathered. */
  group?: { readonly row: number; readonly words: string };
}

/**
 * Where a page's form fields probably are.
 *
 * Answers **candidates**, never fields: see this module's header for why the distinction is not a property of the page.
 */
export function detectFlatFields(
  session: MupdfSession,
  page: number,
): Promise<{
  readonly candidates: readonly FlatFieldCandidate[];
  readonly truncated: boolean;
  /** How many places that look like a field already are one, left out so none is made twice. */
  readonly alreadyFields: number;
}> {
  return withDocument(session, (document) => {
    const loaded = pageAt(document, page, document.countPages());
    const transform = frameOf(loaded);
    // A PAGE THAT DISPLAYS NO REGION has nowhere to put a field, which is the annotation reader's own answer.
    if (transform === null) return { candidates: [], truncated: false, alreadyFields: 0 };

    const { paths, text } = draws(loaded);
    const area = (transform.crop.x1 - transform.crop.x0) * (transform.crop.y1 - transform.crop.y0);

    // WHAT THE DOCUMENT HAS ALREADY, on this page by place and on every page by name. A place that holds a field is not
    // proposed again, and a name a field carries is not given to a new one, since a create refuses a collision.
    const widgets: Displayed[] = [];
    const taken = new Set<string>();
    for (let at = 0; at < document.countPages(); at += 1) {
      for (const widget of document.loadPage(at).getWidgets()) {
        taken.add(widget.getName());
        if (at === page) {
          const [x0, y0, x1, y1] = widget.getBounds();
          widgets.push({ x0, y0, x1, y1 });
        }
      }
    }

    // THE EMPTY BOXES the page draws, for a table's columns: a cell's heading is found up through these.
    const empty = paths.filter((path) => path.y1 - path.y0 >= MINIMUM_EXTENT && !holdsText(path, text));

    const found: Found[] = [];
    const unlabelled: Drawn[] = [];
    const kept: Displayed[] = [];
    let alreadyFields = 0;
    let truncated = false;

    /** Proposes one place, unless it is too small, too large, already proposed, or already a field. */
    const place = (path: Drawn, kind: FlatFieldCandidate['kind'], label: Displayed & { readonly words: string }): void => {
      if (found.length >= MAX_FLAT_CANDIDATES) {
        truncated = true;
        return;
      }
      const box = boxFor(path, label);
      const width = box.x1 - box.x0;
      const height = box.y1 - box.y0;
      if (width < MINIMUM_EXTENT || height < MINIMUM_EXTENT) return;
      if (area > 0 && (width * height) / area > MAXIMUM_COVERAGE) return;

      // THE SAME PLACE TWICE is one candidate (a fill and a stroke of one box), and a place a field holds is none.
      if (kept.some((earlier) => samePlace(earlier, box))) return;
      if (widgets.some((widget) => sharedArea(widget, box) > 0.3 * Math.min(areaOf(widget), areaOf(box)))) {
        kept.push(box);
        alreadyFields += 1;
        return;
      }
      kept.push(box);
      found.push({ box, kind, words: label.words });
    };

    for (const path of paths) {
      if (holdsText(path, text)) continue;
      const small = tickSized(path);
      const kind: FlatFieldCandidate['kind'] = small ? (path.round ? 'radio' : 'checkbox') : 'text';
      // A SMALL SQUARE WITH NO WORD OF ITS OWN may be one of a row of boxes the row's one word names (`gatherRows`), so
      // it waits: named on its own first, the row's word would go to whichever of its boxes is nearest that word.
      if (kind === 'checkbox' && labelRight(path, text) === null) {
        unlabelled.push(path);
        continue;
      }
      // A TICK BOX'S AND A RADIO'S WORD is beside it, right first (`☐ Yes`); a field's label is left first; a box with
      // height may take a caption over it, and a rule line never (a table's row rules would all be proposed).
      const label =
        kind === 'text'
          ? (labelLeft(path, text) ?? labelRight(path, text) ?? (path.y1 - path.y0 >= MINIMUM_EXTENT ? labelAbove(path, text, empty) : null))
          : (labelRight(path, text) ?? labelLeft(path, text) ?? labelAbove(path, text, empty));
      if (label !== null) place(path, kind, label);
    }

    // A SQUARE IN NO ROW is labelled the way any tick box is, by the word left of it or the caption over it.
    for (const path of gatherRows(unlabelled, text, widgets, kept, found)) {
      const label = labelLeft(path, text) ?? labelAbove(path, text, empty);
      if (label !== null) place(path, 'checkbox', label);
    }
    if (found.length > MAX_FLAT_CANDIDATES) {
      found.length = MAX_FLAT_CANDIDATES;
      truncated = true;
    }
    gatherRadios(found, text);
    // A GROUP'S NAME is made unique against the form ONCE, so every option of the group carries the same one.
    const groups = new Map<number, string>();
    const candidates = found.map((each, at): FlatFieldCandidate => {
      const rect = asRect(each.box, transform);
      const shown = { x0: each.box.x0, y0: each.box.y0, x1: each.box.x1, y1: each.box.y1 };
      // A RADIO IS NEVER ALONE: `gatherRadios` gives every one a group, a group of one where the row has one circle.
      if (each.kind !== 'radio' || each.group === undefined) {
        return { rect, shown, label: each.words, name: unique(nameFrom(each.words, at), taken), kind: each.kind };
      }
      const group = each.group;
      let name = groups.get(group.row);
      if (name === undefined) {
        name = unique(nameFrom(group.words, at), taken);
        groups.set(group.row, name);
      }
      return { rect, shown, label: each.words, name, kind: 'radio', option: each.words === '' ? `Choice${String(at + 1)}` : each.words };
    });
    return { candidates, truncated, alreadyFields };
  });

  /**
   * A ROW OF THREE OR MORE small squares with no word of their own, named by the word left of the first (the built
   * twin's *Grid*): each a tick box, numbered along the row. Fewer than three is not a row a person reads as one question.
   * Answers the squares in no named row, and those a field holds, to be placed one at a time.
   */
  function gatherRows(
    boxes: readonly Drawn[],
    text: readonly (Displayed & { readonly words: string })[],
    widgets: readonly Displayed[],
    kept: Displayed[],
    found: Found[],
  ): Drawn[] {
    // A BOX A FIELD HOLDS is in no row: it goes back to be counted as a field already, the way any other one is.
    const left: Drawn[] = [];
    const distinct: Drawn[] = [];
    for (const box of boxes) {
      if (distinct.some((earlier) => samePlace(earlier, box)) || left.some((earlier) => samePlace(earlier, box))) continue;
      if (widgets.some((widget) => sharedArea(widget, box) > 0.3 * Math.min(areaOf(widget), areaOf(box)))) left.push(box);
      else distinct.push(box);
    }
    const rows: Drawn[][] = [];
    for (const box of [...distinct].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
      const middle = (box.y0 + box.y1) / 2;
      const row = rows.find((each) => {
        const last = each[each.length - 1];
        return (
          last !== undefined &&
          Math.abs((last.y0 + last.y1) / 2 - middle) <= ROW_SLACK &&
          box.x0 - last.x1 <= 3 * (box.x1 - box.x0)
        );
      });
      if (row === undefined) rows.push([box]);
      else row.push(box);
    }
    // A ROW WITH NO WORD UNDER A NAMED ROW of the same columns is that grid's next row (`Grid 6` follows `Grid 5`): a
    // grid's word is printed once, beside its first row.
    const named: { words: string; count: number; row: Drawn[] }[] = [];
    for (const row of rows) {
      const first = row[0];
      const word = first === undefined || row.length < 3 ? null : labelLeft(first, text, ROW_REACH);
      const above =
        first === undefined || row.length < 3 || word !== null
          ? undefined
          : named.find((grid) => {
              const top = grid.row[0];
              return (
                top !== undefined &&
                grid.row.length === row.length &&
                grid.row.every((box, at) => Math.abs(box.x0 - (row[at]?.x0 ?? Infinity)) < 2) &&
                first.y0 - top.y1 >= 0 &&
                first.y0 - top.y1 <= 2 * (first.y1 - first.y0)
              );
            });
      if (word === null && above === undefined) {
        left.push(...row);
        continue;
      }
      const grid = above ?? { words: word?.words ?? '', count: 0, row };
      if (above === undefined) named.push(grid);
      grid.row = row;
      for (const box of row) {
        kept.push(box);
        grid.count += 1;
        found.push({ box, kind: 'checkbox', words: `${grid.words} ${String(grid.count)}` });
      }
    }
    return left;
  }

  /**
   * One row of circles is one radio group (the owner's F1: *small circles are radios*): the circles level with each
   * other, named by the words left of the first, each option by its own word. A circle on its own is a group of one.
   * Group names are made unique against the form, once per group, so its options share it.
   */
  function gatherRadios(found: Found[], text: readonly (Displayed & { readonly words: string })[]): void {
    const radios = found.filter((each) => each.kind === 'radio').sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
    const rows: Found[][] = [];
    for (const radio of radios) {
      const middle = (radio.box.y0 + radio.box.y1) / 2;
      const row = rows.find((each) => {
        const first = each[0];
        return first !== undefined && Math.abs((first.box.y0 + first.box.y1) / 2 - middle) <= ROW_SLACK;
      });
      if (row === undefined) rows.push([radio]);
      else row.push(radio);
    }
    rows.forEach((row, at) => {
      row.sort((a, b) => a.box.x0 - b.box.x0);
      const first = row[0];
      if (first === undefined) return;
      // THE GROUP'S WORDS are left of the first circle, never another circle's option word between two circles.
      const left = labelLeft(first.box, text);
      const words = left !== null && left.words !== first.words ? left.words : 'Group';
      for (const radio of row) radio.group = { row: at, words };
    });
  }
}
