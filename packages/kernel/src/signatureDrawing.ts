import { fittedPoint, outlineFit, pictureFit, strokesFit } from '@monstera/contract/host';
import { type AnnotationRect, type DrawableSignature, OUTLINE_OPS } from '@monstera/contract/host';
import { snapRotation } from '@monstera/shared';

import { contentNumber } from './contentNumber.js';

/**
 * How a signature's mark is drawn — ONE module for every writer
 * ([ADR-0133](../../../docs/DECISIONS/0133-a-signatures-mark-is-drawn-once-for-both-writers.md)).
 *
 * *Sign with certificate* draws a visible signature's look into its widget with pdf-lib; the plain *Signature* draws
 * the same look into a `/Stamp` with MuPDF. How a typed name's outline and drawn ink fit their box and how a picture is
 * scaled are decided here, once (B3a), so the same mark looks the same either way. **This module imports neither
 * engine**: it answers a content stream in text, the name that stream uses for a picture, and the form matrix that
 * keeps it upright, and each writer turns the name into an object of its own document.
 *
 * **A typed name names no font** ([ADR-0150](../../../docs/DECISIONS/0150-a-typed-signature-is-written-as-outlines-of-a-bundled-face.md)):
 * it arrives as the outline the renderer made from a bundled face, and is filled as a path, so no font program and no
 * subsetting reaches the document.
 */

/**
 * A typed name's outline or drawn strokes, as both writers draw them. The placing command carries a drawing flattened
 * (`placedMarkOf`), and its apply takes it back to strokes before it reaches this module.
 */
export type KeptMark = DrawableSignature;

/** A picture mark, by the one thing the drawing needs from it: its size in pixels. */
export interface PictureMark {
  readonly kind: 'picture';
  readonly width: number;
  readonly height: number;
}

/** Any mark the module draws. */
export type DrawableMark = KeptMark | PictureMark;

/** What a mark draws, and what its stream names. */
export interface SignatureDrawing {
  /** The form's content stream, PDF operators in text. */
  readonly content: string;
  /** `Im0`, the mark's own picture, for a picture mark; `undefined` for any other. */
  readonly picture: { readonly name: 'Im0' } | undefined;
}

/** The resource name a picture mark's image is reached by. Private to the form, so it collides with nothing. */
const PICTURE_NAME = 'Im0';

/**
 * A typed name's outline, filled and centred in the box.
 *
 * Fitted by `outlineFit`, which says what is fitted and why.
 *
 * **A quadratic becomes the cubic that is the same curve** — control points two thirds of the way from each end to the
 * quadratic's one — because PDF has no quadratic operator; nothing is approximated. The path is filled by the nonzero
 * rule (`f`), the rule TrueType and CFF outlines are both drawn by.
 */
function outlinedDrawing(mark: Extract<KeptMark, { kind: 'outlined' }>, width: number, height: number): SignatureDrawing {
  const { ops, points } = mark.outline;
  // THE ONE FIT (`signatureFit.ts`), which the renderer's held look takes too.
  const fit = outlineFit(mark.outline, width, height);
  const at = (x: number, y: number): string => {
    const [across, up] = fittedPoint(fit, x, y);
    return `${contentNumber(across)} ${contentNumber(up)}`;
  };

  const lines = ['q', '0 g'];
  let next = 0;
  const take = (): readonly [number, number] => {
    const point = [points[next] ?? 0, points[next + 1] ?? 0] as const;
    next += 2;
    return point;
  };
  let current: readonly [number, number] = [0, 0];
  for (const code of ops) {
    const op = OUTLINE_OPS[code];
    if (op === 'M' || op === 'L') {
      current = take();
      lines.push(`${at(...current)} ${op === 'M' ? 'm' : 'l'}`);
    } else if (op === 'Q') {
      const control = take();
      const end = take();
      const first = [current[0] + (2 / 3) * (control[0] - current[0]), current[1] + (2 / 3) * (control[1] - current[1])] as const;
      const second = [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])] as const;
      lines.push(`${at(...first)} ${at(...second)} ${at(...end)} c`);
      current = end;
    } else if (op === 'C') {
      const first = take();
      const second = take();
      current = take();
      lines.push(`${at(...first)} ${at(...second)} ${at(...current)} c`);
    } else if (op === 'Z') {
      lines.push('h');
    }
  }
  lines.push('f', 'Q');
  return { content: lines.join('\n'), picture: undefined };
}

/**
 * Drawn strokes, their ink fitted into the box by `strokesFit`. Both pad coordinates share one unit (the contract's
 * point schema says so), which is what lets one scale serve both axes without turning a circle into an ellipse.
 */
