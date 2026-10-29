import { joinAfterLine } from '@monstera/shared';

import { breakOpportunities } from './lineBreaks.js';

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

/**
 * For each unit of the new words, the unit of the old words it IS, or -1 where it is new: {@link attribute}'s `from`,
 * with every whole word inside a typed stretch that is an old word of the stretch it replaced given back to that word.
 *
 * `attribute` keeps a common prefix and suffix of characters and calls the rest typed, which is what says whose run each
 * unit is. Which words the page already said is a finer question, and that answer is too coarse for it two ways: a tab
 * typed before the first word and a word changed at the end make every word between them typed, though nobody touched
 * them; and the prefix or suffix can end inside a word, so `one two three` made `one two two three` gives the old
 * `three`'s `t` to the typed `two`. So the question is asked of WHOLE words: a word is said as it stands where every unit
 * of it is an old unit, in order and unbroken; the words that are not, and the old words between the said ones either
 * side of them, are matched whole, in order, by the longest common subsequence {@link matchParagraphs} already takes.
 * A word typed between two old ones is then new however it is spelt, and an old word moved past others is not given
 * back. White space between words keeps what `attribute` said of it.
 */
export function saidUnits(attribution: Attribution): number[] {
  const { old, text, from } = attribution;
  const said = [...from];
  const words = wordsIn(text, 0, text.length);
  const intact = (word: Word): boolean => {
    const first = from[word.at] ?? -1;
    if (first < 0) return false;
    for (let unit = 1; unit < word.text.length; unit += 1) if (from[word.at + unit] !== first + unit) return false;
    return true;
  };
  let at = 0;
  while (at < words.length) {
    const word = words[at];
    if (word === undefined || intact(word)) {
      at += 1;
      continue;
    }
    const start = at;
    for (let each = words[at]; each !== undefined && !intact(each); each = words[at]) at += 1;
    const group = words.slice(start, at);
    for (const each of group) for (let unit = 0; unit < each.text.length; unit += 1) said[each.at + unit] = -1;
    // THE OLD WORDS THE GROUP STANDS FOR: between the said words either side of it.
    const previous = words[start - 1];
    const next = words[at];
    const lo = previous === undefined ? 0 : (from[previous.at + previous.text.length - 1] ?? -1) + 1;
    const hi = next === undefined ? old.text.length : (from[next.at] ?? old.text.length);
    if (hi <= lo) continue;
    const before = wordsIn(old.text, lo, hi);
    for (const [i, j] of matchParagraphs(before.map((each) => each.text), group.map((each) => each.text))) {
      const was = before[i];
      const now = group[j];
      if (was === undefined || now === undefined) continue;
      for (let unit = 0; unit < now.text.length; unit += 1) said[now.at + unit] = was.at + unit;
    }
  }
  return said;
}

/** A word of a text, whole, and where it starts. */
interface Word {
  readonly text: string;
  readonly at: number;
}

/** The words of `text` from `lo` to `hi`, each with where it starts: what is not white space, whole. */
function wordsIn(text: string, lo: number, hi: number): Word[] {
  return [...text.slice(lo, hi).matchAll(/\S+/gu)].map((match) => ({ text: match[0], at: lo + match.index }));
}

/** A stretch of one paragraph's characters set by one run. */
export interface Part {
  readonly run: number;
  /** The mark whose style these words take ({@link NO_MARK} for the run's own), ADR-0180. */
  readonly mark: number;
  readonly text: string;
  /** Where its first unit is in the new words: what tells a word the person typed from one the page already said. */
  readonly at: number;
}

/** A word no mark names: set in the style of the run that wrote it. */
export const NO_MARK = -1;

