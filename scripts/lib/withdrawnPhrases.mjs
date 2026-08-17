// @ts-check
/**
 * Claims an ADR correction withdrew, and whether any document still states one.
 *
 * Pure functions over text, with no filesystem and no git, so the behaviour can
 * be driven from fixtures. That is not incidental: the check this implements
 * unblocked Stage 0, and it shipped with no proof at all — every defect in it so
 * far was found by running it against the real tree and noticing the answer was
 * wrong, which is the slowest possible way to find them and works only for the
 * ones somebody happens to grep for.
 *
 * ## The matching unit
 *
 * A phrase is matched against a UNIT, not a line, and the same unit supplies the
 * context that can excuse it. Three separate false negatives came from getting
 * this wrong, and they are the same defect in three costumes:
 *
 *   1. **Literal bytes.** `(stream bytes × 3.7)` in one document,
 *      `(stream bytes × ~3.7)` in another. An approximation tilde is exactly the
 *      difference prose acquires. Matching normalises tildes and whitespace.
 *   2. **The table.** Markdown tables have no blank lines, so paragraph-scoping
 *      made every row share every other row's context, and one log row saying
 *      "are withdrawn" exempted another row still asserting the model. A table
 *      row is its own unit.
 *   3. **The line break.** Matching was still done per LINE while the context
 *      came from the paragraph. This repository hard-wraps prose, so any
 *      declared phrase long enough to wrap escaped in silence — and the longer
 *      the phrase, the likelier it wraps, which is backwards.
 *
 * All three are one rule now: build the unit, normalise it, match against it.
 */

/** A line holding only backticked phrases separated by middots. */
const PHRASE_LINE = /^>\s*`[^`]+`(?:\s*·\s*`[^`]+`)*\s*$/;

/**
 * Prose that names a claim as withdrawn is the record, not an assertion.
 *
 * Deliberately narrow. Widening this vocabulary is the tempting fix whenever a
 * historical narrative trips the check, and it is the wrong one: this pattern is
 * the only thing standing between a live claim and a green check, so it is the
 * one part that must not be relaxed to make a run pass.
 */
const QUALIFIER =
  /withdrawn|withdrew|retracted|superseded|no longer|used to|wrong response|did not|rejected/i;

/**
 * @param {string} text
 * @returns {string}
 */
export function normalise(text) {
  return text.replace(/~/g, '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Splits a markdown document into the units a claim is judged in.
 *
 * @param {string} text
 * @returns {Array<{ start: number, lines: string[] }>} `start` is 0-based.
 */
export function units(text) {
  const lines = text.split('\n');
  /** @type {Array<{ start: number, lines: string[] }>} */
  const found = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    // A table row stands alone: its neighbours are different rows making
    // different statements, not the continuation of this one.
    if (line.trim().startsWith('|')) {
      found.push({ start: index, lines: [line] });
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < lines.length) {
      const next = lines[end + 1] ?? '';
      if (next.trim() === '' || next.trim().startsWith('|')) break;
      end += 1;
    }
    found.push({ start: index, lines: lines.slice(index, end + 1) });
    index = end + 1;
  }
  return found;
}

/**
 * The phrases an ADR's correction declares as withdrawn.
 *
 * The declaration is the marker line's remainder plus any following lines
 * containing ONLY phrases. Bounded deliberately: an earlier version captured to
 * the end of the block and swallowed the paragraph explaining the mechanism, so
 * every backticked path in that prose became a "withdrawn phrase" and five
 * documents were reported for stating their own filenames.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function declaredPhrases(text) {
  const lines = text.split('\n');
  /** @type {string[]} */
  const phrases = [];

  for (let index = 0; index < lines.length; index += 1) {
    const marker = /^>\s*\*\*Withdrawn phrases:\*\*(.*)$/.exec(lines[index] ?? '');
    if (marker === null) continue;

    let block = `${marker[1] ?? ''}`;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (!PHRASE_LINE.test(lines[next] ?? '')) break;
      block += ` ${lines[next]}`;
    }

    for (const match of block.matchAll(/`([^`]+)`/g)) {
      if (match[1] !== undefined) phrases.push(match[1]);
    }
  }
  return phrases;
}

/**
 * Every place a document states a withdrawn phrase without naming it as such.
 *
 * @param {{
 *   declarations: ReadonlyArray<{ adr: string, phrase: string }>,
 *   documents: ReadonlyMap<string, string>,
 * }} input
 * @returns {Array<{ document: string, line: number, phrase: string, adr: string, quote: string }>}
 */
export function liveClaims({ declarations, documents }) {
  /** @type {Array<{ document: string, line: number, phrase: string, adr: string, quote: string }>} */
  const claims = [];

  for (const [document, text] of documents) {
    const grouped = units(text);

    for (const { adr, phrase } of declarations) {
      // The ADR that withdrew it is the one place it must still appear, and its
      // evidence section deliberately leaves the original measurements standing.
      if (document === adr) continue;
      const needle = normalise(phrase);

      for (const unit of grouped) {
        const joined = unit.lines.join(' ');
        if (!normalise(joined).includes(needle)) continue;
        if (QUALIFIER.test(joined)) continue;

        // Report where the match STARTS, not where the unit does. A paragraph
        // can be long, and "somewhere in these nine lines" is the kind of
        // message that gets skimmed past.
        let offset = 0;
        for (let k = 0; k < unit.lines.length; k += 1) {
          if (normalise(unit.lines.slice(k).join(' ')).includes(needle)) offset = k;
          else break;
        }

        claims.push({
          document,
          line: unit.start + offset + 1,
          phrase,
          adr,
          quote: `${unit.lines[offset] ?? ''}`.trim(),
        });
      }
    }
  }
  return claims;
}
