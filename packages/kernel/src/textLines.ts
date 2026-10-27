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

import { type TextFrame, blockShape, faceSeenAs, sameTextFrame } from '@monstera/shared';

/** How a text object's matrix sets it (`orientationOf`, `pdfiumFfi.ts`): `upright` is the only one an editor is placed along. */
export type Orientation = 'upright' | 'turned' | 'vertical' | 'slanted' | 'mirrored';

/**
 * Whether text is set upright, the ONE spelling of that test (B3a). It no longer decides what is edited: since
 * [ADR-0273](../../../docs/DECISIONS/0273-text-set-at-an-angle-is-edited-in-its-own-frame.md) text at any angle is
 * grouped in its own frame ({@link groupInFrames}). What it still decides is upright-only by its nature: glyphs drawn an
 * object each are joined into a run along the page's x (`textRunJoin.ts`), and a line running both ways is read in the
 * page's left-to-right order (`bidiLine.ts`). A proof that groups an upright fixture may still filter by it.
 */
export function isUpright(style: { readonly orientation: Orientation }): boolean {
  return style.orientation === 'upright';
}

/** A run's frame and its place in it, as the read answers it (`RunFrame`, `pdfiumFfi.ts`). */
export interface FramedPlace {
  readonly matrix: TextFrame;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly baseline: number;
}

/**
 * A run as it is grouped: where it has a frame (ADR-0273), its box and baseline are the frame's, in which it is upright;
 * otherwise it is as read. The baseline is the style's, where the composition reads it.
 */
export function inItsFrame<R extends { readonly left: number; readonly right: number; readonly bottom: number; readonly top: number; readonly style: { readonly baseline: number }; readonly frame?: FramedPlace | undefined }>(
  run: R,
): R {
  const frame = run.frame;
  if (frame === undefined) return run;
  return { ...run, left: frame.left, right: frame.right, bottom: frame.bottom, top: frame.top, style: { ...run.style, baseline: frame.baseline } };
}

/**
 * The blocks a person edits, FRAME BY FRAME (ADR-0273): runs of one frame are grouped by {@link groupIntoBlocks}, in that
 * frame's coordinates where they are upright, and each block of a frame carries it. Upright runs have no frame and are
 * grouped exactly as they always were. A block never mixes frames: two runs set at different angles are not one line.
 *
 * The ONE grouping for the editor's read and every walk that must agree with it (B3a). `frameOf` names a run's frame;
 * the runs are given in their frame's coordinates already ({@link inItsFrame}).
 */
