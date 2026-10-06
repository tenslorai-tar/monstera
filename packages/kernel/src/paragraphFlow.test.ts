import { describe, expect, it } from 'vitest';

import {
  JOIN,
  type FlowLine,
  type Measure,
  attribute,
  layOutParagraph,
  oldWordsOf,
  paragraphsOf,
  planBlock,
} from './paragraphFlow.js';

/** Six points a character in every run but 7, the bold one, which sets eight. */
const BOLD = 7;
const measure: Measure = (run, text) => text.length * (run === BOLD ? 8 : 6);

/** The limit a line of twelve regular characters fills. */
const TWELVE = 72;
const LIMITS = { first: TWELVE, rest: TWELVE };

/**
 * A block from the text of each line's runs: ids count up from 1 in reading order, and `soft` says which lines end in a
 * soft wrap (the last never does).
 */
function block(lines: readonly (readonly string[])[], soft: readonly boolean[]): FlowLine[] {
  let id = 0;
  return lines.map((runs, at) => ({
    runs: runs.map((text) => {
      id += 1;
      return { id, text };
    }),
    soft: soft[at] === true && at < lines.length - 1,
  }));
}

/** The pieces of a row as `run:text`, which is how a line reads in these cases. */
function said(rows: ReturnType<typeof planBlock>['rows']): string[] {
  return rows.map((row) => {
    if (row.kind === 'old') return `old ${String(row.line)}`;
    if (row.kind === 'blank') return 'blank';
    return `new ${row.pieces.map((piece) => `${String(piece.run)}:${piece.text}`).join('|')}`;
  });
}

describe('the words of a block (ADR-0179 Decision 3)', () => {
  it('joins a soft end with one space, a hard end with a line break, and keeps a space the line already ends in', () => {
    const lines = block([['aaa bbb'], ['ccc '], ['ddd'], ['eee']], [true, true, false, false]);
    const old = oldWordsOf(lines);
    expect(old.text).toBe('aaa bbb ccc ddd\neee');
    // TWO JOINS, not three: the second line already ends in a space, which is its soft end.
    expect(old.owner.filter((owner) => owner === JOIN)).toHaveLength(2);
    expect(old.paragraphs.map((p) => [p.firstLine, p.lastLine])).toStrictEqual([[0, 2], [3, 3]]);
    expect(old.lineStarts).toStrictEqual([0, 8, 12, 16]);
  });
});

