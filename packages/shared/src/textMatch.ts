import { type Result, err, ok } from './result.js';

/**
 * How a query is compared against a line of text — the ONE place this build
 * decides what "matches" means.
 *
 * ## Why it is here rather than beside the search that uses it
 *
 * `findInPages` is the kernel's, and the browser shim's `document.searchPage`
 * must answer the same question — a shim answering canned matches would let a
 * UI test pass against a find bar that sent the wrong query, the wrong page, or
 * no query at all. The shim may not import the kernel (ARCHITECTURE §1), so a
 * shim that searched had to re-implement the rule, and its own comment claimed
 * it did not.
 *
 * That claim was true while the rule was *lower-case `indexOf`* and would have
 * become false the moment whole-word, regex or normalisation landed. Putting
 * the rule in `shared` — which both may import — is B3a's answer: one resolver,
 * many callers, rather than two opinions that agree until they do not.
 *
 * ## Normalisation is CANONICAL by default and never compatibility
 *
 * Unicode defines two equivalences and the difference is not a matter of taste.
 * NFC folds sequences that *are the same text* — `é` typed as one code point
 * and as `e` plus a combining acute are the same character, and a PDF's
 * extractor picks whichever the font encoding produced. Not folding them means
 * a reader cannot find a word they can see.
 *
 * NFKC additionally folds *compatibility* forms, which changes what the text
 * says: `ﬁ` becomes `fi`, `①` becomes `1`, superscripts flatten. That is useful
 * for finding a ligature by typing its letters and it is a different question,
 * so it is a choice a caller makes rather than the default.
 *
 * **A normalised search reports the normalised line.** NFC can change a line's
 * length, so an offset into the raw extraction would not index the text the
 * caller was handed. The pair `(offset, text)` is always self-consistent, and
 * `text` is what a result surface shows.
 *
 * ## A LINE IS NOT A UNIT OF MEANING, and this module searched one for a stage
 *
 * The lines here are a **typesetter's** lines: where the glyphs happened to be
 * broken by the width of a column. A reader searching for a phrase does not
 * know where a page wrapped and cannot be expected to, so a search that looks
 * at each line separately reports *not found* for a phrase that is plainly on
 * the page — and reports it in exactly the voice of a genuine absence.
 *
 * `CLAUDE.md` item 4b already carries this as the sixth axis of a blind search,
 * with five prior instances in this repository's own tooling, and its remedy is
 * one sentence: **build the unit, normalise it, match against it.** So the unit
 * searched here is the page — the lines joined by a newline — and a match is
 * mapped back to the line it starts in afterwards.
 * `scripts/lib/withdrawnPhrases.mjs` owns the same rule for tracked prose; this
 * is a second subject rather than a second opinion, because the two share no
 * text and no input (that module reads markdown from disk in plain `.mjs`,
 * which cannot import TypeScript).
 *
 * Two consequences worth stating, because both are decisions:
 *
 * - **`^` and `$` still anchor a LINE**, because the regex is compiled with
 *   `m` and the join really does put a newline between lines. A page of table
 *   cells is the case that makes this matter: `^\d+$` finding cells that hold
 *   only a number is a thing somebody types, and joining without `m` would have
 *   silently made it a question about the whole page. Nothing in the regex path
 *   crosses a break unless the pattern asks — `.` does not match a newline — so
 *   a regex author opts in by writing `\s+`.
 * - **A literal query's whitespace matches a RUN of whitespace**, which is what
 *   lets `hello world` cross the break where `hello` ends one line and `world`
 *   begins the next. It also absorbs the trailing and leading spaces an
 *   extractor leaves on a line, which a fixed separator would have turned into
 *   a double space that the query does not contain — the collapse
 *   `withdrawnPhrases.mjs` performs, done positionally so every offset still
 *   indexes the text it was computed from.
 */

/**
 * One occurrence, which may begin on one line and end on another.
 *
 * The four indices are two pairs and they are not interchangeable:
 * `(line, offset)` is where the match starts and `offset` indexes {@link
 * LineMatch.text}; `(endLine, endOffset)` is one past its last character and
 * `endOffset` indexes the END line, which this record does not carry. A caller
 * that highlights a match therefore needs the lines it was searching — which
 * every caller has, since it passed them in.
 */
