// @ts-check
/**
 * The roster of what a check actually ran, so its `ok` lines cannot outlive it.
 *
 * ## Why this exists, measured rather than reasoned
 *
 * Four scripts here accumulated failures and then, if the failure list was
 * empty, printed a **fixed block of `ok` lines and a hand-written total**.
 * Neither was derived from anything. So a deleted case left its line printing:
 * replacing one comparison in `gitleaks.proof.mjs` with `if (false)`, so it
 * could not execute at all, still printed
 *
 * ```
 *   ok  an unreadable destination is neither same nor different
 *
 * 10 provisioning cases passed.
 * ```
 *
 * and exited 0. That is the display-only defect this project bans in its UI,
 * living inside the proofs — a green check asserting something nothing checked.
 *
 * `documentConsistency.mjs` had the live instance rather than the hypothetical
 * one. Its threat-model section applies only when a threat model exists, and
 * the fixed block claimed `ok` for it either way.
 *
 * ## The shape
 *
 * A label is recorded by the section that earns it, against a mark taken when
 * that section started. Deleting a section takes its label with it, because the
 * label is an argument to the call that concludes it — there is no second list
 * OF LABELS to keep in step. That is the difference between a roster that is
 * true and one that is true so far.
 *
 * There IS a second number, added later by Z-4, and the section below is about
 * why a number is honest where a list is not. This sentence said "no second
 * list to keep in step" flat, thirty lines above the thing that has to be kept
 * in step, and the clause carrying it — a label being an argument to the call
 * that concludes it — stayed true throughout. Item 7's compound-claim shape,
 * found by audit rather than by anyone reading this file (finding AA-2).
 *
 * `ran` is what separates *passed* from *not applicable*. A section with
 * nothing to check has not verified anything, and saying so is the whole point:
 * "no problems found" and "did not look" are the same output otherwise, which
 * is audit item 4b one level up.
 *
 * ## The declared count, and why it is not the list this replaced (finding Z-4)
 *
 * The shape above makes a deleted case SILENT rather than false: its line goes
 * with it, the derived total drops to match, and the output is entirely honest
 * about a proof that now checks less than it did. Both figures moving together
 * is also what absence produces — audit item 4's direction rule, one level up
 * from where it was applied.
 *
 * So a roster declares how many cases it has, and `format` refuses to print a
 * roster that disagrees. **This is deliberately not a list of expected labels.**
 * Such a list is exactly the second thing-to-keep-in-step that Y-1 deleted, and
 * it would be the original defect wearing a control's clothes: nothing would
 * force it to match, and the labels would rot the way the `ok` block did.
 *
 * What makes one number honest where a list is not:
 *
 *   - it is ENFORCED. Y-1's roster checked nothing; this fails the run, so it
 *     cannot silently disagree with reality even for one commit;
 *   - it lives beside the cases, in the file whose diff an auditor is already
 *     told to read by the modified-proofs column;
 *   - **there is no `--update` flag, on purpose.** A regenerate-to-fix switch is
 *     how a check becomes a formality — audit item 1's "a repair that could
 *     regenerate". Lowering it is a keystroke somebody has to type and defend.
 *
 * Both directions fail. An increase must be recorded or the number rots; a
 * decrease has to appear in a diff with a reason beside it.
 *
 * ## What this still does not catch, stated rather than implied
 *
 * `record` remains separable from its case body, so deleting a body and leaving
 * its `record` call prints the label for work that did not happen. The count is
 * unchanged, and no API that takes a label can prevent it.
 *
 * **And the count checks a roster against ITSELF, not against the run.** It
 * fires when one roster's recorded total disagrees with that roster's own
 * declaration. It cannot fire when the wrong roster is the one formatted, since
 * each is internally consistent and each agrees with its own number.
 *
 * Measured, in `passRoster.proof.mjs`, while it was being written. A fixture
 * roster inside `main()` was also named `roster` and shadowed the file's own.
 * Eight cases executed and recorded into one roster; the other was formatted.
 * The run printed
 *
 * ```
 *   ok  a case that ran and passed
 *   --  a case with nothing to check — nothing to check
 *
 * 1 pass-roster case passed, 1 not applicable.
 * ```
 *
 * and exited 0 — the pre-Z-4 failure mode, reproduced inside the proof for the
 * mechanism built to prevent it. `no-shadow` is the INSTANCE and ESLint has no
 * `no-shadow` reaching `scripts/`; the CLASS is **consistent with the wrong
 * object**, which no count of a single object can see. Running it is what caught
 * this, not review and not the guard.
 *
 * That sentence used to read "ESLint does not reach `scripts/`", which is a
 * different claim and a false one: `eslint.config.js:348` globs every `.mjs`
 * under `scripts/`, with one rule enabled. The over-generalisation is the
 * expensive kind — "does not reach" costs a B4 conversation about bringing a
 * root under lint, where "reaches with one rule enabled" costs three lines in a
 * block that already exists. It was read as the former and produced exactly that
 * wrong ruling. This file's own proof had the precise wording the whole time,
 * which is why a claim gets narrowed to what was measured rather than widened to
 * what it felt like.
 */

