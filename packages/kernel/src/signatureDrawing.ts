import type { AnnotationRect, CommandOfKind } from '@monstera/contract/host';
import { snapRotation } from '@monstera/shared';

import { contentNumber } from './contentNumber.js';
import { SignatureAppearanceRefusedError } from './signingRefusals.js';

/**
 * How a signature's mark is drawn — ONE module for every writer
 * ([ADR-0133](../../../docs/DECISIONS/0133-a-signatures-mark-is-drawn-once-for-both-writers.md)).
 *
 * *Sign with certificate* draws a visible signature's look into its widget with pdf-lib; the plain *Signature* draws
 * the same look into a `/Stamp` with MuPDF. What a typed name measures, how drawn ink fits its box and how a picture is
 * scaled are decided here, once (B3a), so the same mark looks the same either way. **This module imports neither
 * engine**: it answers a content stream in text, the names that stream uses, and the form matrix that keeps it
 * upright, and each writer turns the names into objects of its own document.
 */

/** A typed or drawn mark, as the commands carry it. */
export type KeptMark = CommandOfKind<'placeSignatureMark'>['mark'];

/** A picture mark, by the one thing the drawing needs from it: its size in pixels. */
export interface PictureMark {
  readonly kind: 'picture';
  readonly width: number;
  readonly height: number;
}

/** Any mark the module draws. */
export type DrawableMark = KeptMark | PictureMark;

/** A base-14 face's PostScript name, as `/BaseFont` carries it. */
export type StandardFaceName = 'Helvetica' | 'Times-Roman' | 'Times-Italic' | 'Courier';

/** What a mark draws, and what its stream names. */
export interface SignatureDrawing {
  /** The form's content stream, PDF operators in text. */
  readonly content: string;
  /** `F0`, a Type 1 base-14 font in `WinAnsiEncoding`, for a typed mark; `undefined` for any other. */
  readonly font: { readonly name: 'F0'; readonly baseFont: StandardFaceName } | undefined;
  /** `Im0`, the mark's own picture, for a picture mark; `undefined` for any other. */
  readonly picture: { readonly name: 'Im0' } | undefined;
}

/** The resource name a typed mark's font is reached by. Private to the form, so it collides with nothing. */
const FONT_NAME = 'F0';

/** The resource name a picture mark's image is reached by, for {@link FONT_NAME}'s reason. */
const PICTURE_NAME = 'Im0';

/**
 * Each typed face's base-14 font, keyed on the contract's own list — a face added to `SIGNATURE_FONTS` without an entry
 * here is a compile error rather than a signature set in whatever the default happened to be.
 */
const FACES: Readonly<Record<Extract<KeptMark, { kind: 'typed' }>['font'], StandardFaceName>> = {
  helvetica: 'Helvetica',
  'times-roman': 'Times-Roman',
  'times-italic': 'Times-Italic',
  courier: 'Courier',
};

/** How much of the box the mark may fill, on its tighter axis. */
const FILL = 0.9;

/**
 * An AFM figure, or the fallback where the font gives none — **zero counts as none**, which is pdf-lib's rule for the
 * same data (a missing width is 250, a missing ascender is the bounding box's top). Spelt as a function because the
 * rule is not `??`'s: `??` would keep a zero, and the two readers of these tables would then disagree about one glyph.
 */
function afm(value: unknown, fallback: number): number {
  return typeof value === 'number' && value !== 0 ? value : fallback;
}

/** The pen's width as a share of the box's shorter side, for a drawn mark. */
const PEN_SHARE = 0.03;

/**
 * Typed text, set in a base-14 font and centred in the box.
 *
 * **The AFM data is the authority on the font**: `@pdf-lib/standard-fonts` carries the base-14 fonts' own metrics and
 * the WinAnsi encoding, the same data pdf-lib reads. It is loaded here, on demand, so a host that never draws a typed
 * signature never pays for its tables (§9.17).
 *
 * **WinAnsi decides what can be drawn.** A character outside it has no code in the font, so it is refused by name
 * rather than drawn as something else.
 *
 * **The width is the glyphs' advances alone.** `Tj` applies no kerning, so a width that added the AFM's kerning pairs
 * would centre the text on a width it is not drawn at — which pdf-lib's `widthOfTextAtSize` does, and which centred
 * the certificate's typed name off by the kerning of its letters until this module drew it.
 */
