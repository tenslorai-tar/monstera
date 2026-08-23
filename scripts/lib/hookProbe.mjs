// @ts-check
/**
 * The record of whether each registered hook has ever been observed to act.
 *
 * ## Why a record, and why it gates Stage 0
 *
 * `CLAUDE.md` states that the escape-resolving write path is *unavailable* — a
 * mechanism, not a rule. Every part of that claim is proven except the part that
 * matters: that the guard is loaded in the agent session doing the writing.
 * `proof:escapeguard` runs the script, reads the tracked settings and executes
 * the configured command string, and none of that can reach the agent's own hook
 * table. Seven occurrences of the class have now happened, the most recent about
 * an hour after the amendment claiming the mechanism was in place.
 *
 * A mechanism a governing document asserts, that has never been seen to work, is
 * not something a closing stage can carry. So this is an **exit condition**
 * rather than a note in a handoff: the handoff was already tried, and the one
 * session that could have run it read `/compact` as a new session.
 *
 * ## One entry per mechanism, and the roster is derived (finding AAAA-13)
 *
 * This held a single outcome for a long time, which was right while one hook was
 * registered and became a widening the moment a second was. The record would
 * have said `denied` about `node -e` — evidence about the escape guard and
 * nothing else — while the gate row it backs named two mechanisms. That is the
 * quiet kind of widening: not a sentence overstating anything, a **data shape**
 * with no room to tell two things apart.
 *
 * So each registered hook has its own entry, with its own exercise, its own
 * outcome and its own inputs, and the set of entries that must exist is derived
 * from `.claude/settings.json` by {@link registeredHooks} rather than listed
 * here. A third hook cannot inherit the second's certificate, because the thing
 * that decides which certificates are required is the same file that registers
 * the hook.
 *
 * ## The confound this exists to make unrepresentable
 *
 * Attempt 1 (2026-08-18) ran the probe and it was NOT denied — because the
 * session's process had started forty hours before `.claude/settings.json`
 * existed. Hooks are read at process start, so the guard was never loaded. The
 * probe measured a session, not a guard, and "the command ran" is exactly what a
 * broken guard also looks like.
 *
 * A record therefore carries the session's start time and the moment its inputs
 * last changed, and a record whose session predates its own configuration is
 * **rejected rather than believed** — for the one outcome where that matters.
 *
 * ## The three outcomes, and why they are not two
 *
 * The vocabulary is about the mechanism, not about the tool call, because two
 * hook kinds now share it and a PreToolUse denial has no PostToolUse analogue:
 *
 *   - **`fired`** — the mechanism was observed acting: the guard denied, the
 *     reporter reported. **Self-certifying, and accepted at any session age.**
 *     Nothing that failed to load a hook can produce that hook's own output, so
 *     no fact about when the session started can weaken it.
 *   - **`silent`** — the mechanism was exercised and did not act. **Ambiguous**,
 *     because a hook that is absent is silent too, so this needs a session newer
 *     than the configuration or it establishes nothing.
 *   - **`unobserved`** — registered, never exercised. Not an observation in
 *     either direction, and never a satisfied gate. It exists so that a hook can
 *     be registered honestly before anyone has seen it act, instead of the
 *     absence of an entry standing in for it.
 *
 * The asymmetry between the first two is the whole point, and it was written
 * symmetric at first — which would have rejected the first denial this project
 * ever observed, on the grounds that the session predated the config. It did;
 * the guard fired anyway.
 *
 * **`fired` is not a synonym for the old `denied`, and the difference is what
 * finding AAAA-12 turned on.** A row claimed that registering the PostToolUse
 * reporter could not be recorded from an older session, reasoning that a
 * reporter cannot deny, so its evidence must be `executed`-shaped, so the age
 * gate applies. The premise is about a *name*. The property the gate is keyed on
 * is whether the observation is self-certifying, and a report is exactly as
 * self-certifying as a denial.
 *
 * ## Why the verdict machinery
 *
 * This is a cached point-in-time verdict, which is the class `verdict.mjs` was
 * built for after three of them went stale unnoticed. An entry's inputs are the
 * two things that decide whether that hook acts: the settings that wire it, and
 * the script that answers. Change either and the entry stops counting, because
 * a probe run against a different guard is not evidence about this one.
 *
 * The settings file is an input to **every** entry, so registering a new hook
 * invalidates them all and each must be re-established. That is deliberate
 * over-invalidation: this cannot tell a settings edit that repoints one hook
 * from one that adds an unrelated one, and the safe direction is to ask again.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { SETTINGS_FILE, registeredHooks } from './registeredHooks.mjs';
import { changedInputs, digestInputs } from './verdict.mjs';

/** Repo-relative path of the tracked record. */
export const RECORD_FILE = 'docs/hook-probe.json';

