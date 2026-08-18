// @ts-check
/**
 * Records the outcome of the PreToolUse guard probe.
 *
 * Usage:
 *   1. Run this, verbatim, as an ordinary shell command in the session:
 *
 *        node -e "console.log('hook test')"
 *
 *   2. node scripts/hooks/recordHookProbe.mjs denied     (it was blocked)
 *      node scripts/hooks/recordHookProbe.mjs executed   (it ran)
 *
 * Record either outcome. `executed` is not a reason to skip the record — it is
 * the finding, and it means `CLAUDE.md` overstates what is in place and must be
 * corrected in the same commit.
 *
 * What this refuses to do is record something it cannot stand behind. The
 * session's start time is read from its own transcript rather than supplied, and
 * a session that started before the guard's configuration is rejected outright:
 * hooks are read at process start, so such a session cannot have loaded the
 * configuration, and its result cannot mean what it appears to mean. That is not
 * hypothetical — it is what happened on the first attempt, where the process
 * predated its own settings file by forty hours and the probe ran unimpeded.
 */

import { repoRoot } from '../lib/gitScope.mjs';
import {
  PROBE_COMMAND,
  RECORD_FILE,
  currentInputDigest,
  currentSessionStart,
  inputsLastChangedAt,
  probeState,
  writeRecord,
} from '../lib/hookProbe.mjs';

const ROOT = repoRoot();
const outcome = process.argv[2];

if (outcome !== 'denied' && outcome !== 'executed') {
  process.stderr.write(
    `Usage: node scripts/hooks/recordHookProbe.mjs <denied|executed>\n\n` +
      `Run this first, verbatim, as an ordinary shell command:\n\n  ${PROBE_COMMAND}\n\n` +
      `Then record what happened. Record it either way — "executed" is the finding, not a\n` +
      `reason to wait for a better answer.\n`,
  );
  process.exit(2);
}

const session = currentSessionStart(ROOT);
if (session === null) {
  process.stderr.write(
    `Cannot determine when this session's process started, so the stale-session confound cannot\n` +
      `be ruled out and this refuses to record an unverifiable pass.\n\n` +
      `The session transcript is the only artefact carrying that time. If this is running outside\n` +
      `an agent session, there is nothing to record: the probe is about whether the agent's own\n` +
      `tool calls are blocked.\n`,
  );
  process.exit(1);
}

const changedAt = inputsLastChangedAt(ROOT);
if (changedAt === null) {
  process.stderr.write(
    `The probe's inputs are not tracked by git yet, so there is no moment to compare the session\n` +
      `start against. Commit .claude/settings.json and the guard script first.\n`,
  );
  process.exit(1);
}

// Only an "executed" outcome needs the session to be newer than the guard it is
// reporting on. A denial cannot be produced by a session that never loaded the
// guard, so its own timing cannot weaken it — and refusing one on those grounds
// would throw away the only evidence that matters.
if (outcome === 'executed' && Date.parse(session.startedAt) <= Date.parse(changedAt)) {
  process.stderr.write(
    `REFUSING to record.\n\n` +
      `  session started        ${session.startedAt}\n` +
      `  inputs last changed    ${changedAt}\n\n` +
      `The probe RAN in a session that started at or before the guard's configuration last changed.\n` +
      `That session may never have loaded it, so "it ran" cannot be told apart from "there is no\n` +
      `guard", and recording it would assert something this run cannot establish.\n\n` +
      `Re-run where the session is newer than the configuration. Note that /compact does not start a\n` +
      `new process; it clears context inside the same session.\n`,
  );
  process.exit(1);
}

const digest = currentInputDigest();

writeRecord(
  {
    outcome,
    command: PROBE_COMMAND,
    recordedAt: new Date().toISOString(),
    sessionStartedAt: session.startedAt,
    inputsLastChangedAt: changedAt,
    note:
      outcome === 'denied'
        ? 'The guard blocked the command. The mechanism CLAUDE.md describes is live.'
        : 'The command RAN in a session that could have loaded the guard. The mechanism does not ' +
          'work; correct CLAUDE.md in the same commit.',
    verdict: {
      digest: digest.digest,
      inputs: digest.inputs.map((input) => ({ name: input.name, digest: input.digest })),
    },
  },
  ROOT,
);

const { state, detail } = probeState(ROOT);
process.stdout.write(`Recorded ${outcome} in ${RECORD_FILE}\n  state: ${state}\n  ${detail}\n`);
process.exit(state === 'denied' ? 0 : 1);
