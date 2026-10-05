import {
  type PDFDocument,
  type PDFName,
  PDFOperator,
  PDFOperatorNames,
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  setTextRise,
} from '@cantoo/pdf-lib';

import { paragraphDirection } from './bidiOrder.js';
import { CidFont, adjustment, codeString } from './cidFont.js';
import type { CatalogueFace, FaceSource } from './fontCatalogue.js';
import { type FontRequest, resolveRuns } from './fontResolver.js';
import { type OutlineCommand, type ShapedGlyph, ShapingFace } from './textShaping.js';

/**
 * The faces a composed document is set in, and every character drawn through them
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)).
 *
 * ## A role asks the resolver; the resolver decides
 *
 * A composer sets text in five ROLES — body, bold, italic, bold italic and code. Each role is a request to
 * `fontResolver.ts` for the bundled family that stands for it (Arimo for prose, Cousine for code), so Latin, Greek
 * and Cyrillic are set in the same face on every machine, and any other script goes to the first face in the
 * catalogue that carries the whole word. A character no face carries is drawn as the missing-character box, `□` from
 * a face that has one, under a code whose `ToUnicode` is the character itself: the page shows the person something
 * is missing, and a reader copying the text gets what was written (the owner's answer to Q4).
 *
 * ## Measuring assigns nothing
 *
 * A layout measures far more text than it draws — a table is measured at every size it tries — so a width is the
 * shaper's advances alone, and a font code is assigned only when a piece is SET to be drawn. A font no drawn piece
 * used is never written.
 *
 * ## A glyph that stands for no character is drawn as its OUTLINE
 *
 * `textShaping.ts` gives each glyph the characters it stands for, and a glyph left with none — the second glyph of a
 * medial letter drawn in two — would map to nothing in `ToUnicode`, which pdf.js reads as a control character
 * (measured 2026-10-05, U+0004). So it is drawn as a filled path after the text object, at the place the text would
 * have put it, and the text skips its advance.
 */

/** The faces a composer sets text in. */
export type FaceRole = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono';

/** What each role asks the resolver for. */
const ROLE_REQUESTS: Readonly<Record<FaceRole, FontRequest>> = {
  regular: { family: 'Arimo', bold: false, italic: false, own: [] },
  bold: { family: 'Arimo', bold: true, italic: false, own: [] },
  italic: { family: 'Arimo', bold: false, italic: true, own: [] },
  boldItalic: { family: 'Arimo', bold: true, italic: true, own: [] },
  mono: { family: 'Cousine', bold: false, italic: false, own: [] },
};

/** U+25A1 WHITE SQUARE, the missing-character box. */
const BOX = 0x25a1;

/** One glyph of a piece, as it is drawn. */
interface PlacedGlyph {
  /** The code it is shown under, `null` for a glyph that stands for no character and is drawn as its outline. */
  readonly code: number | null;
  /** The advance its code's `W` states, in thousandths of an em; 0 for a glyph with no code. */
  readonly width: number;
  readonly glyph: number;
  readonly advance: number;
  /**
   * How far the text moves the pen for this glyph, in font units: its own advance and the advance of every outline
   * glyph after it folded into its width; 0 for an outline glyph so folded, which the text does not move for.
   */
  readonly span: number;
  readonly xOffset: number;
  readonly yOffset: number;
}

/** A stretch of text shaped in one font at one size: one `Tf` and the glyphs after it. */
export interface SetPiece {
  readonly font: CidFont;
  readonly size: number;
  readonly glyphs: readonly PlacedGlyph[];
  /** How far the piece moves the pen, in points. */
  readonly width: number;
}

/** A character drawn as the box, and the source line of the text it was in. */
export interface BoxedCharacter {
  readonly character: string;
  readonly line: number | null;
}

/** A face at one weight: its shaper, and the fonts its codes are written in, opened when the first is drawn. */
interface Instance {
  readonly face: CatalogueFace;
  readonly weight: number;
  readonly shaping: ShapingFace;
  readonly fonts: CidFont[];
}

