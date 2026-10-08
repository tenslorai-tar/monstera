// @ts-check
/**
 * A control role for `perfBudget.proof.mjs` (R29). It never produces a
 * measurement; it only exits.
 *
 * - `--exit 2` refuses the way a role the runner genuinely cannot measure does
 *   (`--host` off Windows, a binary this platform has no AppContainer for): the
 *   sanctioned not-applicable code the gate reads as "not asserted".
 * - any other code fails the way a BROKEN role does — the state that must redden
 *   the gate, because reading it as "not applicable" is how a broken real host
 *   passed from 76e16d7b until R29.
 *
 * Both are the same script so the proof exercises one classifier from both
 * sides with one fixture, never a pair that could drift apart. It prints its
 * reason first, as every role script does, so `measurePeak`'s error carries it.
 *
 * The fixture path the gate always passes first is ignored; this role reads
 * only its own `--exit` argument.
 */
const flag = process.argv.indexOf('--exit');
const code = flag === -1 ? 1 : Number(process.argv[flag + 1]);
process.stderr.write(
  `roleControlExit: exiting ${String(code)} with no measurement — ` +
    `${code === 2 ? 'the sanctioned not-applicable signal' : 'a broken role the gate must redden'} (R29 control)\n`,
);
process.exit(Number.isFinite(code) ? code : 1);
