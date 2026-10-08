import { boxFont } from './boxFont.js';
import { CidFont } from './cidFont.js';
import { editPieces } from './editPieces.js';
import type { CatalogueFace, FaceSource } from './fontCatalogue.js';
import { type MupdfFontRef, mupdfCidSink } from './mupdfCidFont.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import type { FacePiece, OperatorFaces } from './operatorEdit.js';
import type { PageFont } from './pageFonts.js';
import { ShapingFace } from './textShaping.js';

/** U+25A1 WHITE SQUARE, the missing-character box. */
const BOX = 0x25a1;
/** A weight from which a run is asked for in a bold face. */
const BOLD = 600;

/** A font this edit adds to the page: its resource name, the font being written, and the page's view of it. */
interface Added {
  readonly resource: string;
  readonly font: CidFont<MupdfFontRef>;
  readonly page: PageFont;
  /** What the page's view reads: each code's text and width, filled as codes are assigned. */
  readonly text: Map<number, string>;
  readonly widths: Map<number, number>;
}

/**
 * The resolver's faces and the box, for a word a Type 3 page's own fonts cannot draw
 * ([ADR-0177](../../../docs/DECISIONS/0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md)
 * Decisions 2 to 5). The PLAN is `editPieces.ts`', the PDFium writer's own planner, so a word goes to the face it
 * would on any other page; the CODES are `cidFont.ts`', written through MuPDF's object model by `mupdfCidSink`; this
 * class only holds the fonts one edit adds and names them on the page.
 *
 * A face piece whose shaping draws a glyph standing for no character (a mark HarfBuzz composed alone) is set by no
 * one here: the composers draw such a glyph as its outline, and this writer would need a second drawing path to do
 * the same. The word is then refused by name, which loses nothing.
 */
export class OperatorFaceSet {
  readonly #added = new Map<string, Added>();
  readonly #instances = new Map<string, ShapingFace>();
  readonly #bytes = new Map<string, Uint8Array>();
  /** Every character drawn as the box, in the order drawn. */
  readonly boxed: string[] = [];
  readonly #taken: Set<string>;

  constructor(
    private readonly document: PDFDocument,
    private readonly source: FaceSource,
    private readonly fonts: ReadonlyMap<string, PageFont>,
  ) {
    this.#taken = new Set(fonts.keys());
  }

  /** The hook {@link editOperators} asks for a word its run's fonts cannot carry. */
  get faces(): OperatorFaces {
    return {
      set: (word, op, own, restyle) => this.#set(word, op.state.font, own, restyle),
      drawn: (pieces) => {
        for (const piece of pieces) if (piece.boxed !== undefined) this.boxed.push(piece.boxed);
      },
    };
  }

