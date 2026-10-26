import { FEWEST_LETTERS, STEM_LETTERS, contoursOfOutline, meanStem, stemOf, weightMatching } from './drawnWeight.js';
import { editPieces } from './editPieces.js';
import type { CatalogueFace, FaceSource } from './fontCatalogue.js';
import { type FontRequest, askedWeight } from './fontResolver.js';
import type { PageFont } from './pageFonts.js';
import { ShapingFace } from './textShaping.js';

/**
 * What weight a word in a page's font is set at, and whether that is bold — the ONE answer the writer sets a new word by,
 * compares a person's Bold with, and the page read tells the editor (ADR-0176's corrections of 2026-10-26, the owner's
 * L2). Three places had three opinions: the writer's face set asked bold at a descriptor's 600, its mark check compared a
 * person's Bold with that number, and the editor drew a run bold from the read's; a word typed beside a semibold drawn
 * heading was then drawn bold while typing, written bold, and Bold off was taken for no change.
 *
 * For a font whose letters are drawn, the weight is the one they LOOK in the family a word of them goes to: the drawn
 * stem letters' mean stem matched against that family's faces over the same letters (`drawnWeight.ts`). The descriptor's
 * number decides only where nothing can be measured.
 */

/** A weight from which a word is set bold. */
export const BOLD = 600;

/** What a person asked of a word's face (ADR-0180): a weight, slant or family. */
export interface Restyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly family?: string;
}

/** The weights a variable face is measured at: every hundred across its range, and its ends. */
function axisWeights({ min, max }: { readonly min: number; readonly max: number }): number[] {
  const weights = new Set([min, max]);
  for (let weight = Math.ceil(min / 100) * 100; weight <= max; weight += 100) weights.add(weight);
  return [...weights].sort((left, right) => left - right);
}

export class LookedWeights {
  /** The weight each drawn font's letters look, by font and family. */
  readonly #looked = new Map<string, number | undefined>();
  readonly #source: FaceSource;
  readonly #shaping: (face: CatalogueFace, axes: Readonly<Record<string, number>>) => ShapingFace;

  /**
   * @param shaping how a face is opened at a pin: the face set's own, so a face opened to measure is the one it writes
   */
  constructor(source: FaceSource, shaping?: (face: CatalogueFace, axes: Readonly<Record<string, number>>) => ShapingFace) {
    this.#source = source;
    const opened = new Map<string, ShapingFace>();
    this.#shaping =
      shaping ??
      ((face, axes) => {
        const key = `${face.id}|${JSON.stringify(axes)}`;
        let found = opened.get(key);
        if (found === undefined) {
          found = new ShapingFace(source.read(face.path), face.faceIndex, axes);
          opened.set(key, found);
        }
        return found;
      });
  }

  /** The request a word in `font` is set by: the person's restyle over the run's own face, weight and slant. */
  requestFor(font: PageFont | undefined, restyle?: Restyle): FontRequest {
    const family = restyle?.family ?? font?.face ?? null;
    const bold = restyle?.bold ?? (font?.weight ?? 400) >= BOLD;
    const italic = restyle?.italic ?? false;
    // THE WEIGHT ITS DRAWN NEIGHBOURS LOOK, where nobody chose bold or not.
    const looked = restyle?.bold !== undefined || font === undefined ? undefined : this.#lookedWeight(font, { family, bold, italic, own: [] });
    return { family, bold, italic, own: [], ...(looked === undefined ? {} : { weight: looked }) };
  }

  /** The weight a word in `font` nobody marked is set at: where the resolver pins it, by {@link requestFor}. */
  unmarkedWeight(font: PageFont): number {
    const request = this.requestFor(font);
    const piece = editPieces('n', () => false, request, this.#source.faces, []).find((each) => each.face !== null);
    return piece?.weight ?? askedWeight(request);
  }

  /** Whether a word in `font` nobody marked is set bold. */
  isBold(font: PageFont): boolean {
    return this.unmarkedWeight(font) >= BOLD;
  }

  /**
   * The weight a drawn font's letters look in the family a word of them would be set in, or `undefined` where its glyphs
   * cannot be read as outlines, it draws too few stem letters, or the family has one weight to offer.
   */
  #lookedWeight(font: PageFont, request: FontRequest): number | undefined {
    const key = `${font.resource}|${request.family ?? ''}|${String(request.italic)}`;
    if (this.#looked.has(key)) return this.#looked.get(key);
    const found = this.#measure(font, request);
    this.#looked.set(key, found);
    return found;
  }

  #measure(font: PageFont, request: FontRequest): number | undefined {
    const outline = font.outline;
    const text = font.toUnicode?.text;
    if (outline === undefined || text === undefined) return undefined;
    // THE DRAWN STEM LETTERS, one glyph each, read as outlines.
    const drawn = new Map<string, number>();
    for (const [code, character] of text) {
      if (!STEM_LETTERS.has(character) || drawn.has(character) || !font.draws(code)) continue;
      const contours = outline(code);
      const stem = contours === null ? undefined : stemOf(contours);
      if (stem !== undefined && stem > 0) drawn.set(character, stem);
    }
    if (drawn.size < FEWEST_LETTERS) return undefined;
    // THE FAMILY A WORD OF THESE LETTERS GOES TO, by the resolver's own order, and its faces of the asked slant.
    const letters = [...drawn.keys()].join('');
    const chosen = editPieces(letters, () => false, request, this.#source.faces, []).find((piece) => piece.face !== null)?.face ?? null;
    if (chosen === null) return undefined;
    const faces = this.#source.faces.filter((face) => face.family === chosen.family && face.italic === request.italic && face.embedding !== 'never');
    const shaped = faces
      .flatMap((face) =>
        face.weights === null
          ? [{ face, weight: face.weight, axes: {} }]
          : axisWeights(face.weights).map((weight) => ({ face, weight, axes: { wght: weight } })),
      )
      .map((instance) => ({ ...instance, shaping: this.#shaping(instance.face, instance.axes) }));
    // ONLY THE LETTERS EVERY ONE OF THEM DRAWS, so each stem is of the same letters.
    const shared = [...drawn.keys()].filter((letter) => shaped.every(({ shaping }) => shaping.glyphFor(letter.codePointAt(0) ?? 0) !== undefined));
    if (shared.length < FEWEST_LETTERS) return undefined;
    const target = meanStem(shared.map((letter) => drawn.get(letter) ?? 0));
    if (target === undefined) return undefined;
    const family = shaped.flatMap(({ weight, shaping }) => {
      const stem = meanStem(
        shared.flatMap((letter) => {
          const own = stemOf(contoursOfOutline(shaping.outline(shaping.glyphFor(letter.codePointAt(0) ?? 0) ?? 0)));
          return own === undefined ? [] : [own / shaping.unitsPerEm];
        }),
      );
      return stem === undefined ? [] : [{ weight, stem }];
    });
    return weightMatching(target, family);
  }
}
