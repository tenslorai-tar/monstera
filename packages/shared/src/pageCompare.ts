/**
 * Two documents compared as Acrobat's Compare does: pages matched by their content, then each matched pair compared
 * for text, layout, annotations and pictures, every change boxed on BOTH pages (ADR-0131).
 *
 * ## Pure, and where its inputs come from
 *
 * Nothing here reads a document. The renderer walks both documents one pair of pages at a time and hands this module
 * what three existing reads gave it: the kernel's text lines with boxes, the annotation list, and a small raster PDF.js
 * drew. Every box is in a page's DISPLAY space at scale 1 — the text layer's own space (`document.pageTextLayer`) — so
 * a box can be drawn on either page with the transform that page already has.
 *
 * ## The thresholds are chosen, not measured
 *
 * Each is a named constant below with what it decides. None was tuned against a corpus; the fixtures in
 * `pageCompare.test.ts` separate each kind of change, which is what they are evidence for, and no more.
 */
import { alignSequences, comparableLine } from './lineDiff.js';
import { tokensOf, wordsOf } from './wordCount.js';

/** A rectangle in a page's display space at scale 1 (points, origin top-left, rotation applied). */
export interface CompareBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One line of a page's text, as the kernel's text layer reports it. */
export interface CompareLine {
  readonly text: string;
  readonly box: CompareBox;
}

/** One annotation, its rectangle already in display space (or `null`, for one with no rectangle). */
export interface CompareAnnotation {
  readonly kind: string;
  readonly box: CompareBox | null;
  readonly contents: string;
  readonly colour: readonly number[];
}

/** A page drawn small, as luminance 0-255, one byte a pixel, rows top to bottom. */
export interface CompareRaster {
  readonly width: number;
  readonly height: number;
  /** Pixels per point, the same on both sides of a pair. */
  readonly pixelsPerPoint: number;
  readonly luminance: Uint8Array | Uint8ClampedArray;
}

/** Everything one page contributes to a comparison. */
export interface ComparePage {
  /** The page's display size in points at scale 1. */
  readonly size: { readonly width: number; readonly height: number };
  readonly lines: readonly CompareLine[];
  readonly annotations: readonly CompareAnnotation[];
  readonly raster: CompareRaster | undefined;
}

/** A pair may be matched only when its pages are at least this similar (Dice of the word multisets, 0 to 1). */
export const PAGE_MATCH_MIN = 0.5;
/** Fewer words than this and a page is matched by its picture: a scan, a full-page figure, a blank page. */
export const TEXT_SIGNATURE_MIN_WORDS = 3;
/** A word or line on both pages that moved further than this many points is a layout change. */
export const LAYOUT_MOVE_POINTS = 6;
/** The picture comparison's cell, in points. */
export const RASTER_CELL_POINTS = 8;
/** A cell differs when its pixels differ by more than this on average, of 255. */
export const RASTER_CELL_DIFFERENCE = 24;
/** Two annotations of one kind are the same mark when their rectangles overlap at least this much (intersection over union). */
export const ANNOTATION_MATCH_OVERLAP = 0.5;
/** Past this many cells the alignment table is banded rather than full. */
export const FULL_ALIGNMENT_CELLS = 4_000_000;
/** How many pages beyond the difference in length the banded table looks either side. */
export const ALIGNMENT_BAND = 400;

// ─── page signatures and their alignment ────────────────────────────────────

/**
 * What a page is matched by, and all a walk keeps of it: its words as hashes, and for a page with too few words, its
 * ink on a coarse grid. Never its text or its raster — the alignment needs every page's signature at once, so what a
 * signature holds is what a long document costs to compare. Built by {@link signPage}, the only way to make one.
 */
export interface PageSignature {
  readonly sorted: Uint32Array;
  readonly minhash: Uint32Array;
  readonly words: number;
  readonly ink: Float64Array | undefined;
}

/** How the two documents' pages correspond. */
export type PageAlignment =
  | { readonly kind: 'matched'; readonly left: number; readonly right: number; readonly similarity: number }
  | { readonly kind: 'removed'; readonly left: number }
  | { readonly kind: 'inserted'; readonly right: number };

/** A page's words in reading order — `wordCount.ts`' rule, so a page's signature and its word count agree (B3a). */
function pageWords(lines: readonly CompareLine[]): string[] {
  return [...wordsOf(lines.map((line) => line.text))];
}

