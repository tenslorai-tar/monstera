import { joinAfterLine } from '@monstera/shared';

import { breakOpportunities, graphemeBoundaries } from './lineBreaks.js';

/**
 * A block edited as paragraphs of styled words
 * ([ADR-0179](../../../docs/DECISIONS/0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md)).
 *
 * Pure: no engine, no object, no coordinate of the page. It is handed the block's lines as the read answered them, the
 * words a person typed, and a `Measure` that says how wide a piece of text is when it is set in a run's style, and it
 * answers which lines to keep, which to set again and what each new line holds. The writers apply the answer to their
 * own objects, and measure with their own engine.
 *
 * ## Three questions, in order
 *
 * 1. **Whose is each character?** ({@link attribute}) The block's runs, with the one-character join between lines of
 *    `joinAfterLine`, are diffed against the new words by `lineEdit`'s rule, widened from a line to a block, and every
 *    character of the new words is given the run that wrote it: a retained character keeps its own, a typed one takes
 *    the run it was typed into. A word that wraps is still the run's word, so it keeps the run's style.
 * 2. **What are the paragraphs, and where may a line end in them?** ({@link paragraphsOf}) Paragraphs are the hard
 *    breaks of the new words; inside one, a line may end where `breakOpportunities` allows, which includes between
 *    words of the scripts written without spaces.
 * 3. **Which lines change?** ({@link planBlock}) A paragraph is set again from the line its first changed character is
 *    in, one line earlier when the change begins at that line's first character since the line above may now take a
 *    word, and it stops where a new line starts on a character that is the first of an old line and the rest of the
 *    paragraph is exactly what it was. Nothing above or below is touched.
 */

/** One run of a line, as the read answered it. */
export interface FlowRun {
  /** The engine's index of the object, or any number that names the run. */
  readonly id: number;
  readonly text: string;
}

/** One visual line of the block, top to bottom. */
export interface FlowLine {
  readonly runs: readonly FlowRun[];
  /** Whether the line ends in a soft wrap. Never true for the block's last line. */
  readonly soft: boolean;
}

/** The owner of a character no run wrote: the join between two lines. */
export const JOIN = -1;

/** The block's words as the page says them now. */
export interface OldWords {
  readonly text: string;
  /** The run that wrote each UTF-16 unit, or {@link JOIN}. */
  readonly owner: readonly number[];
  /** Where each line's first unit is. */
  readonly lineStarts: readonly number[];
  /** Where each paragraph (a hard break ends one) starts and ends, and the lines it holds. */
  readonly paragraphs: readonly { readonly start: number; readonly end: number; readonly firstLine: number; readonly lastLine: number }[];
}

/** The block's words from its lines, by the one join of `joinAfterLine`. */
export function oldWordsOf(lines: readonly FlowLine[]): OldWords {
  let text = '';
  const owner: number[] = [];
  const lineStarts: number[] = [];
  const paragraphs: { start: number; end: number; firstLine: number; lastLine: number }[] = [];
  let open: { start: number; end: number; firstLine: number; lastLine: number } | undefined;
  for (const [at, line] of lines.entries()) {
    lineStarts.push(text.length);
    open ??= { start: text.length, end: text.length, firstLine: at, lastLine: at };
    let lineText = '';
    for (const run of line.runs) {
      text += run.text;
      lineText += run.text;
      owner.push(...new Array<number>(run.text.length).fill(run.id));
    }
    open.end = text.length;
    open.lastLine = at;
    if (at === lines.length - 1) break;
    const join = joinAfterLine(lineText, line.soft);
    text += join;
    owner.push(...new Array<number>(join.length).fill(JOIN));
    if (!line.soft) {
      paragraphs.push(open);
      open = undefined;
    }
  }
  if (open !== undefined) paragraphs.push(open);
  return { text, owner, lineStarts, paragraphs };
}

/** How many leading units `before` and `after` share, never leaving half a surrogate pair. */
function sharedPrefix(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let at = 0;
  while (at < limit && before[at] === after[at]) at += 1;
  if (at > 0 && isHighSurrogate(before.charCodeAt(at - 1))) at -= 1;
  return at;
}

