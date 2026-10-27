import { type BlockMark, type EditedBlock, oneCommand } from '@monstera/contract';
import { fromTextFrame, joinAfterLine, lineText, normaliseFamily, paragraphsOfLines, sameTextFrame, type TextFrame } from '@monstera/shared';

import type { TextBlock } from './textBlock.js';

/**
 * Join and split ([ADR-0180](../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)
 * Decision 7): two blocks made one, one block made two, each AS AN EDIT of the block wire and nothing stored. The grouping
 * is derived on every read (ADR-0049), so a joined pair is one block exactly while its lines sit as one block's do, and
 * a split pair is two exactly while a gap stands between them: each operation writes the movement that makes it true.
 *
 * ## Words survive, and their looks
 *
 * A word appended to a block takes the style of the run before it (ADR-0179), so a join that only appended the lower
 * block's words would set them in the upper block's last style. The lower block's runs are carried as marks — weight,
 * slant, size and colour — so they keep those (read back by `pdfiumCommand.proof`'s styled join, VVVVVVV-18), and their
 * FAMILY where the font the page states resolves to a family the resolver knows (`listedFamiliesFor`, the owner's
 * decision of 2026-10-18); where it does not, the words take the upper block's, and the join says so. A split names
 * each half's own old lines, so neither half changes at all but where it stands.
 */

/**
 * A box in a frame on the page: the box itself where there is no frame, and where it is set at an angle (ADR-0273) the
 * page box around its corners taken out of the frame. What a rule about the PAGE asks of a block (past its edge, over
 * another, nearest a point), which a box in a frame cannot answer.
 */
export function pageBox(block: { readonly box: TextBlock['box']; readonly frame?: TextFrame | undefined }): TextBlock['box'] {
  const { box, frame } = block;
  if (frame === undefined) return box;
  const corners = [
    fromTextFrame(frame, box.x0, box.y0),
    fromTextFrame(frame, box.x1, box.y0),
    fromTextFrame(frame, box.x0, box.y1),
    fromTextFrame(frame, box.x1, box.y1),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Whether two blocks are set in one frame, so their boxes, in it, can be compared as a column's. */
function oneFrame(left: TextBlock, right: TextBlock): boolean {
  return sameTextFrame(left.frame ?? null, right.frame ?? null);
}

/** A block's words, as the editor shows them: the one join the kernel diffs against. */
export function wordsOfBlock(block: TextBlock): string {
  return paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft })));
}

/** One run's span of a block's words, and how the run is set. */
interface RunSpan {
  readonly from: number;
  readonly to: number;
  readonly style: TextBlock['style'];
}

/** Every run's span of {@link wordsOfBlock}, by the same join of lines, so an offset here is an offset there. */
export function runSpans(block: TextBlock): RunSpan[] {
  const spans: RunSpan[] = [];
  let at = 0;
  for (const [place, line] of block.lines.entries()) {
    const text = lineText(line.runs);
    for (const run of line.runs) {
      if (run.text.length > 0) spans.push({ from: at, to: at + run.text.length, style: run.style });
      at += run.text.length;
    }
    // THE JOIN AFTER THE LINE, from the one function that spells it (the last line has none).
    if (place < block.lines.length - 1) at += joinAfterLine(text, line.soft).length;
  }
  return spans;
}

/**
 * A block's runs as marks over its words, shifted by `shift` where its words follow others'; adjacent equal looks are one.
 * `familyOf` answers the family a run's page font name stands for, where one is known; a run with none carries no family.
 */