/** One stretch of shaped text in one instance, before any code is assigned. */
interface Shaped {
  readonly instance: Instance;
  readonly glyphs: readonly ShapedGlyph[];
  /** The character drawn as the box, for a stretch that is the box. */
  readonly boxed: string | null;
}

function advanceOf(glyphs: readonly ShapedGlyph[], unitsPerEm: number): number {
  return glyphs.reduce((total, glyph) => total + glyph.advance, 0) / unitsPerEm;
}

export class ComposeFonts {
  readonly #instances = new Map<string, Instance>();
  readonly #bytes = new Map<string, Uint8Array>();
  readonly #widths = new Map<string, number>();
  readonly #faces: ReadonlyMap<string, CatalogueFace>;
  readonly #boxed: BoxedCharacter[] = [];
  readonly #boxFace: CatalogueFace;

  constructor(
    private readonly document: PDFDocument,
    private readonly source: FaceSource,
  ) {
    this.#faces = new Map(source.faces.map((face) => [face.id, face]));
    const boxFace = source.faces.find((face) => face.unicodes.has(BOX) && face.embedding !== 'never');
    // A BUILD FAULT, never the document's: the bundled sans and serif faces all carry the box, so a catalogue without
    // one is a host started without its fonts.
    if (boxFace === undefined) throw new Error('no face in the catalogue carries the missing-character box, U+25A1');
    this.#boxFace = boxFace;
  }

  /** Every character drawn as the box so far, in the order it was drawn, once per drawing. */
  get boxed(): readonly BoxedCharacter[] {
    return this.#boxed;
  }