/** How many trailing units they share without overlapping the prefix, never starting inside a surrogate pair. */
function sharedSuffix(before: string, after: string, prefix: number): number {
  const limit = Math.min(before.length, after.length) - prefix;
  let at = 0;
  while (at < limit && before[before.length - 1 - at] === after[after.length - 1 - at]) at += 1;
  if (at > 0 && isLowSurrogate(before.charCodeAt(before.length - at))) at -= 1;
  return at;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * The run a typed span belongs to: the run holding the unit the change starts at, which at a boundary between two runs
 * is the one that FOLLOWS, as `replacementsForLine` has always put it. Where the change starts on a join, the end of a
 * line, it is the run before: a word typed at the end of a line continues that line's last word, in its style. Looked
 * for across the whole block, since a paragraph typed between two others has no run of its own to stand in.
 */
function runAt(words: OldWords, at: number): number {
  const find = (from: number, step: number): number => {
    for (let index = from; index >= 0 && index < words.text.length; index += step) {
      const owner = words.owner[index];
      if (owner !== undefined && owner !== JOIN) return owner;
    }
    return JOIN;
  };
  if (at >= words.text.length) return find(words.text.length - 1, -1);
  const here = words.owner[at];
  if (here !== undefined && here !== JOIN) return here;
  const before = find(at - 1, -1);
  return before === JOIN ? find(at + 1, 1) : before;
}

/**
 * The paragraphs of two lists that are the same words, as pairs `[old, new]` ascending in both: a longest common
 * subsequence, so a paragraph typed above one that is left alone does not make the one left alone look typed.
 */
function matchParagraphs(before: readonly string[], after: readonly string[]): [number, number][] {
  const table: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      if (row === undefined) continue;
      row[j] =
        before[i] === after[j] ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return pairs;
}

interface Owned {
  readonly owner: number[];
  /** For each new unit, the old unit it is, or -1 when it was typed. */
  readonly from: number[];
}

/** The attribution of `next` against the old words between `lo` and `hi`: a common prefix, a common suffix, and a span. */
function attributeRange(words: OldWords, lo: number, hi: number, next: string): Owned {
  const before = words.text.slice(lo, hi);
  const prefix = sharedPrefix(before, next);
  const suffix = sharedSuffix(before, next, prefix);
  const owner: number[] = [];
  const from: number[] = [];
  for (let at = 0; at < prefix; at += 1) {
    owner.push(words.owner[lo + at] ?? JOIN);
    from.push(lo + at);
  }
  const typed = next.length - prefix - suffix;
  const into = typed > 0 ? runAt(words, lo + prefix) : JOIN;
  for (let at = 0; at < typed; at += 1) {
    // A LINE BREAK IS NO RUN'S TEXT: it ends a paragraph, and an object cannot hold one.
    owner.push(next[prefix + at] === '\n' ? JOIN : into);
    from.push(-1);
  }
  for (let at = 0; at < suffix; at += 1) {
    const index = hi - suffix + at;
    owner.push(words.owner[index] ?? JOIN);
    from.push(index);
  }
  return { owner, from };
}

/** What a person's words say about whose each character is. */
export interface Attribution {
  readonly old: OldWords;
  /** The new words, line endings as `\n`. */
  readonly text: string;
  /** The run that wrote each unit of `text`, or {@link JOIN} for a join no run wrote. */
  readonly owner: readonly number[];
  /** For each unit of `text`, the unit of `old.text` it is, or -1 when it was typed. */
  readonly from: readonly number[];
  /** Each run's words after the edit, for the runs whose words changed. A run with none is `''`. */
  readonly texts: ReadonlyMap<number, string>;
  readonly changed: boolean;
}

/**
 * Whose each character of `text` is.
 *
 * Where the block holds as many paragraphs as the text does and there is more than one, each pair is diffed on its own:
 * a translation changes every paragraph, and one diff across them would give every new word to the first run. Otherwise
 * one diff across the block, which is what a person's single edit is, and which keeps the words either side of it.
 */
export function attribute(lines: readonly FlowLine[], text: string): Attribution {
  const old = oldWordsOf(lines);
  const next = text.replace(/\r\n?/gu, '\n');
  const typedParagraphs = next.split('\n');
  const owner: number[] = [];
  const from: number[] = [];
  const push = (part: Owned): void => {
    owner.push(...part.owner);
    from.push(...part.from);
  };
  /** A paragraph break between two paragraphs of the new words: no run's, and no old unit's. */
  const separate = (): void => {
    owner.push(JOIN);
    from.push(-1);
  };
  const oldTexts = old.paragraphs.map((paragraph) => old.text.slice(paragraph.start, paragraph.end));
  const kept = matchParagraphs(oldTexts, typedParagraphs);
  let oldAt = 0;
  let newAt = 0;
  let first = true;
  /** The new paragraphs `[from, to)` written over the old ones `[a, b)`: pairwise when as many, else as one span. */
  const gap = (a: number, b: number, c: number, d: number): void => {
    // NOTHING TYPED: the old paragraphs are simply gone, and no break stands for them.
    if (c === d) return;
    if (b - a === d - c) {
      for (let at = 0; at < b - a; at += 1) {
        const paragraph = old.paragraphs[a + at];
        if (paragraph === undefined) continue;
        if (!first) separate();
        first = false;
        push(attributeRange(old, paragraph.start, paragraph.end, typedParagraphs[c + at] ?? ''));
      }
      return;
    }
    const lo = old.paragraphs[a]?.start ?? old.text.length;
    const hi = old.paragraphs[b - 1]?.end ?? lo;
    const into = typedParagraphs.slice(c, d).join('\n');
    if (!first) separate();
    first = false;
    push(attributeRange(old, lo, Math.max(lo, hi), into));
  };
  for (const [i, j] of kept) {
    gap(oldAt, i, newAt, j);
    const paragraph = old.paragraphs[i];
    if (paragraph !== undefined) {
      if (!first) separate();
      first = false;
      for (let at = paragraph.start; at < paragraph.end; at += 1) {
        owner.push(old.owner[at] ?? JOIN);
        from.push(at);
      }
    }
    oldAt = i + 1;
    newAt = j + 1;
  }
  gap(oldAt, old.paragraphs.length, newAt, typedParagraphs.length);

  const texts = new Map<number, string>();
  const rebuilt = new Map<number, string>();
  for (const [at, unit] of owner.entries()) {
    if (unit === JOIN) continue;
    rebuilt.set(unit, (rebuilt.get(unit) ?? '') + (next[at] ?? ''));
  }
  for (const line of lines) {
    for (const run of line.runs) {
      const after = rebuilt.get(run.id) ?? '';
      if (after !== run.text) texts.set(run.id, after);
    }
  }
  return { old, text: next, owner, from, texts, changed: next !== old.text };
}

/** A stretch of one paragraph's characters set by one run. */
export interface Part {
  readonly run: number;
  readonly text: string;
}

/** The smallest thing a line is filled with: a word, or a word of a script written without spaces, and its spaces. */
export interface Chunk {
  /** Where its first unit is in the new words. */
  readonly start: number;
  /** The word, by run. */
  readonly core: readonly Part[];
  /** The white space after it, which a line that ends here does not keep. */
  readonly trail: Part | undefined;
}

/** One paragraph of the new words. */
export interface FlowParagraph {
  readonly start: number;
  readonly end: number;
  readonly chunks: readonly Chunk[];
}

/** Runs of consecutive units with one owner, as parts. */
function partsOf(text: string, owners: readonly number[]): Part[] {
  const parts: Part[] = [];
  for (const [at, owner] of owners.entries()) {
    const unit = text[at] ?? '';
    const last = parts.at(-1);
    if (last?.run === owner) parts[parts.length - 1] = { run: owner, text: last.text + unit };
    else parts.push({ run: owner, text: unit });
  }
  return parts;
}

/** The paragraphs of the new words, each as chunks a line is filled with. */
export function paragraphsOf(attribution: Attribution): FlowParagraph[] {
  const { text, owner } = attribution;
  const paragraphs: FlowParagraph[] = [];
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    paragraphs.push({ start, end, chunks: chunksOf(text, owner, start, end) });
    if (newline === -1) break;
    start = newline + 1;
  }
  return paragraphs;
}