describe('attribute: every character belongs to the run that wrote it', () => {
  it('gives a typed word to the run it was typed into, and rebuilds the text exactly', () => {
    const lines = block([['aaa ', 'bbb'], ['ccc']], [true]);
    const result = attribute(lines, 'aaa xx bbb ccc');
    // aaa·xx·bbb·join·ccc: the typed words and the space after them take the run that followed the change.
    expect(result.owner).toStrictEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2, JOIN, 3, 3, 3]);
    expect([...result.texts]).toStrictEqual([[2, 'xx bbb']]);
    // THE RUN TEXTS AND THE JOINS REBUILD THE WORDS: nothing is lost and nothing made up.
    const rebuilt = result.owner.map((owner, at) => (owner === JOIN ? ' ' : (result.text[at] ?? ''))).join('');
    expect(rebuilt).toBe(result.text);
  });

  it('gives a word typed at the END of a line to that line’s last run, not the next line’s first', () => {
    const lines = block([['foo'], ['bar']], [true]);
    const result = attribute(lines, 'foox bar');
    expect(result.texts.get(1)).toBe('foox');
    expect(result.texts.has(2)).toBe(false);
  });

  it('CONTROL: a word typed at a boundary BETWEEN two runs of one line joins the one that follows', () => {
    const lines = block([['aaa ', 'bbb']], []);
    const result = attribute(lines, 'aaa xbbb');
    expect(result.texts.get(2)).toBe('xbbb');
    expect(result.texts.has(1)).toBe(false);
  });

  it('empties a run whose words were all deleted, and leaves the others unnamed', () => {
    const lines = block([['aaa ', 'bbb ', 'ccc']], []);
    const result = attribute(lines, 'aaa ccc');
    expect([...result.texts].sort()).toStrictEqual([[2, '']]);
  });

  it('keeps each paragraph’s own runs when the paragraphs are as many as the text’s: a translation', () => {
    const lines = block([['hello'], ['world']], [false]);
    const result = attribute(lines, 'bonjour\nmonde');
    expect(result.texts.get(1)).toBe('bonjour');
    expect(result.texts.get(2)).toBe('monde');
  });

  it('CONTROL: one diff across the block would give every new word to the first run', () => {
    const lines = block([['hello'], ['world']], [false]);
    // The same two paragraphs with a THIRD typed, so the counts differ and one diff runs: the first changed run takes
    // the middle, which is the behaviour the per-paragraph pairing exists to avoid for a translation.
    const result = attribute(lines, 'bonjour\nmonde\nencore');
    expect(result.texts.get(1)).toContain('bonjour');
  });

  it('splits a paragraph at a typed line break and keeps every word in its own run; a line break is no run’s text', () => {
    const lines = block([['aaa bbb ', 'ccc ddd']], []);
    const result = attribute(lines, 'aaa bbb \nccc ddd');
    const [first, second] = paragraphsOf(result);
    expect(first?.chunks.flatMap((chunk) => chunk.core.map((part) => part.run))).toStrictEqual([1, 1]);
    expect(second?.chunks.flatMap((chunk) => chunk.core.map((part) => part.run))).toStrictEqual([2, 2]);
    // NO RUN'S WORDS CHANGED: the break is a paragraph boundary, and an object cannot hold one.
    expect(result.texts.size).toBe(0);
  });

  it('matches a paragraph left alone across paragraphs typed above and below it', () => {
    const lines = block([['aaa'], ['bbb']], [false]);
    const result = attribute(lines, 'aaa\n\nbbb\nnew words');
    // `bbb` is retained, every one of its units the old ones, though there is a change on either side of it.
    const [, , third] = paragraphsOf(result);
    expect(result.from.slice(third?.start ?? 0, third?.end ?? 0)).toStrictEqual([4, 5, 6]);
  });

  it('never cuts a surrogate pair: a changed emoji is replaced whole', () => {
    const lines = block([['a\u{1f600}b']], []);
    const result = attribute(lines, 'a\u{1f601}b');
    expect(result.texts.get(1)).toBe('a\u{1f601}b');
    expect(result.text.length).toBe(4);
  });

  it('reports nothing changed for the same words', () => {
    const lines = block([['aaa'], ['bbb']], [true]);
    expect(attribute(lines, 'aaa bbb').changed).toBe(false);
  });
});

describe('the chunks a line is filled with (ADR-0179 Decision 4)', () => {
  it('breaks after spaces, and between words of a script written without them', () => {
    const lines = block([['abc 中文字 def']], []);
    const [paragraph] = paragraphsOf(attribute(lines, 'abc 中文字 def'));
    const words = paragraph?.chunks.map((chunk) => chunk.core.map((part) => part.text).join('')) ?? [];
    // ICU'S DICTIONARY DECIDES where inside the Chinese a line may break, so the case asserts that it may, and that
    // the spaced words either side of it are whole.
    expect(words[0]).toBe('abc');
    expect(words.at(-1)).toBe('def');
    expect(words.slice(1, -1).length).toBeGreaterThanOrEqual(2);
    expect(words.slice(1, -1).join('')).toBe('中文字');
  });

  it('keeps a word set in two runs as ONE chunk of two parts, so no line breaks between them', () => {
    const lines = block([['foo', 'bar baz']], []);
    const [paragraph] = paragraphsOf(attribute(lines, 'foobar baz'));
    expect(paragraph?.chunks[0]?.core).toStrictEqual([
      { run: 1, text: 'foo' },
      { run: 2, text: 'bar' },
    ]);
  });
});