/** FNV-1a, 32 bits: a word's hash for the signatures below. */
function hashWord(word: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < word.length; at += 1) {
    hash ^= word.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const MINHASH_SEEDS = Array.from({ length: 32 }, (_, at) => [Math.imul(at + 1, 0x9e3779b1) | 1, Math.imul(at + 7, 0x85ebca6b)] as const);

/**
 * Whether a page will be matched by its picture rather than its words — so a walk draws a page for its signature only
 * when this says so. The same count {@link signPage} makes, so the two cannot disagree about which pages are scans.
 */
export function needsPicture(lines: readonly CompareLine[]): boolean {
  return pageWords(lines).length < TEXT_SIGNATURE_MIN_WORDS;
}

/**
 * A page's signature: its words as a sorted multiset of hashes and a 32-value MinHash, and — only when it has fewer
 * than {@link TEXT_SIGNATURE_MIN_WORDS} words, so it will be matched by its picture — the ink of `thumbnail` on the
 * grid {@link rasterSimilarity} reads. The caller can drop the lines and the raster as soon as this returns.
 */
export function signPage(lines: readonly CompareLine[], thumbnail: CompareRaster | undefined): PageSignature {
  const hashes = Uint32Array.from(pageWords(lines).map(hashWord)).sort();
  const minhash = new Uint32Array(MINHASH_SEEDS.length).fill(0xffffffff);
  for (const hash of hashes) {
    for (const [at, [a, b]] of MINHASH_SEEDS.entries()) {
      const value = (Math.imul(hash, a) + b) >>> 0;
      if (value < (minhash[at] ?? 0)) minhash[at] = value;
    }
  }
  const ink = hashes.length >= TEXT_SIGNATURE_MIN_WORDS || thumbnail === undefined ? undefined : inkOf(thumbnail);
  return { sorted: hashes, minhash, words: hashes.length, ink };
}

/** The Dice coefficient of two multisets given as sorted hash arrays: twice the shared count over the total. */
function dice(a: Uint32Array, b: Uint32Array): number {
  if (a.length + b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] ?? 0;
    const y = b[j] ?? 0;
    if (x === y) {
      shared += 1;
      i += 1;
      j += 1;
    } else if (x < y) i += 1;
    else j += 1;
  }
  return (2 * shared) / (a.length + b.length);
}

/**
 * Two pages' similarity, 0 to 1. Both with words enough: the Dice coefficient of their word multisets, computed only
 * where a MinHash estimate says it could reach the match threshold (an estimate far below it decides nothing a
 * comparison needs). Both without: their pictures. One with words and one without: 0, a page that changed what it is.
 */
function similarity(a: PageSignature, b: PageSignature): number {
  const aText = a.words >= TEXT_SIGNATURE_MIN_WORDS;
  const bText = b.words >= TEXT_SIGNATURE_MIN_WORDS;
  if (aText && bText) {
    // A BOUND FIRST: Dice can be no larger than twice the smaller count over the total.
    if ((2 * Math.min(a.words, b.words)) / (a.words + b.words) < PAGE_MATCH_MIN) return 0;
    let equal = 0;
    for (let at = 0; at < a.minhash.length; at += 1) if (a.minhash[at] === b.minhash[at]) equal += 1;
    const jaccard = equal / a.minhash.length;
    // DICE FROM JACCARD for the estimate; a margin below the threshold, because the estimate has variance.
    if ((2 * jaccard) / (1 + jaccard) < PAGE_MATCH_MIN - 0.25) return 0;
    return dice(a.sorted, b.sorted);
  }
  if (!aText && !bText) return rasterSimilarity(a.ink, b.ink);
  return 0;
}

/** The side of the grid a picture's ink is measured on. */
const INK_GRID = 32;

/** A raster's ink — 255 less the mean luminance — in each block of an {@link INK_GRID} × {@link INK_GRID} grid. */
function inkOf(raster: CompareRaster): Float64Array {
  const ink = new Float64Array(INK_GRID * INK_GRID);
  for (let row = 0; row < INK_GRID; row += 1) {
    for (let column = 0; column < INK_GRID; column += 1) {
      ink[row * INK_GRID + column] = 255 - blockMean(raster, column, row, INK_GRID);
    }
  }
  return ink;
}