/** Which of a block's marks covers each unit of its words, and whether a mark changes what a run already is. */
export interface Formatting {
  /** The span each mark covers, `[from, to)` in UTF-16 units of the new words. */
  readonly marks: readonly { readonly from: number; readonly to: number }[];
  /**
   * Whether mark `mark` changes the style of run `run`. A mark that restates what a run already is changes nothing, and
   * its words are set as the run's, so a re-sent block with every style it already had writes no line again.
   */
  readonly changes: (run: number, mark: number) => boolean;
  /** Paragraphs (by place in the new words) whose settings changed, which are set again even where their words did not. */
  readonly forced?: ReadonlySet<number>;
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

/** Runs of consecutive units with one owner and one mark, as parts; `base` is where `text` starts in the new words. */
function partsOf(text: string, owners: readonly number[], marks: readonly number[], base: number): Part[] {
  const parts: Part[] = [];
  for (const [at, owner] of owners.entries()) {
    const unit = text[at] ?? '';
    const mark = marks[at] ?? NO_MARK;
    const last = parts.at(-1);
    if (last?.run === owner && last.mark === mark) parts[parts.length - 1] = { ...last, text: last.text + unit };
    else parts.push({ run: owner, mark, text: unit, at: base + at });
  }
  return parts;
}

/**
 * Which mark each unit of the new words takes: the one covering it where it changes the style of the run the unit's
 * word is in, and {@link NO_MARK} everywhere else. Asked per unit, so a mark across two runs applies to the one it
 * changes and not to the one it restates.
 */
function styleOfUnits(attribution: Attribution, formatting: Formatting | undefined): number[] {
  const styles = Array.from({ length: attribution.text.length }, () => NO_MARK);
  if (formatting === undefined) return styles;
  let previous = JOIN;
  const effective = attribution.owner.map((own) => {
    const run = own === JOIN ? previous : own;
    previous = run;
    return run;
  });
  const first = effective.find((run) => run !== JOIN) ?? JOIN;
  for (const [mark, span] of formatting.marks.entries()) {
    for (let at = span.from; at < Math.min(span.to, styles.length); at += 1) {
      const run = effective[at] === JOIN ? first : (effective[at] ?? first);
      if (formatting.changes(run, mark)) styles[at] = mark;
    }
  }
  return styles;
}

/** The paragraphs of the new words, each as chunks a line is filled with. */
export function paragraphsOf(attribution: Attribution, formatting?: Formatting): FlowParagraph[] {
  const { text, owner } = attribution;
  const styles = styleOfUnits(attribution, formatting);
  const paragraphs: FlowParagraph[] = [];
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    paragraphs.push({ start, end, chunks: chunksOf(text, owner, styles, start, end) });
    if (newline === -1) break;
    start = newline + 1;
  }
  return paragraphs;
}

function chunksOf(text: string, owner: readonly number[], styles: readonly number[], start: number, end: number): Chunk[] {
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
    const marks = styles.slice(start, end);
    const core = partsOf(paragraph.slice(from, coreEnd), effective.slice(from, coreEnd), marks.slice(from, coreEnd), start + from);
    // THE WHOLE WHITE SPACE, in the style of its first run: a space in one run and a tab typed after it in another were
    // two parts, and only the first was kept, so the tab was dropped from the words.
    const trailParts =
      spaces === 0 ? [] : partsOf(paragraph.slice(coreEnd, to), effective.slice(coreEnd, to), marks.slice(coreEnd, to), start + coreEnd);
    const firstTrail = trailParts[0];
    const trail = firstTrail === undefined ? undefined : { ...firstTrail, text: trailParts.map((part) => part.text).join('') };
    chunks.push({ start: start + from, core, trail });
  }
  return chunks;
}

/**
 * How wide `text` is when it is set in the style of `run`, with the style `mark` makes of it ({@link NO_MARK}: none). `at`
 * is where `text` starts in the new words, so a writer can tell a word the person typed from one the page already said,
 * which may be set in different fonts (operator writer, the owner's font rule).
 */
export type Measure = (run: number, mark: number, text: string, at: number) => number;

/** One piece of a line: consecutive words of one run and one mark, which are one object. */
export interface Piece {
  readonly run: number;
  readonly mark: number;
  readonly text: string;
  readonly width: number;
  /** Where its first unit is in the new words. */
  readonly at: number;
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
  return parts.reduce((sum, part) => sum + measure(part.run, part.mark, part.text, part.at), 0);
}

