/**
 * THE font resolver: for each word of text to be written, which face draws it
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
 * Decision 1). Pure: it reads a catalogue somebody else read, so it runs anywhere and loads no font parser.
 *
 * ## The order, and why a word is the unit
 *
 * A word goes to the first source that carries EVERY character of it: the text's own font, then a sibling in the
 * same document, then an installed font of the same family and style, then the bundled face standing in for that
 * family, then a bundled face of the same class, then any installed and any bundled face. A word is never split while
 * one face carries all of it (the owner's Q6): one odd letter inside a word reads as a mistake, while the rest of the
 * line keeps its own font.
 *
 * Where NO face carries the whole word, the face carrying most of it draws what it carries and each GRAPHEME it lacks
 * goes to the first face carrying all of that grapheme, because a character a face can draw is never turned into a
 * box (ADR-0172's correction of 2026-10-05). The grapheme and not the code point, so a mark stays with its letter where
 * HarfBuzz can place it. Only a grapheme no source carries is the missing-character box (Decision 8), in the word's
 * face, which the caller draws.
 *
 * ## Characters that need no glyph
 *
 * A default-ignorable code point (a joiner, a variation selector, a soft hyphen) is shaped to nothing by HarfBuzz, so
 * a face lacking it still draws the word; requiring it would send whole words to the box for an invisible character.
 */

import type { FontEmbedding } from './fontFaces.js';
import { withoutSubsetTag } from './subsetName.js';

/** Where a face came from, in the order the resolver tries them. */
export type FaceOrigin = 'own' | 'sibling' | 'installed' | 'bundled';

/** A face the resolver may choose. */
export interface CandidateFace {
  /** A key the caller resolves back to bytes: a file and face index, or a document font. */
  readonly id: string;
  readonly origin: FaceOrigin;
  readonly family: string;
  readonly weight: number;
  readonly italic: boolean;
  readonly embedding: FontEmbedding;
  readonly unicodes: ReadonlySet<number>;
  /** The weight range a variable face can be pinned to, `null` for a static face. */
  readonly weights: { readonly min: number; readonly max: number } | null;
}

/** What text is to be written in. */
export interface FontRequest {
  /** The family the text asks for (a document font's name, a source's font), `null` for none. */
  readonly family: string | null;
  readonly bold: boolean;
  readonly italic: boolean;
  /** The text's own font, first, then its siblings in the document; empty where the text is new. */
  readonly own: readonly CandidateFace[];
}

/** One stretch of text and the face that draws it. */
export interface ResolvedRun {
  readonly text: string;
  /** The face, `null` where no source carries any character of the stretch. */
  readonly face: CandidateFace | null;
  /** The weight to pin a variable face at; the face's own weight for a static one. */
  readonly weight: number;
  /**
   * Non-empty only for a run of ONE character no source carries, drawn as the missing-character box: the run's text
   * is that character, and the face is its word's, for the box's size.
   */
  readonly missing: readonly string[];
}

/** The family classes a bundled face stands in for. */
export type FamilyClass = 'sans' | 'serif' | 'mono';

/**
 * Which bundled family stands in for which, by normalised family name: the metric-compatible pairs (Arimo for Arial
 * and Helvetica, Tinos for Times New Roman, Cousine for Courier New, Carlito for Calibri, Caladea for Cambria) and the
 * bundled faces' own names.
 */
export const STAND_INS: Readonly<Record<string, string>> = {
  arial: 'Arimo',
  helvetica: 'Arimo',
  helveticaneue: 'Arimo',
  liberationsans: 'Arimo',
  arimo: 'Arimo',
  timesnewroman: 'Tinos',
  times: 'Tinos',
  timesroman: 'Tinos',
  liberationserif: 'Tinos',
  tinos: 'Tinos',
  couriernew: 'Cousine',
  courier: 'Cousine',
  liberationmono: 'Cousine',
  cousine: 'Cousine',
  calibri: 'Carlito',
  carlito: 'Carlito',
  cambria: 'Caladea',
  caladea: 'Caladea',
};

/** The bundled family for each class. */
export const CLASS_FAMILIES: Readonly<Record<FamilyClass, string>> = { sans: 'Arimo', serif: 'Tinos', mono: 'Cousine' };

/**
 * A family name as the stand-in table keys it: no subset tag, no PostScript style suffix, lower case, letters only.
 * `ABCDEF+TimesNewRomanPS-BoldItalicMT` is `timesnewroman`.
 */
