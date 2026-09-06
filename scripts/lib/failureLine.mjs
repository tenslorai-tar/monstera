/**
 * Which line of a failed step's output says what went wrong.
 *
 * ## The reader and the writers had never been compared
 *
 * `checkLocal.mjs` held the exit code and the whole captured output and then
 * re-derived the answer from `/\b(FAIL|Error|error)\b/`. Almost nothing in this
 * repository prints any of those words when a CASE fails. Proofs print a
 * summary line and then their failures under it, in one of two spellings:
 *
 * ```
 * Workflow pin proof — 3 failure(s):
 * 4 checkLocal case(s) FAILED:
 * ```
 *
 * Measured at **`e4ac590~1`**, the tree the reader was wrong against, over
 * `scripts/proofs/*.mjs` and `scripts/lib/*.mjs`: **60 files** carry the first,
 * **25** the second, and of the 85 header lines between them exactly **one**
 * contains `FAIL`, `Error` or `error` as a word. `FAILED` does not match
 * `\bFAIL\b`, which is why the second spelling was invisible too.
 *
 * ```
 * git grep -lE "failure\(s\):" e4ac590~1 -- 'scripts/proofs/*.mjs' 'scripts/lib/*.mjs' | wc -l
 * git grep -lE "case\(s\) FAILED:" e4ac590~1 -- 'scripts/proofs/*.mjs' 'scripts/lib/*.mjs' | wc -l
 * git grep -hE "failure\(s\):|case\(s\) FAILED:" e4ac590~1 -- 'scripts/proofs/*.mjs' 'scripts/lib/*.mjs' \
 *   | grep -cE "\b(FAIL|Error|error)\b"
 * ```
 *
 * ## THOSE FIGURES READ 61/25/86 FIRST, AND NO TREE HOLDS THEM
 *
 * They were taken from the working tree while this file was being written, so
 * the count included a docstring that was not finished. The finished one
 * carries **four** matching lines of its own — the two spellings quoted above
 * and the two grep patterns naming them — and the same commands answer 62/26/95
 * from `e4ac590` onwards. The instrument was inside the set it counted, and
 * completing it moved the number it states.
 *
 * So the citation is a **rev**, not a date. A date identifies a moment on one
 * machine; for a count over tracked files, *where it was read* is a commit, and
 * only that spelling can be read again. Re-running the original commands today
 * answers neither figure and looks like drift in the subject rather than in the
 * frame.
 *
 * ## THE ROOT DECIDES THE LAST FIGURE, WHICH IS THE LOAD-BEARING ONE
 *
 * The single matching line is `scripts/lib/reportError.proof.mjs:200`, a proof
 * whose subject *is* error reporting, so its header reads
 * `${n} error-report failure(s):`. Under `scripts/proofs/` alone the answer is
 * **zero**, of 51 files and 25; across all of `scripts/` it is **one**, of 76
 * and 29 — the same line either way, since `scripts/lib` is inside the second
 * root and not the first. A reader told *no header ever matches* would conclude
 * the fallback below is unreachable. It is reachable, from exactly one file,
 * and that file is named for the word it contains.
 *
 * So the sweep's per-step diagnostic only ever surfaced **throws**. The
 * ordinary way a proof fails — a case that did not hold — reported
 * `(no diagnostic line found)`, or an unrelated line that happened to contain
 * the word *error*.
 *
 * ## The finding is that nobody compared them, not that a caller drifted
 *
 * The usual shape is one writer spelling a token differently from the owner's,
 * and its remedy is a scan over the writers. This is the inverse: **eighty-six
 * writers converged on two wordings**, consistently, and the reader keyed on a
 * third vocabulary that was never checked against them. Consistency among the
 * writers is what made it invisible — there was no odd one out to notice.
 *
 * The remedy is therefore in the **reader**, in one file. Unifying the writers'
 * two spellings is a separate and much larger unit, and it is not what fixes
 * this.
 *
 * ## It anchors on the FORMAT, not on either wording
 *
 * Keying on `failure(s):` would fix 61 files and leave 25, which is how a
 * matcher acquires its third spelling. What both share — and what a third would
 * share — is the **shape**: a summary line, then entries printed as `  - text`.
 * So the anchor is the first entry, and the header is the non-empty line above
 * it. That reads a format rather than a vocabulary, and a proof that renames
 * its noun tomorrow is unaffected.
 *
 * ## Found the hard way, which is why the empty case is separate below
 *
 * The row that exposed it was
 * `{ "name": "proof:canvaspixels", "exit": 1, "bytes": 1198, "firstProblem": null }`,
 * and the first explanation offered for it — a stale-build refusal — was wrong:
 * that path throws, and a throw prints `Error:`, which would have matched.
 * **A row saying output existed and nothing matched is telling you about the
 * matcher, not about the run**, and the only reason that was recoverable is
 * that `bytes` had been recorded beside it. This function keeps the two states
 * apart in words as well, so the next reader does not need the byte count.
 */

/** A failure entry, as every proof in this repository prints one. */
const ENTRY = /^\s*-\s+(?<text>\S.*)$/u;

/** The last-resort match, which is what a THROW looks like. */
const THROWN = /\b(FAIL|Error|error)\b/u;

/**
 * One line naming the problem in `output`, or a stated reason there is none.
 *
 * Never empty: the caller prints this as the whole of what it knows about a
 * failed step, and a blank there sends someone to re-run the script by hand.
 *
 * @param {string} output everything the step wrote, stdout and stderr together
 * @returns {string}
 */
export function failureLineOf(output) {
  const lines = output.split('\n');

  const entryAt = lines.findIndex((line) => ENTRY.test(line));
  if (entryAt !== -1) {
    const entry = ENTRY.exec(lines[entryAt] ?? '')?.groups?.['text'] ?? '';
    // THE NEAREST NON-EMPTY LINE ABOVE IT is the summary, because every proof
    // here separates the two with a blank line. Both are wanted and neither is
    // enough: "3 failure(s):" names none of them, and an entry alone does not
    // say which proof is speaking.
    let header = '';
    for (let index = entryAt - 1; index >= 0; index -= 1) {
      const candidate = (lines[index] ?? '').trim();
      if (candidate.length > 0) {
        header = candidate;
        break;
      }
    }
    // THE ENTRY'S FIRST LINE ONLY. A failure's text is often a paragraph, and
    // this value is printed as one line beside a step's name; taking the whole
    // of it would put a wrapped essay in the middle of a summary table. The
    // header is what tells a reader there are more.
    const first = entry.trim();
    return header.length > 0 ? `${header} ${first}` : first;
  }

  // THEN A THROW, which is what the old matcher found and the only thing it
  // found. Kept rather than replaced: an uncaught exception prints no summary
  // and no entries, and it is the other real way a step fails.
  const thrown = lines.find((line) => THROWN.test(line));
  if (thrown !== undefined) return thrown.trim();

  // THEN WHATEVER IT ENDED WITH. A step that printed something and matched
  // nothing has still told you something, and the last line is where a script
  // that gave up usually says so. Better than a bare *no diagnostic found*,
  // which is a sentence about this function rather than about the step.
  const last = [...lines].reverse().find((line) => line.trim().length > 0);
  if (last !== undefined) return `(no summary line; the run ended with) ${last.trim()}`;

  // AND SILENCE IS ITS OWN STATE, distinct from the line above. A step that
  // failed having printed nothing at all is a different problem from one whose
  // output this could not read, and collapsing them is what cost a session:
  // `bytes` was the only thing separating them, and nobody reading a printed
  // row sees `bytes`.
  return '(the step failed and printed nothing at all)';
}
