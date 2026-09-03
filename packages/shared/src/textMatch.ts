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
 */

/** One occurrence within a line. */
export interface LineMatch {
  /** Index of the line within the list that was searched. */
  readonly line: number;
  /** Offset within `text`, in UTF-16 code units. */
  readonly offset: number;
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

/** A compiled query: the thing that actually looks at a line. */
export interface CompiledQuery {
  /** Every match in one line, in order. */
  readonly matchesIn: (line: string) => readonly { offset: number; length: number }[];
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
      // `g` so `exec` walks the line, `u` so the pattern's own `\p{…}` and
      // surrogate pairs mean what the author wrote. `i` rather than lowering
      // the line, because a regex must see the text it was written against.
      compiled = new RegExp(needle, caseSensitive ? 'gu' : 'giu');
    } catch {
      return err('invalid-pattern');
    }
    return ok({
      normalise,
      matchesIn: (line) => collect(line, compiled, wholeWord),
    });
  }

  const literal = caseSensitive ? needle : needle.toLowerCase();
  return ok({
    normalise,
    matchesIn: (line) => {
      const haystack = caseSensitive ? line : line.toLowerCase();
      const found: { offset: number; length: number }[] = [];
      for (let from = 0; ; ) {
        const offset = haystack.indexOf(literal, from);
        if (offset < 0) break;
        if (!wholeWord || bounded(line, offset, literal.length)) {
          found.push({ offset, length: literal.length });
        }
        // ADVANCE BY ONE, not by the needle's length: overlapping occurrences
        // are occurrences. Searching "aa" in "aaa" finds two, and a reader
        // stepping through matches expects the one starting at offset 1.
        from = offset + 1;
      }
      return found;
    },
  });
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

  const limit = options.limit;
  const matches: LineMatch[] = [];
  for (const [line, raw] of lines.entries()) {
    const text = normalised(raw, compiled.value.normalise);
    for (const hit of compiled.value.matchesIn(text)) {
      matches.push({ line, ...clipped(text, hit.offset) });
      if (limit !== undefined && matches.length >= limit) return ok(matches);
    }
  }
  return ok(matches);
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
