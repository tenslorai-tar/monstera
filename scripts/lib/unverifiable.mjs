// @ts-check
/**
 * What a probe does when it could not look.
 *
 * ## One rule, three callers, and it was three rules for a day
 *
 * `lowboxSpike.mjs` settled this: a Win32-only measurement exits **0** where
 * nothing provisioned it — there is nothing to assert and nothing to deny — and
 * exits **1** on the job that DID provision, because a could-not-look there is
 * something broken rather than something absent. The flag is what separates
 * them, and it is passed by the job that installed the platform, the build and
 * the modules.
 *
 * `transportTeardown.mjs` and `transportWrite.mjs` were written with the first
 * half and not the second: they exited 0 on a missing build, on the containment
 * jobs, where a missing build cannot legitimately happen. A green step and a
 * step that measured nothing were the same observation — which is the
 * three-state rule this project keeps everywhere else, broken in the two files
 * whose subject is the transport's own correctness.
 *
 * So the rule lives here and the callers take it (B3a). A rule that lives in
 * call sites is one the next caller re-derives, and this one had already been
 * re-derived twice by the author who had the original open.
 *
 * ## Why the decision is separated from the exit
 *
 * `process.exit` cannot be observed by a case that also wants to run afterwards.
 * {@link unverifiableOutcome} is pure and answers *what should happen*;
 * {@link exitUnverifiable} does it. The proof exercises the first, which is
 * where the rule is.
 */

/**
 * The token a harness keys on to tell *could not look* from *passed*.
 *
 * Exported rather than matched by eye, because a runner reads only the exit
 * code and the permissive outcome's code is **0** — so without this, a probe
 * that measured nothing and a probe that measured everything are one
 * observation. Measured 2026-08-25: with the built pipe surface moved aside,
 * `npm run local -- --only proof:transportwrite` reported `ok` in 0.3s, and the
 * affected-proofs disclosure then certified that the run had *reached every
 * proof that reads a file this tree changed*.
 *
 * It lives here for the reason the rule does (B3a): a harness that spelt its own
 * version of this string would be a second opinion about what this module says,
 * and the two would drift the first time the wording changed.
 */
export const UNVERIFIABLE_MARKER = '\n  UNVERIFIABLE  ';

/**
 * @typedef {object} UnverifiableOutcome
 * @property {number} code the exit code this run should end with
 * @property {'stdout' | 'stderr'} stream where the explanation belongs
 * @property {string} text the explanation
 */

/**
 * The decision, without taking it.
 *
 * @param {object} options
 * @param {boolean} options.required whether the caller was told to require a
 *   real measurement — the flag the provisioning job passes.
 * @param {string} options.subject what is not being measured, named so the
 *   reader knows what the silence covers.
 * @param {string} options.why the specific condition that stopped it.
 * @param {string} options.flag the flag a job passes to require this, named in
 *   the permissive message so a reader can see where the strict path lives.
 * @returns {UnverifiableOutcome}
 */
export function unverifiableOutcome({ required, subject, why, flag }) {
  if (required) {
    return {
      code: 1,
      stream: 'stderr',
      text:
        `\n${subject.toUpperCase()} IS UNPROVEN, and ${flag} says that is a failure here.\n\n` +
        `  ${why}\n\n` +
        `  This flag is passed by a job that provisions the platform, the build and the\n` +
        `  modules, so a could-not-look on it is something broken rather than something\n` +
        `  absent.\n`,
    };
  }
  return {
    code: 0,
    stream: 'stdout',
    text:
      `${UNVERIFIABLE_MARKER}${subject} is not measured here\n      ${why}\n\n` +
      `  NOT a pass. Nothing about ${subject} is asserted by this run, and nothing is denied\n` +
      `  either — a job passing ${flag} treats the same condition as red.\n`,
  };
}

/**
 * Takes the decision. Never returns.
 *
 * @param {Parameters<typeof unverifiableOutcome>[0]} options
 * @returns {never}
 */
export function exitUnverifiable(options) {
  const outcome = unverifiableOutcome(options);
  if (outcome.stream === 'stderr') process.stderr.write(outcome.text);
  else process.stdout.write(outcome.text);
  process.exit(outcome.code);
}
