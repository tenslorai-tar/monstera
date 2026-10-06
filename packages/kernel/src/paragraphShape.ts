/**
 * A paragraph's shape, read from its lines
 * ([ADR-0179](../../../docs/DECISIONS/0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md)
 * Decisions 5 and 6): which edge its lines keep, how far its first line stands from the rest, and the space that
 * separates its paragraphs.
 *
 * ## Relations, and one unit
 *
 * Two edges AGREE when they differ by less than one character's width of the text they are on, the unit `softEnds`
 * already uses: the average width of a character across the lines, their widths over their characters. That is a
 * quantity the text carries, so there is no constant to defend. Measured on the lines the engine reads, a justified
 * paragraph's edges agree to the last digit and a ragged one's differ by many characters, so the unit separates them
 * with room on both sides (the cases in `paragraphShape.test.ts` put an edge one and a half characters off as the
 * control).
 *
 * ## What it cannot know, and says
 *
 * - **A block of one line has no alignment to read.** Its lines agree with themselves on every edge. It is `left`, the
 *   direction that never moves text the person did not touch.
 * - **Justified text reads as `left`.** Its lefts agree and its rights agree, and a typesetter's justified paragraph and a
 *   ragged one that happens to fill its lines look the same here. Writing it left-aligned is the stated limit of
 *   ADR-0179 Decision 5.
 * - **Centred and right-aligned text is told from left-aligned by the edges that DISAGREE**, so a paragraph of lines that
 *   all happen to be the same width is `left`.
 */

/** A line as the shape needs it: where it stands, and how many characters it holds. */
export interface LineExtent {
  readonly x0: number;
  readonly x1: number;
  readonly characters: number;
}

/** Which edge a paragraph's lines keep. Justified text is `left`, by the limit above. */
export type Alignment = 'left' | 'center' | 'right';

/** What a paragraph's lines say about how it is set. */
export interface ParagraphShape {
  readonly align: Alignment;
  /**
   * How far the first line starts to the RIGHT of the others: positive for a first-line indent, negative for a hanging
   * one. `0` for a block of one line (nothing to compare against) and for centred and right-aligned text, whose lines
   * stand by their centre or their right edge and not by a left one.
   */
  readonly firstIndent: number;
  /** The left edge the lines after the first keep: the first line's own for a block of one line. */
  readonly left: number;
  /** The right edge: the furthest any line reaches. */
  readonly right: number;
  /** The centre the lines keep, for `center`: the mean of the lines' own centres. */
  readonly centre: number;
}

/** One character's width across the lines: the unit two edges are compared in. `0` where no line holds a character. */
export function characterUnit(lines: readonly LineExtent[]): number {
  let width = 0;
  let characters = 0;
  for (const line of lines) {
    width += line.x1 - line.x0;
    characters += line.characters;
  }
  return characters === 0 ? 0 : width / characters;
}

/** Whether every value lies within `unit` of every other: the range is under one unit. */
function agree(values: readonly number[], unit: number): boolean {
  if (values.length < 2) return true;
  return Math.max(...values) - Math.min(...values) < unit;
}

/**
 * The shape of one paragraph's lines, top to bottom.
 *
 * @param lines the paragraph's lines
 */
export function paragraphShape(lines: readonly LineExtent[]): ParagraphShape {
  const [first] = lines;
  if (first === undefined) return { align: 'left', firstIndent: 0, left: 0, right: 0, centre: 0 };
  const right = Math.max(...lines.map((line) => line.x1));
  const centres = lines.map((line) => (line.x0 + line.x1) / 2);
  const centre = centres.reduce((sum, at) => sum + at, 0) / centres.length;
  const rest = lines.slice(1);
  if (rest.length === 0) return { align: 'left', firstIndent: 0, left: first.x0, right, centre };

  const unit = characterUnit(lines);
  const lefts = rest.map((line) => line.x0);
  const rightsAgree = agree(
    lines.map((line) => line.x1),
    unit,
  );
  const centresAgree = agree(centres, unit);
  const restLeft = Math.min(...lefts);
  const left = { align: 'left', firstIndent: first.x0 - restLeft, left: restLeft, right, centre } as const;

  // EVERY LEFT EDGE AGREES: left-aligned whatever else agrees, which is also what makes a paragraph of equal-width lines
  // `left`. A first line standing off the rest is then an indent, and is measured below.
  if (agree(lines.map((line) => line.x0), unit)) return { ...left, firstIndent: 0 };
  // THE LINES AFTER THE FIRST AGREE: left-aligned with a first-line indent or a hanging one, even when every right edge
  // agrees too (a justified paragraph that is indented).
  if (rest.length >= 2 && agree(lefts, unit)) return left;
  if (centresAgree && !rightsAgree) return { align: 'center', firstIndent: 0, left: restLeft, right, centre };
  // TWO LINES CANNOT SEPARATE A RIGHT-ALIGNED PARAGRAPH FROM AN INDENTED ONE whose lines both fill the measure, so they
  // are the indented one, the direction that moves nothing the person did not type.
  if (rest.length >= 2 && rightsAgree) return { align: 'right', firstIndent: 0, left: restLeft, right, centre };
  return left;
}

/**
 * The shape of a BLOCK, which may hold several paragraphs (a list, an address): the shape of its first paragraph of two
 * lines or more, since that is the first place a first-line indent and a rag can be told apart, and where no paragraph
 * has two lines, of all the lines together, which is how stacked centred or right-aligned lines are told from a column
 * of left-aligned ones. The ONE function the read (`document.textBlocks`, for the editor to draw) and the writer (over
 * the objects' bounds, to lay out) both take, so a block is never one shape on screen and another on the page.
 *
 * @param lines the block's lines, top to bottom
 * @param soft whether each line's end is soft; the last is never read
 */
export function blockShape(lines: readonly LineExtent[], soft: readonly boolean[]): ParagraphShape {
  let start = 0;
  for (let at = 0; at < lines.length; at += 1) {
    const ends = at === lines.length - 1 || soft[at] !== true;
    if (!ends) continue;
    if (at - start >= 1) return paragraphShape(lines.slice(start, at + 1));
    start = at + 1;
  }
  return paragraphShape(lines);
}

/**
 * The extra space a paragraph's end leaves, beyond the pitch inside a paragraph: what a paragraph typed below takes
 * ([ADR-0179](../../../docs/DECISIONS/0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md)
 * Decision 6). The largest amount by which the gap at a hard break exceeds the smallest gap in the block, or `0` for a
 * block with no hard break, and for one whose hard breaks sit at the pitch.
 *
 * @param baselines each line's baseline, top to bottom
 * @param soft whether each line's end is soft; the last is never read
 */
export function paragraphSpacing(baselines: readonly number[], soft: readonly boolean[]): number {
  const gaps = baselines.slice(0, -1).map((baseline, at) => baseline - (baselines[at + 1] ?? baseline));
  if (gaps.length === 0) return 0;
  const pitch = Math.min(...gaps);
  let extra = 0;
  for (const [at, gap] of gaps.entries()) {
    if (soft[at] !== true) extra = Math.max(extra, gap - pitch);
  }
  return extra;
}
