import { instanceName } from '@monstera/shared';

import { boxFont } from './boxFont.js';
import { readFace } from './fontFaces.js';
import { namedSubset } from './fontSubset.js';

/**
 * The font program an in-place edit loads into PDFium for a catalogue face, made from the face's WHOLE file
 * ([ADR-0173](../../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decisions 5 and 7). Made in a thread that ends (`faceProgramApart.ts`, ADR-0239), because reading the whole file
 * through HarfBuzz keeps it for the reader's life; this module is what that thread runs, and nothing in a host imports
 * it.
 */

/** What a face program is made from: the face's whole file and which face in it, at which weight. */
interface FaceOfFile {
  readonly whole: Uint8Array;
  readonly faceIndex: number;
  /** Whether the face is variable, so `weight` pins its `wght` axis and names the instance. */
  readonly variable: boolean;
  readonly weight: number;
}

/** A subset carrying `unicodes`, or a one-glyph box font for `point`. */
export type FaceProgramRequest =
  | (FaceOfFile & {
      readonly kind: 'subset';
      readonly unicodes: readonly number[];
      /** Whether the whole file may stand in where HarfBuzz refuses the subset: licensed, static, the file's one face. */
      readonly wholeAllowed: boolean;
    })
  | (FaceOfFile & { readonly kind: 'box'; readonly point: number });

/** The program PDFium is handed, or `null` where the face cannot make one. */
export function faceProgram(request: FaceProgramRequest): Uint8Array | null {
  const named = readFace(request.whole, request.faceIndex).postscript;
  // A VARIABLE FACE'S NAME says which instance it is, as the composers name one (`composeFonts.ts`).
  const postscript = request.variable ? instanceName(named, request.weight) : named;
  const axes = request.variable ? { wght: request.weight } : {};
  if (request.kind === 'box') return boxFont(request.whole, request.faceIndex, axes, postscript, request.point)?.bytes ?? null;
  const subset = namedSubset(request.whole, postscript, { unicodes: [...request.unicodes], faceIndex: request.faceIndex, axes });
  // THE WHOLE FONT only where HarfBuzz refused the subset and the request allows it (Decision 5).
  return subset?.bytes ?? (request.wholeAllowed ? request.whole : null);
}