  /** The fonts the edit added, by resource name, as the page will read them once {@link finish} has written them. */
  get pageFonts(): ReadonlyMap<string, PageFont> {
    return new Map([...this.#added.values()].map((added) => [added.resource, added.page]));
  }

  /** Writes every added font and names it in `fontDictionary`, the page's `/Font`. Answers the names it added. */
  finish(fontDictionary: PDFObject): string[] {
    const names: string[] = [];
    for (const added of this.#added.values()) {
      added.font.finish();
      if (added.font.ref.object === null) throw new Error(`the font ${added.resource} was finished and not written`);
      fontDictionary.put(added.resource, added.font.ref.object);
      names.push(added.resource);
    }
    return names;
  }

  #set(
    word: string,
    runFont: string | null,
    own: (stretch: string) => FacePiece | null,
    restyle?: { readonly bold?: boolean; readonly italic?: boolean; readonly family?: string },
  ): readonly FacePiece[] | null {
    const font = runFont === null ? undefined : this.fonts.get(runFont);
    // A RESTYLED WORD (ADR-0180) asks the resolver for the weight, slant and family the person chose, and the run's own
    // font is not tried: it is the wrong face by definition.
    const request = {
      family: restyle?.family ?? font?.face ?? null,
      bold: restyle?.bold ?? (font?.weight ?? 400) >= BOLD,
      italic: restyle?.italic ?? false,
      own: [],
    };
    const pieces = editPieces(word, (stretch) => restyle === undefined && own(stretch) !== null, request, this.source.faces, []);
    const out: FacePiece[] = [];
    for (const piece of pieces) {
      if (piece.boxed.length > 0) {
        for (const character of piece.boxed) {
          const box = this.#box(character, piece.face);
          if (box === null) return null;
          out.push({ ...box, boxed: character });
        }
        continue;
      }
      const set = piece.face === null ? own(piece.text) : this.#inFace(piece.face, piece.weight, piece.text);
      if (set === null) return null;
      out.push(set);
    }
    return out;
  }

  /** `text` in `face` at `weight`, in the one font this edit writes for that face and weight. */
  #inFace(face: CatalogueFace, weight: number, text: string): FacePiece | null {
    const axes: Record<string, number> = face.weights === null ? {} : { wght: weight };
    const shaping = this.#shaping(face, axes);
    const named = shaping.postscriptName();
    // A VARIABLE FACE'S NAME says which instance it is, as the composers name one (`composeFonts.ts`).
    const postscript = face.weights === null ? named : `${named === '' ? 'Font' : named}-wght${String(weight)}`;
    const added = this.#add(`${face.id}@${String(weight)}`, () => ({
      bytes: this.#read(face.path),
      faceIndex: face.faceIndex,
      axes,
      postscript,
      embedding: face.embedding,
      italic: face.italic,
      shaping,
    }), face);
    const glyphs = shaping.shape(text, false);
    if (glyphs.some((glyph) => glyph.text === '') || added.font.room < glyphs.length) return null;
    return { font: added.page, codes: glyphs.map((glyph) => this.#code(added, glyph.glyph, glyph.text)) };
  }

  /**
   * The box for `character`: the piece's own face's where it has one, else the first catalogue face's, in the
   * catalogue's order, so the box sits in the face beside it where it can. One font per character, because its cmap
   * maps that character to the box glyph and its `ToUnicode` reads it back (ADR-0173 Decision 7 as corrected).
   */
  #box(character: string, face: CatalogueFace | null): FacePiece | null {
    const point = character.codePointAt(0) ?? 0;
    const candidates = [...(face === null ? [] : [face]), ...this.source.faces].filter(
      (each) => each.unicodes.has(BOX) && each.embedding !== 'never',
    );
    for (const candidate of candidates) {
      const key = `box|${candidate.id}|${String(point)}`;
      const known = this.#added.get(key);
      if (known !== undefined) return { font: known.page, codes: [this.#code(known, known.font.source.shaping.glyphFor(point) ?? 0, character)] };
      const axes: Record<string, number> = candidate.weights === null ? {} : { wght: candidate.weight };
      const named = this.#shaping(candidate, axes).postscriptName();
      const made = boxFont(this.#read(candidate.path), candidate.faceIndex, axes, named === '' ? 'Font' : named, point);
      if (made === null) continue;
      const shaping = new ShapingFace(made.bytes, 0, {});
      const glyph = shaping.glyphFor(point);
      if (glyph === undefined) continue;
      const added = this.#add(key, () => ({
        bytes: made.bytes,
        faceIndex: 0,
        axes: {},
        postscript: made.name.replace(/^[A-Z]{6}\+/u, ''),
        embedding: candidate.embedding,
        italic: false,
        shaping,
      }), candidate);
      return { font: added.page, codes: [this.#code(added, glyph, character)] };
    }
    return null;
  }

  /** The code `added` draws `glyph` for `text` under, recorded in its `ToUnicode` as the page will read it. */
  #code(added: Added, glyph: number, text: string): number {
    const assigned = added.font.cid(glyph, text);
    if (assigned === null) throw new Error(`the font ${added.resource} ran out of codes inside one word`);
    added.text.set(assigned.code, text);
    added.widths.set(assigned.code, assigned.width / 1000);
    return assigned.code;
  }

  #add(key: string, source: () => ConstructorParameters<typeof CidFont<MupdfFontRef>>[1], face: CatalogueFace): Added {
    const known = this.#added.get(key);
    if (known !== undefined) return known;
    const font = new CidFont(mupdfCidSink(this.document), source());
    let n = this.#added.size + 1;
    while (this.#taken.has(`MonsteraF${String(n)}`)) n += 1;
    const resource = `MonsteraF${String(n)}`;
    this.#taken.add(resource);
    const text = new Map<number, string>();
    const widths = new Map<number, number>();
    const page: PageFont = {
      resource,
      subtype: 'Type0',
      toUnicode: { text, bytes: 2 },
      codeBytes: 2,
      width: (code) => widths.get(code) ?? null,
      draws: (code) => text.has(code),
      face: face.family,
      weight: face.weight,
    };
    const added = { resource, font, page, text, widths };
    this.#added.set(key, added);
    return added;
  }

  #shaping(face: CatalogueFace, axes: Readonly<Record<string, number>>): ShapingFace {
    const key = `${face.id}|${JSON.stringify(axes)}`;
    let shaping = this.#instances.get(key);
    if (shaping === undefined) {
      shaping = new ShapingFace(this.#read(face.path), face.faceIndex, axes);
      this.#instances.set(key, shaping);
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
