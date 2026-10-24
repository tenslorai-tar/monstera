/**
 * The editor's visual lines and blocks, grouped from the editing engine's own runs.
 *
 * ## THE ONE INTERFACE
 *
 * [ADR-0049](../../../docs/DECISIONS/0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md)
 * permits a grouping of ours where no engine answers, and
 * [ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)
 * moved its one consumer from a dialog onto the page: **it is permitted only
 * while its output reaches the in-place editor a person answers — or, since
 * [ADR-0097](../../../docs/DECISIONS/0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md),
 * a translation written back into the very blocks it was read from.** That is
 * the rule, and it is checkable rather than a judgement: *does this grouping's
 * output reach any consumer other than those two?* A third caller is the moment
 * it has become the second extraction path Part E2 bans, and this file's header
 * is where the next reader meets that.
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

import { MAX_PUSHED_BLOCKS } from '@monstera/contract/host';

import { blockShape } from '@monstera/shared';

/** How a text object's matrix sets it (`orientationOf`, `pdfiumFfi.ts`): `upright` is the only one an editor is placed along. */
export type Orientation = 'upright' | 'turned' | 'vertical' | 'slanted' | 'mirrored';

/**
 * Whether text set like this is edited in place: straight text only, since an editor cannot be placed along an axis the
 * page is not set on ([ADR-0181](../../../docs/DECISIONS/0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md)
 * Decision 7). The ONE spelling of that test (B3a): the composition leaves other text out of the blocks, the join does
 * not join it, and the proofs that group runs ask the same question, so a kind added to {@link Orientation} is decided
 * here and nowhere else.
 */
export function isEditedInPlace(style: { readonly orientation: Orientation }): boolean {
  return style.orientation === 'upright';
}

/**
 * A line's baseline: ITS FIRST RUN'S, the one spelling of that rule (B3a). The writer lays a block's lines out from it and
 * keeps each object's offset from it (`pdfiumFfi.ts`), and the editor draws each run at that offset ({@link risesOf}),
 * so what is drawn while a block is open and what is written are one rule's answer. `undefined` for an empty line.
 */
export function lineBaselineOf<R>(line: readonly R[], baselineOf: (run: R) => number): number | undefined {
  const first = line[0];
  return first === undefined ? undefined : baselineOf(first);
}

/**
 * Each run's rise above its line's baseline ({@link lineBaselineOf}), in points: 0 for a run on the line, positive for a
 * superscript, negative for a subscript.
 */
export function risesOf<R>(line: readonly R[], baselineOf: (run: R) => number): number[] {
  const base = lineBaselineOf(line, baselineOf) ?? 0;
  return line.map((run) => baselineOf(run) - base);
}

/**
 * `blocks` with each run's style made by `runStyle` from its own and its rise ({@link risesOf}), and each block's by
 * `blockStyle`: where a style that carries a baseline becomes one that carries what an editor draws by, which is the
 * offset from the line and never the page's coordinate.
 */
export function withRises<S extends { readonly baseline: number }, T>(
  blocks: readonly EditableBlock<S>[],
  runStyle: (style: S, rise: number) => T,
  blockStyle: (style: S) => T,
): RisenBlock<T>[] {
  return blocks.map((block) => ({
    ...block,
    style: blockStyle(block.style),
    lines: block.lines.map((line) => {
      const rises = risesOf(line.runs, (run) => run.style.baseline);
      return {
        ...line,
        // THE LINE'S BASELINE, by the writer's own rule, in the space its box is in: where the editor puts its own
        // first baseline, and the distance between two lines' baselines is the spacing it sets (the owner's A5 and A7:
        // an editor placed at the ink's top with spacing read from the ink's tops sat lower and grew taller than the page).
        baseline: lineBaselineOf(line.runs, (run) => run.style.baseline) ?? line.box.y0,
        runs: line.runs.map((run, at) => ({ ...run, style: runStyle(run.style, rises[at] ?? 0) })),
      };
    }),
  }));
}

