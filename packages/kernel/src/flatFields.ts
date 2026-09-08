import type { PDFPage, StrokeState } from 'mupdf';
import * as mupdf from 'mupdf';

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
 * enough that the next column's heading is not read as this box's label. Not
 * tuned — the measurement used this value and reported precision 1.00 on every
 * fixture but the timesheet, and tuning it against six synthetic pages would be
 * fitting a constant to the fixtures.
 */
const LABEL_REACH = 60;

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

/** One place a field could go, and what to call it. */
export interface FlatFieldCandidate {
  /** Where it goes, in PDF user space — what `createFormField` takes. */
  readonly rect: AnnotationRect;
  /** The text beside it, as a person reads it. Empty when there is none. */
  readonly label: string;
  /** A field name derived from the label, unique within this page's answer. */
  readonly name: string;
}

/** A box in the page's DISPLAY space, which is what the device reports. */
interface Displayed {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * `getBounds` needs a stroke state and a fill has none.
 *
 * `new StrokeState()` with no argument throws inside the library — measured
 * while writing the instrument — so *no outset* is spelt as a zero width, once,
 * rather than at each call site.
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
 * Every path and every line of text the page draws, in display space.
 *
 * **The paths come from a DEVICE and the text from `toStructuredText`**, and the
 * split is a correction rather than a preference. `Text.getBounds` answers the
 * FONT's box scaled to the run, not the glyphs' ink: measured 2026-09-08, a run
 * drawn at `x=66` inside a cell spanning 59.5–200.5 reported `x0=55.69` —
 * outside its own cell — and every containment test against it was false, for
 * all thirty-two cells. `toStructuredText` answers where the glyphs are, which
 * is the question and MuPDF's own answer to it (B3a).
 */
function draws(loaded: PDFPage): { readonly paths: Displayed[]; readonly text: Displayed[] } {
  const paths: Displayed[] = [];
  const text: Displayed[] = [];
  const stroke = hairline();

  const device = new mupdf.Device({
    fillPath: (path, _evenOdd, ctm) => {
      const [x0, y0, x1, y1] = path.getBounds(stroke, ctm);
      paths.push({ x0, y0, x1, y1 });
    },
    strokePath: (path, state, ctm) => {
      const [x0, y0, x1, y1] = path.getBounds(state, ctm);
      paths.push({ x0, y0, x1, y1 });
    },
  });
  loaded.run(device, mupdf.Matrix.identity);
  device.close();

  const structured = JSON.parse(loaded.toStructuredText().asJSON()) as {
    blocks?: { lines?: { bbox?: { x: number; y: number; w: number; h: number } }[] }[];
  };
  for (const block of structured.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const box = line.bbox;
      if (box === undefined) continue;
      text.push({ x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h });
    }
  }
  return { paths, text };
}

/** Whether any line of text sits inside this box. */
function holdsText(box: Displayed, text: readonly Displayed[]): boolean {
  return text.some(
    (line) =>
      line.x0 > box.x0 - 1 && line.x1 < box.x1 + 1 && line.y0 > box.y0 - 1 && line.y1 < box.y1 + 1,
  );
}

/** The line of text immediately beside this box, on either side, or `null`. */
function labelBeside(box: Displayed, text: readonly Displayed[]): Displayed | null {
  const middle = (box.y0 + box.y1) / 2;
  const level = text.filter(
    (line) => line.y0 - LABEL_SLACK <= middle && line.y1 + LABEL_SLACK >= middle,
  );
  // LEFT FIRST, because that is where a form puts a field's label and a tick
  // box's word on the right is the exception rather than the rule. Where both
  // exist the left one is the name a person would read.
  const left = level
    .filter((line) => line.x1 <= box.x0 + 1 && box.x0 - line.x1 < LABEL_REACH)
    .sort((a, b) => b.x1 - a.x1)[0];
  if (left !== undefined) return left;
  return (
    level
      .filter((line) => line.x0 >= box.x1 - 1 && line.x0 - box.x1 < LABEL_REACH)
      .sort((a, b) => a.x0 - b.x0)[0] ?? null
  );
}

/**
 * The box a field would occupy, given the path and the label beside it.
 *
 * **A RULE LINE HAS NO HEIGHT**, and a field with none is a field nobody can
 * click. A printed form's line is where somebody writes *above* it, so the box
 * sits on the line and is as tall as the label beside it — the label's own size
 * is what the form's designer chose for the writing, which makes it the honest
 * answer rather than a constant this build picked.
 */