/**
 * Two pictures' similarity, 0 to 1, measured on their INK ({@link inkOf}): twice the ink both share over all the ink
 * either has (Dice again, over darkness). Not a mean difference of luminance, which two mostly white pages win
 * whatever is drawn on them — measured by `pageCompare.test.ts`' scan case, where two different squares on white
 * scored above 0.9. Two blank pages are the same page.
 */
function rasterSimilarity(a: Float64Array | undefined, b: Float64Array | undefined): number {
  if (a === undefined || b === undefined) return 0;
  let shared = 0;
  let total = 0;
  for (let at = 0; at < a.length; at += 1) {
    const inkA = a[at] ?? 0;
    const inkB = b[at] ?? 0;
    shared += Math.min(inkA, inkB);
    total += inkA + inkB;
  }
  return total === 0 ? 1 : (2 * shared) / total;
}

/** The mean luminance of one block of a raster divided into `grid` × `grid` blocks. */
function blockMean(raster: CompareRaster, column: number, row: number, grid: number): number {
  const x0 = Math.floor((column * raster.width) / grid);
  const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * raster.width) / grid));
  const y0 = Math.floor((row * raster.height) / grid);
  const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * raster.height) / grid));
  let sum = 0;
  let count = 0;
  for (let y = y0; y < Math.min(y1, raster.height); y += 1) {
    for (let x = x0; x < Math.min(x1, raster.width); x += 1) {
      sum += raster.luminance[y * raster.width + x] ?? 255;
      count += 1;
    }
  }
  return count === 0 ? 255 : sum / count;
}

/**
 * The correspondence between two documents' pages: matched pairs in order, and the pages only one side has.
 *
 * A dynamic program maximising the total similarity of matched pairs, where a pair may match only at
 * {@link PAGE_MATCH_MIN} or above. So one page inserted in the middle is one `inserted` entry and every page after it
 * still matches its counterpart — the property a comparison by page number does not have. The table is full up to
 * {@link FULL_ALIGNMENT_CELLS}; past it, each row looks {@link ALIGNMENT_BAND} pages beyond the difference in length
 * either side of the diagonal, so a document is never refused for being long.
 */
export function alignPages(a: readonly PageSignature[], b: readonly PageSignature[]): readonly PageAlignment[] {
  const n = a.length;
  const m = b.length;
  const banded = (n + 1) * (m + 1) > FULL_ALIGNMENT_CELLS;
  const reach = ALIGNMENT_BAND + Math.abs(n - m);
  const lo = (i: number): number => (banded ? Math.max(0, Math.floor((i * m) / Math.max(1, n)) - reach) : 0);
  const hi = (i: number): number => (banded ? Math.min(m, Math.ceil((i * m) / Math.max(1, n)) + reach) : m);

  // ROWS STORED FROM THEIR OWN START, so a banded table holds its band and not the whole width.
  const rows: { readonly start: number; readonly score: Float64Array; readonly move: Uint8Array }[] = [];
  const at = (i: number, j: number): number => {
    const row = rows[i];
    if (row === undefined || j < row.start || j >= row.start + row.score.length) return Number.NEGATIVE_INFINITY;
    return row.score[j - row.start] ?? Number.NEGATIVE_INFINITY;
  };
  for (let i = 0; i <= n; i += 1) {
    const start = lo(i);
    const width = hi(i) - start + 1;
    const score = new Float64Array(width);
    // 0 = from the left (a right page inserted), 1 = from above (a left page removed), 2 = matched.
    const move = new Uint8Array(width);
    rows.push({ start, score, move });
    for (let j = start; j <= start + width - 1; j += 1) {
      const k = j - start;
      if (i === 0 && j === 0) continue;
      let best = Number.NEGATIVE_INFINITY;
      let from = 0;
      if (j > 0 && at(i, j - 1) > best) {
        best = at(i, j - 1);
        from = 0;
      }
      if (i > 0 && at(i - 1, j) > best) {
        best = at(i - 1, j);
        from = 1;
      }
      if (i > 0 && j > 0) {
        const left = a[i - 1];
        const right = b[j - 1];
        const shared = left === undefined || right === undefined ? 0 : similarity(left, right);
        if (shared >= PAGE_MATCH_MIN && at(i - 1, j - 1) + shared > best) {
          best = at(i - 1, j - 1) + shared;
          from = 2;
        }
      }
      score[k] = best;
      move[k] = from;
    }
  }

  const steps: PageAlignment[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const row = rows[i];
    const from = row === undefined ? 0 : (row.move[j - row.start] ?? 0);
    if (i > 0 && j > 0 && from === 2) {
      const leftPage = a[i - 1];
      const rightPage = b[j - 1];
      steps.push({
        kind: 'matched',
        left: i - 1,
        right: j - 1,
        similarity: leftPage === undefined || rightPage === undefined ? 0 : similarity(leftPage, rightPage),
      });
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || from === 1)) {
      steps.push({ kind: 'removed', left: i - 1 });
      i -= 1;
    } else {
      steps.push({ kind: 'inserted', right: j - 1 });
      j -= 1;
    }
  }
  return steps.reverse();
}

