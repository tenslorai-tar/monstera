// @ts-check
/**
 * Records what one registered hook was observed to do.
 *
 * Usage:
 *   node scripts/hooks/recordHookProbe.mjs <mechanism> <fired|silent|unobserved>
 *     [--exercise "<what exercises it>"]   required only the first time
 *     [--evidence "<what was observed>"]
 *
 * The mechanism names must come from `.claude/settings.json` — this refuses a
 * name nothing registers, because an entry for a hook that is not wired up is a
 * certificate with no mechanism behind it.
 *
 * Record whichever outcome happened. `silent` is not a reason to skip the
 * record — it is the finding, and it means the documents overstate what is in
 * place and must be corrected in the same commit.
 *
 * ## What this refuses to do
 *
 * Record something it cannot stand behind. The session's start time is read from
 * its own transcript rather than supplied, and a **silent** result from a
 * session that started before the hook's configuration is rejected outright:
 * hooks are read at process start, so such a session cannot have loaded the
 * configuration, and its result cannot mean what it appears to mean. That is not
 * hypothetical — it is what happened on the first attempt, where the process
 * predated its own settings file by forty hours and the probe ran unimpeded.
 *
 * A **fired** result is accepted at any session age, deliberately. Nothing that
 * failed to load a hook can produce that hook's own output, so the observation
 * certifies itself and refusing it on timing grounds would throw away the only
 * evidence that matters. That asymmetry is keyed on whether the observation is
 * self-certifying, not on which hook kind produced it: a PostToolUse report is
 * exactly as self-certifying as a PreToolUse denial (finding AAAA-12).
 */

import { repoRoot } from '../lib/gitScope.mjs';
import {
  PROBE_COMMAND,
  RECORD_FILE,
  currentInputDigest,
  currentSessionStart,
  inputsLastChangedAt,
  probeState,
  readRecord,
  writeRecord,
} from '../lib/hookProbe.mjs';
import { registeredHooks } from '../lib/registeredHooks.mjs';

const ROOT = repoRoot();

/** @param {readonly string[]} argv @param {string} flag @returns {string | null} */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

const argv = process.argv.slice(2);
const positional = argv.filter((value, index) => !value.startsWith('--') && !argv[index - 1]?.startsWith('--'));
const [mechanism, outcome] = positional;
const exercise = flagValue(argv, '--exercise');
const evidence = flagValue(argv, '--evidence');

const hooks = registeredHooks(ROOT);
const known = hooks.map((hook) => hook.name).join(', ');

/** @param {string} message @returns {never} */
function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

if (outcome !== 'fired' && outcome !== 'silent' && outcome !== 'unobserved') {
  refuse(
    `Usage: node scripts/hooks/recordHookProbe.mjs <mechanism> <fired|silent|unobserved> --exercise "..."\n\n` +
      `Registered mechanisms: ${known}\n\n` +
      `  fired       the hook was observed acting (denied, reported). Self-certifying.\n` +
      `  silent      it was exercised and did nothing. THE FINDING — record it.\n` +
      `  unobserved  registered, never exercised. Honest, and satisfies no gate.\n\n` +
      `The escape guard is exercised by running this verbatim as an ordinary shell command:\n\n  ${PROBE_COMMAND}\n`,
  );
}

const hook = hooks.find((entry) => entry.name === mechanism);
if (hook === undefined) {
  refuse(
    `${mechanism ?? '(no mechanism named)'} is not registered in .claude/settings.json.\n\n` +
      `Registered mechanisms: ${known}\n\n` +
      `An entry for an unregistered hook is a certificate with no mechanism behind it. Register ` +
      `it first, in the same commit as this record.`,
  );
}

// How a mechanism is exercised is a property of the mechanism, not of each
// observation, so it is required once and inherited by every later recording.
// Re-probing after a settings change — which invalidates every entry — must not
// mean retyping a command; a tool that is tedious to run correctly is one that
// gets run some other way.
const existing = readRecord(ROOT)?.mechanisms?.[hook.name];
const exerciseText = exercise ?? existing?.exercise ?? null;
if (exerciseText === null || exerciseText.trim() === '') {
  refuse(
    `--exercise is required the first time a mechanism is recorded. It says what was done to make ` +
      `the hook act, or — for unobserved — what WOULD. An entry nobody can reproduce is ` +
      `provenance nobody can check.\n\n` +
      `Later recordings inherit it; pass --exercise again only when the way you exercise it changed.`,
  );
}

const changedAt = inputsLastChangedAt(ROOT, hook.script);
if (changedAt === null) {
  refuse(
    `${mechanism}'s inputs are not tracked by git yet, so there is no moment to compare the ` +
      `session start against. Commit .claude/settings.json and ${hook.script} first.`,
  );
}

/** @type {string | null} */
let sessionStartedAt = null;
if (outcome !== 'unobserved') {
  const session = currentSessionStart(ROOT);
  if (session === null) {
    refuse(
      `Cannot determine when this session's process started, so the stale-session confound cannot\n` +
        `be ruled out and this refuses to record an unverifiable observation.\n\n` +
        `The session transcript is the only artefact carrying that time. If this is running outside\n` +
        `an agent session, there is nothing to record: the probe is about whether the agent's own\n` +
        `tool calls meet the hook.`,
    );
  }
  sessionStartedAt = session.startedAt;

  if (outcome === 'silent' && Date.parse(sessionStartedAt) <= Date.parse(changedAt)) {
    process.stderr.write(
      `REFUSING to record.\n\n` +
        `  session started        ${sessionStartedAt}\n` +
        `  inputs last changed    ${changedAt}\n\n` +
        `${mechanism} stayed SILENT in a session that started at or before its configuration last\n` +
        `changed. That session may never have loaded it, so "it did nothing" cannot be told apart\n` +
        `from "there is no hook", and recording it would assert something this run cannot\n` +
        `establish.\n\n` +
        `Re-run where the session is newer than the configuration. Note that /compact does not start\n` +
        `a new process; it clears context inside the same session.\n`,
    );
    process.exit(1);
  }
}

const digest = currentInputDigest(hook.script, ROOT);
const record = readRecord(ROOT) ?? { mechanisms: {} };

record.mechanisms[hook.name] = {
  script: hook.script,
  event: hook.event,
  outcome,
  exercise: exerciseText,
  evidence:
    evidence ??
    (outcome === 'fired'
      ? 'The hook produced its own output. Nothing that failed to load it can do that.'
      : outcome === 'silent'
        ? 'The hook did nothing in a session that could have loaded it. It does not work.'
        : 'Registered and never exercised. This is not evidence and satisfies no gate.'),
  recordedAt: new Date().toISOString(),
  sessionStartedAt,
  inputsLastChangedAt: changedAt,
  verdict: {
    digest: digest.digest,
    inputs: digest.inputs.map((input) => ({ name: input.name, digest: input.digest })),
  },
};

// Sorted, so the file's order is the resolver's order and a diff shows the
// change rather than the reshuffle.
record.mechanisms = Object.fromEntries(
  Object.entries(record.mechanisms).sort(([a], [b]) => a.localeCompare(b)),
);

writeRecord(record, ROOT);

const { state, detail } = probeState(hook.name, ROOT);
process.stdout.write(`Recorded ${outcome} for ${hook.name} in ${RECORD_FILE}\n  state: ${state}\n  ${detail}\n`);
process.exit(state === 'fired' || state === 'unobserved' ? 0 : 1);
