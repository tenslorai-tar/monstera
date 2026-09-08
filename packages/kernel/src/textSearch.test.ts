import { MATCH_TEXT_WINDOW } from '@monstera/shared';
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
      { page: 1, line: 0, offset: 15, endLine: 0, endOffset: 19, text: 'jumps over the lazy dog' },
    ]);
  });

  it('is case-insensitive by default and exact when asked', () => {
    const pages = [pageOf(['PDF and pdf'])];

    expect(matchesOf(pages, 'pdf')).toHaveLength(2);
    expect(matchesOf(pages, 'pdf', { caseSensitive: true })).toStrictEqual([
      { page: 0, line: 0, offset: 8, endLine: 0, endOffset: 11, text: 'PDF and pdf' },
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

  describe('a line the DOCUMENT made long', () => {
    // Invariant L11 at the one place a document chooses a payload's size. A
    // line's length is whatever the PDF's author wrote, and every match carries
    // its line — up to the channel's match limit, per call.
    const long = 'x'.repeat(20_000);

    it('CLIPS the line to the window, and moves the offset with it', () => {
      const pages = [pageOf([`${long}needle${long}`])];

      const [match] = matchesOf(pages, 'needle');
      if (match === undefined) throw new Error('one match was found above');

      expect(match.text.length).toBe(MATCH_TEXT_WINDOW);
      // THE PAIR STILL HOLDS, which is the whole reason the offset moves: a
      // clip that left the offset alone would point past the end of the string
      // it was handed, and a highlighter would draw nothing or throw.
      expect(match.text.slice(match.offset, match.offset + 'needle'.length)).toBe('needle');
    });

    it('keeps the line WHOLE when it fits, so ordinary results are untouched', () => {
      // The control. Without it, the case above passes for a build that clips
      // every line to 1024 characters — which would silently shorten every
      // result in a document nobody would call hostile.
      const short = 'the needle sits here';
      const [match] = matchesOf([pageOf([short])], 'needle');

      expect(match?.text).toBe(short);
    });

    it('keeps the offset inside the window for a match at the very END', () => {
      // The edge the arithmetic is about: the window cannot start at the match
      // when there is not a window's worth of line left, so it starts earlier
      // and the offset has to follow. A clip that always started at the match
      // would run past the end of the line.
      const pages = [pageOf([`${long}needle`])];

      const [match] = matchesOf(pages, 'needle');
      if (match === undefined) throw new Error('one match was found above');

      expect(match.offset).toBeLessThan(MATCH_TEXT_WINDOW);
      expect(match.text.slice(match.offset)).toBe('needle');
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

    it('starts each PAGE at the beginning, which a shared cursor does not', () => {
      // A `g` regex carries `lastIndex` between calls, and `findInPages` hands
      // the same compiled query to every page — so without the reset, page 2
      // starts where page 1 stopped and a match early in it disappears.
      //
      // THIS FIXTURE WAS TWO LINES OF ONE PAGE until the search began joining a
      // page into one unit, at which point a single `exec` walk covered both
      // and the case could not fail however the cursor behaved. The boundary
      // the defect now lives at is the page, so that is where the fixture is.
      const pages = [pageOf(['xxxxxxxxxx needle']), pageOf(['needle'])];

      expect(matchesOf(pages, 'needle', { regex: true }).map((match) => match.page)).toStrictEqual([
        0, 1,
      ]);
    });

    it('keeps `^` and `$` meaning a LINE, which the page-wide unit would not', () => {
      // The load-bearing case for the `m` flag. A page of table cells is where
      // this is asked for — `^\d+$` finds the cells holding only a number —
      // and joining the lines without `m` would silently turn it into a
      // question about the whole page, which matches nothing here.
      const pages = [pageOf(['12', 'page 12 of 340', '340'])];

      expect(
        matchesOf(pages, '^\\d+$', { regex: true }).map((match) => match.line),
      ).toStrictEqual([0, 2]);
    });

    it('does NOT cross a break unless the pattern asks, because `.` is not `\\n`', () => {
      const pages = [pageOf(['hello', 'world'])];

      // The control and the case in one fixture: the same two words, one
      // pattern that cannot cross and one that says it may.
      expect(matchesOf(pages, 'hello.world', { regex: true })).toStrictEqual([]);
      expect(
        matchesOf(pages, 'hello\\s+world', { regex: true }).map((match) => ({
          line: match.line,
          endLine: match.endLine,
        })),
      ).toStrictEqual([{ line: 0, endLine: 1 }]);
    });
  });

  describe('a match that spans a line break', () => {
    it('FINDS a phrase the typesetter wrapped, and says where it starts and ends', () => {
      // The defect this closes: a reader searching for a phrase does not know
      // where the column was broken, so a per-line search answers "not found"
      // in exactly the voice of a genuine absence.
      const pages = [pageOf(['the quick brown', 'fox jumps over'])];

      expect(matchesOf(pages, 'brown fox')).toStrictEqual([
        {
          page: 0,
          line: 0,
          offset: 10,
          endLine: 1,
          endOffset: 3,
          // THE START LINE, not the joined text. `offset` indexes this string
          // and `endOffset` indexes the other one, which is the whole reason
          // the end is a pair rather than a length.
          text: 'the quick brown',
        },
      ]);
    });

    it('CONTROL: a phrase that is not there is still not found across the break', () => {
      // Without this, a join that matched too eagerly — treating the break as
      // nothing at all, so `brownfox` matched — would pass the case above.
      const pages = [pageOf(['the quick brown', 'fox jumps over'])];

      expect(matchesOf(pages, 'brownfox')).toStrictEqual([]);
      expect(matchesOf(pages, 'brown cat')).toStrictEqual([]);
    });

    it('absorbs the padding an extractor leaves, which a fixed separator would not', () => {
      // A line arriving with a trailing space and the next with a leading one
      // puts three whitespace characters between the words. A join that
      // inserted one separator and compared with `indexOf` would need the query
      // to contain exactly three spaces — which nobody types.
      const pages = [pageOf(['the quick brown ', ' fox jumps'])];

      expect(matchesOf(pages, 'brown fox').map((match) => match.endLine)).toStrictEqual([1]);
    });

    it('reports `endLine` equal to `line` for a match that did not cross', () => {
      // The other half of the pair, and it is a control on the first: a build
      // that reported the LAST line of the page as every match's end would pass
      // every spanning case above.
      const pages = [pageOf(['alpha beta', 'gamma delta'])];

      expect(
        matchesOf(pages, 'gamma').map((match) => ({
          line: match.line,
          endLine: match.endLine,
          endOffset: match.endOffset,
        })),
      ).toStrictEqual([{ line: 1, endLine: 1, endOffset: 5 }]);
    });

    it('does not join across a PAGE, because a page is where the unit ends', () => {
      const pages = [pageOf(['the quick brown']), pageOf(['fox jumps over'])];

      expect(matchesOf(pages, 'brown fox')).toStrictEqual([]);
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
