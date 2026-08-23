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
 * @typedef {object} Inspection
 * @property {'clean' | 'found' | 'nothing-to-scan'} state
 * @property {string} report empty when there is nothing to say
 */

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

  // NOT reported as clean. A payload shape this does not understand is a
  // question that was never asked, and the two must not share an output — which
  // is the distinction every instrument in this repository is built around.
  if (text === null) return { state: 'nothing-to-scan', report: '' };

  const at = findControlCharacter(Buffer.from(text, 'utf8'));
  if (at === -1) return { state: 'clean', report: '' };

  const byte = Buffer.from(text, 'utf8')[at] ?? 0;
  const line = text.slice(0, at).split('\n').length;
  return {
    state: 'found',
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
  if (inspection.state === 'found') {
    process.stderr.write(inspection.report);
    process.exit(2);
  }
  process.exit(0);
}