  /** The width of `text` set in `role` at `size`, in points, as {@link set} would draw it. */
  width(text: string, role: FaceRole, size: number): number {
    if (text === '') return 0;
    const key = `${role}\u0000${text}`;
    let perPoint = this.#widths.get(key);
    if (perPoint === undefined) {
      perPoint = this.#shape(text, role, paragraphDirection(text) === 'rtl').reduce(
        (total, stretch) => total + advanceOf(stretch.glyphs, stretch.instance.shaping.unitsPerEm),
        0,
      );
      this.#widths.set(key, perPoint);
    }
    return perPoint * size;
  }

  /**
   * `text`, one stretch of one direction in one role, as the pieces that draw it, in drawing order.
   *
   * @param line the source line the text came from, which a box drawn in it is reported against
   */
  set(text: string, role: FaceRole, size: number, rtl: boolean, line: number | null): SetPiece[] {
    return this.#shape(text, role, rtl).map((stretch) => {
      if (stretch.boxed !== null) this.#boxed.push({ character: stretch.boxed, line });
      return this.#piece(stretch, size);
    });
  }

  /** `text` resolved and shaped, stretch by stretch, in drawing order. */
  #shape(text: string, role: FaceRole, rtl: boolean): Shaped[] {
    const stretches: Shaped[] = [];
    for (const run of resolveRuns(text, ROLE_REQUESTS[role], this.source.faces)) {
      const face = run.face === null ? undefined : this.#faces.get(run.face.id);
      if (run.missing.length > 0 || face === undefined) {
        // THE BOX, from the run's own face where it carries one so the box matches the text around it.
        const own = face !== undefined && face.unicodes.has(BOX) && face.embedding !== 'never';
        const instance = own ? this.#instance(face, run.weight) : this.#instance(this.#boxFace, this.#boxFace.weight);
        const glyph = instance.shaping.glyphFor(BOX) ?? 0;
        const advance = instance.shaping.nominalAdvance(glyph);
        for (const character of run.text) {
          stretches.push({ instance, glyphs: [{ glyph, advance, xOffset: 0, yOffset: 0, text: character }], boxed: character });
        }
        continue;
      }
      const instance = this.#instance(face, run.weight);
      stretches.push({ instance, glyphs: instance.shaping.shape(run.text, rtl), boxed: null });
    }
    return rtl ? stretches.reverse() : stretches;
  }

  /** A stretch with its codes assigned, in the instance's current font, opening another when that one is full. */
  #piece(stretch: Shaped, size: number): SetPiece {
    const { instance } = stretch;
    // AN OUTLINE GLYPH'S ADVANCE GOES INTO THE TEXT GLYPH BEFORE IT. Skipped as a gap in the text, it is a space to a
    // reader (measured 2026-10-05, MuPDF read one inside an Arabic word); stated as part of the width before it, the
    // character reaches the next one. One that leads its piece has nothing before it, and is skipped as a gap.
    const folded = stretch.glyphs.map(() => 0);
    const into = stretch.glyphs.map(() => -1);
    let carrier = -1;
    stretch.glyphs.forEach((entry, at) => {
      if (entry.text !== '') carrier = at;
      else if (carrier !== -1) {
        folded[carrier] = (folded[carrier] ?? 0) + entry.advance;
        into[at] = carrier;
      }
    });
    // A PIECE IS SHOWN IN ONE FONT, so a font without room for all of it gives way to a new one BEFORE the piece: a
    // two-byte encoding holds 65,535 codes, and a font filling half way through would leave the rest of the piece's
    // codes in a font its `Tf` does not name.
    const current = instance.fonts.at(-1);
    const font = current !== undefined && current.room >= stretch.glyphs.length ? current : this.#open(instance);
    const glyphs: PlacedGlyph[] = stretch.glyphs.map((entry, at) => {
      const placed = { glyph: entry.glyph, advance: entry.advance, xOffset: entry.xOffset, yOffset: entry.yOffset };
      if (entry.text === '') return { ...placed, code: null, width: 0, span: into[at] === -1 ? entry.advance : 0 };
      const extra = folded[at] ?? 0;
      const assigned = font.cid(entry.glyph, entry.text, extra);
      if (assigned === null) throw new Error(`a piece of ${String(stretch.glyphs.length)} glyphs outgrew a font's codes`);
      return { ...placed, code: assigned.code, width: assigned.width, span: entry.advance + extra };
    });
    return { font, size, glyphs, width: advanceOf(stretch.glyphs, instance.shaping.unitsPerEm) * size };
  }

  #open(instance: Instance): CidFont {
    const { face, weight, shaping } = instance;
    const named = shaping.postscriptName();
    const font = new CidFont(this.document, {
      bytes: this.#read(face.path),
      faceIndex: face.faceIndex,
      axes: face.weights === null ? {} : { wght: weight },
      // A VARIABLE FACE'S NAME says which instance it is, since its own name 6 names only the default one.
      postscript: face.weights === null ? named : `${named === '' ? 'Font' : named}-wght${String(weight)}`,
      embedding: face.embedding,
      italic: face.italic,
      shaping,
    });
    instance.fonts.push(font);
    return font;
  }

  #read(path: string): Uint8Array {
    let bytes = this.#bytes.get(path);
    if (bytes === undefined) {
      bytes = this.source.read(path);
      this.#bytes.set(path, bytes);
    }
    return bytes;
  }

  #instance(face: CatalogueFace, weight: number): Instance {
    const key = `${face.id}@${String(weight)}`;
    let instance = this.#instances.get(key);
    if (instance === undefined) {
      const axes: Record<string, number> = face.weights === null ? {} : { wght: weight };
      instance = { face, weight, shaping: new ShapingFace(this.#read(face.path), face.faceIndex, axes), fonts: [] };
      this.#instances.set(key, instance);
    }
    return instance;
  }

  /**
   * The text operators that draw `piece` inside a text object, its font registered under `key`.
   *
   * Each glyph is moved to where HarfBuzz placed it by `TJ` adjustments around it — before it by its offset, after it
   * by the difference between the width the font states and the advance HarfBuzz gave it — and raised by `Ts` where it
   * sits above or below the baseline. A glyph drawn as its outline is skipped by its advance.
   */
  textOperators(piece: SetPiece, key: PDFName): PDFOperator[] {
    const operators: PDFOperator[] = [setFontAndSize(key, piece.size)];
    const unitsPerEm = piece.font.source.shaping.unitsPerEm;
    const scale = 1000 / unitsPerEm;
    let parts: (number | number[])[] = [];
    let rise = 0;
    const flush = (): void => {
      if (parts.length === 0) return;
      const array = this.document.context.obj(
        parts.map((part) => (typeof part === 'number' ? adjustment(part) : codeString(part))),
      );
      operators.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [array]));
      parts = [];
    };
    // A `TJ` number moves the pen LEFT by thousandths of an em, so moving right is a negative one.
    const move = (thousandths: number): void => {
      if (Math.abs(thousandths) < 0.0005) return;
      const last = parts.at(-1);
      if (typeof last === 'number') parts[parts.length - 1] = last + thousandths;
      else parts.push(thousandths);
    };
    const show = (code: number): void => {
      const last = parts.at(-1);
      if (Array.isArray(last)) last.push(code);
      else parts.push([code]);
    };
    for (const glyph of piece.glyphs) {
      if (glyph.code === null) {
        move(-glyph.span * scale);
        continue;
      }
      const wanted = (glyph.yOffset * piece.size) / unitsPerEm;
      if (wanted !== rise) {
        flush();
        operators.push(setTextRise(wanted));
        rise = wanted;
      }
      move(-glyph.xOffset * scale);
      show(glyph.code);
      move(glyph.xOffset * scale + glyph.width - glyph.span * scale);
    }
    flush();
    if (rise !== 0) operators.push(setTextRise(0));
    return operators;
  }

  /**
   * The outlines of `piece`'s glyphs that stand for no character, as filled paths, the piece starting at `x` on
   * `baseline`. Empty for a piece with none, which is nearly every piece.
   */
  outlineOperators(piece: SetPiece, x: number, baseline: number): PDFOperator[] {
    const operators: PDFOperator[] = [];
    const scale = piece.size / piece.font.source.shaping.unitsPerEm;
    let pen = x;
    for (const glyph of piece.glyphs) {
      if (glyph.code === null) {
        const outline = piece.font.source.shaping.outline(glyph.glyph);
        if (outline.length > 0) {
          operators.push(
            pushGraphicsState(),
            concatTransformationMatrix(scale, 0, 0, scale, pen + glyph.xOffset * scale, baseline + glyph.yOffset * scale),
            ...pathOperators(outline),
            fill(),
            popGraphicsState(),
          );
        }
      }
      pen += glyph.advance * scale;
    }
    return operators;
  }

  /** Writes every font a drawn piece used. Called once, before the document is saved. */
  finish(): void {
    for (const instance of this.#instances.values()) for (const font of instance.fonts) font.finish();
  }
}

/** A glyph outline as PDF path operators; a quadratic segment becomes the cubic that draws the same curve. */
function pathOperators(outline: readonly OutlineCommand[]): PDFOperator[] {
  const operators: PDFOperator[] = [];
  let current: readonly [number, number] = [0, 0];
  let start: readonly [number, number] = [0, 0];
  for (const { type, values } of outline) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
    if (type === 'M') {
      operators.push(moveTo(a, b));
      current = [a, b];
      start = current;
    } else if (type === 'L') {
      operators.push(lineTo(a, b));
      current = [a, b];
    } else if (type === 'Q') {
      const [x0, y0] = current;
      operators.push(appendBezierCurve(x0 + (2 / 3) * (a - x0), y0 + (2 / 3) * (b - y0), c + (2 / 3) * (a - c), d + (2 / 3) * (b - d), c, d));
      current = [c, d];
    } else if (type === 'C') {
      operators.push(appendBezierCurve(a, b, c, d, e, f));
      current = [e, f];
    } else {
      operators.push(closePath());
      current = start;
    }
  }
  return operators;
}
