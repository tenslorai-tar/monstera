// @ts-check
/**
 * Reports a control character in a file a tool just wrote (finding AAAA-11).
 *
 * ## IT REPORTS. IT CANNOT PREVENT, AND NOTHING HERE IS A GATE.
 *
 * A PostToolUse hook runs AFTER the write has happened, so the byte is already
 * on disk when this sees it. `guardFiles.mjs` at commit time remains the only
 * fail-closed gate on this class and is unchanged by this file existing. Read
 * nothing here as protection: this is **latency**, not a second gate.
 *
 * That is the whole design, and it is sufficient for the defect it addresses.
 * Three `Write` calls emitted control characters into string literals on
 * 2026-08-23 — `0x01` once and `0x00` twice, always where a space belonged,
 * always invisible. `guardFiles.mjs` blocked the third at commit. **The first
 * two were found by luck**: an `Edit` that could not match text a `Read` had
 * just displayed, and a `grep` that called a source file binary. In both cases
 * the harm was the window between the write and `git add` — running the file,
 * reading it, misdiagnosing the symptom — rather than the byte reaching a
 * commit. Closing the window is what this does.
 *
 * ## Why the escape rule does not cover it
 *
 * The standing rule sends you to `Write` and `Edit` because shells resolve
 * escape sequences. `Write` is the tool that rule sends you TO, and it is not
 * exempt from emitting a byte nobody typed. The PreToolUse escape guard governs
 * shell tools only and cannot see this at all.
 *
 * ## What it reads
 *
 * The tool's own input, on stdin, as the harness supplies it — not the
 * filesystem. The path is used only to name the file in the report. A hook that
 * re-read the disk would be answering about whatever is there now, which is a
 * different question and one `guardFiles.mjs` already asks better.
 *
 * The detector and the repair text are `guardFiles.mjs`'s, imported rather than
 * copied: a committer and an agent must not be told to repair the same file two
 * different ways, and a second opinion about which bytes are control characters
 * is exactly B3a's shape.
 *
 * Usage: registered as a PostToolUse hook for Write and Edit. Reads a JSON
 * payload on stdin; exits 0 silently when clean, 2 with a report otherwise.
 */

import { CONTROL_CHARACTER_REPAIR, findControlCharacter } from './guardFiles.mjs';
import { isMain } from '../lib/isMain.mjs';

/**
 * The text a Write or Edit call put into the file.
 *
 * Both shapes are handled because both tools can emit the byte, and an Edit's
 * replacement is as capable of carrying one as a whole-file Write. An unknown
 * shape yields nothing to scan and is reported as such by {@link inspectPayload}
 * rather than treated as clean.
 *
 * @param {Record<string, unknown>} toolInput
 * @returns {string | null}
 */
export function writtenText(toolInput) {
  const content = toolInput['content'];
  if (typeof content === 'string') return content;
  const replacement = toolInput['new_string'];
  if (typeof replacement === 'string') return replacement;
  return null;
}

/**
 * A directory whose every write makes this hook say that it ran.
 *
 * ## Why a second trigger exists at all (finding AAAA-14)
 *
 * Without one, the only event that could ever certify this hook is loaded is the
 * defect recurring — and a gate whose expiry may never fire is one that reads as
 * pending for the life of the project while covering nothing. This repository
 * has already sat in that state once: `engine-host-containment` stayed green
 * watching a symbol shipped code could never name.
 *
 * The escape guard has no such problem because its probe input is *harmless in
 * effect while being the banned shape* — `console.log('hook test')` is an
 * ordinary command that the guard must refuse. This hook has no equivalent,
 * because its trigger is a byte nobody can author on purpose: a deliberate
 * attempt on 2026-08-23 to write `0x01` and `0x00` through the tool produced two
 * ordinary spaces. So the benign trigger is supplied on a different axis — a
 * path instead of a payload.
 *
 * ## IT IS A SECOND TRIGGER AND NEVER A SECOND DETECTOR
 *
 * The path decides one thing: whether a live-ness line is emitted. It does not
 * choose a scanner, skip the scan, or change what a finding looks like. Every
 * write goes through {@link findControlCharacter} exactly once and gets
 * {@link CONTROL_CHARACTER_REPAIR} exactly as it would anywhere else — a probe
 * file carrying a real control character is reported as one. A second path with
 * its own detection logic would be the very shape B3a is about, arriving inside
 * the fix for a finding about shared certificates.
 *
 * ## What a firing here certifies, and what it does not
 *
 * **Invocation only.** That the harness ran this hook for a write in this
 * session. It says nothing whatever about whether the scan is correct — that is
 * `proof:reportControlCharacters`, whose fixtures build the bytes numerically
 * because no keyboard emits them. The distinction is carried in the record as a
 * field rather than as prose beside it, so a `fired` entry cannot quietly come
 * to stand for both.
 */