/**
 * The command that exercises the escape guard, quoted verbatim by `CLAUDE.md`.
 *
 * Deliberately the most ordinary possible use of the banned path: if the guard
 * does not stop this, it stops nothing. It is one mechanism's exercise rather
 * than the probe's, which is why the recorder takes the exercise as an argument
 * instead of assuming this one.
 */
export const PROBE_COMMAND = `node -e "console.log('hook test')"`;

/**
 * What one mechanism's verdict rests on: the wiring, and the script it wires up.
 *
 * The hook's PROOF is not an input — a proof changing does not change what the
 * hook does.
 *
 * @param {string} script Repo-relative path of the hook script.
 * @returns {readonly import('./verdict.mjs').Input[]}
 */
export function mechanismInputs(script) {
  return [
    { file: SETTINGS_FILE, why: 'registers the hook; a change can unregister or repoint it' },
    {
      file: script,
      why: 'decides whether the hook acts; a probe against a different script is not evidence about this one',
    },
  ];
}

/**
 * When the current agent session's process started.
 *
 * Read from the session transcript, because that is the only artefact that
 * records it. The session being written to right now is the one with the newest
 * mtime; its birth time is when the process started, which is when hooks were
 * read.
 *
 * Returns null rather than guessing. A probe that cannot establish when its own
 * session began cannot rule out the stale-session confound, and recording it
 * anyway would produce exactly the unverifiable pass this module exists to
 * prevent.
 *
 * @param {string} root
 * @returns {{ startedAt: string, transcript: string } | null}
 */
