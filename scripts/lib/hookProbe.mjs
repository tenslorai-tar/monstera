// @ts-check
/**
 * The record of whether the PreToolUse guard has ever been observed to fire.
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
 * **rejected rather than believed**. That is the whole point: the failure mode
 * is not "someone forgot to run it", it is "someone ran it and got an answer
 * that could not mean what it appeared to mean".
 *
 * ## Why the verdict machinery
 *
 * This is a cached point-in-time verdict, which is the class `verdict.mjs` was
 * built for after three of them went stale unnoticed. Its inputs are the two
 * things that decide whether the configured guard denies: the settings that wire
 * it, and the script that answers. Change either and the record stops counting,
 * because a probe run against a different guard is not evidence about this one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { changedInputs, digestInputs } from './verdict.mjs';

/** Repo-relative path of the tracked record. */
export const RECORD_FILE = 'docs/hook-probe.json';

/**
 * The command the probe runs. Deliberately the most ordinary possible use of the
 * banned path: if the guard does not stop this, it stops nothing.
 */
export const PROBE_COMMAND = `node -e "console.log('hook test')"`;

/**
 * What this verdict's truth rests on. Two inputs and no more — the wiring, and
 * the script it wires up. The guard's PROOF is not an input: a proof changing
 * does not change what the guard does.
 *
 * @type {readonly import('./verdict.mjs').Input[]}
 */
export const PROBE_INPUTS = [
  { file: '.claude/settings.json', why: 'registers the hook; a change can unregister or repoint it' },
  {
    file: 'scripts/hooks/blockEscapeResolvingWrites.mjs',
    why: 'decides deny or allow; a probe against a different script is not evidence about this one',
  },
];

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
 * When the probe's inputs last changed, according to git.
 *
 * The committer date of the most recent commit touching any declared input. A
 * session that started before this cannot have loaded the configuration the
 * record claims to be about.
 *
 * @param {string} root
 * @returns {string | null} ISO timestamp, or null if none are tracked yet.
 */
export function inputsLastChangedAt(root) {
  /** @type {string[]} */
  const paths = [];
  for (const input of PROBE_INPUTS) if ('file' in input) paths.push(input.file);

  const result = spawnSync('git', ['log', '-1', '--format=%cI', '--', ...paths], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const stamped = `${result.stdout ?? ''}`.trim();
  return stamped === '' ? null : stamped;
}

/**
 * @typedef {{
 *   outcome: 'denied' | 'executed',
 *   command: string,
 *   recordedAt: string,
 *   sessionStartedAt: string,
 *   inputsLastChangedAt: string,
 *   note: string,
 *   verdict: { digest: string, inputs: Array<{ name: string, digest: string }> },
 * }} ProbeRecord
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
 * @typedef {'unrecorded' | 'inputs-changed' | 'stale-session' | 'executed' | 'denied'} ProbeState
 */

/**
 * Whether the guard has been observed to fire, and if not, why the record does
 * not establish it.
 *
 * The order of the checks is the order in which an answer stops meaning
 * anything: no record at all, then a record about a different guard, then a
 * record taken where the guard could not have been loaded, and only then the
 * outcome itself.
 *
 * @param {string} [root]
 * @returns {{ state: ProbeState, detail: string }}
 */
export function probeState(root = repoRoot()) {
  const record = readRecord(root);
  if (record === null) {
    return {
      state: 'unrecorded',
      detail:
        `No ${RECORD_FILE}. The guard has never been observed to fire. Run it in a session whose ` +
        `process started AFTER its inputs last changed, then record with: npm run probe:hook -- <denied|executed>`,
    };
  }

  const moved = changedInputs(record.verdict.inputs, PROBE_INPUTS, { root });
  if (moved.length > 0) {
    return {
      state: 'inputs-changed',
      detail:
        `The recorded probe is about a different guard. Changed since it was taken: ` +
        `${moved.map((entry) => entry.name).join(', ')}. Re-run the probe.`,
    };
  }

  // The session-age check applies to ONE outcome, not both, and the asymmetry is
  // the whole point.
  //
  // A denial is self-certifying: a session that had not loaded the guard cannot
  // produce one, so no fact about when that session started can weaken it. "It
  // ran" is the ambiguous outcome — indistinguishable from a guard that is
  // simply absent — and that is the only one needing the session to be newer
  // than the configuration.
  //
  // This was symmetric when first written, which would have rejected the first
  // denial this project ever observed, on the grounds that the session predated
  // the config. It did; the guard fired anyway.
  if (record.outcome !== 'denied') {
    if (Date.parse(record.sessionStartedAt) <= Date.parse(record.inputsLastChangedAt)) {
      return {
        state: 'stale-session',
        detail:
          `The probe RAN, in a session that started ${record.sessionStartedAt} — at or before its ` +
          `inputs last changed (${record.inputsLastChangedAt}). That session may never have loaded ` +
          `this configuration, so "it ran" cannot be told apart from "there is no guard". Re-run ` +
          `where the session is newer than the configuration.`,
      };
    }
    return {
      state: 'executed',
      detail:
        `The probe RAN rather than being denied, in a session that could have loaded the guard ` +
        `(started ${record.sessionStartedAt}, inputs last changed ${record.inputsLastChangedAt}). ` +
        `The mechanism does not work. CLAUDE.md must not claim it does.`,
    };
  }

  return {
    state: 'denied',
    detail: `Observed denied at ${record.recordedAt}, session started ${record.sessionStartedAt}.`,
  };
}

/** @returns {Resolved} */
export function currentInputDigest() {
  return digestInputs(PROBE_INPUTS);
}

/** @typedef {import('./verdict.mjs').Resolved} Resolved */