async function typedDrawing(mark: Extract<KeptMark, { kind: 'typed' }>, width: number, height: number): Promise<SignatureDrawing> {
  const { Encodings, Font } = await import('@pdf-lib/standard-fonts');
  const baseFont = FACES[mark.font];
  const font = Font.load(baseFont);
  const codes: number[] = [];
  let advance = 0;
  for (const character of mark.text) {
    const point = character.codePointAt(0) ?? -1;
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(point)) {
      throw new SignatureAppearanceRefusedError(
        'unencodable-text',
        'the signature text holds a character the chosen standard font cannot encode',
      );
    }
    const glyph = Encodings.WinAnsi.encodeUnicodeCodePoint(point);
    codes.push(glyph.code);
    // 250 for a glyph the AFM gives no width, as pdf-lib does, so the two never disagree about a gap.
    advance += afm(font.getWidthOfGlyph(glyph.name), 250);
  }
  const across = advance / 1000;
  // TEXT THAT ADVANCES NOTHING DRAWS NOTHING, and a visible signature with no ink is the display-only defect on the
  // page. The dialogs trim, so this is not reachable from the surfaces that send the commands.
  if (across <= 0) throw new RangeError('the signature text draws nothing');
  const size = Math.min(height * FILL * 0.75, (width * FILL) / across);
  // THE CAP HEIGHT ABOVE THE BASELINE, which is what centres a line by eye: the ascender less the descender's depth,
  // pdf-lib's `heightAtSize(size, { descender: false })` exactly, so the baseline sits where it always has.
  const top = afm(font.Ascender, font.FontBBox[3]);
  const bottom = afm(font.Descender, font.FontBBox[1]);
  const rise = ((top - bottom + afm(font.Descender, 0)) / 1000) * size;
  const hex = codes.map((code) => code.toString(16).padStart(2, '0').toUpperCase()).join('');
  return {
    content: [
      'q',
      '0 g',
      'BT',
      `/${FONT_NAME} ${contentNumber(size)} Tf`,
      `${contentNumber((width - across * size) / 2)} ${contentNumber((height - rise) / 2)} Td`,
      `<${hex}> Tj`,
      'ET',
      'Q',
    ].join('\n'),
    font: { name: FONT_NAME, baseFont },
    picture: undefined,
  };
}

/**
 * Drawn strokes, their ink fitted into the box.
 *
 * **The ink's own bounding box is what is fitted, not the pad's**, so where on the pad a person started and what shape
 * the pad was decide nothing. Both pad coordinates share one unit (the contract's point schema says so), which is what
 * lets one scale serve both axes without turning a circle into an ellipse.
 */
function drawnDrawing(mark: Extract<KeptMark, { kind: 'drawn' }>, width: number, height: number): SignatureDrawing {
  // A LOOP AND NOT `Math.min(...points)`: a drawn signature may carry 65,536 points, and spreading that many arguments
  // is a stack limit waiting for the person with the longest name.
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const line of mark.strokes) {
    for (const [x, y] of line) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const pen = Math.max(1, Math.min(width, height) * PEN_SHARE);
  const inkWide = right - left;
  const inkTall = bottom - top;
  // A DOT HAS NO EXTENT ON EITHER AXIS, so neither ratio exists; it is drawn at the centre, where the round cap makes
  // it a mark.
  const fits = [
    inkWide > 0 ? (width * FILL - pen) / inkWide : Infinity,
    inkTall > 0 ? (height * FILL - pen) / inkTall : Infinity,
  ];
  const tightest = Math.min(...fits);
  const scale = Number.isFinite(tightest) ? Math.max(0, tightest) : 0;
  const originX = (width - inkWide * scale) / 2;
  const originY = (height - inkTall * scale) / 2;

  // Round caps and joins (`1 J`, `1 j`), black (`0 G`), the pen's width (`w`).
  const lines = ['q', '0 G', `${contentNumber(pen)} w`, '1 J', '1 j'];
  for (const line of mark.strokes) {
    line.forEach(([x, y], index) => {
      // THE PAD IS Y-DOWN and a form is y-up, so a point's distance from the ink's BOTTOM edge is its height in the
      // form.
      const across = contentNumber(originX + (x - left) * scale);
      const up = contentNumber(originY + (bottom - y) * scale);
      lines.push(`${across} ${up} ${index === 0 ? 'm' : 'l'}`);
    });
    lines.push('S');
  }
  lines.push('Q');
  return { content: lines.join('\n'), font: undefined, picture: undefined };
}

/** A picture, scaled to fit the box without distortion and centred. */
function pictureDrawing(mark: PictureMark, width: number, height: number): SignatureDrawing {
  if (!(mark.width > 0 && mark.height > 0)) throw new RangeError('a signature picture needs a width and a height');
  const scale = Math.min((width * FILL) / mark.width, (height * FILL) / mark.height);
  const wide = mark.width * scale;
  const tall = mark.height * scale;
  return {
    content: [
      'q',
      `${contentNumber(wide)} 0 0 ${contentNumber(tall)} ${contentNumber((width - wide) / 2)} ${contentNumber((height - tall) / 2)} cm`,
      `/${PICTURE_NAME} Do`,
      'Q',
    ].join('\n'),
    font: undefined,
    picture: { name: PICTURE_NAME },
  };
}

/** Draws a mark into a box of the given size, as the page is seen. */
export async function drawSignature(mark: DrawableMark, width: number, height: number): Promise<SignatureDrawing> {
  if (mark.kind === 'typed') return typedDrawing(mark, width, height);
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
 * Where a mark goes, as the page is seen.
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