export function styleMarks(
  block: TextBlock,
  shift: number,
  familyOf: (font: string) => string | undefined = () => undefined,
): Omit<BlockMark, 'block'>[] {
  const marks: Omit<BlockMark, 'block'>[] = [];
  for (const { from, to, style } of runSpans(block)) {
    const family = style.font === undefined ? undefined : familyOf(style.font);
    const set = {
      bold: style.bold,
      italic: style.italic,
      size: style.size,
      colour: { r: style.colour.r, g: style.colour.g, b: style.colour.b },
      ...(family === undefined ? {} : { family }),
    };
    const last = marks.at(-1);
    if (last?.to === shift + from && JSON.stringify(last.set) === JSON.stringify(set)) {
      marks[marks.length - 1] = { ...last, to: shift + to };
    } else marks.push({ from: shift + from, to: shift + to, set });
  }
  return marks;
}

/** A block's lines as the wire names them. */
function linesOf(block: TextBlock): Pick<EditedBlock, 'lines' | 'soft'> {
  return { lines: block.lines.map((line) => line.runs.map((run) => run.index)), soft: block.lines.map((line) => line.soft) };
}

/**
 * Two blocks made one: the upper block's words with the lower's after them as ONE paragraph, the lower's looks kept as
 * marks, and the lower block removed (its words emptied, which is what removes a block). They are two entries of one
 * command, so one undo step; the upper block's lines are laid out again from its first line, so the words that were the
 * lower block's stand at the pitch of the block they joined, which is what makes them read as one.
 *
 * THE LOWER BLOCK'S FAMILY TOO, where its run's page font name resolves to a family the resolver knows (`familyOf`, the
 * owner's decision of 2026-10-18 on VVVVVVV-18): a mark names a family, and a family not listed is one no mark can write.
 * Where a run's font does not resolve and is not the upper block's own, its words take the upper's family, and `kept`
 * says so, for the person to be told.
 */
export function joinEdits(
  upper: TextBlock,
  lower: TextBlock,
  familyOf: (font: string) => string | undefined,
): { readonly edits: [EditedBlock, EditedBlock]; readonly kept: boolean } {
  const head = wordsOfBlock(upper);
  const shift = head.length + 1;
  const upperFonts = new Set(upper.lines.flatMap((line) => line.runs.map((run) => normaliseFamily(run.style.font ?? ''))));
  let kept = false;
  const marks = styleMarks(lower, shift, (font) => {
    const family = familyOf(font);
    if (family === undefined && !upperFonts.has(normaliseFamily(font))) kept = true;
    return family;
  });
  return {
    edits: [
      { ...linesOf(upper), text: `${head} ${wordsOfBlock(lower)}`, marks },
      { ...linesOf(lower), text: '' },
    ],
    kept,
  };
}

/**
 * One block made two, before its paragraph `paragraph` (1 or more): each half names its own old lines and its own words,
 * so neither changes, and the second is moved down by a line so the gap between the halves is wider than the grouping
 * joins across. `undefined` where there is no paragraph there to split before.
 *
 * **And `undefined` where the moved half would land within a line of the text below** (the owner's decision of
 * 2026-10-27, ADR-0271): nothing below moves, so a half that came within a line of a block under it in its column would
 * be grouped with it on the next read, or drawn over it. `others` is the rest of the page's blocks, required so that no
 * caller can offer a split without asking.
 */
export function splitEdits(block: TextBlock, paragraph: number, others: readonly TextBlock[]): EditedBlock[] | undefined {
  const words = wordsOfBlock(block).split('\n');
  if (paragraph < 1 || paragraph >= words.length) return undefined;
  // THE LINES EACH PARAGRAPH HOLDS: a paragraph ends at the first line that is not soft.
  let firstLineOfSecond = -1;
  let ended = 0;
  for (const [at, line] of block.lines.entries()) {
    if (line.soft) continue;
    ended += 1;
    if (ended === paragraph) {
      firstLineOfSecond = at + 1;
      break;
    }
  }
  if (firstLineOfSecond <= 0 || firstLineOfSecond >= block.lines.length) return undefined;
  const first: TextBlock = { ...block, lines: block.lines.slice(0, firstLineOfSecond) };
  const second: TextBlock = { ...block, lines: block.lines.slice(firstLineOfSecond) };
  const pitch = pitchBetween(block) ?? block.style.size * 1.2;
  if (landsNearBelow(second, pitch, others.filter((other) => other !== block))) return undefined;
  const down = { move: { x: 0, y: -pitch } };
  return [
    { ...linesOf(first), text: words.slice(0, paragraph).join('\n') },
    { ...linesOf(second), text: words.slice(paragraph).join('\n'), place: down },
  ];
}