function chunksOf(text: string, owner: readonly number[], start: number, end: number): Chunk[] {
  const paragraph = text.slice(start, end);
  if (paragraph === '') return [];
  // A JOIN UNIT TAKES THE RUN BEFORE IT, or the one after at the start: it is a space between two words and the
  // line it falls on needs a run to measure it in.
  const effective: number[] = [];
  let previous = JOIN;
  for (let at = start; at < end; at += 1) {
    const unit = owner[at] ?? JOIN;
    const own = unit === JOIN ? previous : unit;
    effective.push(own);
    previous = own;
  }
  const first = effective.find((unit) => unit !== JOIN) ?? 0;
  for (const [at, unit] of effective.entries()) if (unit === JOIN) effective[at] = first;
  const bounds = [0, ...breakOpportunities(paragraph), paragraph.length];
  const chunks: Chunk[] = [];
  for (let at = 0; at < bounds.length - 1; at += 1) {
    const from = bounds[at] ?? 0;
    const to = bounds[at + 1] ?? paragraph.length;
    if (to <= from) continue;
    const piece = paragraph.slice(from, to);
    const spaces = /\s+$/u.exec(piece)?.[0].length ?? 0;
    const coreEnd = to - spaces;
    const core = partsOf(paragraph.slice(from, coreEnd), effective.slice(from, coreEnd));
    const trail = spaces === 0 ? undefined : partsOf(paragraph.slice(coreEnd, to), effective.slice(coreEnd, to))[0];
    chunks.push({ start: start + from, core, trail });
  }
  return chunks;
}