/** A block as it crosses to the editor: its runs' styles carry their rises, and each line its baseline. */
export interface RisenBlock<S> extends Omit<EditableBlock<S>, 'lines'> {
  readonly lines: readonly (EditableBlock<S>['lines'][number] & { readonly baseline: number })[];
}

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
export interface BlockableRun<S> extends LineableRun {
  /** How the run is set. Carried through to the block, never read here. */
  readonly style: S;
  /** The run's font, size and fill as one comparable key — {@link settingOf}'s, and read here only for equality. */
  readonly setting: string;
  /** The size the run is drawn at, in points: what a gap beside it is measured in ({@link piecesOf}). */
  readonly size: number;
  /**
   * The width of the measure an edit set the run's lines to, from its block's left edge, where one is recorded
   * (ADR-0097's correction of 2026-10-17): its block is at least that wide.
   */
  readonly measure?: number | undefined;
  /**
   * Whether the run is set in a fixed-pitch face — the read's own `mono`, passed by the caller since `style` is never
   * read here. A line of such runs keeps its break ({@link softEnds}).
   */
  readonly fixedPitch?: boolean | undefined;
}

/**
 * A run's SETTING as one key: which font, the size it is drawn at, and the colour it is filled with. Two runs set
 * alike have equal keys, and a block never continues across a change of key (`groupIntoBlocks`, step 3).
 *
 * The size to a hundredth of a point: the glyphs of one line come back with sizes equal to the last digit, and a
 * hundredth is far below any two sizes a designer sets apart.
 */
export function settingOf(style: {
  readonly font: string;
  readonly size: number;
  readonly colour: { readonly r: number; readonly g: number; readonly b: number };
}): string {
  const { r, g, b } = style.colour;
  return `${style.font}|${style.size.toFixed(2)}|${String(r)},${String(g)},${String(b)}`;
}

/**
 * A run with what the block grouping reads of how it is set — its {@link settingOf} key and the size it is drawn at — taken
 * from its style in one place, so no caller derives the two apart.
 */
export function blockableOf<R extends { readonly style: Parameters<typeof settingOf>[0] }>(
  run: R,
): R & { readonly setting: string; readonly size: number } {
  return { ...run, setting: settingOf(run.style), size: run.style.size };
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
  /** Each line's runs with how EACH is set, which the editor draws them in (ADR-0145), and the line's box. */
  readonly lines: readonly {
    readonly runs: readonly { readonly index: number; readonly text: string; readonly style: S }[];
    readonly box: BlockBox;
    /** Whether the line ENDS in a soft wrap ({@link softEnds}); never the block's last line. */
    readonly soft: boolean;
  }[];
  /** How the block's first line's longest run is set — what the editor over it is set in. */
  readonly style: S;
  /** How the block is set, for the editor to draw (ADR-0179 Decision 5). */
  readonly shape: { readonly align: 'left' | 'center' | 'right'; readonly firstIndent: number };
}