export function groupInFrames<R extends BlockableRun<unknown>>(
  runs: readonly R[],
  frameOf: (run: R) => TextFrame | undefined,
): readonly (EditableBlock<R['style']> & { readonly frame?: TextFrame })[] {
  const groups: { readonly frame: TextFrame | null; readonly runs: R[] }[] = [];
  for (const run of runs) {
    const frame = frameOf(run) ?? null;
    const group = groups.find((each) => sameTextFrame(each.frame, frame));
    if (group === undefined) groups.push({ frame, runs: [run] });
    else group.runs.push(run);
  }
  // UPRIGHT FIRST, then each frame in the order its first run was read, so a page with no angled text is answered as before.
  groups.sort((a, b) => (a.frame === null ? 0 : 1) - (b.frame === null ? 0 : 1));
  return groups.flatMap(({ frame, runs: members }) =>
    groupIntoBlocks<R['style']>(members).map((block) => (frame === null ? block : { ...block, frame })),
  );
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
 * A run's SETTING as one key: which face, the size it is drawn at, and the colour it is filled with. Two runs set
 * alike have equal keys, and a block never continues across a change of key (`groupIntoBlocks`, step 3).
 *
 * The face as a person sees it (`faceSeenAs`), not the font's name: an edit writes letters a subset lacks in the face
 * that stands in for it, and a heading whose last word went into Arimo beside the page's Liberation Sans read back as two
 * blocks (ADR-0096's correction of 2026-10-25).
 *
 * The size to a hundredth of a point: the glyphs of one line come back with sizes equal to the last digit, and a
 * hundredth is far below any two sizes a designer sets apart.
 */
export function settingOf(style: {
  readonly font: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly size: number;
  readonly colour: { readonly r: number; readonly g: number; readonly b: number };
}): string {
  const { r, g, b } = style.colour;
  return `${faceSeenAs(style.font, style.bold, style.italic)}|${style.size.toFixed(2)}|${String(r)},${String(g)},${String(b)}`;
}

/**
 * A run with what the block grouping reads of how it is set — its {@link settingOf} key, the size it is drawn at, and
 * whether it is fixed pitch (the read's `mono`) — taken from its style in one place, so no caller derives them apart. A
 * FIXED-PITCH LINE KEEPS ITS BREAK (`softEnds`): code set one command to a line is not a wrapped paragraph. A caller
 * that set the pitch itself beside the call could leave it out, and a code block's first line then read as wrapped and
 * went with the next as one paragraph.
 */
export function blockableOf<R extends { readonly style: Parameters<typeof settingOf>[0] & { readonly mono?: boolean } }>(
  run: R,
): R & { readonly setting: string; readonly size: number; readonly fixedPitch: boolean } {
  return { ...run, setting: settingOf(run.style), size: run.style.size, fixedPitch: run.style.mono === true };
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
 * How far apart two of a line's gaps may be, in ems, and still be spaces justification set alike: measured to within
 * 0.05 em on document 4's justified lines (ADR-0096's correction of 2026-10-25).
 */
const JUSTIFIED_SPACES_EM = 0.1;

/** How near, in points, a piece on a line beside must start to the run after a gap for the gap to be a column's. */
const COLUMN_START_PT = 0.5;

interface LinePiece<T> {
  runs: T[];
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** Whether `other` is a line just beside `line`, above or below: closer than the shorter of the two is tall. */
function besideLine(line: { readonly bottom: number; readonly top: number }, other: { readonly bottom: number; readonly top: number }): boolean {
  const gap = Math.max(other.bottom - line.top, line.bottom - other.top);
  return gap >= 0 && gap < Math.min(line.top - line.bottom, other.top - other.bottom);
}

/**
 * One line's runs, swept left to right, as pieces: a new piece where the gap from the piece so far is wider than an em of
 * the smaller neighbour's type and `spaced` does not call it a word space set wide.
 *
 * @param spaced given the piece so far, the run after the gap, that run's place in `swept`, and the gap in ems of `size`
 */
function splitLine<T extends LineableRun>(
  swept: readonly T[],
  sizeOf: (run: T) => number,
  spaced: (piece: LinePiece<T>, run: T, at: number, em: number, size: number) => boolean,
): LinePiece<T>[] {
  const pieces: LinePiece<T>[] = [];
  let piece: LinePiece<T> | undefined;
  // THE SIZE OF THE RUN AT THE PIECE'S RIGHT, the one the next gap is beside.
  let edge = 0;
  swept.forEach((run, at) => {
    // A SIZE THAT IS NOT A NUMBER IS REFUSED, never compared: every comparison with it is false, so a gap would never
    // be wider than it and every line would be one piece, columns and all. A typed caller cannot leave it out; a script
    // that builds the runs by hand can, and the grouping it is proving would then pass while grouping nothing apart.
    if (!Number.isFinite(sizeOf(run))) throw new TypeError(`a run's size must be a number of points, not ${String(sizeOf(run))}`);
    const gap = piece === undefined ? 0 : Math.max(0, run.left - piece.right, piece.left - run.right);
    // A WORD SPACE IS SET IN THE TYPE AROUND IT, so the gap is measured in an em of the SMALLER neighbour's type, never
    // against the line's height. The line is every run that overlaps, so its height grows with what says the runs are
    // apart: two columns whose baselines are offset, and a large figure beside small text. Measured 2026-10-24 in the
    // owner's document 11: a 13.71 pt gutter between 12 pt columns whose baselines are 3.81 pt apart, against a line
    // 14.84 pt tall; a 40 pt figure and a 14 pt caption 14.29 and 12.61 pt from an 11.5 pt list. Each was joined, and an
    // edit of one column's paragraph rewrote a line of the other. Across the corpus every other joined gap is at most
    // 0.94 em, and the widest space this application justifies to is a space and JUSTIFY_CAP's 0.6 em (`markFigures.ts`),
    // under an em; those gutters are 1.1 to 1.57.
    const size = Math.min(edge, sizeOf(run));
    if (piece === undefined || (gap > size && !spaced(piece, run, at, gap / size, size))) {
      edge = sizeOf(run);
      piece = { runs: [run], left: run.left, right: run.right, bottom: run.bottom, top: run.top };
      pieces.push(piece);
      return;
    }
    piece.runs.push(run);
    if (run.right >= piece.right) edge = sizeOf(run);
    piece.left = Math.min(piece.left, run.left);
    piece.right = Math.max(piece.right, run.right);
    piece.bottom = Math.min(piece.bottom, run.bottom);
    piece.top = Math.max(piece.top, run.top);
  });
  return pieces;
}

/**
 * The pieces of a page's runs: each line split where the gap between the piece so far and the next run is wider than an
 * em of the smaller of the two neighbours' type (step 2 of {@link groupIntoBlocks}), in the order the runs came. The ONE place a piece is decided, which
 * the block grouping and the line reading (`readInLineOrder`, in `bidiLine.ts`, which takes the bidirectional algorithm
 * this module must not load into `main`) both take (B3a): two readings of which runs are one line would put a run's words
 * in one and its place in the other.
 *
 * ## A justified line's wide spaces are not splits
 *
 * Justification stretches a line's spaces, past an em on a short justified line, and no width tells such a space from a
 * gutter: 1.0 to 1.6 em on document 4's justified page against 1.1 to 1.57 em for document 11's gutters. The lines beside
 * tell them apart (ADR-0096's correction of 2026-10-25): a wider gap is a word space where another gap on its line is
 * within {@link JUSTIFIED_SPACES_EM} of it, a run of the same size on a line just beside spans it, and no piece of that
 * line starts within {@link COLUMN_START_PT} of where the run after it starts. A line with one wide gap stays split.
 *
 * @param sizeOf the size a run is drawn at, in points
 */
export function piecesOf<T extends LineableRun>(
  runs: readonly T[],
  sizeOf: (run: T) => number,
): { runs: T[]; order: number; left: number; right: number; bottom: number; top: number }[] {
  // SWEPT LEFT TO RIGHT, whatever order the runs came in: a gap is between two neighbours, and a line read in the order
  // it was typed visits a right-to-left phrase before the words beside it, which a sweep in that order measures from
  // the wrong side. The runs of a piece keep the order they came in.
  const lines = overlapLines(runs).map((line) => {
    const given = new Map(line.runs.map((run, at) => [run, at] as const));
    const swept = [...line.runs].sort((a, b) => a.left - b.left || (given.get(a) ?? 0) - (given.get(b) ?? 0));
    return { ...line, given, swept };
  });
  // WHERE EACH LINE'S PIECES START BY THE EM RULE ALONE, which is what a column start is read from.
  const starts = new Map(lines.map((line) => [line, splitLine(line.swept, sizeOf, () => false).map((piece) => piece.left)] as const));
  const sameSize = (a: number, b: number): boolean => a.toFixed(2) === b.toFixed(2);
  const pieces: { runs: T[]; order: number; left: number; right: number; bottom: number; top: number }[] = [];
  for (const line of lines) {
    const { swept, given } = line;
    const beside = lines.filter((other) => other !== line && besideLine(line, other));
    // EVERY RUN-TO-RUN GAP OF THE LINE, in ems of the smaller of its two runs: the gap before run `at` is `gaps[at]`.
    const gaps = swept.map((run, at) => {
      const before = swept[at - 1];
      if (before === undefined || run.left <= before.right) return undefined;
      return (run.left - before.right) / Math.min(sizeOf(run), sizeOf(before));
    });
    const spaced = (piece: LinePiece<T>, run: T, at: number, em: number, size: number): boolean =>
      gaps.some((other, k) => k !== at && other !== undefined && Math.abs(other - em) <= JUSTIFIED_SPACES_EM) &&
      beside.some((other) => other.runs.some((each) => each.left < piece.right && run.left < each.right && sameSize(sizeOf(each), size))) &&
      !beside.some((other) => (starts.get(other) ?? []).some((start) => Math.abs(start - run.left) < COLUMN_START_PT));
    // THE PIECES KEEP THE ORDER THEIR FIRST RUN CAME IN, which is the order a person Tabs through them, and each keeps its
    // runs in the order they came.
    const at = (run: T): number => given.get(run) ?? 0;
    const made = splitLine(swept, sizeOf, spaced);
    for (const each of made) each.runs.sort((a, b) => at(a) - at(b));
    const firstAt = (each: { runs: T[] }): number => {
      const [head] = each.runs;
      return head === undefined ? 0 : at(head);
    };
    made.sort((a, b) => firstAt(a) - firstAt(b));
    const first = pieces.length;
    made.forEach((each, rank) => {
      pieces.push({ ...each, order: first + rank });
    });
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
