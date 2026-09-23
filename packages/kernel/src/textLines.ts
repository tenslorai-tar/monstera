/**
 * The editor's visual lines and blocks, grouped from the editing engine's own runs.
 *
 * ## THE ONE INTERFACE
 *
 * [ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)
 * permits a grouping of ours where no engine answers, and
 * [ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)
 * moved its one consumer from a dialog onto the page: **it is permitted only
 * while its output reaches the in-place editor a person answers.** That is the
 * rule, and it is checkable rather than a judgement: *does this grouping's
 * output reach any consumer other than the in-place editor?* A second caller is
 * the moment it has become the second extraction path Part E2 bans, and this
 * file's header is where the next reader meets that.
 *
 * So nothing here is exported to the renderer's text layer, to search, to
 * extraction or to export. Those read MuPDF's structured text through
 * `textStructure.ts`, which owns the engine's options and implements no
 * clustering ([ADR-0034](../../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)),
 * and the two answers are never mixed on one surface.
 *
 * ## Why a grouping of ours exists at all, which is measured
 *
 * `scripts/research/pdfiumLines.mjs`, PDFium 155.0.8044.0, 2026-09-09:
 * `FPDFText_CountRects` answers **4 rects for four runs** whether the two
 * sharing a baseline sit 170pt apart or 3pt apart. PDFium's rects are per-RUN,
 * so there is no engine answer for a substrate to own options over — ADR-0034's
 * route 1 has nothing behind it, and this takes its route 2.
 *
 * The reading engine's lines are not available either, and that is refused on
 * evidence rather than on principle: `proof:lineagreement` scored **52.9%** of
 * our lines verbatim among an independent reader's, so a join between MuPDF's
 * lines and PDFium's objects would name the wrong run about half the time.
 *
 * ## Relations, and no constant
 *
 * Two runs are on one line when their vertical extents **overlap**. A line is
 * split where the gap between two of its runs is **wider than the line is
 * tall**, and consecutive pieces join one block when they overlap horizontally
 * and the gap between them is **smaller than the shorter one's height**. Each is
 * a comparison against a quantity the text already carries, so Part E2's
 * *"constants change only with a corpus score in the commit message"* has
 * nothing here to govern — which is the same property ADR-0034 chose when it
 * took options over an algorithm.
 *
 * Exact equality was tried first for lines and rejected on a measurement: two
 * runs drawn on one baseline in one font came back with tops of **237.9 and
 * 238.0**, so equality splits the very case the grouping exists for.
 */

/** One text run as the line grouping needs it. `pdfiumFfi.ts`'s `TextRun`, structurally. */
export interface GroupableRun {
  readonly index: number;
  readonly text: string;
  readonly bottom: number;
  readonly top: number;
}

/**
 * One visual line: the runs it is made of, in reading order.
 *
 * ## NOT `TextLine`, and the collision is the reason
 *
 * `textStructure.ts` already exports a `TextLine`: MuPDF's structured text, the
 * reading engine's own lines, which feed the renderer's text layer, search and
 * extraction. This is PDFium's runs grouped by the editor for an edit, and the
 * two are different readings of the same page — `proof:lineagreement` scored
 * **52.9%** of ours verbatim among an independent reader's.
 *
 * One name for both would put that 52.9% inside a type, where a caller holding
 * either would compile. The name says which reading it is, and the collision
 * that forced it is a better guard than a comment saying not to mix them.
 */
export interface EditableLine {
  /**
   * The runs this line covers, in the order their text appears.
   *
   * ## The RUNS and not a concatenated string, which is a decision
   *
   * A line arriving as one string reads better and cannot be edited back: a run
   * is a text object with its own font, an edit names objects, and something
   * would have to work out which characters of the string belonged to which
   * object. `lineText` in `@monstera/shared` derives the string where it is
   * shown, and `replacementsForLine` beside it turns an edit back into runs.
   *
   * The index is the engine's own numbering, unconverted — the whole of
   * ADR-0049's first decision is that no other index space reaches it.
   */
  readonly runs: readonly { readonly index: number; readonly text: string }[];
}

/**
 * Groups runs into visual lines.
 *
 * ## The order within a line is the RUNS' order, not a sort by position
 *
 * `textRuns` walks PDFium's text page, which is reading order — the order the
 * characters come back in — so the runs arrive already ordered and this
 * preserves it. Sorting by horizontal position here would be a second opinion
 * about reading order, held by the module least equipped to have one: it would
 * read right-to-left scripts backwards, and it would disagree with the text the
 * user is shown, which comes from the same walk.
 *
 * ## A run joins the line it overlaps, and the FIRST such line
 *
 * Runs are considered in order and each joins the first open line whose extent
 * it overlaps, extending that line's extent. Two lines that were separate and
 * are bridged by a third run stay separate — the bridging run joins the first —
 * and that is the conservative direction: a person sees the runs a line claims,
 * where a merge would offer them a line they never saw.
 *
 * @param runs the page's text runs, in reading order
 */
export function groupIntoLines(runs: readonly GroupableRun[]): readonly EditableLine[] {
  return overlapLines(runs).map((line) => ({
    runs: line.runs.map((run) => ({ index: run.index, text: run.text })),
  }));
}

/** Lines under construction, each carrying the extent it has grown to. */
function overlapLines<T extends GroupableRun>(
  runs: readonly T[],
): { runs: T[]; bottom: number; top: number }[] {
  const open: { runs: T[]; bottom: number; top: number }[] = [];
  for (const run of runs) {
    // OVERLAP IS `bottom < other.top && top > other.bottom`, strictly — two runs
    // that merely touch at an edge are on two lines. A `<=` here would join the
    // descender of one line to the ascender of the next on tightly set text,
    // which is the failure mode the conservative direction exists to avoid.
    const line = open.find((held) => run.bottom < held.top && run.top > held.bottom);
    if (line === undefined) {
      open.push({ runs: [run], bottom: run.bottom, top: run.top });
      continue;
    }
    line.runs.push(run);
    line.bottom = Math.min(line.bottom, run.bottom);
    line.top = Math.max(line.top, run.top);
  }
  return open;
}

