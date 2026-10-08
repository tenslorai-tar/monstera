import type { BlockMark, EditedBlock } from '@monstera/contract';
import { joinAfterLine, lineText, paragraphsOfLines } from '@monstera/shared';

import type { TextBlock } from './commands/documentCommands.js';

/**
 * Join and split ([ADR-0180](../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)
 * Decision 7): two blocks made one, one block made two, each AS AN EDIT of the block wire and nothing stored. The grouping
 * is derived on every read (ADR-0049), so a joined pair is one block exactly while its lines sit as one block's do, and
 * a split pair is two exactly while a gap stands between them: each operation writes the movement that makes it true.
 *
 * ## Words and their looks both survive
 *
 * A word appended to a block takes the style of the run before it (ADR-0179), so a join that only appended the lower
 * block's words would set them in the upper block's last style. The lower block's runs are carried as marks (weight,
 * slant, size, colour), so they keep the look they had; and a split names each half's own old lines, so neither half
 * changes at all but where it stands.
 */

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

/** A block's runs as marks over its words, shifted by `shift` where its words follow others'; adjacent equal looks are one. */
export function styleMarks(block: TextBlock, shift: number): Omit<BlockMark, 'block'>[] {
  const marks: Omit<BlockMark, 'block'>[] = [];
  for (const { from, to, style } of runSpans(block)) {
    const set = { bold: style.bold, italic: style.italic, size: style.size, colour: { r: style.colour.r, g: style.colour.g, b: style.colour.b } };
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
 */
export function joinEdits(upper: TextBlock, lower: TextBlock): [EditedBlock, EditedBlock] {
  const head = wordsOfBlock(upper);
  const shift = head.length + 1;
  return [
    { ...linesOf(upper), text: `${head} ${wordsOfBlock(lower)}`, marks: styleMarks(lower, shift) },
    { ...linesOf(lower), text: '' },
  ];
}

/**
 * One block made two, before its paragraph `paragraph` (1 or more): each half names its own old lines and its own words,
 * so neither changes, and the second is moved down by a line so the gap between the halves is wider than the grouping
 * joins across. `undefined` where there is no paragraph there to split before.
 */
export function splitEdits(block: TextBlock, paragraph: number): [EditedBlock, EditedBlock] | undefined {
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
  return [
    { ...linesOf(first), text: words.slice(0, paragraph).join('\n') },
    { ...linesOf(second), text: words.slice(paragraph).join('\n'), place: { move: { x: 0, y: -pitch } } },
  ];
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
    if (index === at) continue;
    const across = Math.min(own.box.x1, other.box.x1) - Math.max(own.box.x0, other.box.x0);
    if (across < 0.5 * Math.min(own.box.x1 - own.box.x0, other.box.x1 - other.box.x0)) continue;
    // PDF y RUNS UP: the block above has the larger y, so the gap is this block's top to that one's bottom.
    const gap = side === 'above' ? other.box.y0 - own.box.y1 : own.box.y0 - other.box.y1;
    if (gap < -1 || gap > reach) continue;
    if (best === undefined || gap < best.gap) best = { index, gap };
  }
  return best?.index;
}