export interface LineMatch {
  /** Index of the line the match STARTS in, within the list that was searched. */
  readonly line: number;
  /** Offset within `text`, in UTF-16 code units. */
  readonly offset: number;
  /**
   * Index of the line the match ENDS in. Equal to `line` for a match that does
   * not cross a break, which is nearly all of them.
   */
  readonly endLine: number;
  /**
   * Offset one past the match's last character, within the `endLine`-th line.
   *
   * **Into the raw line, not into `text`.** `text` is clipped to a window
   * around the start, so an index into it would be meaningless the moment a
   * match crossed a break — the window is a different line's.
   */
  readonly endOffset: number;
  /**
   * The line the match sits in, after normalisation, so `offset` indexes it.
   *
   * **Clipped to {@link MATCH_TEXT_WINDOW}**, which is the document's own
   * content meeting invariant L11: a line's length is chosen by whoever made
   * the PDF, so an unclipped line is a payload a hostile document sets — once
   * per match. The clip keeps `offset` valid by moving it with the window, so
   * the pair still indexes what the caller was handed.
   */
  readonly text: string;
}

/**
 * How much of a line a match carries.
 *
 * Above `MAX_QUERY_LENGTH` (512), so a match of the longest query a person can
 * type still fits inside its own window with room around it. Below anything a
 * result row could show: a line this long is already more than a reader scans,
 * and the number that matters is that it does not depend on the document.
 */
export const MATCH_TEXT_WINDOW = 1024;

/**
 * How much of the line before the match the window tries to keep.
 *
 * A match at position 0 of its window reads as though the line begins there.
 * The lead is best-effort — a match near the start of a long line gets the
 * line's own beginning instead, which is better context than a fixed offset.
 */
const MATCH_TEXT_LEAD = 64;

/** Which Unicode normalisation a search applies before comparing. */
export type Normalisation = 'nfc' | 'nfkc' | 'none';

/**
 * How a query is compared. Every field is optional and every default is stated.
 *
 * **`| undefined` on every field, deliberately, under
 * `exactOptionalPropertyTypes`.** These options arrive from a validated
 * boundary, where an optional field that was not sent is present and
 * `undefined` rather than absent — so a type admitting only absence would force
 * every caller to strip the keys, and stripping is where a flag gets dropped.
 * Absent and explicitly-unset mean the same thing here, and the type says so.
 */
export interface TextMatchOptions {
  /** Default false — a reader looking for "pdf" expects "PDF". */
  readonly caseSensitive?: boolean | undefined;
  /**
   * Match only where both ends fall on a word boundary. Default false.
   *
   * A boundary is decided by what sits *around* the match, never by wrapping
   * the query in `\b`: `\b` is defined against ASCII `[A-Za-z0-9_]` in
   * JavaScript, so it puts a boundary in the middle of "café" and finds "caf"
   * — and a PDF is full of words that are not ASCII.
   */
  readonly wholeWord?: boolean | undefined;
  /**
   * Treat the query as a regular expression. Default false.
   *
   * See {@link compileQuery} for what is accepted and for the cost this
   * carries.
   */
  readonly regex?: boolean | undefined;
  /** Default `'nfc'`. See this module's header for why not `'nfkc'`. */
  readonly normalise?: Normalisation | undefined;
  /** Stop after this many matches. Absent means unbounded. */
  readonly limit?: number | undefined;
}

/** Why a query could not be compiled. */
export type QueryProblem = 'empty' | 'invalid-pattern';

/** A compiled query: the thing that actually looks at the text. */
export interface CompiledQuery {
  /**
   * Every match in the joined page, in order.
   *
   * The argument is the whole unit — see this module's header — rather than one
   * line, which is what makes a match across a break representable at all.
   */
  readonly matchesIn: (text: string) => readonly { offset: number; length: number }[];
  /** The normalisation this query was compiled with, applied to each line. */
  readonly normalise: Normalisation;
}

/** Applies a normalisation, or none. */
export function normalised(text: string, form: Normalisation): string {
  return form === 'none' ? text : text.normalize(form.toUpperCase());
}

/**
 * Whether a code point is part of a word, for {@link TextMatchOptions.wholeWord}.
 *
 * Letters, numbers, marks and the underscore. **Marks are in and they are the
 * reason this is not `\w`**: a combining accent is part of the letter it sits
 * on, so treating it as a boundary would make "café" a whole-word match for
 * "caf" wherever the extractor produced a decomposed form.
 */
function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}\p{M}_]/u.test(character);
}

