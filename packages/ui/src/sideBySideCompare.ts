import { type ContractClient, MAX_TEXT_LAYER_LINES } from '@monstera/contract';
import {
  type CompareAnnotation,
  type CompareBox,
  type CompareLine,
  type ComparePage,
  type CompareRaster,
  type DocId,
  type DocVersion,
  type PageSignature,
  type PairChange,
  alignPages,
  comparePair,
  needsPicture,
  pdfPoint,
  signPage,
  toViewport,
} from '@monstera/shared';

import { unscaledTransform } from './annotations/annotationSpace.js';

/**
 * How many differences one comparison lists. A document rewritten from end to end differs everywhere, and a list a
 * person cannot read to the end is not a review; the counts above it stay whole.
 */
export const MAX_COMPARE_CHANGES = 1000;

/** A page drawn small for the comparison, with the geometry it was drawn at. */
export interface DrawnPage {
  readonly raster: CompareRaster | undefined;
  /** The page's visible box in PDF user space, as PDF.js reports it (`RasterisedPage.crop`). */
  readonly crop: readonly [number, number, number, number];
  readonly rotation: number;
}

/** One half of Side by Side, as the comparison reads it. */
export interface CompareSide {
  readonly docId: DocId;
  /** The version the half's view shows. A read answered at any other version stops the walk. */
  readonly version: DocVersion;
  readonly pageCount: number;
  /** Draws page `page` (zero-based) small, from this half's own view. */
  readonly draw: (page: number, signal: AbortSignal) => Promise<DrawnPage>;
}

/** One row of the summary list: a change on a matched pair, or a page only one side has. */
export type CompareRow =
  | {
      readonly kind: PairChange['kind'];
      readonly left: number;
      readonly right: number;
      readonly change: PairChange;
    }
  | { readonly kind: 'removed'; readonly left: number; readonly box: CompareBox }
  | { readonly kind: 'inserted'; readonly right: number; readonly box: CompareBox };

/** What a finished comparison found. */
export interface ComparisonResult {
  readonly rows: readonly CompareRow[];
  /** Whether there were more differences than {@link MAX_COMPARE_CHANGES}. */
  readonly more: boolean;
  readonly matched: number;
  readonly inserted: number;
  readonly removed: number;
  /** Pages whose text was longer than one read carries, so their text was compared in part. */
  readonly clipped: number;
}

export type ComparisonOutcome =
  | { readonly kind: 'done'; readonly result: ComparisonResult }
  /** A read was refused: a document is busy, closed, or could not be read. */
  | { readonly kind: 'refused' }
  /** A document changed during the walk, so pages read either side of it describe two documents. */
  | { readonly kind: 'moved' }
  | { readonly kind: 'cancelled' };

/**
 * Side by Side's comparison (ADR-0131): every page of both documents signed, the two sequences aligned by content,
 * then each matched pair compared for text, layout, annotations and pictures.
 *
 * ## Two passes over the pages, and what each holds
 *
 * The first pass reads each page's text and keeps only its signature — hashes, never words — because the alignment
 * needs every page's at once. The second reads the matched pairs again, one pair at a time, with each side's raster
 * drawn small from that half's own view. So at any moment two pages' lines and two rasters are held, plus a signature
 * per page; main holds no text at any point (ADR-0035), and every read is one the text layer and the annotation list
 * already answer.
 *
 * ## A page is drawn in the first pass only when it has too few words to be matched by them
 *
 * A text page's picture plays no part in matching it, so drawing every page twice would pay for rasters the
 * alignment never reads.
 *
 * @param onProgress told how far through the walk it is, out of `total`
 */
