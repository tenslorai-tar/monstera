import { describe, expect, it } from 'vitest';

import { type SearchOptions, type TextMatch, findInPages, lineOf } from './textSearch.js';
import { type PageText, parsePageText } from './textStructure.js';

/** A page built the way MuPDF returns one, so the search meets the real shape. */
function pageOf(...blocks: readonly (readonly string[])[]): PageText {
  return parsePageText(
    JSON.stringify({
      blocks: blocks.map((lines, block) => ({
        type: 'text',
        bbox: { x: 72, y: block * 40, w: 300, h: 32 },
        lines: lines.map((text, index) => ({
          x: 72,
          y: block * 40 + index * 16 + 13,
          font: { size: 12 },
          bbox: { x: 72, y: block * 40 + index * 16, w: 300, h: 16 },
          text,
        })),
      })),
    }),
  );
}

/**
 * The matches, or a failure naming the problem.
 *
 * `findInPages` answers a `Result` because an empty query and an unparseable
 * pattern are things a person types. Every case below is about a query that
 * compiles, so unwrapping here keeps them about matching — and it THROWS rather
 * than defaulting to `[]`, because an empty list is a search's reassuring answer
 * and a helper that produced one would hide a refusal in every case at once.
 */
function matchesOf(
  pages: readonly PageText[],
  query: string,
  options: SearchOptions = {},
): readonly TextMatch[] {
  const found = findInPages(pages, query, options);
  if (!found.ok) throw new Error(`this case expects a query that compiles: ${found.error}`);
  return found.value;
}