/** A box in PDF user space: left, bottom, right, top. */
export interface BlockBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A run as the block grouping needs it: the line grouping's fields and a horizontal extent. */
export interface BlockableRun<S> extends GroupableRun {
  readonly left: number;
  readonly right: number;
  /** How the run is set. Carried through to the block, never read here. */
  readonly style: S;
}

/**
 * One editable block: the lines a person edits as one piece of text, and where
 * they are.
 *
 * The boxes leave the kernel to PLACE the editor and draw the outline, and for
 * nothing else (ADR-0096 Decision 3): no renderer code decides anything from
 * them.
 */
export interface EditableBlock<S> {
  readonly box: BlockBox;
  readonly lines: readonly (EditableLine & { readonly box: BlockBox })[];
  /** How the block's first run is set — what the editor over it is set in. */
  readonly style: S;
}

interface Piece<S> {
  runs: BlockableRun<S>[];
  /** Where the piece came in reading order, which is the order blocks are answered in. */
  readonly order: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/**
 * Groups runs into the blocks a person edits in place.
 *
 * ## Three steps, each a relation
 *
 * 1. **Lines**, by {@link groupIntoLines}' overlap, unchanged.
 * 2. **Pieces**: a line is split where the horizontal gap between the piece so
 *    far and its next run is wider than the line is tall. PDFium puts one line
 *    across a whole page when two columns share a baseline — overlap is all it
 *    asks — and a block drawn across both columns would be edited as one string
 *    that is not on the page. A word gap is a fraction of the line's height; a
 *    tab stop, a column gutter and the gap after a bullet are more than it.
 * 3. **Blocks**: a piece joins a block whose last piece is directly above it —
 *    the two overlap horizontally, and the gap between them is smaller than the
 *    shorter one's height. A paragraph's lines are closer than a line is tall;
 *    the space between paragraphs, and between a heading and what follows it
 *    across a rule, is usually not.
 *
 * **These are choices, and they are on screen**: every block is outlined
 * before anything is edited, so a person sees the grouping before it writes
 * anything, which is ADR-0049's condition on the page.
 *
 * @param runs the page's text runs, in reading order
 */
export function groupIntoBlocks<S>(runs: readonly BlockableRun<S>[]): readonly EditableBlock<S>[] {
  const pieces: Piece<S>[] = [];
  for (const line of overlapLines(runs)) {
    const height = line.top - line.bottom;
    let piece: Piece<S> | undefined;
    for (const run of line.runs) {
      const gap =
        piece === undefined ? 0 : Math.max(0, run.left - piece.right, piece.left - run.right);
      if (piece === undefined || gap > height) {
        piece = {
          runs: [run],
          order: pieces.length,
          left: run.left,
          right: run.right,
          bottom: run.bottom,
          top: run.top,
        };
        pieces.push(piece);
        continue;
      }
      piece.runs.push(run);
      piece.left = Math.min(piece.left, run.left);
      piece.right = Math.max(piece.right, run.right);
      piece.bottom = Math.min(piece.bottom, run.bottom);
      piece.top = Math.max(piece.top, run.top);
    }
  }

  // TOP TO BOTTOM, not reading order, for the BLOCK pass only. A block's lines
  // are top to bottom by what a block is, and reading order is the content
  // stream's: measured 2026-09-23 in the running build, a line a block edit
  // wrapped into was made as a new object at the END of the page's content, so
  // in reading order it came after the paragraph's last line and joined the
  // block above it — splitting the paragraph it belongs to. Runs within a LINE
  // keep reading order (`overlapLines`), which is where right-to-left text lives.
  pieces.sort((a, b) => b.top - a.top || a.left - b.left);

  const blocks: Piece<S>[][] = [];
  for (const piece of pieces) {
    const height = piece.top - piece.bottom;
    const block = blocks.find((held) => {
      const above = held[held.length - 1];
      if (above === undefined) return false;
      const overlaps = piece.left < above.right && piece.right > above.left;
      const gap = above.bottom - piece.top;
      return overlaps && piece.top < above.top && gap < Math.min(height, above.top - above.bottom);
    });
    if (block === undefined) blocks.push([piece]);
    else block.push(piece);
  }

  // THE BLOCKS IN READING ORDER — the order a person Tabs through them — by the
  // earliest piece each holds. Only the lines INSIDE a block are top to bottom.
  const earliest = (block: readonly Piece<S>[]): number => Math.min(...block.map((piece) => piece.order));
  blocks.sort((a, b) => earliest(a) - earliest(b));

  return blocks.flatMap((block) => {
    const [first] = block;
    const [firstRun] = first?.runs ?? [];
    if (first === undefined || firstRun === undefined) return [];
    return [
      {
        box: {
          x0: Math.min(...block.map((piece) => piece.left)),
          y0: Math.min(...block.map((piece) => piece.bottom)),
          x1: Math.max(...block.map((piece) => piece.right)),
          y1: Math.max(...block.map((piece) => piece.top)),
        },
        lines: block.map((piece) => ({
          runs: piece.runs.map((run) => ({ index: run.index, text: run.text })),
          box: { x0: piece.left, y0: piece.bottom, x1: piece.right, y1: piece.top },
        })),
        style: firstRun.style,
      },
    ];
  });
}