describe('layOutParagraph', () => {
  function laid(text: string, limit = TWELVE): string[] {
    const [paragraph] = paragraphsOf(attribute(block([[text]], []), text));
    if (paragraph === undefined) throw new Error('no paragraph');
    return layOutParagraph(paragraph, measure, { first: limit, rest: limit }, { chunk: 0, line: 0 }).lines.map((line) =>
      line.pieces.map((piece) => piece.text).join(''),
    );
  }

  it('fills each line with every word that fits, and drops the space a line ends in', () => {
    expect(laid('aaa bbb ccc ddd eee fff')).toStrictEqual(['aaa bbb ccc', 'ddd eee fff']);
  });

  it('fits a word that reaches the limit exactly, and breaks one a character over', () => {
    expect(laid('aaaaaaaaaaaa')).toStrictEqual(['aaaaaaaaaaaa']);
    expect(laid('aaaaaa bbbbbb', 72)).toStrictEqual(['aaaaaa bbbbb'.slice(0, 6), 'bbbbbb']);
  });

  it('breaks a word wider than a whole line between graphemes, the last resort, and never leaves a line empty', () => {
    expect(laid('abcdefghijklmnopqrstuvwxy')).toStrictEqual(['abcdefghijkl', 'mnopqrstuvwx', 'y']);
    expect(laid('abc', 1)).toStrictEqual(['a', 'b', 'c']);
  });

  it('measures a bold run at its own width: a bold word that is wider wraps where a regular one would fit', () => {
    const lines: FlowLine[] = [{ runs: [{ id: 1, text: 'aaa ' }, { id: BOLD, text: 'bbbb' }], soft: false }];
    const [paragraph] = paragraphsOf(attribute(lines, 'aaa bbbb'));
    if (paragraph === undefined) throw new Error('no paragraph');
    // "aaa " is 24, "bbbb" bold is 32: 56 fits 72; at 50 it does not.
    expect(layOutParagraph(paragraph, measure, { first: 72, rest: 72 }, { chunk: 0, line: 0 }).lines).toHaveLength(1);
    expect(layOutParagraph(paragraph, measure, { first: 50, rest: 50 }, { chunk: 0, line: 0 }).lines).toHaveLength(2);
  });

  it('takes the first line’s limit for line 0 and the rest’s for the others', () => {
    const [paragraph] = paragraphsOf(attribute(block([['aaa bbb ccc ddd']], []), 'aaa bbb ccc ddd'));
    if (paragraph === undefined) throw new Error('no paragraph');
    const { lines } = layOutParagraph(paragraph, measure, { first: 36, rest: 72 }, { chunk: 0, line: 0 });
    expect(lines.map((line) => line.pieces.map((piece) => piece.text).join(''))).toStrictEqual(['aaa', 'bbb ccc ddd'.slice(0, 11)]);
  });
});