/** How wide `text` is when it is set in the style of `run`. */
export type Measure = (run: number, text: string) => number;

/** One piece of a line: consecutive words of one run, which are one object. */
export interface Piece {
  readonly run: number;
  readonly text: string;
  readonly width: number;
}

/** One line of a paragraph the layout produced. */
export interface FlowLineOut {
  /** Where its first unit is in the new words. */
  readonly start: number;
  readonly pieces: readonly Piece[];
  readonly width: number;
}

/** A float is equal to the limit when it is within a millionth of it. */
const WITHIN = 1e-6;

function widthOf(parts: readonly Part[], measure: Measure): number {
  return parts.reduce((sum, part) => sum + measure(part.run, part.text), 0);
}

/**
 * The chunk that cannot fit a whole line, as the head that fits and the rest: broken between grapheme clusters, never
 * inside one, and never leaving the head empty.
 */
function breakWide(chunk: Chunk, limit: number, measure: Measure): { head: Chunk; rest: Chunk | undefined } {
  const units: { run: number; text: string; at: number }[] = [];
  let offset = 0;
  for (const part of chunk.core) {
    const boundaries = [0, ...graphemeBoundaries(part.text), part.text.length];
    for (let at = 0; at < boundaries.length - 1; at += 1) {
      const text = part.text.slice(boundaries[at] ?? 0, boundaries[at + 1] ?? part.text.length);
      units.push({ run: part.run, text, at: offset + (boundaries[at] ?? 0) });
    }
    offset += part.text.length;
  }
  let width = 0;
  let take = 0;
  for (const unit of units) {
    const next = width + measure(unit.run, unit.text);
    if (take > 0 && next > limit + WITHIN) break;
    width = next;
    take += 1;
  }
  const headUnits = units.slice(0, take);
  const restUnits = units.slice(take);
  const join = (taken: typeof units): Part[] => {
    const parts: Part[] = [];
    for (const unit of taken) {
      const last = parts.at(-1);
      if (last?.run === unit.run) parts[parts.length - 1] = { run: unit.run, text: last.text + unit.text };
      else parts.push({ run: unit.run, text: unit.text });
    }
    return parts;
  };
  const headLength = headUnits.reduce((sum, unit) => sum + unit.text.length, 0);
  // NOTHING LEFT: the head is the whole word, and keeps the white space that followed it.
  if (restUnits.length === 0) return { head: { start: chunk.start, core: join(headUnits), trail: chunk.trail }, rest: undefined };
  return {
    head: { start: chunk.start, core: join(headUnits), trail: undefined },
    rest: { start: chunk.start + headLength, core: join(restUnits), trail: chunk.trail },
  };
}

/** The pieces of a line's parts: consecutive parts of one run are one. */
function piecesOf(parts: readonly Part[], measure: Measure): Piece[] {
  const pieces: { run: number; text: string }[] = [];
  for (const part of parts) {
    const last = pieces.at(-1);
    if (last?.run === part.run) pieces[pieces.length - 1] = { run: part.run, text: last.text + part.text };
    else pieces.push({ run: part.run, text: part.text });
  }
  return pieces.map((piece) => ({ ...piece, width: measure(piece.run, piece.text) }));
}

/** Where a paragraph's layout begins, and when it may stop. */
export interface LayOutFrom {
  /** The chunk the first line starts at. */
  readonly chunk: number;
  /** The line's number in its paragraph, 0 for the first, which takes `limits.first`. */
  readonly line: number;
  /** Whether the lines above are left alone, so a line that starts where an old one did ends the layout. */
  readonly stopAt?: (start: number) => boolean;
}