// ─── one matched pair ────────────────────────────────────────────────────────

/** One difference between a matched pair of pages, boxed on each page it can be seen on. */
export interface PairChange {
  readonly kind: 'text' | 'layout' | 'annotation' | 'graphics';
  /** Where it is on the left page, and on the right; empty where that side has nothing to point at. */
  readonly left: readonly CompareBox[];
  readonly right: readonly CompareBox[];
  /** For text: the words only the left has, and only the right has, each cut to {@link CHANGE_TEXT_LIMIT}. */
  readonly removed?: string;
  readonly inserted?: string;
  /** For an annotation: its kind, and what happened to it. */
  readonly annotation?: { readonly kind: string; readonly what: 'added' | 'removed' | 'changed' };
  /** For layout: whether the page itself changed size rather than something on it moving. */
  readonly pageSize?: boolean;
}

/** How much of a change's words its summary carries. */
export const CHANGE_TEXT_LIMIT = 160;

/** A word with the box it is estimated to occupy. */
interface PlacedWord {
  readonly text: string;
  readonly box: CompareBox;
}

/**
 * A line's words, each boxed by its share of the line's characters — the stated limit of ADR-0131: the kernel reports
 * line boxes, so in a proportional font a word of narrow letters is boxed slightly off.
 */
function placeWords(lines: readonly CompareLine[], indices: readonly number[]): PlacedWord[] {
  const placed: PlacedWord[] = [];
  for (const index of indices) {
    const line = lines[index];
    if (line === undefined) continue;
    const length = Math.max(1, line.text.length);
    const width = line.box.x1 - line.box.x0;
    // THE SEGMENTER'S TOKENS, not a whitespace split: a line of Chinese is one whitespace run, and a one-character
    // edit in it would box the whole line (`wordCount.ts` states the rule).
    for (const token of tokensOf(line.text)) {
      const start = token.index;
      const end = start + token.text.length;
      placed.push({
        text: token.text,
        box: {
          x0: line.box.x0 + (width * start) / length,
          x1: line.box.x0 + (width * end) / length,
          y0: line.box.y0,
          y1: line.box.y1,
        },
      });
    }
  }
  return placed;
}

function moved(a: CompareBox, b: CompareBox): boolean {
  return Math.abs(a.x0 - b.x0) > LAYOUT_MOVE_POINTS || Math.abs(a.y0 - b.y0) > LAYOUT_MOVE_POINTS;
}

function cut(words: readonly PlacedWord[]): string {
  const joined = words.map((word) => word.text).join(' ');
  return joined.length > CHANGE_TEXT_LIMIT ? `${joined.slice(0, CHANGE_TEXT_LIMIT - 1)}…` : joined;
}

