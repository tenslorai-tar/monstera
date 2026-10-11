import { boxFont } from './boxFont.js';
import { CidFont } from './cidFont.js';
import { editPieces } from './editPieces.js';
import type { CatalogueFace, FaceSource } from './fontCatalogue.js';
import { type MupdfFontRef, mupdfCidSink } from './mupdfCidFont.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import { type ShapedGlyph, ShapingFace } from './textShaping.js';
import type { FaceStyle, SetPiece, Typesetter } from './textBoxStyle.js';

/** U+25A1 WHITE SQUARE, the missing-character box. */
const BOX = 0x25a1;

/** One face a box is drawn in: the font being written and the shaper that measured its glyphs. */
interface Held {
  readonly font: CidFont<MupdfFontRef>;
  readonly shaping: ShapingFace;
}

const fixed = (value: number): string => {
  const text = (Math.round(value * 1000) / 1000).toString();
  return text === '-0' ? '0' : text;
};

const hex4 = (value: number): string => value.toString(16).padStart(4, '0').toUpperCase();

/**
 * A text box's words in the resolver's faces, embedded as subsets (K2,
 * [ADR-0228](../../../docs/DECISIONS/0228-the-formatting-set-is-whole-in-both-text-writers-and-a-tab-is-a-marked-gap.md)
 * Decision 3): the {@link Typesetter} `textBoxStyle.ts` lays a box out with wherever a base-14 face cannot write a word.
 *
 * The PLAN is `editPieces.ts`', the in-place editor's own: the chosen family where it carries the word, the nearest face
 * where it does not (K9), the box for a character no face has. The CODES are `cidFont.ts`', written through MuPDF's object
 * model by `mupdfCidSink`, as the Type 3 page writer writes them (`operatorFaces.ts`), so every font Monstera embeds is one
 * opinion whichever writer draws it.
 *
 * ## The width is the shaper's, and the drawing says the same
 *
 * A code's `W` is the glyph's own advance; where the shaper placed a glyph elsewhere (a kern, a mark's offset) the
 * difference is written as a `TJ` adjustment, and a raised mark as a rise around it. So the width a line was broken by is
 * the width drawn.
 */
export class TextBoxFaces implements Typesetter {
  readonly #held = new Map<string, Held>();
  readonly #bytes = new Map<string, Uint8Array>();
  readonly #shapers = new Map<string, ShapingFace>();
  /** Every character drawn as the box, in the order set. */
  readonly boxed: string[] = [];

  constructor(
    private readonly document: PDFDocument,
    private readonly source: FaceSource,
  ) {}

  set(text: string, style: FaceStyle, size: number, rtl: boolean): readonly SetPiece[] | undefined {
    const request = { family: style.family, bold: style.bold, italic: style.italic, own: [] };
    // NO FONT OF ITS OWN: a text box's words are all the resolver's, so every segment is asked of the catalogue.
    const pieces = editPieces(text, () => false, request, this.source.faces, []);
    const out: SetPiece[] = [];
    for (const piece of pieces) {
      if (piece.boxed.length > 0) {
        for (const character of piece.boxed) {
          const set = this.#box(character, piece.face, size);
          if (set === undefined) return undefined;
          out.push(set);
        }
        continue;
      }
      if (piece.face === null) return undefined;
      const set = this.#inFace(piece.face, piece.weight, piece.text, size, rtl);
      if (set === undefined) return undefined;
      out.push(set);
    }
    return out;
  }

  /** Writes every face this box drew into the document, and answers each one's font object by the key its pieces carry. */
  finish(): ReadonlyMap<string, PDFObject> {
    const fonts = new Map<string, PDFObject>();
    for (const [key, held] of this.#held) {
      held.font.finish();
      if (held.font.ref.object === null) throw new Error(`the face ${key} was finished and not written`);
      fonts.set(key, held.font.ref.object);
    }
    return fonts;
  }