function boxFor(path: Displayed, label: Displayed | null): Displayed {
  const height = path.y1 - path.y0;
  if (height >= MINIMUM_EXTENT) return path;
  const tall = label === null ? MINIMUM_EXTENT * 3 : label.y1 - label.y0;
  // DISPLAY SPACE IS Y-DOWN, so *above the line* is a SMALLER y. A build that
  // added here would put the field under the rule, which renders as a field on
  // the next line's text.
  return { x0: path.x0, y0: path.y0 - tall, x1: path.x1, y1: path.y1 };
}

/**
 * A field name derived from a label, or a positional one when there is none.
 *
 * **Dots are removed rather than kept**, because a dot makes a parent in the
 * field tree — measured by the create row — so `Mr. Smith` as a label would
 * propose a field under a parent called `Mr`. A detector inventing hierarchy
 * from punctuation is not something a person asked for.
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
  // THE ONE CONVERSION, through the transform every pointer event already goes
  // through. A flip written here would be the banned inline one, and it would
  // be wrong on a rotated page and on a page whose CropBox starts anywhere but
  // the origin — the two shapes the create row measured itself against.
  const first = toPdf(viewportPoint(box.x0, box.y0), transform);
  const second = toPdf(viewportPoint(box.x1, box.y1), transform);
  return {
    x0: Math.min(first.x, second.x),
    y0: Math.min(first.y, second.y),
    x1: Math.max(first.x, second.x),
    y1: Math.max(first.y, second.y),
  };
}

/**
 * Where a page's form fields probably are.
 *
 * Answers **candidates**, never fields: see this module's header for why the
 * distinction is not a property of the page.
 */
export function detectFlatFields(
  session: MupdfSession,
  page: number,
): Promise<{ readonly candidates: readonly FlatFieldCandidate[]; readonly truncated: boolean }> {
  return withDocument(session, (document) => {
    const loaded = pageAt(document, page, document.countPages());
    const transform = frameOf(loaded);
    // A PAGE THAT DISPLAYS NO REGION has nowhere to put a field, which is the
    // annotation reader's own answer to the same question.
    if (transform === null) return { candidates: [], truncated: false };

    const { paths, text } = draws(loaded);
    const area =
      (transform.crop.x1 - transform.crop.x0) * (transform.crop.y1 - transform.crop.y0);
    const taken = new Set<string>();
    const candidates: FlatFieldCandidate[] = [];

    for (const path of paths) {
      if (candidates.length >= MAX_FLAT_CANDIDATES) {
        return { candidates, truncated: true };
      }
      if (holdsText(path, text)) continue;
      const label = labelBeside(path, text);
      if (label === null) continue;

      const box = boxFor(path, label);
      const width = box.x1 - box.x0;
      const height = box.y1 - box.y0;
      if (width < MINIMUM_EXTENT || height < MINIMUM_EXTENT) continue;
      if (area > 0 && (width * height) / area > MAXIMUM_COVERAGE) continue;

      const words = labelText(label, text, loaded);
      candidates.push({
        rect: asRect(box, transform),
        label: words,
        name: unique(nameFrom(words, candidates.length), taken),
      });
    }
    return { candidates, truncated: false };
  });
}

/**
 * The words of the label beside a candidate.
 *
 * Read from the structured text a second time rather than carried through the
 * geometry, because `toStructuredText`'s JSON holds the characters and the
 * boxes together and a parallel array of strings would be a second structure to
 * keep in step with the first.
 */
function labelText(label: Displayed, _text: readonly Displayed[], loaded: PDFPage): string {
  const structured = JSON.parse(loaded.toStructuredText().asJSON()) as {
    blocks?: {
      lines?: { bbox?: { x: number; y: number; w: number; h: number }; text?: string }[];
    }[];
  };
  for (const block of structured.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const box = line.bbox;
      if (box === undefined) continue;
      if (
        Math.abs(box.x - label.x0) < 0.5 &&
        Math.abs(box.y - label.y0) < 0.5 &&
        Math.abs(box.w - (label.x1 - label.x0)) < 0.5
      ) {
        return (line.text ?? '').slice(0, MAX_LABEL);
      }
    }
  }
  return '';
}