/** The pieces of a line's parts: consecutive parts of one run and one mark are one, and begin where the first does. */
function piecesOf(parts: readonly Part[], measure: Measure): Piece[] {
  const pieces: { run: number; mark: number; text: string; at: number }[] = [];
  for (const part of parts) {
    const last = pieces.at(-1);
    if (last?.run === part.run && last.mark === part.mark) {
      pieces[pieces.length - 1] = { ...last, text: last.text + part.text };
    } else pieces.push({ run: part.run, mark: part.mark, text: part.text, at: part.at });
  }
  return pieces.map((piece) => ({ ...piece, width: measure(piece.run, piece.mark, piece.text, piece.at) }));
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
 * limit; the white space after a line's last word is not kept and not counted. A word wider than a whole line is set
 * whole on a line of its own, never broken (ADR-0275). Stops when `stopAt` says the line that would start next begins
 * where an old line did.
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
  // A TAB IN THE WHITE SPACE A LINE ENDS IN, and what follows it, which starts the next line rather than being dropped
  // with the spaces (the owner's W9: Home goes to the start of a VISUAL line, after the space the line above ends in,
  // and a tab typed there was the trail of that line's last word).
  let carried: { readonly part: Part; readonly start: number } | undefined;
  while (at < chunks.length) {
    const limit = number === 0 ? limits.first : limits.rest;
    const parts: Part[] = [];
    let width = 0;
    let trail: Part | undefined;
    let trailWidth = 0;
    const start = carried?.start ?? chunks[at]?.start ?? paragraph.start;
    if (carried !== undefined) {
      parts.push(carried.part);
      width += measure(carried.part.run, carried.part.mark, carried.part.text, carried.part.at);
      carried = undefined;
    }
    for (; at < chunks.length; at += 1) {
      const chunk = chunks[at];
      if (chunk === undefined) break;
      // WHITE SPACE BEFORE A PARAGRAPH'S FIRST WORD is the one chunk with no word: a break opportunity follows white
      // space, so anywhere else it is the trail of the word before it. A person typed it (Home then Tab, the owner's W9),
      // so it is set as the line's start; the next word then joins it as any word joins the one before.
      if (parts.length === 0 && chunk.core.length === 0 && chunk.trail !== undefined) {
        parts.push(chunk.trail);
        width += measure(chunk.trail.run, chunk.trail.mark, chunk.trail.text, chunk.trail.at);
        continue;
      }
      const word = widthOf(chunk.core, measure);
      if (parts.length === 0) {
        // A WORD WIDER THAN THE WHOLE LINE is set whole on a line of its own, past the limit: a word is never broken
        // between its letters (ADR-0275). `planBlock` widens a block's limits to its widest word, so there this only
        // keeps the rule for a caller that has not.
        if (word > limit + WITHIN) {
          parts.push(...chunk.core);
          width = word;
          at += 1;
          break;
        }
      } else if (width + trailWidth + word > limit + WITHIN) {
        const tab = trail?.text.indexOf('\t') ?? -1;
        const ended = chunks[at - 1];
        if (trail !== undefined && tab >= 0 && ended !== undefined) {
          const coreLength = ended.core.reduce((total, part) => total + part.text.length, 0);
          carried = { part: { ...trail, text: trail.text.slice(tab), at: trail.at + tab }, start: ended.start + coreLength + tab };
        }
        break;
      } else if (trail !== undefined) {
        parts.push(trail);
        width += trailWidth;
      }
      parts.push(...chunk.core);
      width += word;
      trail = chunk.trail;
      trailWidth = trail === undefined ? 0 : measure(trail.run, trail.mark, trail.text, trail.at);
    }
    lines.push({ start, pieces: piecesOf(parts, measure), width });
    number += 1;
    const next = chunks[at];
    // A CARRIED TAB STARTS THE NEXT LINE, which no old line did, so the layout does not stop before setting it.
    if (carried === undefined && next !== undefined && from.stopAt?.(next.start) === true) return { lines, stoppedAt: next.start };
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
      /** Whether it ends its paragraph: a justified paragraph's last line is not stretched (ADR-0228 Decision 1). */
      readonly last: boolean;
      /** Whether it starts a paragraph that was not there: it takes the block's paragraph spacing above it. */
      readonly opens: boolean;
      /** The old line it stands in for, whose gap above it it keeps, or -1. */
      readonly replaces: number;
      /** The paragraph it belongs to, by place in the new words, for the settings that paragraph has. */
      readonly paragraph: number;
      /** The OLD paragraph whose edges it is set in ({@link planBlock}): the place the editor draws it, by the same rule. */
      readonly shapedBy: number;
    }
  /** A paragraph with no words: a blank line the person left, kept at the pitch. */
  | { readonly kind: 'blank'; readonly opens: boolean; readonly paragraph: number };

/** The widths a paragraph's first line, and every other, may fill. */
export interface Limits {
  readonly first: number;
  readonly rest: number;
}

/** What an edit does to a block. */
export interface BlockPlan {
  readonly attribution: Attribution;
  readonly rows: readonly Row[];
}

/**
 * The smallest a fitted block is scaled to: 11-point text at 0.6 is 6.6 points, the size of fine
 * print, and smaller is not a translation anyone can read (ADR-0097 4b). A block needing more is
 * written at this and may overlap what is below it.
 */
export const MIN_FIT = 0.6;

/**
 * How many bisection steps find a block's scale: the interval [0.6, 1] halved six times is 0.00625
 * wide — at 11 points, under a tenth of a point of size, which no reader sees.
 */
export const FIT_STEPS = 6;

/**
 * The largest scale in [{@link MIN_FIT}, 1] at which a block `fits`, by bisection: 1 where it fits whole, and the floor,
 * accepted without a trial, where it does not fit even at it (ADR-0097 4b, and ADR-0181 Decision 10 for the writer that
 * has no trial pages and asks the plan itself). The PDFium writer asks the same question of a thrown-away page and
 * shares the bounds and the step count, so a translation shrinks to the same size on either writer.
 */
export function largestFit(fits: (scale: number) => boolean): number {
  if (fits(1)) return 1;
  let low = MIN_FIT;
  let high = 1;
  for (let step = 0; step < FIT_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
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
 * @param limits the width a paragraph's first line, and every other, may fill; or, per paragraph (by place in the new
 * words, and the old paragraph whose edges it is set in), where the person set one differently (ADR-0180 Decision 2) or
 * the paragraph's own edges set it (ADR-0179's correction of 2026-10-24)
 * @param formatting what spans of the words are, and which paragraphs' settings changed (ADR-0180 Decision 1)
 */
export function planBlock(
  lines: readonly FlowLine[],
  text: string,
  measure: Measure,
  limits: Limits | ((paragraph: number, shapedBy: number) => Limits),
  formatting?: Formatting,
): BlockPlan {
  const attribution = attribute(lines, text);
  const { old, from } = attribution;
  const styles = styleOfUnits(attribution, formatting);
  /** The old paragraph the paragraph before was set in, which a paragraph made only of typed words takes too. */
  let shapedBefore = 0;
  const paragraphs = paragraphsOf(attribution, formatting).map((paragraph, place) => {
    // THE OLD PARAGRAPH THIS ONE IS, by its first unit that was not typed: the words were written over it or in front of
    // it, and its lines are the ones to keep or set again.
    let anchor = -1;
    for (let unit = paragraph.start; unit < paragraph.end && anchor < 0; unit += 1) anchor = from[unit] ?? -1;
    const heldAt = anchor < 0 ? -1 : old.paragraphs.findIndex((candidate) => anchor >= candidate.start && anchor <= candidate.end);
    // THE EDGES IT IS SET IN are that old paragraph's — the half of one Enter split included, as the editor's own paragraph
    // after a split keeps the one it was split from — or, for words all typed, the paragraph's before it.
    const shapedBy = heldAt >= 0 ? heldAt : shapedBefore;
    shapedBefore = shapedBy;
    return { paragraph, heldAt, shapedBy, limits: typeof limits === 'function' ? limits(place, shapedBy) : limits };
  });
  // A WORD WIDER THAN ITS LINE WIDENS THE WHOLE BLOCK BY WHAT IT OVERFLOWS (ADR-0275): a word is never broken, and the
  // editor's surface is at least as wide as its longest word with that word's paragraph's indent, so where one word laid
  // out does not fit, every paragraph is laid out again with that much more width, and every line wraps where the person
  // sees it. ONLY WORDS LAID OUT ARE MEASURED: a writer's measure of a word its fonts cannot set names its letters for a
  // face, so measuring the words of lines kept as they were refused a move of a block whose font has no ToUnicode
  // (measured 2026-10-29, `proof:editobject`'s font-kind fixtures, when every word was measured ahead of the plan).
  const first = planWith(0);
  return { attribution, rows: (first.overflow > 0 ? planWith(first.overflow) : first).rows };

  /** The rows with every limit `extra` wider, and the most a laid-out line overflows its own limit by. */
  function planWith(extra: number): { readonly rows: Row[]; readonly overflow: number } {
    const rows: Row[] = [];
    /** The old paragraphs a new one already stands for: a split gives the second half to nobody, it is set afresh. */
    const claimed = new Set<number>();
    let overflow = 0;
    for (const [place, { paragraph, heldAt, shapedBy, limits: given }] of paragraphs.entries()) {
      const { start, end } = paragraph;
      const opens = rows.length > 0;
      const limitsHere = extra === 0 ? given : { first: given.first + extra, rest: given.rest + extra };
      if (paragraph.chunks.length === 0) {
        rows.push({ kind: 'blank', opens, paragraph: place });
        continue;
      }
      // A PARAGRAPH THE PERSON FORMATTED OR RE-SET is laid out again whole, where an unformatted one keeps what it can.
      const formatted = formatting?.forced?.has(place) === true || styles.slice(start, end).some((style) => style !== NO_MARK);
      const held = heldAt < 0 || claimed.has(heldAt) ? undefined : old.paragraphs[heldAt];
      if (heldAt >= 0 && held !== undefined) claimed.add(heldAt);
      // WHERE THE PARAGRAPH FIRST DIFFERS FROM THE OLD ONE, in new units: the first unit that is not the next old one, or
      // the end where the old paragraph goes on past it.
      let change = start;
      if (held !== undefined && !formatted) {
        while (change < end && from[change] === held.start + (change - start)) change += 1;
      }
      const identical = held !== undefined && !formatted && change === end && held.start + (end - start) === held.end;
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
        if (held === undefined || formatted) return false;
        const origin = from[offset] ?? -1;
        if (origin < 0 || !old.lineStarts.includes(origin) || origin <= (old.lineStarts[relaidFrom] ?? 0)) return false;
        for (let unit = offset; unit < end; unit += 1) {
          if (from[unit] !== origin + (unit - offset)) return false;
        }
        return origin + (end - offset) === held.end;
      };
      const { lines: laid, stoppedAt } = layOutParagraph(paragraph, measure, limitsHere, {
        chunk: begin,
        line: lineNumber,
        stopAt: resumes,
      });
      let rejoin = held === undefined ? -1 : held.lastLine + 1;
      if (stoppedAt !== undefined) rejoin = lineAt(old, from[stoppedAt] ?? 0);
      for (const [at, line] of laid.entries()) {
        // A LINE PAST ITS LIMIT is a word wider than it, set whole on a line of its own (`layOutParagraph`).
        overflow = Math.max(overflow, line.width - (lineNumber + at === 0 ? limitsHere.first : limitsHere.rest));
        const stands = relaidFrom < 0 ? -1 : relaidFrom + at < rejoin ? relaidFrom + at : -1;
        // A FORMATTED OR RE-SET PARAGRAPH IS NEVER KEPT by saying the same words: where its lines stand is what changed.
        if (stands >= 0 && !formatted && sameLine(lines[stands], line)) rows.push({ kind: 'old', line: stands });
        else {
          rows.push({
            kind: 'new',
            pieces: line.pieces,
            width: line.width,
            first: lineNumber + at === 0,
            // THE PARAGRAPH'S LAST LINE, unless the layout stopped where the old lines resume, which then end it.
            last: at === laid.length - 1 && stoppedAt === undefined,
            opens: at === 0 && relaidFrom < 0 && opens,
            replaces: stands,
            paragraph: place,
            shapedBy,
          });
        }
      }
      if (stoppedAt !== undefined && held !== undefined) {
        for (let line = rejoin; line <= held.lastLine; line += 1) rows.push({ kind: 'old', line });
      }
    }
    return { rows, overflow: overflow > WITHIN ? overflow : 0 };
  }
}

/** Whether a new line says what an old one did, run for run. */
function sameLine(old: FlowLine | undefined, line: FlowLineOut): boolean {
  if (old === undefined) return false;
  const runs = old.runs.filter((run) => run.text !== '');
  if (runs.length !== line.pieces.length) return false;
  return line.pieces.every((piece, at) => {
    const run = runs[at];
    return run?.id === piece.run && run.text === piece.text && piece.mark === NO_MARK;
  });
}