/** The text and layout changes of a pair: lines aligned first, then the words of each run of changed lines. */
function textChanges(left: readonly CompareLine[], right: readonly CompareLine[]): PairChange[] {
  const changes: PairChange[] = [];
  const steps = alignSequences(
    left.map((line) => comparableLine(line.text)),
    right.map((line) => comparableLine(line.text)),
  );
  const movedLeft: CompareBox[] = [];
  const movedRight: CompareBox[] = [];
  let removedLines: number[] = [];
  let addedLines: number[] = [];

  const flushLayout = (): void => {
    if (movedLeft.length === 0) return;
    changes.push({ kind: 'layout', left: [...movedLeft], right: [...movedRight] });
    movedLeft.length = 0;
    movedRight.length = 0;
  };
  const flushHunk = (): void => {
    if (removedLines.length === 0 && addedLines.length === 0) return;
    const before = placeWords(left, removedLines);
    const after = placeWords(right, addedLines);
    const words = alignSequences(
      before.map((word) => word.text),
      after.map((word) => word.text),
    );
    const gone: PlacedWord[] = [];
    const come: PlacedWord[] = [];
    for (const step of words) {
      if (step.kind === 'removed') {
        const word = before[step.left];
        if (word !== undefined) gone.push(word);
      } else if (step.kind === 'added') {
        const word = after[step.right];
        if (word !== undefined) come.push(word);
      } else {
        // THE SAME WORD INSIDE AN EDITED RUN: sliding along its line is the edit's own consequence (the words after a
        // shorter replacement move left), so only a move to ANOTHER LINE counts — measured by this file's text case,
        // where every word after "red" moved ten points and was reported as layout.
        const was = before[step.left];
        const is = after[step.right];
        if (was !== undefined && is !== undefined && Math.abs(was.box.y0 - is.box.y0) > LAYOUT_MOVE_POINTS) {
          movedLeft.push(was.box);
          movedRight.push(is.box);
        }
      }
    }
    if (gone.length > 0 || come.length > 0) {
      changes.push({
        kind: 'text',
        // WORD BY WORD (the owner's answer of 2 October, and ADR-0131 Decision 5's *removed tokens are boxed*): one box
        // per changed token, never one across a phrase, so the words a phrase kept between two edits stay unmarked.
        left: gone.map((word) => word.box),
        right: come.map((word) => word.box),
        removed: cut(gone),
        inserted: cut(come),
      });
    }
    removedLines = [];
    addedLines = [];
  };

  for (const step of steps) {
    if (step.kind === 'removed') removedLines.push(step.left);
    else if (step.kind === 'added') addedLines.push(step.right);
    else {
      flushHunk();
      const was = left[step.left];
      const is = right[step.right];
      if (was !== undefined && is !== undefined && moved(was.box, is.box)) {
        movedLeft.push(was.box);
        movedRight.push(is.box);
      } else {
        flushLayout();
      }
    }
  }
  flushHunk();
  flushLayout();
  return changes;
}

function overlap(a: CompareBox, b: CompareBox): number {
  const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (width <= 0 || height <= 0) return 0;
  const shared = width * height;
  const area = (box: CompareBox): number => (box.x1 - box.x0) * (box.y1 - box.y0);
  return shared / (area(a) + area(b) - shared);
}

function sameColour(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, at) => Math.abs(value - (b[at] ?? 0)) <= 0.02);
}

/** The annotation changes of a pair: each left mark matched to a right one of its kind where their rectangles overlap. */
function annotationChanges(left: readonly CompareAnnotation[], right: readonly CompareAnnotation[]): PairChange[] {
  const changes: PairChange[] = [];
  const taken = new Set<number>();
  for (const was of left) {
    let best = -1;
    let bestOverlap = 0;
    for (const [at, is] of right.entries()) {
      if (taken.has(at) || is.kind !== was.kind) continue;
      const shared =
        was.box === null || is.box === null ? (was.box === is.box && was.contents === is.contents ? 1 : 0) : overlap(was.box, is.box);
      if (shared >= ANNOTATION_MATCH_OVERLAP && shared > bestOverlap) {
        best = at;
        bestOverlap = shared;
      }
    }
    const is = right[best];
    if (is === undefined) {
      changes.push({ kind: 'annotation', left: was.box === null ? [] : [was.box], right: [], annotation: { kind: was.kind, what: 'removed' } });
      continue;
    }
    taken.add(best);
    const differs = was.contents !== is.contents || !sameColour(was.colour, is.colour) || bestOverlap < 0.9;
    if (differs) {
      changes.push({
        kind: 'annotation',
        left: was.box === null ? [] : [was.box],
        right: is.box === null ? [] : [is.box],
        annotation: { kind: was.kind, what: 'changed' },
      });
    }
  }
  for (const [at, is] of right.entries()) {
    if (taken.has(at)) continue;
    changes.push({ kind: 'annotation', left: [], right: is.box === null ? [] : [is.box], annotation: { kind: is.kind, what: 'added' } });
  }
  return changes;
}