describe('findInPages', () => {
  it('finds a match and locates it by page, line and offset', () => {
    const pages = [pageOf(['the quick brown fox']), pageOf(['jumps over the lazy dog'])];

    expect(matchesOf(pages, 'lazy')).toStrictEqual([
      { page: 1, line: 0, offset: 15, text: 'jumps over the lazy dog' },
    ]);
  });

  it('is case-insensitive by default and exact when asked', () => {
    const pages = [pageOf(['PDF and pdf'])];

    expect(matchesOf(pages, 'pdf')).toHaveLength(2);
    expect(matchesOf(pages, 'pdf', { caseSensitive: true })).toStrictEqual([
      { page: 0, line: 0, offset: 8, text: 'PDF and pdf' },
    ]);
  });

  it('finds OVERLAPPING occurrences, because they are occurrences', () => {
    // Advancing by the needle's length would report one match here, and a
    // reader stepping through results would never be offered offset 1.
    expect(matchesOf([pageOf(['aaa'])], 'aa')).toHaveLength(2);
  });

  it('follows the READING ORDER the substrate produced, not the page layout', () => {
    // The two-column case, in the form ADR-0034 measured: `SEGMENT` puts a whole
    // column in one block. A search that walked blocks in bbox order, or sorted
    // by y, would return these the other way round — and would be the block
    // clusterer this substrate exists not to re-implement, arriving as a sort.
    const twoColumns = pageOf(['left0', 'left1'], ['right0', 'right1']);

    expect(matchesOf([twoColumns], 'left').map((match) => match.line)).toStrictEqual([0, 1]);
    expect(matchesOf([twoColumns], '0').map((match) => match.line)).toStrictEqual([0, 2]);
  });

  it('CONTROL: a page whose text it cannot reach yields nothing, not a crash', () => {
    // Zero matches is the reassuring answer for a search, so the case that
    // matters is the one asserting a REAL page finds something — above — and
    // this one only pins that an empty page is a legal input.
    expect(matchesOf([parsePageText('{"blocks":[]}')], 'anything')).toStrictEqual([]);
  });

  it('REFUSES an empty query rather than returning everything or nothing', () => {
    const answer = findInPages([pageOf(['text'])], '');
    expect(answer.ok).toBe(false);
    // THE REASON, not just the refusal. An unparseable pattern is refused here
    // too and means something entirely different to the person who typed it —
    // `ok: false` alone cannot tell a caller which message to show.
    if (!answer.ok) expect(answer.error).toBe('empty');
  });

  describe('the limit', () => {
    it('stops at the bound', () => {
      expect(matchesOf([pageOf(['a a a a'])], 'a', { limit: 2 })).toHaveLength(2);
    });

    it('is absent by default, so exhaustion and truncation stay distinguishable', () => {
      // With a default cap, "no more matches" and "the cap was reached" would be
      // the same observation for every caller that did not set one.
      expect(matchesOf([pageOf(['a a a a'])], 'a')).toHaveLength(4);
    });

    it('BOUNDS THE WHOLE SEARCH, not each page', () => {
      // The bug this separates: handing every page the caller's whole limit
      // returns up to `limit` matches PER PAGE, so the bound multiplies by the
      // document's length. A one-page fixture cannot see it — the two agree
      // there — which is why this one has three pages and a limit under the
      // first page's own count.
      const pages = [pageOf(['a a a']), pageOf(['a a a']), pageOf(['a a a'])];

      expect(matchesOf(pages, 'a', { limit: 2 })).toHaveLength(2);
      // AND ACROSS a page boundary, so the case is not satisfied by a limit
      // that stops the first page and forgets the rest.
      expect(matchesOf(pages, 'a', { limit: 4 }).map((match) => match.page)).toStrictEqual([
        0, 0, 0, 1,
      ]);
    });
  });

  describe('whole word', () => {
    it('matches a word and not the same letters inside another', () => {
      const pages = [pageOf(['cat catalogue concat cat.'])];

      expect(matchesOf(pages, 'cat')).toHaveLength(4);
      // Offsets 0 and 21: the bare word, and the one before a full stop. A
      // punctuation mark is not a word character, so a word at the end of a
      // sentence is still a word.
      expect(matchesOf(pages, 'cat', { wholeWord: true }).map((match) => match.offset)).toStrictEqual(
        [0, 21],
      );
    });

    it('treats a COMBINING MARK as part of the word, which `\\b` does not', () => {
      // The reason the boundary is decided by a Unicode property rather than by
      // wrapping the query in `\b`: JavaScript's `\b` is defined against ASCII
      // word characters, so it finds a boundary between "caf" and a combining
      // acute — and reports "caf" as a whole word in the middle of "café".
      const decomposed = pageOf([`café society`]);

      expect(matchesOf([decomposed], 'caf', { wholeWord: true })).toStrictEqual([]);
      // AND THE CONTROL: the whole word IS found, so the case above is not
      // passing because nothing matches this fixture at all.
      expect(matchesOf([decomposed], 'café', { wholeWord: true })).toHaveLength(1);
    });
  });

  describe('regular expressions', () => {
    it('matches a pattern, and the same text is a literal without the flag', () => {
      const pages = [pageOf(['page 12 of 340'])];

      expect(matchesOf(pages, '\\d+', { regex: true }).map((match) => match.offset)).toStrictEqual([
        5, 11,
      ]);
      // THE CONTROL. Without it, a build that always compiled the query as a
      // pattern would pass the assertion above and quietly make every search
      // with a `.` or a `(` in it mean something else.
      expect(matchesOf(pages, '\\d+')).toStrictEqual([]);
    });

    it('REPORTS an unparseable pattern rather than throwing', () => {
      // A person types `(` on the way to typing `(a)`. A throw here would make
      // a half-written query an exception in the document's lane.
      const answer = findInPages([pageOf(['text'])], '(', { regex: true });
      expect(answer.ok).toBe(false);
      if (!answer.ok) expect(answer.error).toBe('invalid-pattern');
    });

    it('does not hang on a pattern that can match nothing', () => {
      // `a*` matches the empty string at every position. A loop advancing by the
      // match's length would never move, and the case that catches it is one
      // that terminates rather than one that asserts a number — so the count is
      // asserted too, because a search that returned nothing would also
      // terminate.
      const found = matchesOf([pageOf(['ab'])], 'a*', { regex: true });
      expect(found.map((match) => match.offset)).toStrictEqual([0, 1, 2]);
    });

    it('starts each LINE at the beginning, which a shared cursor does not', () => {
      // A `g` regex carries `lastIndex` between calls. Reusing one across lines
      // starts each line where the previous stopped, so a match early in a later
      // line disappears — and only a fixture whose SECOND line matches before
      // the first line's match ended can see it.
      const pages = [pageOf(['xxxxxxxxxx needle', 'needle'])];

      expect(matchesOf(pages, 'needle', { regex: true }).map((match) => match.line)).toStrictEqual([
        0, 1,
      ]);
    });
  });

  describe('Unicode normalisation', () => {
    // `café` composed, and the same word with a combining acute. They are the
    // same text by Unicode's own definition and a PDF's extractor produces
    // whichever the font encoding held.
    const COMPOSED = 'café';
    const DECOMPOSED = 'café';

    it('finds a composed query in decomposed text, and the reverse', () => {
      expect(matchesOf([pageOf([DECOMPOSED])], COMPOSED)).toHaveLength(1);
      expect(matchesOf([pageOf([COMPOSED])], DECOMPOSED)).toHaveLength(1);
    });

    it("CONTROL: 'none' does not, so the case above is the normalisation", () => {
      expect(matchesOf([pageOf([DECOMPOSED])], COMPOSED, { normalise: 'none' })).toStrictEqual([]);
    });

    it('reports the NORMALISED line, so the offset indexes what was returned', () => {
      const [match] = matchesOf([pageOf([`x ${DECOMPOSED}`])], COMPOSED);
      if (match === undefined) throw new Error('one match was found above');

      // The raw line is 7 code units and the normalised one is 6. An offset
      // into the raw text would point one past the match.
      expect(match.text).toBe(`x ${COMPOSED}`);
      expect(match.text.slice(match.offset, match.offset + COMPOSED.length)).toBe(COMPOSED);
    });

    it('does NOT fold a compatibility form by default, and does under nfkc', () => {
      // NFC folds text that IS the same; NFKC folds forms that are a different
      // rendering of the same idea, which changes what the text says. The
      // ligature is the useful case and it is a choice rather than the default.
      const ligature = pageOf(['the ﬁnal page']);

      expect(matchesOf([ligature], 'final')).toStrictEqual([]);
      expect(matchesOf([ligature], 'final', { normalise: 'nfkc' })).toHaveLength(1);
    });
  });

  it('hands back the line a match sits in, with its Fitz-space box', () => {
    const pages = [pageOf(['left0', 'left1'], ['right0'])];
    const [, second] = matchesOf(pages, 'left');
    if (second === undefined) throw new Error('two matches were found above');

    const line = lineOf(pages, second);
    expect(line?.text).toBe('left1');
    // The box is what a highlight converts through `PageTransform`, which is
    // why search needs no second engine call to draw a result.
    expect(line?.box.topLeft.y).toBe(16);
  });
});
