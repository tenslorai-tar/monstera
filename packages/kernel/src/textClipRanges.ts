import { CLIP_IDENTITY_LENGTH } from './textOperators.js';

/**
 * The shape of `engine/text-clips`' answer and its one lookup
 * ([ADR-0281](../../../docs/DECISIONS/0281-a-run-carries-the-clip-its-content-draws-it-through.md)): which clip each text
 * object of a page is drawn through, by the content's own parse. Pure and apart from `textClips.ts`, which binds MuPDF,
 * so `main` can hand an answer on without loading the engine (ADR-0026), as `textFaceRanges.ts` is for the faces.
 *
 * Text objects are numbered as the writer numbers them (`ShowOperator.object`): the `k`-th text object PDFium makes of
 * the content, which is the `k`-th text object among the page's objects (ADR-0176 Decision 3).
 */

/** Consecutive text objects, `first` to `last` inclusive, drawn through `clip`, an index into {@link TextClipRanges.clips}. */
export interface TextClipRange {
  readonly first: number;
  readonly last: number;
  readonly clip: number;
}

export interface TextClipRanges {
  /** How many text objects the content shows: a reader whose own count differs cannot join these to its objects. */
  readonly objects: number;
  /** Each distinct clip's identity (`clipIdentitiesAt`). */
  readonly clips: readonly string[];
  /** The objects drawn through a clip; an object in no range is drawn through none. */
  readonly ranges: readonly TextClipRange[];
  /** Whether the page had more than the bounds below: a truncated answer is given to no read, which then groups as before. */
  readonly truncated: boolean;
}

/**
 * The most ranges an answer carries. 2048, the faces read's bound (`TEXT_FACE_RANGES_MAX`): a range is three numbers, so
 * the worst answer is under 100 KB beside {@link TEXT_CLIPS_MAX} identities, inside the 262,144-byte frame both the
 * answer and the PDFium reads' requests that carry it cross (`hostRoutes.test.ts` holds it).
 */
export const TEXT_CLIP_RANGES_MAX = 2048;

/** The most distinct clips an answer names. */
export const TEXT_CLIPS_MAX = 512;

/** A clip identity on the wire: {@link CLIP_IDENTITY_LENGTH} hex digits. */
export const CLIP_IDENTITY_PATTERN = new RegExp(`^[0-9a-f]{${String(CLIP_IDENTITY_LENGTH)}}$`, 'u');

/** The ranges of `clips`, one entry per text object in the writer's numbering (`textObjectClips`), bounded as above. */
export function clipRangesOf(clips: readonly (string | null)[]): TextClipRanges {
  const named: string[] = [];
  const indexOf = new Map<string, number>();
  const ranges: TextClipRange[] = [];
  for (const [object, clip] of clips.entries()) {
    if (clip === null) continue;
    let at = indexOf.get(clip);
    if (at === undefined) {
      if (named.length >= TEXT_CLIPS_MAX) return { objects: clips.length, clips: [], ranges: [], truncated: true };
      at = named.push(clip) - 1;
      indexOf.set(clip, at);
    }
    const last = ranges.at(-1);
    if (last?.clip === at && last.last + 1 === object) {
      ranges[ranges.length - 1] = { ...last, last: object };
      continue;
    }
    if (ranges.length >= TEXT_CLIP_RANGES_MAX) return { objects: clips.length, clips: [], ranges: [], truncated: true };
    ranges.push({ first: object, last: object, clip: at });
  }
  return { objects: clips.length, clips: named, ranges, truncated: false };
}

/**
 * Text object `k`'s clip, for a reader that numbers `count` text objects; `undefined` where it is drawn through none,
 * and for every object where the answer was truncated or counts otherwise: those numberings do not join.
 */
export function clipOfTextObject(answer: TextClipRanges, count: number, k: number): string | undefined {
  if (answer.truncated || answer.objects !== count) return undefined;
  const range = answer.ranges.find((each) => each.first <= k && k <= each.last);
  return range === undefined ? undefined : answer.clips[range.clip];
}