/**
 * @typedef {{
 *   mark: () => number,
 *   record: (mark: number, label: string, ran?: boolean) => void,
 *   passed: readonly string[],
 *   skipped: readonly string[],
 *   format: (noun: string) => string,
 * }} Roster
 */

/**
 * @param {readonly string[]} failures
 *   The live failure list. Held by reference on purpose: a section that pushed
 *   a failure is reported by that failure and must not also get a line saying
 *   it passed, and comparing lengths is how the roster knows without every
 *   caller having to remember to say so.
 * @param {{ cases: number }} declared
 *   How many cases this roster has. REQUIRED, so that a roster cannot be created
 *   without the drop-detection — an optional count is one every future caller
 *   omits, and the omission looks like every other roster.
 * @returns {Roster}
 */
export function createRoster(failures, declared) {
  const expected = declared?.cases;
  if (!Number.isInteger(expected) || Number(expected) < 0) {
    throw new Error(
      `createRoster needs a case count, got ${JSON.stringify(expected)}. Without one a deleted ` +
        `case is silent: its line goes with it and the total drops to match.`,
    );
  }

  /** @type {string[]} */
  const passed = [];
  /** @type {string[]} */
  const skipped = [];

  return {
    mark: () => failures.length,

    record(mark, label, ran = true) {
      if (failures.length !== mark) return;
      (ran ? passed : skipped).push(label);
    },

    passed,
    skipped,

    format(noun) {
      // THROWS rather than pushing a failure, and that is the seam this needs.
      // `format` is the one call every roster user already makes, on the success
      // path, exactly once — so the check costs no caller cooperation. Pushing
      // to `failures` here would be too late: every caller reads that list
      // BEFORE formatting, so the run would report success and then print a
      // complaint nobody's exit code reflects. A second method to remember is
      // how Y-1's roster drifted in the first place.
      const recorded = passed.length + skipped.length;
      if (recorded !== expected) {
        throw new Error(
          recorded < Number(expected)
            ? `This proof declares ${String(expected)} ${noun}s and recorded ${String(recorded)}. ` +
              `${String(Number(expected) - recorded)} case(s) STOPPED RUNNING. If that is ` +
              `deliberate, lower the number in the same commit and say why — a case that ` +
              `disappears takes its line and the total with it, which is why nothing noticed ` +
              `before (finding Z-4).`
            : `This proof declares ${String(expected)} ${noun}s and recorded ${String(recorded)}. ` +
              `Raise the number in the same commit: a count that lags reality stops being ` +
              `evidence the moment it is wrong in either direction.`,
        );
      }

      return (
        `${passed.map((label) => `  ok  ${label}`).join('\n')}\n` +
        skipped.map((label) => `  --  ${label} — nothing to check\n`).join('') +
        `\n${String(passed.length)} ${noun}${passed.length === 1 ? '' : 's'} passed` +
        (skipped.length > 0 ? `, ${String(skipped.length)} not applicable` : '') +
        `.\n`
      );
    },
  };
}