/**
 * Compiles a query once, so a page loop does not rebuild it per line.
 *
 * ## The regex is the caller's, and so is its cost
 *
 * A pattern is compiled with `u`, and an invalid one is **reported** rather
 * than thrown: a person typing into a find field will produce `(` on the way to
 * typing `(a)`, and a validation failure is not the right answer to a
 * half-typed query.
 *
 * **What this does NOT do is bound the time a pattern takes.** JavaScript's
 * regular expressions backtrack, so a pattern like `(a+)+$` over a long line
 * takes exponential time, and there is no timeout to give it — a caller running
 * one in a lane that must stay responsive is choosing that risk. The honest
 * mitigation is where it runs rather than what it is checked for: a search in a
 * process that can be killed bounds this, and a structural check for
 * "dangerous" patterns is a partial reimplementation of a question nobody can
 * answer syntactically. Stated here because the caller is the only one who can
 * act on it.
 */
export function compileQuery(
  query: string,
  options: TextMatchOptions = {},
): Result<CompiledQuery, QueryProblem> {
  if (query === '') {
    // AN EMPTY QUERY MATCHES EVERY POSITION, so the honest answers are "every
    // offset" and "nothing", and both are wrong. A caller with an empty search
    // box has not asked a question yet.
    return err('empty');
  }

  const normalise = options.normalise ?? 'nfc';
  const caseSensitive = options.caseSensitive ?? false;
  const wholeWord = options.wholeWord ?? false;
  const needle = normalised(query, normalise);

  if (options.regex === true) {
    let compiled: RegExp;
    try {
      // `g` so `exec` walks the text, `u` so the pattern's own `\p{…}` and
      // surrogate pairs mean what the author wrote. `i` rather than lowering
      // the text, because a regex must see the text it was written against.
      //
      // `m` IS WHAT KEEPS `^` AND `$` MEANING A LINE. The unit searched is the
      // page, so without it an anchor written against a line would silently
      // become one about the whole page — and `^\d+$` over a table of cells is
      // a pattern somebody types.
      compiled = new RegExp(needle, caseSensitive ? 'gmu' : 'gimu');
    } catch {
      return err('invalid-pattern');
    }
    return ok({
      normalise,
      matchesIn: (text) => collect(text, compiled, wholeWord),
    });
  }

  return ok({
    normalise,
    matchesIn: (text) => {
      const found: { offset: number; length: number }[] = [];
      // EVERY POSITION, not a jump past each match: overlapping occurrences are
      // occurrences. Searching "aa" in "aaa" finds two, and a reader stepping
      // through matches expects the one starting at offset 1.
      for (let from = 0; from < text.length; from += 1) {
        const end = literalEnd(text, needle, from, caseSensitive);
        if (end < 0) continue;
        if (!wholeWord || bounded(text, from, end - from)) {
          found.push({ offset: from, length: end - from });
        }
      }
      return found;
    },
  });
}

/** Whether one character is whitespace. Not `g`: a shared cursor is a defect. */
const WHITESPACE = /\s/u;

/**
 * Where a literal needle ends if it starts at `from`, or `-1`.
 *
 * ## Two things this does that `indexOf` cannot, and both are the point
 *
 * **A whitespace run in the needle consumes a whitespace run in the text.**
 * That is what makes `hello world` findable across a break, since the join put
 * a newline between the two words and the extractor may have left a space on
 * either side of it as well. A fixed separator plus `indexOf` would answer *not
 * found* for a phrase a reader can see, which is the defect this module's
 * header is about.
 *
 * **Case is folded PER CHARACTER rather than by lowering both strings.**
 * Lowering `İ` yields two code units, so lowering a page shifts every offset
 * after the first Turkish capital I — a latent defect in the `indexOf` form
 * this replaced, which reported offsets into a string the caller never sees.
 *
 * @returns one past the last character consumed, or `-1` if the needle does not
 *   start here.
 */
function literalEnd(text: string, needle: string, from: number, caseSensitive: boolean): number {
  let at = from;
  let n = 0;
  while (n < needle.length) {
    const wanted = needle[n];
    if (wanted === undefined) break;
    if (WHITESPACE.test(wanted)) {
      const here = text[at];
      if (here === undefined || !WHITESPACE.test(here)) return -1;
      while (n < needle.length && WHITESPACE.test(needle[n] ?? '')) n += 1;
      while (at < text.length && WHITESPACE.test(text[at] ?? '')) at += 1;
      continue;
    }
    const here = text[at];
    if (here === undefined) return -1;
    if (caseSensitive ? here !== wanted : here.toLowerCase() !== wanted.toLowerCase()) return -1;
    at += 1;
    n += 1;
  }
  return at;
}