describe('planBlock: a paragraph reflows from its first changed line and stops where it comes back into step', () => {
  // twelve characters a line: "aaa bbb" (the next word, ten letters, will not fit), "cccccccccc", "dd eee".
  const paragraph = (): FlowLine[] => block([['aaa bbb'], ['cccccccccc'], ['dd eee']], [true, true, false]);

  it('answers every line as it was for words that are the same', () => {
    expect(said(planBlock(paragraph(), 'aaa bbb cccccccccc dd eee', measure, LIMITS).rows)).toStrictEqual([
      'old 0',
      'old 1',
      'old 2',
    ]);
  });

  it('sets the line a word was typed into and leaves every line below it, which come back into step', () => {
    const plan = planBlock(paragraph(), 'aaa bbbx cccccccccc dd eee', measure, LIMITS);
    expect(said(plan.rows)).toStrictEqual(['new 1:aaa bbbx', 'old 1', 'old 2']);
  });

  it('CONTROL: a layout that does not stop at an old line start sets every line below the change', () => {
    const [laidParagraph] = paragraphsOf(attribute(paragraph(), 'aaa bbbx cccccccccc dd eee'));
    if (laidParagraph === undefined) throw new Error('no paragraph');
    const everything = layOutParagraph(laidParagraph, measure, LIMITS, { chunk: 0, line: 0 });
    expect(everything.lines).toHaveLength(3);
    expect(everything.stoppedAt).toBeUndefined();
  });

  it('fills the changed line first, then the next, and leaves the lines it comes back into step with', () => {
    // "zzzz yyyy " goes in at the start of the second line. The first line takes what fits of it, the next holds the
    // rest, and the two old lines below are exactly as they were: the paragraph was not set again from the top.
    const plan = planBlock(paragraph(), 'aaa bbb zzzz yyyy cccccccccc dd eee', measure, LIMITS);
    const lines = said(plan.rows);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('aaa bbb ');
    expect(lines[0]).toContain('zzzz');
    expect(lines[1]).toContain('yyyy');
    expect(lines.slice(2)).toStrictEqual(['old 1', 'old 2']);
  });

  it('CONTROL: the same words with a layout that never stops set every line below, which the plan did not', () => {
    const [laidParagraph] = paragraphsOf(attribute(paragraph(), 'aaa bbb zzzz yyyy cccccccccc dd eee'));
    if (laidParagraph === undefined) throw new Error('no paragraph');
    const everything = layOutParagraph(laidParagraph, measure, LIMITS, { chunk: 0, line: 0 }).lines;
    const plan = planBlock(paragraph(), 'aaa bbb zzzz yyyy cccccccccc dd eee', measure, LIMITS);
    expect(everything).toHaveLength(4);
    expect(plan.rows.filter((row) => row.kind === 'new')).toHaveLength(2);
  });

  it('keeps the style of a word that wraps: a bold word stays in the bold run on the next line', () => {
    const lines: FlowLine[] = [
      { runs: [{ id: 1, text: 'aaa bbb ' }, { id: BOLD, text: 'ccc' }], soft: false },
    ];
    const plan = planBlock(lines, 'aaa bbb xxxx ccc', measure, { first: 72, rest: 72 });
    const rows = plan.rows.filter((row) => row.kind === 'new');
    const second = rows[1];
    expect(second?.kind === 'new' ? second.pieces.map((piece) => piece.run) : []).toContain(BOLD);
  });

  it('pulls a word up to the line above when the change is at the first character of a line', () => {
    // 'aaa bbb' / 'cccccccccc' / 'dd eee': deleting "cccccccccc " leaves "dd" able to join the first line.
    const plan = planBlock(paragraph(), 'aaa bbb dd eee', measure, LIMITS);
    const [first] = plan.rows;
    expect(first?.kind === 'new' ? first.pieces.map((piece) => piece.text).join('') : '').toBe('aaa bbb dd');
    // AND IN THE RUNS THAT WROTE THEM: the first words in line 1's run, "dd" in the run of the line it came from.
    expect(first?.kind === 'new' ? first.pieces.map((piece) => piece.run) : []).toStrictEqual([1, 3]);
  });

  it('answers no rows for a paragraph that was deleted, and keeps the others’ lines', () => {
    const lines = block([['aaa'], ['bbb'], ['ccc']], [false, false]);
    expect(said(planBlock(lines, 'aaa\nccc', measure, LIMITS).rows)).toStrictEqual(['old 0', 'old 2']);
  });

  it('opens a new paragraph with its own lines, and a blank one for an empty paragraph', () => {
    const lines = block([['aaa'], ['bbb']], [false]);
    const plan = planBlock(lines, 'aaa\n\nbbb\nnew words', measure, LIMITS);
    const rows = said(plan.rows);
    expect(rows[0]).toBe('old 0');
    expect(rows[1]).toBe('blank');
    expect(rows[2]).toBe('old 1');
    expect(rows[3]?.startsWith('new')).toBe(true);
    const opened = plan.rows[3];
    expect(opened?.kind === 'new' && opened.opens && opened.first).toBe(true);
  });

  it('splits a paragraph at a typed line break and sets the second half afresh in its own runs', () => {
    const lines = block([['aaa bbb ccc ddd eee fff']], []);
    const plan = planBlock(lines, 'aaa bbb ccc\nddd eee fff', measure, LIMITS);
    expect(said(plan.rows)).toStrictEqual(['new 1:aaa bbb ccc', 'new 1:ddd eee fff']);
  });

  it('answers the first line of a paragraph as first and the others as not', () => {
    const plan = planBlock(paragraph(), 'zzz bbb cccccccccc dd eee', measure, LIMITS);
    const flags = plan.rows.map((row) => (row.kind === 'new' ? row.first : undefined));
    expect(flags[0]).toBe(true);
  });
});