/**
 * Fills lines of a paragraph, greedily, from `from`.
 *
 * A line takes the next word while its width, the spaces between its words and that word's own width, are within the
 * limit; the white space after a line's last word is not kept and not counted. A word wider than a whole line is broken
 * between grapheme clusters, the last resort. Stops when `stopAt` says the line that would start next begins where an
 * old line did.
 *
 * @returns the lines, and where the layout stopped (`undefined` when it ran to the end of the paragraph)
 */
export function layOutParagraph(
  paragraph: FlowParagraph,
  measure: Measure,
  limits: { readonly first: number; readonly rest: number },
  from: LayOutFrom,
): { lines: FlowLineOut[]; stoppedAt: number | undefined } {
  const chunks = [...paragraph.chunks];
  const lines: FlowLineOut[] = [];
  let at = from.chunk;
  let number = from.line;
  while (at < chunks.length) {
    const limit = number === 0 ? limits.first : limits.rest;
    const parts: Part[] = [];
    let width = 0;
    let trail: Part | undefined;
    let trailWidth = 0;
    const start = chunks[at]?.start ?? paragraph.start;
    for (; at < chunks.length; at += 1) {
      const chunk = chunks[at];
      if (chunk === undefined) break;
      const word = widthOf(chunk.core, measure);
      if (parts.length === 0) {
        if (word > limit + WITHIN) {
          const { head, rest } = breakWide(chunk, limit, measure);
          chunks.splice(at, 1, ...(rest === undefined ? [head] : [head, rest]));
          const split = chunks[at];
          if (split === undefined) break;
          parts.push(...split.core);
          width = widthOf(split.core, measure);
          at += 1;
          break;
        }
      } else if (width + trailWidth + word > limit + WITHIN) {
        break;
      } else if (trail !== undefined) {
        parts.push(trail);
        width += trailWidth;
      }
      parts.push(...chunk.core);
      width += word;
      trail = chunk.trail;
      trailWidth = trail === undefined ? 0 : measure(trail.run, trail.text);
    }
    lines.push({ start, pieces: piecesOf(parts, measure), width });
    number += 1;
    const next = chunks[at];
    if (next !== undefined && from.stopAt?.(next.start) === true) return { lines, stoppedAt: next.start };
  }
  return { lines, stoppedAt: undefined };
}

/** One row of the block as it will stand: an old line kept, or a line set afresh. */
export type Row =
  | { readonly kind: 'old'; readonly line: number }
  | {
      readonly kind: 'new';
      readonly pieces: readonly Piece[];
      readonly width: number;
      /** Whether it is its paragraph's first line, which takes the paragraph's first-line indent. */
      readonly first: boolean;
      /** Whether it starts a paragraph that was not there: it takes the block's paragraph spacing above it. */
      readonly opens: boolean;
      /** The old line it stands in for, whose gap above it it keeps, or -1. */
      readonly replaces: number;
    }
  /** A paragraph with no words: a blank line the person left, kept at the pitch. */
  | { readonly kind: 'blank'; readonly opens: boolean };

/** What an edit does to a block. */
export interface BlockPlan {
  readonly attribution: Attribution;
  readonly rows: readonly Row[];
}

/** The line of `old` that holds `offset`. */
function lineAt(old: OldWords, offset: number): number {
  let line = 0;
  for (const [at, start] of old.lineStarts.entries()) {
    if (start <= offset) line = at;
  }
  return line;
}

/**
 * The lines a block has after an edit: which old lines stay, and which are set again and as what.
 *
 * @param lines the block's lines as the read answered them
 * @param text the words after the edit
 * @param measure how wide a piece of text is in a run's style
 * @param limits the width a paragraph's first line, and every other, may fill
 */