/** Every match of a compiled pattern in one line. */
function collect(
  line: string,
  pattern: RegExp,
  wholeWord: boolean,
): readonly { offset: number; length: number }[] {
  const found: { offset: number; length: number }[] = [];
  // A FRESH `lastIndex` PER LINE. A `g` regex carries its cursor between calls,
  // so a shared one would start each line where the previous one stopped and
  // silently skip the beginning of every line after the first.
  pattern.lastIndex = 0;
  for (;;) {
    const hit = pattern.exec(line);
    if (hit === null) break;
    const length = hit[0].length;
    if (!wholeWord || bounded(line, hit.index, length)) {
      found.push({ offset: hit.index, length });
    }
    // AN EMPTY MATCH DOES NOT ADVANCE `lastIndex`, so a pattern that can match
    // nothing — `a*`, `^`, a lookahead — loops for ever without this. Stepping
    // by one is what the language's own string methods do with the same
    // problem.
    pattern.lastIndex = length === 0 ? hit.index + 1 : hit.index + length;
  }
  return found;
}

/** Whether a span has a non-word character (or nothing) on each side. */
function bounded(line: string, offset: number, length: number): boolean {
  return (
    !isWordCharacter(line[offset - 1]) &&
    !isWordCharacter(line[offset + length]) &&
    // A ZERO-LENGTH MATCH IS NOT A WORD, and without this it would be reported
    // wherever two non-word characters meet — which is every space in the
    // document, for a regex a person did not mean to write that way.
    length > 0
  );
}

/**
 * Every occurrence of `query` in the given lines, in order.
 *
 * @returns the matches, or the reason the query could not be compiled. A
 *   `Result` rather than a throw because both problems are things a person
 *   types, and a half-written regex is not an exceptional condition.
 */
export function findInLines(
  lines: readonly string[],
  query: string,
  options: TextMatchOptions = {},
): Result<readonly LineMatch[], QueryProblem> {
  const compiled = compileQuery(query, options);
  if (!compiled.ok) return compiled;

  const normalisedLines = lines.map((raw) => normalised(raw, compiled.value.normalise));
  // ONE UNIT, one separator per gap. The starts are computed alongside rather
  // than recovered from the joined string afterwards: recovering them would
  // mean finding newlines in text that may contain its own, which is the
  // extractor's business and not this join's.
  const starts: number[] = [];
  let at = 0;
  for (const line of normalisedLines) {
    starts.push(at);
    at += line.length + 1;
  }
  const unit = normalisedLines.join(JOIN);

  const limit = options.limit;
  const matches: LineMatch[] = [];
  for (const hit of compiled.value.matchesIn(unit)) {
    const start = locate(starts, hit.offset);
    const end = locate(starts, hit.offset + hit.length);
    matches.push({
      line: start.line,
      ...clipped(normalisedLines[start.line] ?? '', start.offset),
      endLine: end.line,
      endOffset: end.offset,
    });
    if (limit !== undefined && matches.length >= limit) return ok(matches);
  }
  return ok(matches);
}

/**
 * What separates two lines in the searched unit.
 *
 * A newline and not a space, so `m`-mode `^` and `$` keep meaning a line and a
 * `.` keeps not crossing one. The literal path never sees it as a newline in
 * particular — {@link literalEnd} treats any whitespace run as one gap — so the
 * choice costs the literal case nothing and buys the regex case its anchors.
 */
const JOIN = '\n';

/**
 * Which line an index into the joined unit falls in, and where within it.
 *
 * Binary search rather than a walk: a dense page is 840 lines measured and
 * bounded at 2,048, and this runs once per match end. The separator belongs to
 * the line BEFORE it — an index pointing at it is reported as one past that
 * line's last character, which is what a match ending at a line's end means and
 * is the only reading that keeps `endOffset` an index into a line that actually
 * contains the match.
 */
function locate(starts: readonly number[], index: number): { line: number; offset: number } {
  if (starts.length === 0) return { line: 0, offset: index };
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return { line: low, offset: index - (starts[low] ?? 0) };
}

/**
 * A match's line, bounded, with its offset moved to match.
 *
 * The window always contains the match's START, which is what keeps `offset`
 * an index into the string beside it: `start` is at most `offset`, because
 * `Math.min` takes it when the line's tail is shorter than the window. A match
 * longer than the window is truncated at its end and the offset still points
 * at its beginning, which is the only property a caller can rely on when the
 * document chose the length.
 */
function clipped(text: string, offset: number): { offset: number; text: string } {
  if (text.length <= MATCH_TEXT_WINDOW) return { offset, text };
  const start = Math.max(0, Math.min(offset - MATCH_TEXT_LEAD, text.length - MATCH_TEXT_WINDOW));
  return { offset: offset - start, text: text.slice(start, start + MATCH_TEXT_WINDOW) };
}