export function currentSessionStart(root) {
  // Claude Code names the project directory after the checkout path with every
  // separator and colon replaced by a dash.
  const slug = root.replaceAll(/[\\/:]/gu, '-');
  const directory = join(homedir(), '.claude', 'projects', slug);
  if (!existsSync(directory)) return null;

  const transcripts = readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const path = join(directory, name);
      const stats = statSync(path);
      return { path, mtime: stats.mtimeMs, birthtime: stats.birthtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const active = transcripts[0];
  if (active === undefined) return null;
  return { startedAt: active.birthtime.toISOString(), transcript: active.path };
}

/**
 * When one mechanism's inputs last changed, according to git.
 *
 * The committer date of the most recent commit touching either of them. A
 * session that started before this cannot have loaded the configuration the
 * entry claims to be about.
 *
 * @param {string} root
 * @param {string} script
 * @returns {string | null} ISO timestamp, or null if neither is tracked yet.
 */
export function inputsLastChangedAt(root, script) {
  const result = spawnSync('git', ['log', '-1', '--format=%cI', '--', SETTINGS_FILE, script], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const stamped = `${result.stdout ?? ''}`.trim();
  return stamped === '' ? null : stamped;
}

/**
 * @typedef {'fired' | 'silent' | 'unobserved'} ProbeOutcome
 *
 * @typedef {{
 *   script: string,
 *   event: string,
 *   outcome: ProbeOutcome,
 *   exercise: string,
 *   evidence: string,
 *   recordedAt: string,
 *   sessionStartedAt: string | null,
 *   inputsLastChangedAt: string,
 *   verdict: { digest: string, inputs: Array<{ name: string, digest: string }> },
 * }} MechanismEntry
 *
 * @typedef {{ mechanisms: Record<string, MechanismEntry> }} ProbeRecord
 */

/**
 * @param {string} [root]
 * @returns {ProbeRecord | null}
 */
export function readRecord(root = repoRoot()) {
  const path = join(root, RECORD_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @param {ProbeRecord} record
 * @param {string} [root]
 */
export function writeRecord(record, root = repoRoot()) {
  writeFileSync(join(root, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/**
 * @typedef {'unregistered' | 'unrecorded' | 'inputs-changed' | 'stale-session'
 *   | 'unobserved' | 'silent' | 'fired'} ProbeState
 */

/**
 * Whether one mechanism has been observed to act, and if not, why the record
 * does not establish it.
 *
 * The order of the checks is the order in which an answer stops meaning
 * anything: not registered at all, then no entry, then an entry about a
 * different hook, then never exercised, then an exercise taken where the hook
 * could not have been loaded, and only then the outcome itself.
 *
 * @param {string} mechanism
 * @param {string} [root]
 * @returns {{ state: ProbeState, detail: string }}
 */
export function probeState(mechanism, root = repoRoot()) {
  const hook = registeredHooks(root).find((entry) => entry.name === mechanism);
  if (hook === undefined) {
    return {
      state: 'unregistered',
      detail:
        `${SETTINGS_FILE} registers no hook named ${mechanism}. A mechanism that is not ` +
        `registered cannot have been observed, whatever the record says about it.`,
    };
  }

  const entry = readRecord(root)?.mechanisms?.[mechanism];
  if (entry === undefined) {
    return {
      state: 'unrecorded',
      detail:
        `No entry for ${mechanism} in ${RECORD_FILE}. It has never been observed to act. Exercise ` +
        `it, then record with: npm run probe:hook -- ${mechanism} <fired|silent> --exercise "..."`,
    };
  }

  const moved = changedInputs(entry.verdict.inputs, mechanismInputs(hook.script), { root });
  if (moved.length > 0) {
    return {
      state: 'inputs-changed',
      detail:
        `The recorded probe for ${mechanism} is about a different hook. Changed since it was ` +
        `taken: ${moved.map((item) => item.name).join(', ')}. Re-run the probe.`,
    };
  }

  if (entry.outcome === 'unobserved') {
    return {
      state: 'unobserved',
      detail:
        `${mechanism} is registered and has never been exercised. That is an honest entry, not ` +
        `evidence: it must not satisfy any gate. Exercise it with: ${entry.exercise}`,
    };
  }

  // The session-age check applies to ONE outcome, not both, and the asymmetry is
  // the whole point.
  //
  // A hook that was never loaded cannot produce its own output, so `fired` is
  // self-certifying and no fact about when the session started can weaken it.
  // `silent` is the ambiguous one — indistinguishable from a hook that is simply
  // absent — and that is the only outcome needing the session to be newer than
  // the configuration.
  if (entry.outcome === 'silent') {
    if (
      entry.sessionStartedAt === null ||
      Date.parse(entry.sessionStartedAt) <= Date.parse(entry.inputsLastChangedAt)
    ) {
      return {
        state: 'stale-session',
        detail:
          `${mechanism} was exercised and stayed SILENT, in a session that started ` +
          `${entry.sessionStartedAt ?? '(unknown)'} — at or before its inputs last changed ` +
          `(${entry.inputsLastChangedAt}). That session may never have loaded this ` +
          `configuration, so "it did nothing" cannot be told apart from "there is no hook". ` +
          `Re-run where the session is newer than the configuration.`,
      };
    }
    return {
      state: 'silent',
      detail:
        `${mechanism} was exercised and did NOT act, in a session that could have loaded it ` +
        `(started ${entry.sessionStartedAt}, inputs last changed ${entry.inputsLastChangedAt}). ` +
        `The mechanism does not work. No document may claim it does.`,
    };
  }

  return {
    state: 'fired',
    detail: `Observed acting at ${entry.recordedAt}; exercised by ${entry.exercise}. ${entry.evidence}`,
  };
}

/**
 * Every registered hook, its recorded state, and the entries that are missing.
 *
 * The `missing` list is what makes a newly registered hook loud: it is derived
 * from the settings file, so a third hook arrives already owing evidence rather
 * than quietly covered by the second one's.
 *
 * @param {string} [root]
 * @returns {{
 *   hooks: readonly import('./registeredHooks.mjs').RegisteredHook[],
 *   states: Array<{ name: string, state: ProbeState, detail: string }>,
 *   missing: string[],
 *   unrecognised: string[],
 * }}
 */
export function probeCoverage(root = repoRoot()) {
  const hooks = registeredHooks(root);
  const states = hooks.map((hook) => ({ name: hook.name, ...probeState(hook.name, root) }));
  const recorded = Object.keys(readRecord(root)?.mechanisms ?? {});

  return {
    hooks,
    states,
    missing: states.filter((entry) => entry.state === 'unrecorded').map((entry) => entry.name),
    // An entry for a hook nothing registers any more. Not a failure on its own —
    // it is stale evidence, and saying so beats deleting it silently.
    unrecognised: recorded.filter((name) => !hooks.some((hook) => hook.name === name)),
  };
}

/**
 * @param {string} script
 * @param {string} [root]
 * @returns {Resolved}
 */
export function currentInputDigest(script, root = repoRoot()) {
  return digestInputs(mechanismInputs(script), { root });
}

/** @typedef {import('./verdict.mjs').Resolved} Resolved */