export function planBlock(
  lines: readonly FlowLine[],
  text: string,
  measure: Measure,
  limits: { readonly first: number; readonly rest: number },
): BlockPlan {
  const attribution = attribute(lines, text);
  const { old, from } = attribution;
  const rows: Row[] = [];
  /** The old paragraphs a new one already stands for: a split gives the second half to nobody, it is set afresh. */
  const claimed = new Set<number>();
  for (const paragraph of paragraphsOf(attribution)) {
    const { start, end } = paragraph;
    const opens = rows.length > 0;
    if (paragraph.chunks.length === 0) {
      rows.push({ kind: 'blank', opens });
      continue;
    }
    // THE OLD PARAGRAPH THIS ONE IS, by its first unit that was not typed: the words were written over it or in front of
    // it, and its lines are the ones to keep or set again.
    let anchor = -1;
    for (let unit = start; unit < end && anchor < 0; unit += 1) anchor = from[unit] ?? -1;
    const heldAt = anchor < 0 ? -1 : old.paragraphs.findIndex((candidate) => anchor >= candidate.start && anchor <= candidate.end);
    const held = heldAt < 0 || claimed.has(heldAt) ? undefined : old.paragraphs[heldAt];
    if (heldAt >= 0 && held !== undefined) claimed.add(heldAt);
    // WHERE THE PARAGRAPH FIRST DIFFERS FROM THE OLD ONE, in new units: the first unit that is not the next old one, or
    // the end where the old paragraph goes on past it.
    let change = start;
    if (held !== undefined) {
      while (change < end && from[change] === held.start + (change - start)) change += 1;
    }
    const identical = held !== undefined && change === end && held.start + (end - start) === held.end;
    if (identical) {
      for (let line = held.firstLine; line <= held.lastLine; line += 1) rows.push({ kind: 'old', line });
      continue;
    }

    // THE OLD LINE THE CHANGE IS IN, and one above it when the change is at its first unit, since the line above may
    // now take a word.
    let relaidFrom = -1;
    let begin = 0;
    let lineNumber = 0;
    if (held !== undefined) {
      const reach = change === start ? held.start : (from[change - 1] ?? held.start) + 1;
      let line = Math.max(held.firstLine, lineAt(old, Math.min(reach, held.end)));
      if (reach <= (old.lineStarts[line] ?? 0) && line > held.firstLine) line -= 1;
      // A LINE ENDS WHERE A CHUNK STARTS, or the layout would begin in the middle of a word: back up to one that does.
      const starts = new Set(paragraph.chunks.map((chunk) => chunk.start));
      while (line > held.firstLine && !starts.has(start + (old.lineStarts[line] ?? 0) - held.start)) line -= 1;
      relaidFrom = line;
      begin = Math.max(
        0,
        paragraph.chunks.findIndex((chunk) => chunk.start === start + (old.lineStarts[line] ?? 0) - held.start),
      );
      lineNumber = line - held.firstLine;
      for (let above = held.firstLine; above < line; above += 1) rows.push({ kind: 'old', line: above });
    }

    // A LINE THAT STARTS ON AN OLD LINE'S FIRST UNIT, with the rest of the paragraph exactly as it was, ends the layout.
    const resumes = (offset: number): boolean => {
      if (held === undefined) return false;
      const origin = from[offset] ?? -1;
      if (origin < 0 || !old.lineStarts.includes(origin) || origin <= (old.lineStarts[relaidFrom] ?? 0)) return false;
      for (let unit = offset; unit < end; unit += 1) {
        if (from[unit] !== origin + (unit - offset)) return false;
      }
      return origin + (end - offset) === held.end;
    };
    const { lines: laid, stoppedAt } = layOutParagraph(paragraph, measure, limits, {
      chunk: begin,
      line: lineNumber,
      stopAt: resumes,
    });
    let rejoin = held === undefined ? -1 : held.lastLine + 1;
    if (stoppedAt !== undefined) rejoin = lineAt(old, from[stoppedAt] ?? 0);
    for (const [at, line] of laid.entries()) {
      const stands = relaidFrom < 0 ? -1 : relaidFrom + at < rejoin ? relaidFrom + at : -1;
      if (stands >= 0 && sameLine(lines[stands], line)) rows.push({ kind: 'old', line: stands });
      else {
        rows.push({
          kind: 'new',
          pieces: line.pieces,
          width: line.width,
          first: lineNumber + at === 0,
          opens: at === 0 && relaidFrom < 0 && opens,
          replaces: stands,
        });
      }
    }
    if (stoppedAt !== undefined && held !== undefined) {
      for (let line = rejoin; line <= held.lastLine; line += 1) rows.push({ kind: 'old', line });
    }
  }
  return { attribution, rows };
}

/** Whether a new line says what an old one did, run for run. */
function sameLine(old: FlowLine | undefined, line: FlowLineOut): boolean {
  if (old === undefined) return false;
  const runs = old.runs.filter((run) => run.text !== '');
  if (runs.length !== line.pieces.length) return false;
  return line.pieces.every((piece, at) => {
    const run = runs[at];
    return run?.id === piece.run && run.text === piece.text;
  });
}