function touches(a: CompareBox, b: CompareBox, pad: number): boolean {
  return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
}

/**
 * The picture changes of a pair: raster cells that differ and that no text, layout or annotation change explains,
 * joined into rectangles. Both rasters must be drawn at the same pixels per point; the cells cover the area both pages
 * have, so a page that changed size is reported as layout and compared over what it shares.
 */
function graphicsChanges(left: ComparePage, right: ComparePage, explained: readonly CompareBox[]): PairChange[] {
  const a = left.raster;
  const b = right.raster;
  if (a === undefined || b === undefined || Math.abs(a.pixelsPerPoint - b.pixelsPerPoint) > 1e-6) return [];
  const ppp = a.pixelsPerPoint;
  const widthPoints = Math.min(left.size.width, right.size.width);
  const heightPoints = Math.min(left.size.height, right.size.height);
  const columns = Math.ceil(widthPoints / RASTER_CELL_POINTS);
  const rows = Math.ceil(heightPoints / RASTER_CELL_POINTS);
  const marked = new Uint8Array(columns * rows);
  const cellBox = (column: number, row: number): CompareBox => ({
    x0: column * RASTER_CELL_POINTS,
    y0: row * RASTER_CELL_POINTS,
    x1: Math.min(widthPoints, (column + 1) * RASTER_CELL_POINTS),
    y1: Math.min(heightPoints, (row + 1) * RASTER_CELL_POINTS),
  });
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const box = cellBox(column, row);
      if (explained.some((each) => touches(box, each, 2))) continue;
      const x0 = Math.floor(box.x0 * ppp);
      const x1 = Math.min(a.width, b.width, Math.ceil(box.x1 * ppp));
      const y0 = Math.floor(box.y0 * ppp);
      const y1 = Math.min(a.height, b.height, Math.ceil(box.y1 * ppp));
      let total = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          total += Math.abs((a.luminance[y * a.width + x] ?? 255) - (b.luminance[y * b.width + x] ?? 255));
          count += 1;
        }
      }
      if (count > 0 && total / count > RASTER_CELL_DIFFERENCE) marked[row * columns + column] = 1;
    }
  }

  // CONNECTED CELLS ARE ONE CHANGE: a moved picture is two regions, where it was and where it is.
  const changes: PairChange[] = [];
  const seen = new Uint8Array(marked.length);
  for (let start = 0; start < marked.length; start += 1) {
    if (marked[start] !== 1 || seen[start] === 1) continue;
    let box: CompareBox | undefined;
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const cell = queue.pop() ?? 0;
      const column = cell % columns;
      const row = Math.floor(cell / columns);
      const here = cellBox(column, row);
      box = box === undefined ? here : { x0: Math.min(box.x0, here.x0), y0: Math.min(box.y0, here.y0), x1: Math.max(box.x1, here.x1), y1: Math.max(box.y1, here.y1) };
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = column + dx;
        const y = row + dy;
        if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
        const next = y * columns + x;
        if (marked[next] === 1 && seen[next] !== 1) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    if (box !== undefined) changes.push({ kind: 'graphics', left: [box], right: [box] });
  }
  return changes;
}

/** Every difference between two matched pages, top to bottom. */
export function comparePair(left: ComparePage, right: ComparePage): readonly PairChange[] {
  const changes: PairChange[] = [];
  if (Math.abs(left.size.width - right.size.width) > 1 || Math.abs(left.size.height - right.size.height) > 1) {
    changes.push({
      kind: 'layout',
      pageSize: true,
      left: [{ x0: 0, y0: 0, x1: left.size.width, y1: left.size.height }],
      right: [{ x0: 0, y0: 0, x1: right.size.width, y1: right.size.height }],
    });
  }
  const textual = [...textChanges(left.lines, right.lines), ...annotationChanges(left.annotations, right.annotations)];
  changes.push(...textual);
  const explained = textual.flatMap((change) => [...change.left, ...change.right]);
  changes.push(...graphicsChanges(left, right, explained));
  const top = (change: PairChange): number => Math.min(...[...change.left, ...change.right].map((box) => box.y0), Number.POSITIVE_INFINITY);
  return changes.sort((a, b) => (a.pageSize === true ? -1 : b.pageSize === true ? 1 : top(a) - top(b)));
}