  #inFace(face: CatalogueFace, weight: number, text: string, size: number, rtl: boolean): SetPiece | undefined {
    const axes: Record<string, number> = face.weights === null ? {} : { wght: weight };
    const key = `${face.id}@${String(weight)}`;
    const held = this.#hold(key, () => {
      const shaping = this.#shaping(face, axes);
      const named = shaping.postscriptName();
      // A VARIABLE FACE'S NAME says which instance it is, as the composers name one (`composeFonts.ts`).
      const postscript = face.weights === null ? named : `${named === '' ? 'Font' : named}-wght${String(weight)}`;
      return { bytes: this.#read(face.path), faceIndex: face.faceIndex, axes, postscript, embedding: face.embedding, italic: face.italic, shaping };
    });
    const glyphs = held.shaping.shape(text, rtl);
    if (held.font.room < glyphs.length) return undefined;
    return { face: key, text, ...this.#drawn(held, glyphs, size) };
  }

  /**
   * The box for `character`: in the piece's own face where it has one, else in the first catalogue face that does, one
   * font per character whose cmap maps that character to the box glyph (ADR-0173 Decision 7 as corrected).
   */
  #box(character: string, face: CatalogueFace | null, size: number): SetPiece | undefined {
    const point = character.codePointAt(0) ?? 0;
    const candidates = [...(face === null ? [] : [face]), ...this.source.faces].filter(
      (each) => each.unicodes.has(BOX) && each.embedding !== 'never',
    );
    for (const candidate of candidates) {
      const key = `box|${candidate.id}|${String(point)}`;
      const known = this.#held.get(key);
      const held =
        known ??
        (() => {
          const axes: Record<string, number> = candidate.weights === null ? {} : { wght: candidate.weight };
          const named = this.#shaping(candidate, axes).postscriptName();
          const made = boxFont(this.#read(candidate.path), candidate.faceIndex, axes, named === '' ? 'Font' : named, point);
          if (made === null) return undefined;
          const shaping = new ShapingFace(made.bytes, 0, {});
          if (shaping.glyphFor(point) === undefined) return undefined;
          return this.#hold(key, () => ({
            bytes: made.bytes,
            faceIndex: 0,
            axes: {},
            postscript: made.name.replace(/^[A-Z]{6}\+/u, ''),
            embedding: candidate.embedding,
            italic: false,
            shaping,
          }));
        })();
      if (held === undefined) continue;
      const glyph = held.shaping.glyphFor(point) ?? 0;
      this.boxed.push(character);
      const advance = held.shaping.nominalAdvance(glyph);
      return { face: key, text: character, ...this.#drawn(held, [{ glyph, advance, xOffset: 0, yOffset: 0, text: character }], size) };
    }
    return undefined;
  }

  /**
   * The width `glyphs` take at `size` and the operators that draw them: each glyph's code, the shaper's placement past the
   * glyph's own advance as a `TJ` adjustment, and a raised or lowered glyph shown alone under a text rise.
   */
  #drawn(held: Held, glyphs: readonly ShapedGlyph[], size: number): { readonly width: number; readonly show: string } {
    const { shaping } = held;
    const em = shaping.unitsPerEm;
    const parts: string[] = [];
    let array: string[] = [];
    const flush = (): void => {
      if (array.length > 0) parts.push(`[${array.join(' ')}] TJ`);
      array = [];
    };
    let width = 0;
    for (const glyph of glyphs) {
      const assigned = held.font.cid(glyph.glyph, glyph.text);
      if (assigned === null) throw new Error('a text box face ran out of codes inside one piece');
      const nominal = shaping.nominalAdvance(glyph.glyph);
      // A TJ NUMBER MOVES THE PEN BACK by thousandths of the size: a glyph placed `xOffset` further on is preceded by
      // that much and followed by its return, and an advance wider than the glyph's own by the difference.
      const before = (-glyph.xOffset * 1000) / em;
      const after = (-(glyph.advance - nominal - glyph.xOffset) * 1000) / em;
      if (glyph.yOffset !== 0) {
        flush();
        if (before !== 0) parts.push(`[${fixed(before)}] TJ`);
        parts.push(`${fixed((glyph.yOffset * size) / em)} Ts`, `<${hex4(assigned.code)}> Tj`, '0 Ts');
        if (after !== 0) parts.push(`[${fixed(after)}] TJ`);
      } else {
        if (before !== 0) array.push(fixed(before));
        array.push(`<${hex4(assigned.code)}>`);
        if (after !== 0) array.push(fixed(after));
      }
      width += (glyph.advance * size) / em;
    }
    flush();
    return { width, show: parts.join(' ') };
  }

  #hold(key: string, source: () => ConstructorParameters<typeof CidFont<MupdfFontRef>>[1]): Held {
    const known = this.#held.get(key);
    if (known !== undefined) return known;
    const made = source();
    const held = { font: new CidFont(mupdfCidSink(this.document), made), shaping: made.shaping };
    this.#held.set(key, held);
    return held;
  }

  #shaping(face: CatalogueFace, axes: Readonly<Record<string, number>>): ShapingFace {
    const key = `${face.id}|${JSON.stringify(axes)}`;
    let shaping = this.#shapers.get(key);
    if (shaping === undefined) {
      shaping = new ShapingFace(this.#read(face.path), face.faceIndex, axes);
      this.#shapers.set(key, shaping);
    }
    return shaping;
  }

  #read(path: string): Uint8Array {
    let bytes = this.#bytes.get(path);
    if (bytes === undefined) {
      bytes = this.source.read(path);
      this.#bytes.set(path, bytes);
    }
    return bytes;
  }
}
