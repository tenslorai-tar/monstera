import { faceOf } from './fontFace.js';
import { familyClass } from './fontResolver.js';

/**
 * The shape of `engine/text-faces`' answer and the one lookup of it
 * ([ADR-0256](../../../docs/DECISIONS/0256-a-type-3-runs-face-is-read-from-its-descriptor-by-mupdf.md)). Pure, and apart
 * from `textFaces.ts`, which binds MuPDF, so `main` can read an answer without loading the engine (ADR-0026).
 */

/** A font's face as its descriptor (or base name) states it: the name less its subset tag, and its weight. */
export interface TextFace {
  readonly face: string | null;
  readonly weight: number | null;
}

/** Consecutive text objects, `first` to `last` inclusive, shown in `font`, an index into {@link TextFaces.fonts}. */
export interface TextFaceRange {
  readonly first: number;
  readonly last: number;
  readonly font: number;
}

export interface TextFaces {
  readonly fonts: readonly TextFace[];
  readonly ranges: readonly TextFaceRange[];
  readonly truncated: boolean;
}

/** The most ranges an answer carries; `engine/text-faces`' schema takes this bound. */
export const TEXT_FACE_RANGES_MAX = 2048;

/**
 * The most fonts an answer names; a page past it names the first ones, and the ranges in the rest are left out. 64, so
 * the worst answer fits one frame beside {@link TEXT_FACE_RANGES_MAX} ranges: at 256 it admitted 334,285 bytes against
 * the 262,144-byte frame (`hostRoutes.test.ts`, 2026-10-19).
 */
export const TEXT_FACE_FONTS_MAX = 64;

/**
 * The longest face name an answer carries, in UTF-16 units: 127, the bound a run's style carries a font name under
 * (`PDFIUM_FONT_NAME_MAX`), so a name filled into a run always fits it. Stated here rather than imported because the
 * PDFium channels import the engine channels, and a constant read across that cycle is undefined at load.
 */
export const TEXT_FACE_NAME_MAX = 127;

/** A face name cut to {@link TEXT_FACE_NAME_MAX} at a whole character. */
export function boundedFaceName(name: string): string {
  if (name.length <= TEXT_FACE_NAME_MAX) return name;
  let cut = '';
  for (const character of name) {
    if (cut.length + character.length > TEXT_FACE_NAME_MAX) break;
    cut += character;
  }
  return cut;
}

/** What a run's style says of its face: the part {@link namedByDescriptor} fills. */
export interface FaceStyle {
  readonly font: string;
  readonly serif: boolean;
  readonly mono: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
}

/**
 * A run PDFium left unnamed (`font: ""`), named by its font's descriptor where `faces` says which, and its kind, weight
 * and slant decided by the rules a named run takes: `faceOf`'s weight and name, the resolver's class. A run PDFium named
 * is returned as it is — two witnesses about one run, and the one that spoke first keeps its word (ADR-0256 Decision 2).
 *
 * ## Two numberings, joined by PDFium's own list
 *
 * `faces` numbers TEXT objects (`showOperators`' `object`, the k-th text-showing operator), and a run's `index` is its
 * object's place among ALL the page's objects. They agree only while nothing but text comes first. So the run is found
 * in `textObjects`, PDFium's page indices of its text objects in order (`PageRuns.textObjects`), and the k-th of those
 * is text object k: the correspondence the operator writer reads too (`operatorEdit.ts`). Required, so no caller can
 * name a run by the wrong number. Measured 2026-11-01: a page that fills a rectangle and then shows two Type 3 fonts
 * named its first run with the second font's face, and its second with none.
 */
export function namedByDescriptor<T extends { readonly index: number; readonly style: FaceStyle }>(
  run: T,
  faces: TextFaces,
  textObjects: readonly number[],
): T {
  if (run.style.font !== '') return run;
  const number = textObjects.indexOf(run.index);
  if (number === -1) return run;
  const face = faceOfObject(faces, number);
  if (face?.face === null || face?.face === undefined || face.face === '') return run;
  const read = faceOf({ program: undefined, weight: Math.max(0, face.weight ?? 0), flags: undefined, name: face.face });
  const kind = familyClass(face.face);
  return {
    ...run,
    style: { ...run.style, font: face.face, serif: kind === 'serif', mono: kind === 'mono', bold: read.bold, italic: read.italic },
  };
}

/** The face of text object `object` (the k-th text object, not a page index), or `undefined` where none is named. */
export function faceOfObject(faces: TextFaces, object: number): TextFace | undefined {
  const range = faces.ranges.find((each) => each.first <= object && object <= each.last);
  return range === undefined ? undefined : faces.fonts[range.font];
}