function drawnDrawing(mark: Extract<KeptMark, { kind: 'drawn' }>, width: number, height: number): SignatureDrawing {
  // THE ONE FIT (`signatureFit.ts`), which the renderer's held look takes too.
  const fit = strokesFit(mark.strokes, width, height);

  // Round caps and joins (`1 J`, `1 j`), black (`0 G`), the pen's width (`w`).
  const lines = ['q', '0 G', `${contentNumber(fit.pen)} w`, '1 J', '1 j'];
  for (const line of mark.strokes) {
    line.forEach(([x, y], index) => {
      const [across, up] = fittedPoint(fit, x, y);
      lines.push(`${contentNumber(across)} ${contentNumber(up)} ${index === 0 ? 'm' : 'l'}`);
    });
    lines.push('S');
  }
  lines.push('Q');
  return { content: lines.join('\n'), picture: undefined };
}

/** A picture, scaled to fit the box without distortion and centred. */
function pictureDrawing(mark: PictureMark, width: number, height: number): SignatureDrawing {
  const { x, y, wide, tall } = pictureFit(mark, width, height);
  return {
    content: [
      'q',
      `${contentNumber(wide)} 0 0 ${contentNumber(tall)} ${contentNumber(x)} ${contentNumber(y)} cm`,
      `/${PICTURE_NAME} Do`,
      'Q',
    ].join('\n'),
    picture: { name: PICTURE_NAME },
  };
}

/** Draws a mark into a box of the given size, as the page is seen. */
export function drawSignature(mark: DrawableMark, width: number, height: number): SignatureDrawing {
  if (mark.kind === 'outlined') return outlinedDrawing(mark, width, height);
  if (mark.kind === 'drawn') return drawnDrawing(mark, width, height);
  return pictureDrawing(mark, width, height);
}

/**
 * The form matrix that draws an appearance UPRIGHT on a page turned by `/Rotate`.
 *
 * A reader maps an appearance into its annotation's `/Rect` by transforming the `/BBox` through `/Matrix` and fitting
 * the result (ISO 32000-2 §12.5.5), and it then shows the whole page turned clockwise by `/Rotate`. Counter-rotating
 * the form by the same angle is what makes a signature read left to right as the page is SEEN — and on a quarter turn
 * the box a person placed is the rectangle's height wide, which is why {@link signatureBox} swaps the two.
 *
 * Neither writer converts for us: MuPDF's `setAppearance` writes `/BBox` and `/Matrix` as given
 * (`pdf_set_annot_appearance`, 1.28.0 source, read 2026-10-02), and pdf-lib's form is ours to write.
 */
const UPRIGHT: Readonly<Record<number, readonly [number, number, number, number, number, number]>> = {
  0: [1, 0, 0, 1, 0, 0],
  90: [0, 1, -1, 0, 0, 0],
  180: [-1, 0, 0, -1, 0, 0],
  270: [0, -1, 1, 0, 0, 0],
};

/** A placement's rectangle ordered, the box as the page shows it, and the matrix that keeps the mark upright. */
export interface SignatureBox {
  /** The rectangle in PDF user space, ordered: `[x0, y0, x1, y1]` with `x0 < x1`, `y0 < y1`. */
  readonly rect: readonly [number, number, number, number];
  readonly seenWide: number;
  readonly seenTall: number;
  readonly matrix: readonly [number, number, number, number, number, number];
}

/**
 * Where a mark goes, as the page is seen — THE ONE UPRIGHT BOX for a written stamp appearance: the signature's mark,
 * and *Place image*'s picture since 2026-10-02 (`applyPlaceImage`), which drew on its side on a turned page without it.
 *
 * **The rectangle is ordered here**: a placement runs whichever way the pointer went and the schema leaves ordering to
 * the kernel. One with no area is refused rather than drawn, because a signature nobody can see placed as a visible one
 * is the defect this exists to not have.
 *
 * @param rotation the page's `/Rotate`, raw — snapped here through the shared function every reader of it agrees on
 */
export function signatureBox(rect: AnnotationRect, rotation: number): SignatureBox {
  const x0 = Math.min(rect.x0, rect.x1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const y1 = Math.max(rect.y0, rect.y1);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) {
    throw new RangeError('a signature needs a rectangle with an area');
  }
  const snapped = snapRotation(rotation);
  const turned = snapped === 90 || snapped === 270;
  return {
    rect: [x0, y0, x1, y1],
    seenWide: turned ? y1 - y0 : x1 - x0,
    seenTall: turned ? x1 - x0 : y1 - y0,
    matrix: UPRIGHT[snapped] ?? [1, 0, 0, 1, 0, 0],
  };
}