export function normaliseFamily(name: string): string {
  return withoutSubsetTag(name)
    .replace(/[-,](?:Bold|Italic|Oblique|Regular|Roman|Book|Medium|Light|Semibold|Black)\w*$/iu, '')
    .replace(/(?:PS)?MT$/u, '')
    .replace(/PS$/u, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
}

/** The class a family name reads as, for a family with no stand-in. */
export function familyClass(family: string | null): FamilyClass {
  const name = family === null ? '' : normaliseFamily(family);
  if (/mono|courier|consol|menlo|typewriter|code/u.test(name)) return 'mono';
  // SANS BEFORE SERIF, because the name is read as one run of letters: *Microsoft Sans Serif* normalises to
  // `microsoftsansserif`, which holds `serif`. And no bare `book`, which is a weight in *Franklin Gothic Book*; the
  // serif families that carry it are named.
  if (/sans|gothic|grotesk|grotesque/u.test(name)) return 'sans';
  if (/times|serif|roman|georgia|garamond|cambria|caladea|tinos|minion|palatino|bookantiqua|bookman|baskerville|naskh/u.test(name)) {
    return 'serif';
  }
  return 'sans';
}

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

/** The code points a face must carry to draw `text`. */
function needed(text: string): number[] {
  const points: number[] = [];
  for (const character of text) {
    if (IGNORABLE.test(character) || /\s/u.test(character)) continue;
    points.push(character.codePointAt(0) ?? 0);
  }
  return points;
}

/** How near a face's weight and slope are to what was asked; lower is nearer. */
function styleDistance(face: CandidateFace, weight: number, italic: boolean): number {
  const weightGap = face.weights === null ? Math.abs(face.weight - weight) : weight < face.weights.min || weight > face.weights.max ? 100 : 0;
  return weightGap + (face.italic === italic ? 0 : 1000);
}

/**
 * Every candidate in the order Decision 1 tries them, the never-embeddable ones left out: the text's own font and
 * siblings first, then the request's family installed, its stand-in bundled, its class bundled, then any installed and
 * any bundled face, each group nearest in style first.
 */
export function candidatesFor(request: FontRequest, catalogue: readonly CandidateFace[]): CandidateFace[] {
  const weight = request.bold ? 700 : 400;
  const usable = catalogue.filter((face) => face.embedding !== 'never');
  const asked = request.family === null ? null : normaliseFamily(request.family);
  const standIn = asked === null ? undefined : STAND_INS[asked];
  const classFamily = CLASS_FAMILIES[familyClass(request.family)];
  const near = (faces: readonly CandidateFace[]): CandidateFace[] =>
    [...faces].sort((left, right) => styleDistance(left, weight, request.italic) - styleDistance(right, weight, request.italic));
  const groups: CandidateFace[][] = [
    [...request.own],
    near(usable.filter((face) => face.origin === 'installed' && asked !== null && normaliseFamily(face.family) === asked)),
    near(usable.filter((face) => face.origin === 'bundled' && standIn !== undefined && face.family === standIn)),
    near(usable.filter((face) => face.origin === 'bundled' && face.family === classFamily)),
    near(usable.filter((face) => face.origin === 'installed')),
    near(usable.filter((face) => face.origin === 'bundled')),
  ];
  const seen = new Set<string>();
  const ordered: CandidateFace[] = [];
  for (const face of groups.flat()) {
    if (face.embedding === 'never' || seen.has(face.id)) continue;
    seen.add(face.id);
    ordered.push(face);
  }
  return ordered;
}

/** The weight a face is drawn at for a request: pinned into a variable face's range, or the face's own. */
function weightFor(face: CandidateFace | null, bold: boolean): number {
  const asked = bold ? 700 : 400;
  if (face === null) return asked;
  if (face.weights === null) return face.weight;
  return Math.min(face.weights.max, Math.max(face.weights.min, asked));
}

const WORDS = new Intl.Segmenter('und', { granularity: 'word' });
const GRAPHEMES = new Intl.Segmenter('und', { granularity: 'grapheme' });

/**
 * `text` resolved into runs, each in one face. Adjacent words in the same face are one run, and a space or a mark of
 * punctuation stays in the face before it when that face carries it, so a line does not change font at every space.
 */
export function resolveRuns(text: string, request: FontRequest, catalogue: readonly CandidateFace[]): ResolvedRun[] {
  const candidates = candidatesFor(request, catalogue);
  const runs: { text: string; face: CandidateFace | null; missing: string[] }[] = [];
  // A BOX IS ITS OWN RUN, so the one who draws it knows where it is: runs merge only when both are drawable in one face.
  const append = (piece: string, face: CandidateFace | null, missing: readonly string[]): void => {
    const previous = runs.at(-1);
    if (previous?.face === face && previous.missing.length === 0 && missing.length === 0) {
      previous.text += piece;
    } else {
      runs.push({ text: piece, face, missing: [...missing] });
    }
  };
  for (const { segment, isWordLike } of WORDS.segment(text)) {
    const points = needed(segment);
    const previous = runs.at(-1)?.face ?? null;
    if (previous !== null && isWordLike !== true && points.every((point) => previous.unicodes.has(point))) {
      append(segment, previous, []);
      continue;
    }
    const whole = candidates.find((candidate) => points.every((point) => candidate.unicodes.has(point)));
    if (whole !== undefined) {
      append(segment, whole, []);
      continue;
    }
    // NO FACE CARRIES THE WHOLE WORD. The face carrying most of it draws what it carries; a grapheme only another face
    // carries is drawn in that face, because a character drawn in some face is never turned into a box; and a grapheme
    // no face carries is a box, in the word's face. Splitting a word is the last resort, after the box would otherwise
    // replace something a face can draw.
    const best = candidates.reduce<{ face: CandidateFace; carried: number } | null>((most, face) => {
      const carried = points.filter((point) => face.unicodes.has(point)).length;
      return most === null || carried > most.carried ? { face, carried } : most;
    }, null);
    const wordFace = best !== null && best.carried > 0 ? best.face : (previous ?? candidates[0] ?? null);
    for (const { segment: grapheme } of GRAPHEMES.segment(segment)) {
      const wanted = needed(grapheme);
      if (wanted.every((point) => wordFace?.unicodes.has(point) === true)) {
        append(grapheme, wordFace, []);
        continue;
      }
      const other = candidates.find((candidate) => wanted.every((point) => candidate.unicodes.has(point)));
      if (other !== undefined) append(grapheme, other, []);
      else append(grapheme, wordFace, Array.from(grapheme));
    }
  }
  return runs.map((run) => ({ text: run.text, face: run.face, weight: weightFor(run.face, request.bold), missing: run.missing }));
}
