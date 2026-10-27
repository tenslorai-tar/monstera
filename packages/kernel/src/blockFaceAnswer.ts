/**
 * The shape of `engine/block-faces`' answer ([ADR-0271](../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)
 * section 5, the read on open), apart from `blockFaces.ts`, which binds MuPDF, so `main` can carry an answer without
 * loading the engine (ADR-0026). Its bounds and its styles are the contract's, which `document.blockFaces` carries the
 * same answer to the renderer under: one number for each, not one per wire.
 */
import {
  FACE_STYLES,
  type FaceStyle,
  MAX_BLOCK_FACE_RUNS,
  MAX_BLOCK_FACE_TEXT,
  MAX_BLOCK_FONTS,
  MAX_FACE_CANDIDATES,
  MAX_FACE_FAMILY,
} from '@monstera/contract/host';

export { FACE_STYLES, type FaceStyle };

/** A face the writer may set words in: its family, the weight and slant it is set at, and the styles its family has. */
export interface FaceChoice {
  readonly family: string;
  readonly weight: number;
  readonly italic: boolean;
  readonly styles: readonly FaceStyle[];
}

/** What the writer does with words in one of the block's fonts. */
export interface BlockFont {
  /**
   * Whether the font may carry a new word: an ordinary program, not one whose letters are drawn (a Type 3 font). The
   * writer still sets a new word in it only where it has every letter (`operatorEdit.ts`' `carrier`).
   */
  readonly own: boolean;
  /** The face a new word the font cannot carry is set in, the chain's answer, or `null` where this process has no faces. */
  readonly chosen: FaceChoice | null;
  /** The chain's nearest faces, one per family, the chosen one's family first. Empty where this process has no faces. */
  readonly candidates: readonly FaceChoice[];
}

export interface BlockFaces {
  readonly fonts: readonly BlockFont[];
  /** For each run asked about, in the order asked, its font's place in `fonts`, or `null` where the content shows none. */
  readonly runs: readonly (number | null)[];
}

/**
 * One run of a block, as the read on open asks about it: its index as `document.textBlocks` named it, its first text
 * object as the CONTENT numbers it (`textOperators.ts`' `object`), and its words. The first object names the run's font:
 * the font the run is shown in where it starts, which is the writer's `fontOf` for the operator that starts it.
 */
export interface BlockFaceRun {
  readonly index: number;
  readonly object: number;
  readonly text: string;
}

/**
 * The runs `indices` names, from PDFium's pre-read, the first object translated to the content's numbering through the
 * pre-read's `textObjects`: the k-th text object is `textObjects[k]`, the one correspondence the operator writer reads
 * the other way (`operatorEdit.ts`), so a run is the same object to both. A run the pre-read does not hold, or whose
 * objects are none of its text objects, is left out, and the answer then names no font for it.
 */
export function blockFaceRunsOf(
  read: { readonly textObjects: readonly number[]; readonly runs: readonly { readonly index: number; readonly members: readonly number[]; readonly text: string }[] },
  indices: readonly number[],
): BlockFaceRun[] {
  const ordinalOf = new Map(read.textObjects.map((object, ordinal) => [object, ordinal]));
  const runs = new Map(read.runs.map((run) => [run.index, run]));
  return indices.flatMap((index) => {
    const run = runs.get(index);
    if (run === undefined) return [];
    const object = run.members.map((member) => ordinalOf.get(member)).find((ordinal) => ordinal !== undefined);
    return object === undefined ? [] : [{ index, object, text: run.text.slice(0, BLOCK_FACE_TEXT_MAX) }];
  });
}

/**
 * `answer`, made for `runs`, given back for `indices`, in the order asked: a run the pre-read did not hold is not among
 * `runs` (`blockFaceRunsOf` leaves it out), so each answer is put back on its run by index, and that run is answered none
 * rather than taking the next run's font.
 */
export function facesInOrder(indices: readonly number[], runs: readonly BlockFaceRun[], answer: BlockFaces): BlockFaces {
  const placeOf = new Map(runs.map((run, at) => [run.index, answer.runs[at] ?? null]));
  return { fonts: answer.fonts, runs: indices.map((index) => placeOf.get(index) ?? null) };
}

/** The most fonts one block's answer carries: the contract's, which the renderer's wire carries it under. */
export const BLOCK_FACE_FONTS_MAX = MAX_BLOCK_FONTS;

/** The most candidates a font's answer carries: the owner's three to five *Closest matches*. */
export const BLOCK_FACE_CANDIDATES_MAX = MAX_FACE_CANDIDATES;

/** The most runs one read asks about: the contract's, which keeps a request inside the host's frame. */
export const BLOCK_FACE_RUNS_MAX = MAX_BLOCK_FACE_RUNS;

/** The longest family name an answer carries; a name past it is cut. */
export const BLOCK_FACE_FAMILY_MAX = MAX_FACE_FAMILY;

/** The most of a run's words a read carries, and the longest sample a face is chosen for: the contract's. */
export const BLOCK_FACE_TEXT_MAX = MAX_BLOCK_FACE_TEXT;