export const PROBE_DIRECTORY = '.claude/hookprobe/';

/**
 * @typedef {object} Inspection
 * @property {'clean' | 'found' | 'nothing-to-scan'} state
 * @property {boolean} live whether the write was under {@link PROBE_DIRECTORY}
 * @property {string} report empty when there is nothing to say
 */

/**
 * Whether a written path sits under the reserved probe directory.
 *
 * Separators are normalised because the harness reports a native path and this
 * runs on Windows, where a check written against forward slashes would answer
 * "no" for every real write and the probe would look permanently dead.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isProbePath(path) {
  return path.replaceAll('\\', '/').includes(PROBE_DIRECTORY);
}

/**
 * What the probe path emits, and it states its own limit.
 *
 * The wording is load-bearing rather than decorative: this is the sentence
 * someone reads before recording a `fired`, and if it did not say *invocation*
 * the entry would be the widening this whole mechanism exists to prevent.
 */
export const LIVENESS_REPORT =
  `\nreportControlCharacters IS LOADED. The harness invoked this hook for a write under ` +
  `${PROBE_DIRECTORY}\n\n` +
  `  THIS CERTIFIES INVOCATION AND NOTHING ELSE — that the hook ran, in this session, for a\n` +
  `  real tool call. It says nothing about whether the scan is correct; that is\n` +
  `  proof:reportControlCharacters, whose fixtures build the bytes numerically because no\n` +
  `  keyboard emits them.\n\n` +
  `  Record it with:\n` +
  `    npm run probe:hook -- reportControlCharacters@PostToolUse fired --certifies invocation\n`;

/**
 * @param {unknown} payload the harness's JSON, already parsed
 * @returns {Inspection}
 */
export function inspectPayload(payload) {
  const object = typeof payload === 'object' && payload !== null ? payload : {};
  const toolInput = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (object)['tool_input'] ?? {}
  );
  const path = typeof toolInput['file_path'] === 'string' ? toolInput['file_path'] : '(unknown path)';
  const text = writtenText(toolInput);
  const live = isProbePath(path);

  // NOT reported as clean. A payload shape this does not understand is a
  // question that was never asked, and the two must not share an output — which
  // is the distinction every instrument in this repository is built around.
  if (text === null) return { state: 'nothing-to-scan', live, report: '' };

  const at = findControlCharacter(Buffer.from(text, 'utf8'));
  if (at === -1) return { state: 'clean', live, report: '' };

  const byte = Buffer.from(text, 'utf8')[at] ?? 0;
  const line = text.slice(0, at).split('\n').length;
  return {
    state: 'found',
    live,
    report:
      `\nA CONTROL CHARACTER WAS JUST WRITTEN, and it is invisible.\n\n` +
      `  ${path}\n` +
      `  0x${byte.toString(16).padStart(2, '0')} at byte ${String(at)}, line ${String(line)} of ` +
      `the written text.\n\n` +
      `  This is a byte nobody typed. It renders as nothing, so the file LOOKS right — and the\n` +
      `  next thing you do with it will fail for a reason that has nothing to do with the byte.\n\n` +
      `  ${CONTROL_CHARACTER_REPAIR}\n\n` +
      `  This is a report, not a block: the write already happened. The commit-time gate is\n` +
      `  guardFiles.mjs, which is what actually refuses the byte.\n`,
  };
}

if (isMain(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // An unreadable payload is not a finding about the file. Saying so on
    // stderr and exiting 0 keeps this from becoming a source of noise about
    // itself — it has no power to protect anything, so failing loudly here
    // would cost more than it buys.
    process.stderr.write('reportControlCharacters: could not parse the hook payload.\n');
    process.exit(0);
  }
  const inspection = inspectPayload(payload);
  // The scan's own result first, unconditionally, so a probe file carrying a
  // real control character is reported as one. The probe path adds a line; it
  // never replaces or suppresses a finding.
  if (inspection.state === 'found') process.stderr.write(inspection.report);
  if (inspection.live) process.stderr.write(LIVENESS_REPORT);
  // Exit 2 is how a PostToolUse hook's stderr reaches the agent at all, so the
  // live-ness line needs it as much as a finding does. An observation nobody
  // can see is not an observation.
  process.exit(inspection.state === 'found' || inspection.live ? 2 : 0);
}
