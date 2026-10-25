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
import { LOOKS_LIKE, STAND_INS, normaliseFamily } from '@monstera/shared';

/** Where a face came from, in the order the resolver tries them. */
/**
 * Where a face comes from. `last` is the face that draws every script and is used ONLY for a character no other face
 * draws ([ADR-0270](../../../docs/DECISIONS/0270-edit-text-writes-what-the-person-typed-and-never-refuses-it.md)'s
 * correction, GNU Unifont): never chosen for a word, never the face that draws most of one, and never in the font picker.
 */
export type FaceOrigin = 'own' | 'sibling' | 'installed' | 'bundled' | 'last';

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

// THE NAME RULES AND THE STAND-IN TABLE are `@monstera/shared`'s, so the font picker previews a family by the very table
// this resolver writes with (ADR-0250 Decision 3); exported on from here for the kernel's own callers.
export { LOOKS_LIKE, STAND_INS, normaliseFamily };

/** The bundled family for each class. */
export const CLASS_FAMILIES: Readonly<Record<FamilyClass, string>> = { sans: 'Arimo', serif: 'Tinos', mono: 'Cousine' };

/** The class a family name reads as, for a family with no stand-in. */
export function familyClass(family: string | null): FamilyClass {
  const name = family === null ? '' : normaliseFamily(family);
  if (/mono|courier|consol|menlo|typewriter|code/u.test(name)) return 'mono';
  // TEX'S OWN FAMILIES, by their short names (the owner's A1: a serif page whose fonts read as sans while edited):
  // Computer Modern's `cmr10`, `cmbx12`, `cmti10` are serif, `cmtt` typewriter and `cmss` sans; `NimbusRomNo9L` is
  // Times as pdfTeX's `times` package embeds it.
  if (/^cmtt|^lmmono/u.test(name)) return 'mono';
  if (/^cm(?:r|bx|b|ti|sl|csc|u|fib|dunh)\d/u.test(name) || name.startsWith('nimbusrom')) return 'serif';
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

/**
 * Whether `face` draws `point`: it maps it, and the point is not a control character. A face that maps a control maps it
 * to a glyph that draws nothing (bundled faces map U+0000 to an empty `NULL` glyph, measured 2026-10-12: a NUL in a CSV
 * field was drawn invisibly and named nowhere), so a control is drawn by no face and is the box, named by its line, as any
 * character no face carries is (C3). White space is never asked for: `needed` leaves it out.
 */
export function carries(face: { readonly unicodes: ReadonlySet<number> }, point: number): boolean {
  return !CONTROL.test(String.fromCodePoint(point)) && face.unicodes.has(point);
}

const CONTROL = /\p{Cc}/u;

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
export function candidatesFor(request: FontRequest, catalogue: readonly CandidateFace[]): readonly CandidateFace[] {
  const fromCatalogue = catalogueOrder(request, catalogue);
  if (request.own.length === 0) return fromCatalogue;
  const ordered: CandidateFace[] = [];
  const seen = new Set<string>();
  for (const face of [...request.own, ...fromCatalogue]) {
    if (face.embedding === 'never' || seen.has(face.id)) continue;
    seen.add(face.id);
    ordered.push(face);
  }
  return ordered;
}

/**
 * THE CATALOGUE'S ORDER IS WORKED OUT ONCE per catalogue and per family, weight and slope, never per call. A catalogue
 * is read once per host and never changes, and the order depends on nothing else; `resolveRuns` runs once per cell of a
 * CSV, so filtering and sorting every face each time made a part's cost the cells times the installed faces — measured
 * 2026-10-14, 83,000 calls took 484 ms over 20 faces and 46,565 ms over 920, which is what took a 1 MiB part past the
 * host call's 120 s deadline on a machine with hundreds of fonts installed. Keyed by the catalogue array itself, so a
 * catalogue that is dropped takes its orders with it.
 */
const ORDERS = new WeakMap<readonly CandidateFace[], Map<string, readonly CandidateFace[]>>();

function catalogueOrder(request: FontRequest, catalogue: readonly CandidateFace[]): readonly CandidateFace[] {
  let orders = ORDERS.get(catalogue);
  if (orders === undefined) {
    orders = new Map();
    ORDERS.set(catalogue, orders);
  }
  const key = `${request.family ?? ''}\u0000${String(request.bold)}\u0000${String(request.italic)}`;
  let order = orders.get(key);
  if (order === undefined) {
    order = workOutOrder(request, catalogue);
    orders.set(key, order);
  }
  return order;
}

function workOutOrder(request: FontRequest, catalogue: readonly CandidateFace[]): readonly CandidateFace[] {
  const weight = request.bold ? 700 : 400;
  const usable = catalogue.filter((face) => face.embedding !== 'never');
  const asked = request.family === null ? null : normaliseFamily(request.family);
  const standIn = asked === null ? undefined : STAND_INS[asked];
  const classFamily = CLASS_FAMILIES[familyClass(request.family)];
  const near = (faces: readonly CandidateFace[]): CandidateFace[] =>
    [...faces].sort((left, right) => styleDistance(left, weight, request.italic) - styleDistance(right, weight, request.italic));
  const groups: CandidateFace[][] = [
    near(usable.filter((face) => face.origin === 'installed' && asked !== null && normaliseFamily(face.family) === asked)),
    near(usable.filter((face) => face.origin === 'bundled' && standIn !== undefined && face.family === standIn)),
    near(usable.filter((face) => face.origin === 'bundled' && face.family === classFamily)),
    near(usable.filter((face) => face.origin === 'installed')),
    near(usable.filter((face) => face.origin === 'bundled')),
    // AND THE LAST FACE LAST, after every other.
    usable.filter((face) => face.origin === 'last'),
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
  // THE LAST FACE APART (`FaceOrigin`'s `last`): every choice below is made among the others, and a grapheme none of them
  // draws is drawn in the last face before it is a box.
  const all = candidatesFor(request, catalogue);
  const candidates = all.filter((candidate) => candidate.origin !== 'last');
  const lastFaces = all.filter((candidate) => candidate.origin === 'last');
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
    if (previous !== null && isWordLike !== true && points.every((point) => carries(previous, point))) {
      append(segment, previous, []);
      continue;
    }
    const whole = candidates.find((candidate) => points.every((point) => carries(candidate, point)));
    if (whole !== undefined) {
      append(segment, whole, []);
      continue;
    }
    // NO FACE CARRIES THE WHOLE WORD. The face carrying most of it draws what it carries; a grapheme only another face
    // carries is drawn in that face, because a character drawn in some face is never turned into a box; and a grapheme
    // no face carries is a box, in the word's face. Splitting a word is the last resort, after the box would otherwise
    // replace something a face can draw.
    const best = candidates.reduce<{ face: CandidateFace; carried: number } | null>((most, face) => {
      const carried = points.filter((point) => carries(face, point)).length;
      return most === null || carried > most.carried ? { face, carried } : most;
    }, null);
    const wordFace = best !== null && best.carried > 0 ? best.face : (previous ?? candidates[0] ?? null);
    for (const { segment: grapheme } of GRAPHEMES.segment(segment)) {
      const wanted = needed(grapheme);
      if (wordFace !== null && wanted.every((point) => carries(wordFace, point))) {
        append(grapheme, wordFace, []);
        continue;
      }
      const other =
        candidates.find((candidate) => wanted.every((point) => carries(candidate, point))) ??
        lastFaces.find((candidate) => wanted.every((point) => carries(candidate, point)));
      if (other !== undefined) append(grapheme, other, []);
      else append(grapheme, wordFace, Array.from(grapheme));
    }
  }
  return runs.map((run) => ({ text: run.text, face: run.face, weight: weightFor(run.face, request.bold), missing: run.missing }));
}