/**
 * Whether `half`, moved down by `pitch`, would stand within a line of a block in its column: one under it closer than a
 * line, or one it would be drawn over. The line is the larger of the pitch and the half's tallest line, since the
 * grouping joins across a gap smaller than a line's own height (`groupIntoBlocks`) and the pitch alone may be less.
 */
function landsNearBelow(half: TextBlock, pitch: number, others: readonly TextBlock[]): boolean {
  const left = Math.min(...half.lines.map((line) => line.box.x0));
  const right = Math.max(...half.lines.map((line) => line.box.x1));
  // PDF y RUNS UP: moving down subtracts. IN THE HALF'S FRAME where it has one (ADR-0273): the writer moves it down its
  // own lines, so its column is its frame's.
  const top = Math.max(...half.lines.map((line) => line.box.y1)) - pitch;
  const bottom = Math.min(...half.lines.map((line) => line.box.y0)) - pitch;
  const line = Math.max(pitch, ...half.lines.map((each) => each.box.y1 - each.box.y0));
  // A BLOCK IN ANOTHER FRAME has no column in common with it, so only being drawn over it counts: the moved half's page
  // box against that block's, a line wide all round.
  const moved = pageBox({ box: { x0: left, y0: bottom, x1: right, y1: top }, frame: half.frame });
  return others.some((other) =>
    oneFrame(half, other)
      ? other.box.x0 < right && other.box.x1 > left && other.box.y1 > bottom - line && other.box.y0 < top
      : (() => {
          const there = pageBox(other);
          return there.x0 < moved.x1 + line && there.x1 > moved.x0 - line && there.y1 > moved.y0 - line && there.y0 < moved.y1 + line;
        })(),
  );
}

/** The distance between a block's first two lines' tops, or `undefined` for a block of one line. */
function pitchBetween(block: TextBlock): number | undefined {
  const [first, second] = block.lines;
  return first !== undefined && second !== undefined && first.box.y1 > second.box.y1 ? first.box.y1 - second.box.y1 : undefined;
}

/**
 * The block above or below `at` in a page's blocks, where there is one near enough to be a continuation: it overlaps the
 * block's own column by at least half of the narrower, and sits within four lines of it. The nearest wins; `undefined`
 * where none does, so a join is not offered across a page.
 */
export function neighbourOf(blocks: readonly TextBlock[], at: number, side: 'above' | 'below'): number | undefined {
  const own = blocks[at];
  if (own === undefined) return undefined;
  const reach = 4 * own.style.size;
  let best: { index: number; gap: number } | undefined;
  for (const [index, other] of blocks.entries()) {
    // NOT ACROSS STREAMS (ADR-0269): a block in a form and one on the page are written by two commands, never joined.
    // NOR ACROSS FRAMES (ADR-0273): a turned label beside upright text is no continuation of it, and their boxes are in
    // two frames that cannot be compared.
    if (index === at || !oneCommand(own, other)) continue;
    const across = Math.min(own.box.x1, other.box.x1) - Math.max(own.box.x0, other.box.x0);
    if (across < 0.5 * Math.min(own.box.x1 - own.box.x0, other.box.x1 - other.box.x0)) continue;
    // PDF y RUNS UP: the block above has the larger y, so the gap is this block's top to that one's bottom.
    const gap = side === 'above' ? other.box.y0 - own.box.y1 : own.box.y0 - other.box.y1;
    if (gap < -1 || gap > reach) continue;
    if (best === undefined || gap < best.gap) best = { index, gap };
  }
  return best?.index;
}