/** A run as the pieces of a line need it: its place on the page. */
export interface LineableRun extends GroupableRun {
  readonly left: number;
  readonly right: number;
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
 * The pieces of a page's runs: each line split where the gap between the piece so far and the next run is wider than an
 * em of the smaller of the two neighbours' type (step 2 of {@link groupIntoBlocks}), in the order the runs came. The ONE place a piece is decided, which
 * the block grouping and the line reading (`readInLineOrder`, in `bidiLine.ts`, which takes the bidirectional algorithm
 * this module must not load into `main`) both take (B3a): two readings of which runs are one line would put a run's words
 * in one and its place in the other.
 *
 * @param sizeOf the size a run is drawn at, in points
 */
export function piecesOf<T extends LineableRun>(
  runs: readonly T[],
  sizeOf: (run: T) => number,
): { runs: T[]; order: number; left: number; right: number; bottom: number; top: number }[] {
  const pieces: { runs: T[]; order: number; left: number; right: number; bottom: number; top: number }[] = [];
  for (const line of overlapLines(runs)) {
    let piece: (typeof pieces)[number] | undefined;
    // SWEPT LEFT TO RIGHT, whatever order the runs came in: a gap is between two neighbours, and a line read in the order
    // it was typed visits a right-to-left phrase before the words beside it, which a sweep in that order measures from
    // the wrong side. The runs of a piece keep the order they came in.
    const given = new Map(line.runs.map((run, at) => [run, at] as const));
    const swept = [...line.runs].sort((a, b) => a.left - b.left || (given.get(a) ?? 0) - (given.get(b) ?? 0));
    const first = pieces.length;
    // THE SIZE OF THE RUN AT THE PIECE'S RIGHT, the one the next gap is beside.
    let edge = 0;
    for (const run of swept) {
      // A SIZE THAT IS NOT A NUMBER IS REFUSED, never compared: every comparison with it is false, so a gap would never
      // be wider than it and every line would be one piece, columns and all. A typed caller cannot leave it out; a script
      // that builds the runs by hand can, and the grouping it is proving would then pass while grouping nothing apart.
      if (!Number.isFinite(sizeOf(run))) throw new TypeError(`a run's size must be a number of points, not ${String(sizeOf(run))}`);
      const gap =
        piece === undefined ? 0 : Math.max(0, run.left - piece.right, piece.left - run.right);
      // A WORD SPACE IS SET IN THE TYPE AROUND IT, so the gap is measured in an em of the SMALLER neighbour's type, never
      // against the line's height. The line is every run that overlaps, so its height grows with what says the runs are
      // apart: two columns whose baselines are offset, and a large figure beside small text. Measured 2026-10-24 in the
      // owner's document 11: a 13.71 pt gutter between 12 pt columns whose baselines are 3.81 pt apart, against a line
      // 14.84 pt tall; a 40 pt figure and a 14 pt caption 14.29 and 12.61 pt from an 11.5 pt list. Each was joined, and an
      // edit of one column's paragraph rewrote a line of the other. Across the corpus every other joined gap is at most
      // 0.94 em, and the widest space this application justifies to is a space and JUSTIFY_CAP's 0.6 em (`markFigures.ts`),
      // under an em; those gutters are 1.1 to 1.57.
      if (piece === undefined || gap > Math.min(edge, sizeOf(run))) {
        edge = sizeOf(run);
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
      if (run.right >= piece.right) edge = sizeOf(run);
      piece.left = Math.min(piece.left, run.left);
      piece.right = Math.max(piece.right, run.right);
      piece.bottom = Math.min(piece.bottom, run.bottom);
      piece.top = Math.max(piece.top, run.top);
    }
    // THE PIECES KEEP THE ORDER THEIR FIRST RUN CAME IN, which is the order a person Tabs through them, and each keeps its
    // runs in the order they came.
    const at = (run: T): number => given.get(run) ?? 0;
    const made = pieces.splice(first);
    for (const each of made) each.runs.sort((a, b) => at(a) - at(b));
    const firstAt = (each: { runs: T[] }): number => {
      const [head] = each.runs;
      return head === undefined ? 0 : at(head);
    };
    made.sort((a, b) => firstAt(a) - firstAt(b));
    made.forEach((each, rank) => {
      each.order = first + rank;
    });
    pieces.push(...made);
  }
  return pieces;
}

/**
 * A piece's setting: its LONGEST run's, by characters that are not spaces. A line of a paragraph with a bold word in it
 * is set in the paragraph's face, and a list entry whose lead words are bold is set in the face of the rest of it — so
 * a word set apart inside a line never breaks the block it is in, and a line set apart as a whole does.
 */
function settingOfPiece<S>(piece: Piece<S>): string {
  return longestRun(piece)?.setting ?? '';
}

/** A piece's longest run by characters that are not spaces — the first of equals — or `undefined` for no runs. */
function longestRun<S>(piece: Piece<S>): BlockableRun<S> | undefined {
  let longest: BlockableRun<S> | undefined;
  let most = -1;
  for (const run of piece.runs) {
    const length = run.text.replace(/\s/gu, '').length;
    if (length > most) {
      most = length;
      longest = run;
    }
  }
  return longest;
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
 *    the two overlap horizontally, the gap between them is smaller than the
 *    shorter one's height, and the two are SET ALIKE: the same font, size and
 *    colour ({@link settingOf}, by each piece's longest run). A paragraph's lines
 *    are closer than a line is tall; the space between paragraphs is usually not.
 *    A heading set tight over its text is not either, and the gap alone joined
 *    them: measured 2026-10-02 in the owner's document, a 13 pt bold blue heading
 *    7.99 pt above 9.2 pt grey list lines whose height is 8.47 became one block of
 *    fourteen lines, whose editor took the heading's style — 1.42 times too large,
 *    bold and blue over the list. A change of setting ends a block whatever the gap.
 *
 * **These are choices, and they are on screen**: every block is outlined
 * before anything is edited, so a person sees the grouping before it writes
 * anything, which is ADR-0049's condition on the page.
 *
 * @param runs the page's text runs, in reading order
 */
export function groupIntoBlocks<S>(runs: readonly BlockableRun<S>[]): readonly EditableBlock<S>[] {
  const pieces = piecesOf(runs, (run) => run.size);

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
    const setting = settingOfPiece(piece);
    const block = blocks.find((held) => {
      const above = held[held.length - 1];
      if (above === undefined) return false;
      const overlaps = piece.left < above.right && piece.right > above.left;
      const gap = above.bottom - piece.top;
      return (
        overlaps &&
        piece.top < above.top &&
        gap < Math.min(height, above.top - above.bottom) &&
        settingOfPiece(above) === setting
      );
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
    // THE STYLE OF THE RUN THE BLOCK WAS GROUPED BY, its first piece's longest — every piece of the block is set alike
    // by that same reading. Its first run was a list entry's bold lead word.
    const setBy = first === undefined ? undefined : longestRun(first);
    if (first === undefined || setBy === undefined) return [];
    const x0 = Math.min(...block.map((piece) => piece.left));
    const inkRight = Math.max(...block.map((piece) => piece.right));
    // AT LEAST AS WIDE AS THE MEASURE ITS LINES WERE SET TO (ADR-0097's correction of 2026-10-17): the paragraph keeps
    // the width it had on the page, so the editor wraps at it whatever font the words are now drawn in.
    const measure = Math.max(0, ...block.flatMap((piece) => piece.runs.map((run) => run.measure ?? 0)));
    const box = {
      x0,
      y0: Math.min(...block.map((piece) => piece.bottom)),
      x1: Math.max(inkRight, measure > 0 ? x0 + measure : inkRight),
      y1: Math.max(...block.map((piece) => piece.top)),
    };
    const texts = block.map((piece) => piece.runs.map((run) => run.text).join(''));
    // SOFT ENDS ARE JUDGED AGAINST THE INK, as before the measure was kept: a line the plan broke early on purpose (a tab
    // is counted a whole stop wide, ADR-0228 Decision 2) has room left before the measure, and judged against the measure
    // its wrap read as a paragraph's end (measured 2026-10-17, `proof:pdfiumcommand`'s second edit of a tabbed line).
    const soft = softEnds(
      block.map((piece, at) => ({
        text: texts[at] ?? '',
        box: { x0: piece.left, x1: piece.right },
        fixedPitch: piece.runs.every((run) => run.fixedPitch === true),
      })),
      inkRight,
    );
    const { align, firstIndent } = blockShape(
      block.map((piece, at) => ({ x0: piece.left, x1: piece.right, characters: (texts[at] ?? '').length })),
      soft,
    );
    return [
      {
        box,
        lines: block.map((piece, at) => ({
          runs: piece.runs.map((run) => ({ index: run.index, text: run.text, style: run.style })),
          box: { x0: piece.left, y0: piece.bottom, x1: piece.right, y1: piece.top },
          soft: soft[at] === true,
        })),
        style: setBy.style,
        shape: { align, firstIndent },
      },
    ];
  });
}

/** What a block pushes when it grows: the blocks below it in its column, and how far they may go. */
export interface PushedColumn {
  /** The blocks it pushes, by their place in the page's blocks, in that order. Empty for a footer and a block with nothing below. */
  readonly below: readonly number[];
  /** How far down, in points, the lowest of {@link below} may go before it reaches the footer or the bottom margin. */
  readonly room: number;
}

/**
 * What each block of a page pushes when it grows
 * ([ADR-0249](../../../docs/DECISIONS/0249-a-paragraph-that-grows-pushes-the-text-below-it-down.md) Decision 2): the one
 * answer to *which text is below a block, in its column*, decided here beside the grouping, which is the one place `main`
 * decides anything about a page's text (ADR-0096 Decision 2).
 *
 * ## The column is ADR-0096's own relation, closed
 *
 * A block is below another when the two overlap horizontally and its top is lower — `groupIntoBlocks`' two comparisons.
 * The set is CLOSED under that relation: a block below one that is pushed is pushed too, so text moved down never lands on
 * text that stayed. The owner's wording, *overlaps the edited block's extent*, is its first step.
 *
 * ## The margins are the page's own, and no number is in them
 *
 * The bottom margin mirrors the top one: as far up from the page box's bottom as the page's highest text sits down from
 * its top. A block lying wholly inside it is the footer, which never moves; the room ends at the footer's top, or at the
 * margin where there is no footer (the owner's locked decision 3).
 *
 * @param page the page box the boxes are measured in
 */
export function pushesOf(boxes: readonly BlockBox[], page: BlockBox): readonly PushedColumn[] {
  if (boxes.length === 0) return [];
  const highest = Math.max(...boxes.map((box) => box.y1));
  const margin = page.y0 + Math.max(0, page.y1 - highest);
  const footer = boxes.map((box) => box.y1 <= margin);
  const footerTops = boxes.filter((_, at) => footer[at] === true).map((box) => box.y1);
  const limit = footerTops.length === 0 ? margin : Math.max(...footerTops);
  // ONE SWEEP DOWN THE PAGE PER BLOCK, never a worklist over every pair. The relation only ever reaches a STRICTLY lower
  // top, so visiting the blocks from the highest top down decides every block a candidate could be reached from before
  // the candidate itself. And what is reached is ONE INTERVAL: each block reached overlaps one reached before it, so their
  // extents chain from this block's into one, and a candidate overlaps a reached block exactly when it overlaps that
  // interval. The worklist this replaces was cubic in the blocks, and ran in `main` on every page read for editing: a
  // stacked column of 515 took about 2 s a call (`textLines.test.ts`' MAX_PUSHED_BLOCKS case, 2026-10-18). This is
  // quadratic, and the same sets (proven against that worklist in the same file).
  const downward = [...boxes.keys()]
    .filter((at) => footer[at] !== true)
    .sort((a, b) => (boxes[b]?.y1 ?? 0) - (boxes[a]?.y1 ?? 0));
  return boxes.map((box, at): PushedColumn => {
    if (footer[at] === true) return { below: [], room: 0 };
    let left = box.x0;
    let right = box.x1;
    const pushed: number[] = [];
    let row = downward.findIndex((other) => (boxes[other]?.y1 ?? 0) < box.y1);
    if (row === -1) row = downward.length;
    // A ROW OF EQUAL TOPS IS DECIDED AGAINST WHAT IS ABOVE IT ONLY, then widens the interval: none of it reaches another.
    while (row < downward.length) {
      const top = boxes[downward[row] ?? 0]?.y1;
      let rowLeft = left;
      let rowRight = right;
      for (; row < downward.length && boxes[downward[row] ?? 0]?.y1 === top; row += 1) {
        const other = downward[row] ?? 0;
        const candidate = boxes[other];
        if (candidate !== undefined && candidate.x0 < right && left < candidate.x1) {
          pushed.push(other);
          rowLeft = Math.min(rowLeft, candidate.x0);
          rowRight = Math.max(rowRight, candidate.x1);
        }
      }
      left = rowLeft;
      right = rowRight;
    }
    const below = pushed.sort((a, b) => a - b);
    const lowest = Math.min(...below.map((other) => boxes[other]?.y0 ?? Number.POSITIVE_INFINITY));
    // MORE BLOCKS BELOW THAN ONE EDIT MAY CARRY have no room: the editor then says so rather than send an edit the
    // contract refuses (`MAX_PUSHED_BLOCKS`).
    const carried = below.length <= MAX_PUSHED_BLOCKS;
    return { below, room: below.length === 0 || !carried ? 0 : Math.max(0, lowest - limit) };
  });
}

/** What a block pushes where it pushes nothing. */
const PUSHES_NOTHING: PushedColumn = { below: [], room: 0 };

/**
 * What each block of a page's READ pushes: {@link pushesOf} over the page box the runs were read in, and nothing where
 * the read cannot answer it. A page with no box has no margins to measure the room against. A page the engine's walk
 * stopped part-way through (`truncated`) has blocks below a block that are only the runs it read, and moving those would
 * leave the rest where they stood, so the text would part (the text walk's L6, 2026-10-17: a heading over 39,200 runs).
 */
export function pushesOfPage(
  boxes: readonly BlockBox[],
  read: { readonly box: BlockBox | null; readonly truncated: boolean },
): readonly PushedColumn[] {
  if (read.box === null || read.truncated) return boxes.map(() => PUSHES_NOTHING);
  return pushesOf(boxes, read.box);
}

/**
 * What a line that begins a list entry starts with: a bullet of the kinds word processors and browsers draw, or a number
 * or a letter closed by a full stop or a bracket, then white space. The ONE statement of it in the reading.
 */
export const LIST_ENTRY = /^(?:[•◦▪▫‣⁃●○■□–—*-]|\(?(?:\d{1,3}|[a-z])[.)])\s/u;

/**
 * Whether each line of a block ENDS in a soft wrap, by the typesetter's own test and no constant: a line was soft-wrapped
 * when **the next line's first word would not have fitted at its end**, which is the only reason a typesetter breaks a
 * line inside a paragraph ([ADR-0097](../../../docs/DECISIONS/0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md)
 * 4c). The first word's width is the next line's width in proportion to its characters, a space included. A line that
 * ends short of where that word would have reached (an address line, a list entry, a paragraph's last line) was broken on
 * purpose, and its break is kept.
 *
 * The ONE place a soft end is decided: the reading `document.textBlocks` answers is built from it, the translation and
 * the editor take their paragraphs from that reading, and a block's writer takes it from the wire rather than deciding
 * again ([ADR-0179](../../../docs/DECISIONS/0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md)
 * Decision 2). The last line ends nothing, so it is never soft.
 *
 * ## A full line is not always a wrapped one
 *
 * Lines of similar length each long enough that the next one's first word would not fit pass the test above whether
 * or not they were wrapped: four sentences, one to a line, and a block of code, read as one paragraph each, and a font
 * change that reflowed them joined them (the owner's A4, measured 2026-10-14). So two signs that a break was made ON
 * PURPOSE keep it, whatever the width says:
 *
 * - the line ENDS A SENTENCE (`.`, `!`, `?`, `:`) and the next begins with a capital or a digit;
 * - the next line starts INDENTED past this one by more than a character, and not by the even amount on both sides a
 *   shorter centred line has;
 * - both lines are set in a FIXED-PITCH face. A monospaced face is how code, a terminal's output and preformatted text
 *   are set, where every line ends where its writer ended it. Measured 2026-10-24 on four Courier commands one to a line,
 *   read by PDFium and grouped here: the first, the block's widest, read as soft because the next line's first word
 *   (`#`) would not have fitted after it, so the editor drew the two commands as one line and an edit would have written
 *   them so. Prose set in a typewriter face keeps its line breaks too, which is the principle's cost again;
 * - the next line BEGINS A LIST ENTRY ({@link LIST_ENTRY}): a bullet or a number, then a space. Measured the same day on
 *   two entries of a bulleted list, each a bold lead-in and a raised reference: the first ended near the block's right
 *   edge and read as wrapping into the second, so typing in one entry would have joined the two.
 *
 * A wrap that happens to fall at a sentence's end is then kept as a break, which costs a ragged line if words are added
 * before it; reading two sentences as one costs the person's line breaks. Of the two, the one that keeps what the page
 * said is chosen (the owner's principle: preserve, never drop).
 *
 * @param lines the block's lines, top to bottom, each its text and its box
 * @param right the block's right edge
 */
export function softEnds(
  lines: readonly {
    readonly text: string;
    readonly box: { readonly x0: number; readonly x1: number };
    readonly fixedPitch?: boolean;
  }[],
  right: number,
): boolean[] {
  return lines.map((line, at) => {
    const next = lines[at + 1];
    if (next === undefined) return false;
    if (line.fixedPitch === true && next.fixedPitch === true) return false;
    if (LIST_ENTRY.test(next.text.trimStart())) return false;
    const nextText = next.text.trimStart();
    const firstWord = nextText.split(/\s/u)[0] ?? '';
    const perCharacter = nextText.length === 0 ? 0 : (next.box.x1 - next.box.x0) / nextText.length;
    if (/[.!?:]["'’”)\]]*$/u.test(line.text.trimEnd()) && /^["'‘“([]*[\p{Lu}\p{Nd}]/u.test(nextText)) return false;
    const indent = next.box.x0 - line.box.x0;
    const centred = Math.abs(indent - (line.box.x1 - next.box.x1)) <= perCharacter;
    if (indent > perCharacter && !centred) return false;
    return firstWord !== '' && line.box.x1 + (firstWord.length + 1) * perCharacter > right;
  });
}
