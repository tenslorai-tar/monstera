import type { FormPath } from '@monstera/contract/host';

import {
  BLOCK_FACE_CANDIDATES_MAX,
  BLOCK_FACE_FAMILY_MAX,
  BLOCK_FACE_FONTS_MAX,
  BLOCK_FACE_TEXT_MAX,
  FACE_STYLES,
  type BlockFaceRun,
  type BlockFaces,
  type BlockFont,
  type FaceChoice,
  type FaceStyle,
} from './blockFaceAnswer.js';
import { editFaces, editFacesBound, loadEditFaces } from './editFaces.js';
import { editPieces } from './editPieces.js';
import type { MupdfSession } from './engineSeam.js';
import type { FaceSource } from './fontCatalogue.js';
import { BOLD } from './lookedWeights.js';
import { withDocument } from './mupdfWriter.js';
import { type PageFont, loadStandardFonts, pageFonts } from './pageFonts.js';
import { type CandidateFace, candidatesFor } from './fontResolver.js';
import { targetOf } from './textOperatorEdit.js';
import { showOperators } from './textOperators.js';

/**
 * The read on open ([ADR-0271](../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)
 * section 5): for each font a block's runs are shown in, what the operator writer does with a new word in it — whether
 * the font may carry one, the face the chain sets one in where it cannot, and the chain's nearest faces for the person's
 * *Closest matches*. Asked once when a block is selected; never while it is typed in.
 *
 * ## The writer's own answer, not a second one (B3a)
 *
 * The run's font is found as the writer finds it: PDFium's object numbers through the pre-read's `textObjects`
 * (`blockFaceRunsOf`), the content's showing operators numbered by `textOperators.ts`, the page's fonts. The face is
 * `editPieces`' under `LookedWeights`' request, the planner and the weight the writer's `OperatorFaceSet` sets a word
 * by; the candidates are `candidatesFor`'s order, the resolver's. A word this read says goes to a face goes there when
 * it is written, because the two ask the same functions the same question.
 */
export async function readBlockFaces(
  session: MupdfSession,
  at: { readonly page: number; readonly form?: FormPath | undefined },
  runs: readonly BlockFaceRun[],
): Promise<BlockFaces> {
  const standard = await loadStandardFonts();
  const source = await faceSource();
  const weights = source === null ? null : new (await import('./lookedWeights.js')).LookedWeights(source);
  return withDocument(session, (document) => {
    const { content, holder } = targetOf(document, at, false);
    const fonts = pageFonts(holder, standard);
    // EACH TEXT OBJECT'S FONT, by the content's own numbering (`textOperators.ts`), which `blockFaceRunsOf` translated
    // the runs into.
    const fontOfObject = new Map<number, string>();
    for (const op of showOperators(content)) {
      if (op.object !== null && op.state.font !== null && !fontOfObject.has(op.object)) fontOfObject.set(op.object, op.state.font);
    }
    const placeOf = new Map<string, number>();
    const texts: string[] = [];
    const named: PageFont[] = [];
    const answerRuns = runs.map((run): number | null => {
      const resource = fontOfObject.get(run.object);
      const font = resource === undefined ? undefined : fonts.get(resource);
      if (resource === undefined || font === undefined) return null;
      let place = placeOf.get(resource);
      if (place === undefined) {
        if (named.length >= BLOCK_FACE_FONTS_MAX) return null;
        place = named.push(font) - 1;
        placeOf.set(resource, place);
        texts.push('');
      }
      texts[place] = `${texts[place] ?? ''}${run.text}`;
      return place;
    });
    const answerFonts = named.map((font, place): BlockFont => {
      const own = font.subtype !== 'Type3';
      if (source === null || weights === null) return { own, chosen: null, candidates: [] };
      const request = weights.requestFor(font);
      // THE FACE A NEW WORD GOES TO, asked of the block's own words in this font so a face carrying their script is the
      // answer: the writer's planner with the run's own font carrying nothing, which is the word it cannot carry.
      const sample = (texts[place] ?? '').replace(/\s+/gu, ' ').trim().slice(0, BLOCK_FACE_TEXT_MAX) || 'n';
      const piece = editPieces(sample, () => false, request, source.faces, []).find((each) => each.face !== null);
      const chosen = piece?.face === undefined || piece.face === null ? null : choiceOf(piece.face, piece.weight, source.faces);
      const families: FaceChoice[] = [];
      for (const face of candidatesFor(request, source.faces)) {
        if (face.origin === 'last' || families.some((each) => each.family === boundedFamily(face.family))) continue;
        families.push(choiceOf(face, face.weights === null ? face.weight : Math.min(face.weights.max, Math.max(face.weights.min, chosen?.weight ?? face.weight)), source.faces));
      }
      // THE CHOSEN FACE FIRST, whether or not the order put it in the first few.
      const rest = families.filter((each) => each.family !== chosen?.family);
      const candidates = (chosen === null ? rest : [chosen, ...rest]).slice(0, BLOCK_FACE_CANDIDATES_MAX);
      return { own, chosen, candidates };
    });
    return { fonts: answerFonts, runs: answerRuns };
  });
}

/** The faces this process writes new words in, loaded on first need as the writer loads them: they bring HarfBuzz. */
async function faceSource(): Promise<FaceSource | null> {
  if (!editFacesBound()) return null;
  await loadEditFaces();
  return editFaces();
}

/** A family name as an answer carries it. */
function boundedFamily(family: string): string {
  return family.slice(0, BLOCK_FACE_FAMILY_MAX);
}

/** `face` at `weight`, with every style its family has among `faces`. */
function choiceOf(face: CandidateFace, weight: number, faces: readonly CandidateFace[]): FaceChoice {
  const styles = new Set<FaceStyle>();
  for (const each of faces) {
    if (each.family !== face.family || each.embedding === 'never') continue;
    const regular = each.weights === null ? each.weight < BOLD : each.weights.min < BOLD;
    const bold = each.weights === null ? each.weight >= BOLD : each.weights.max >= BOLD;
    if (regular) styles.add(each.italic ? 'italic' : 'regular');
    if (bold) styles.add(each.italic ? 'bold-italic' : 'bold');
  }
  return { family: boundedFamily(face.family), weight, italic: face.italic, styles: FACE_STYLES.filter((style) => styles.has(style)) };
}