export async function compareSides(
  client: ContractClient,
  left: CompareSide,
  right: CompareSide,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<ComparisonOutcome> {
  // READ THROUGH A CALL, for `checkSpellingCommand`'s reason: the signal moves across every await.
  const aborted = (): boolean => signal.aborted;

  const [leftMarks, rightMarks] = await Promise.all([annotationsOf(client, left), annotationsOf(client, right)]);
  if (aborted()) return { kind: 'cancelled' };
  if (leftMarks === 'refused' || rightMarks === 'refused') return { kind: 'refused' };
  if (leftMarks === 'moved' || rightMarks === 'moved') return { kind: 'moved' };

  let done = 0;
  // A FIRST ESTIMATE: both sides signed, and one pair per page of the shorter. Corrected once the alignment is known.
  let total = left.pageCount + right.pageCount + Math.min(left.pageCount, right.pageCount);
  const step = (): void => {
    done += 1;
    onProgress(done, total);
  };

  const signatures: { left: PageSignature[]; right: PageSignature[] } = { left: [], right: [] };
  for (const [side, into] of [
    [left, signatures.left],
    [right, signatures.right],
  ] as const) {
    for (let page = 0; page < side.pageCount; page += 1) {
      if (aborted()) return { kind: 'cancelled' };
      const read = await linesOf(client, side, page);
      if (aborted()) return { kind: 'cancelled' };
      if (read.kind !== 'read') return { kind: read.kind };
      const thumbnail = needsPicture(read.lines) ? (await side.draw(page, signal)).raster : undefined;
      if (aborted()) return { kind: 'cancelled' };
      into.push(signPage(read.lines, thumbnail));
      step();
    }
  }

  const alignment = alignPages(signatures.left, signatures.right);
  const pairs = alignment.filter((entry) => entry.kind === 'matched');
  total = left.pageCount + right.pageCount + alignment.length;
  done = left.pageCount + right.pageCount;
  onProgress(done, total);

  const rows: CompareRow[] = [];
  let more = false;
  let clipped = 0;
  const add = (row: CompareRow): void => {
    if (rows.length < MAX_COMPARE_CHANGES) rows.push(row);
    else more = true;
  };

  for (const entry of alignment) {
    if (aborted()) return { kind: 'cancelled' };
    if (entry.kind === 'removed' || entry.kind === 'inserted') {
      const side = entry.kind === 'removed' ? left : right;
      const page = entry.kind === 'removed' ? entry.left : entry.right;
      const drawn = await side.draw(page, signal);
      if (aborted()) return { kind: 'cancelled' };
      const size = displaySize(drawn);
      const box = { x0: 0, y0: 0, x1: size.width, y1: size.height };
      add(entry.kind === 'removed' ? { kind: 'removed', left: page, box } : { kind: 'inserted', right: page, box });
      step();
      continue;
    }
    const [before, after] = await Promise.all([linesOf(client, left, entry.left), linesOf(client, right, entry.right)]);
    if (aborted()) return { kind: 'cancelled' };
    if (before.kind !== 'read') return { kind: before.kind };
    if (after.kind !== 'read') return { kind: after.kind };
    if (before.truncated || after.truncated) clipped += 1;
    const [leftDrawn, rightDrawn] = await Promise.all([left.draw(entry.left, signal), right.draw(entry.right, signal)]);
    if (aborted()) return { kind: 'cancelled' };
    const changes = comparePair(
      pageOf(before.lines, leftMarks.get(entry.left), leftDrawn),
      pageOf(after.lines, rightMarks.get(entry.right), rightDrawn),
    );
    for (const change of changes) add({ kind: change.kind, left: entry.left, right: entry.right, change });
    step();
  }

  return {
    kind: 'done',
    result: {
      rows,
      more,
      matched: pairs.length,
      inserted: alignment.filter((entry) => entry.kind === 'inserted').length,
      removed: alignment.filter((entry) => entry.kind === 'removed').length,
      clipped,
    },
  };
}

/** An annotation as the list reports it: PDF user space, which is converted once the page's geometry is known. */
interface ListedAnnotation {
  readonly kind: string;
  readonly rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  readonly contents: string;
  readonly colour: readonly number[];
}

async function annotationsOf(
  client: ContractClient,
  side: CompareSide,
): Promise<ReadonlyMap<number, readonly ListedAnnotation[]> | 'refused' | 'moved'> {
  const answer = await client['document.annotations']({ docId: side.docId });
  if (!answer.ok) return 'refused';
  if (answer.value.version !== side.version) return 'moved';
  const byPage = new Map<number, ListedAnnotation[]>();
  for (const each of answer.value.annotations) {
    const list = byPage.get(each.page) ?? [];
    list.push({ kind: each.kind, rect: each.rect, contents: each.contents, colour: each.style.colour });
    byPage.set(each.page, list);
  }
  return byPage;
}

type LinesRead =
  | { readonly kind: 'read'; readonly lines: readonly CompareLine[]; readonly truncated: boolean }
  | { readonly kind: 'refused' }
  | { readonly kind: 'moved' };

async function linesOf(client: ContractClient, side: CompareSide, page: number): Promise<LinesRead> {
  const answer = await client['document.pageTextLayer']({ docId: side.docId, page, limit: MAX_TEXT_LAYER_LINES });
  if (!answer.ok) return { kind: 'refused' };
  // A MOVED VERSION STOPS THE WALK, a refused read refuses it: the second says nothing about how the documents differ.
  if (answer.value.version !== side.version) return { kind: 'moved' };
  return { kind: 'read', lines: answer.value.lines, truncated: answer.value.truncated };
}

/** The page's size in display space at scale 1: the crop box, turned. */
function displaySize(drawn: DrawnPage): { readonly width: number; readonly height: number } {
  const [x0, y0, x1, y1] = drawn.crop;
  const turned = Math.abs(drawn.rotation) % 180 === 90;
  return turned ? { width: y1 - y0, height: x1 - x0 } : { width: x1 - x0, height: y1 - y0 };
}

/**
 * One page as the comparison takes it, every box in display space at scale 1. The annotations arrive in PDF user
 * space and are converted through `annotationSpace.ts`' transform at scale 1 — the one the text layer's boxes are in —
 * so a rotated page's mark lands where its text does.
 */
function pageOf(
  lines: readonly CompareLine[],
  annotations: readonly ListedAnnotation[] | undefined,
  drawn: DrawnPage,
): ComparePage {
  const transform = unscaledTransform({ crop: drawn.crop, rotation: drawn.rotation, zoom: 1 });
  const marks: CompareAnnotation[] = (annotations ?? []).map((each) => {
    if (each.rect === null) return { kind: each.kind, box: null, contents: each.contents, colour: each.colour };
    const a = toViewport(pdfPoint(each.rect.x0, each.rect.y0), transform);
    const b = toViewport(pdfPoint(each.rect.x1, each.rect.y1), transform);
    return {
      kind: each.kind,
      box: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) },
      contents: each.contents,
      colour: each.colour,
    };
  });
  return { size: displaySize(drawn), lines, annotations: marks, raster: drawn.raster };
}
