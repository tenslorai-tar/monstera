// @ts-check
/**
 * Proof that the control-character reporter sees, refuses to see what is not
 * there, and says the same words the commit gate says (rule B2, finding
 * AAAA-11).
 *
 * It is a SEARCH, and its reassuring answer is silence — a clean file and a
 * reporter that cannot read its payload produce the same empty output. So the
 * cases drive both directions, and the positive control is built from a byte
 * NUMERICALLY rather than typed, because no keyboard emits one and a fixture
 * that carries it as text would not be carrying it at all.
 *
 * Usage: node scripts/proofs/reportControlCharacters.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTROL_CHARACTER_REPAIR } from '../hooks/guardFiles.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { inspectPayload, writtenText } from '../hooks/reportControlCharacters.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 14 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'reportControlCharacters.mjs');

/**
 * Text carrying one control character, built from its byte value.
 *
 * @param {number} byte @returns {string}
 */
function carrying(byte) {
  return `const message = "hello${String.fromCharCode(byte)}world";\n`;
}

/** @param {string} text @param {string} [path] */
function writePayload(text, path = 'C:/repo/src/file.ts') {
  return { tool_name: 'Write', tool_input: { file_path: path, content: text } };
}

// ---------------------------------------------------------------------------
// 1-3. IT SEES, on each of the three bytes this actually happened with.
// ---------------------------------------------------------------------------
for (const byte of [0x00, 0x01, 0x1f]) {
  const inspection = inspectPayload(writePayload(carrying(byte)));
  check(
    `a 0x${byte.toString(16).padStart(2, '0')} in written content is reported`,
    inspection.state === 'found' && inspection.report.includes(`0x${byte.toString(16).padStart(2, '0')}`),
    `got ${inspection.state}. 0x01 and 0x00 are the bytes three Write calls actually emitted ` +
      `on 2026-08-23, always where a space belonged.`,
  );
}

// ---------------------------------------------------------------------------
// 4. CONTROL: ordinary text is NOT reported.
//
// Without this the reporter could answer "found" to everything and satisfy
// every case above — and a hook that fires on every write is one that gets
// unregistered, which is the escape guard's false-positive lesson.
// ---------------------------------------------------------------------------
{
  const ordinary =
    'const message = "hello world";\n\tconst indented = 1;\r\n// a comment — with an em dash, ' +
    'CJK 文字 and an emoji 🙂\n';
  const inspection = inspectPayload(writePayload(ordinary));
  check(
    'CONTROL: ordinary text — tabs, CRLF, em dashes, CJK, emoji — is not reported',
    inspection.state === 'clean' && inspection.report === '',
    `got ${inspection.state}: ${inspection.report}. Tab, LF and CR are legitimate text, and a ` +
      `reporter that rejects non-ASCII prose reads as broken rather than as right.`,
  );
}

// ---------------------------------------------------------------------------
// 5. An Edit's replacement is scanned too — both tools can emit the byte.
// ---------------------------------------------------------------------------
{
  const inspection = inspectPayload({
    tool_name: 'Edit',
    tool_input: { file_path: 'C:/repo/x.md', old_string: 'a', new_string: carrying(0x00) },
  });
  check(
    'an Edit’s new_string is scanned, not only a Write’s content',
    inspection.state === 'found',
    `got ${inspection.state}. Covering Write alone would leave half the tools the standing rule ` +
      `sends you to unwatched.`,
  );
}

// ---------------------------------------------------------------------------
// 6. A SHAPE IT DOES NOT UNDERSTAND IS NOT CLEAN.
//
// This is the case that separates "looked and found nothing" from "never
// looked", which every instrument here is built to keep apart. A payload with
// no text to scan must say so.
// ---------------------------------------------------------------------------
{
  const inspection = inspectPayload({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  check(
    'a payload with nothing to scan reports nothing-to-scan, not clean',
    inspection.state === 'nothing-to-scan',
    `got ${inspection.state}. If a future tool shape stops matching, this reporter must not ` +
      `answer "clean" about writes it never read.`,
  );
  check(
    'CONTROL: and writtenText returns null for it rather than an empty string',
    writtenText({ command: 'ls' }) === null,
    'an empty string would scan clean and be indistinguishable from a file with no control ' +
      'characters in it.',
  );
}

// ---------------------------------------------------------------------------
// 7. THE WORDS ARE THE COMMIT GATE'S WORDS.
//
// A committer following guardFiles.mjs and an agent following this must not be
// repairing the same file two different ways.
// ---------------------------------------------------------------------------
{
  const inspection = inspectPayload(writePayload(carrying(0x00)));
  check(
    'the report carries guardFiles.mjs’s repair text verbatim, from its one writer',
    inspection.report.includes(CONTROL_CHARACTER_REPAIR),
    'a second copy of the repair would drift, and the drift would be invisible until someone ' +
      'followed the wrong one.',
  );
}

// ---------------------------------------------------------------------------
// 8. END TO END, as the harness runs it: JSON on stdin, exit 2 and a report.
//
// Every case above calls the function directly, so the entry point is exercised
// by none of them — which is the shape AAAA-5 was.
// ---------------------------------------------------------------------------
{
  const run = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(writePayload(carrying(0x00))),
    encoding: 'utf8',
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  check(
    'run as a PROCESS on a payload carrying the byte, it exits 2 and prints the report',
    run.status === 2 && /CONTROL CHARACTER WAS JUST WRITTEN/u.test(output),
    `exit=${String(run.status)}. Output:\n${output}`,
  );
}

// ---------------------------------------------------------------------------
// 9-13. THE PROBE PATH: a second TRIGGER and never a second DETECTOR
//       (finding AAAA-14).
//
// The hook's real trigger is a byte nobody can author on purpose, so without a
// benign one the only event that could ever show it is loaded is the defect
// recurring — a gate that reads as pending for the life of the project while
// covering nothing. The path supplies that trigger on a different axis.
//
// The condition that makes it safe is the one these cases are about: the path
// decides ONLY whether a live-ness line is emitted. It does not choose a
// scanner, skip the scan, or change what a finding looks like.
// ---------------------------------------------------------------------------
{
  const probe = writePayload('nothing unusual here\n', 'C:/repo/.claude/hookprobe/live.txt');
  const inspection = inspectPayload(probe);
  check(
    'an ordinary write under the probe path is LIVE, and still scans clean',
    inspection.live && inspection.state === 'clean',
    `live=${String(inspection.live)} state=${inspection.state}. The point of the probe is to be ` +
      `exercisable with harmless content; if it had to carry a finding it would be no easier to ` +
      `run than the defect.`,
  );

  const ordinary = inspectPayload(writePayload('nothing unusual here\n'));
  check(
    'CONTROL: the same content OUTSIDE the probe path is not live',
    !ordinary.live && ordinary.state === 'clean',
    `live=${String(ordinary.live)}. If every write were live the line would mean nothing, and ` +
      `the record would be certifying that the hook ran on some write, somewhere, ever.`,
  );

  // Windows reports a native path. A check written against forward slashes would
  // answer "no" for every real write and the probe would look permanently dead —
  // which is the reassuring answer, arriving through a separator.
  const native = inspectPayload(writePayload('x\n', 'C:\\repo\\.claude\\hookprobe\\live.txt'));
  check(
    'and a BACKSLASH path is live too, because the harness reports a native one',
    native.live,
    'a probe that only recognises forward slashes is dead on the platform this ships to',
  );

  // The load-bearing one. A probe file carrying a real control character must be
  // reported as one: the path adds a line, it never replaces or suppresses a
  // finding.
  const both = inspectPayload(
    writePayload(carrying(0x00), 'C:/repo/.claude/hookprobe/live.txt'),
  );
  check(
    'a probe file carrying a real byte is STILL a finding, not just a live-ness line',
    both.live && both.state === 'found' && both.report.includes(CONTROL_CHARACTER_REPAIR),
    `live=${String(both.live)} state=${both.state}. A path that suppressed the scan would be a ` +
      `second detector, which is the shape B3a is about, inside the fix for a finding about ` +
      `shared certificates.`,
  );
}

{
  const run = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(writePayload('ordinary\n', 'C:/repo/.claude/hookprobe/live.txt')),
    encoding: 'utf8',
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  check(
    'run as a PROCESS on a probe write, it exits 2 and states that it certifies INVOCATION',
    run.status === 2 && /IS LOADED/u.test(output) && /CERTIFIES INVOCATION AND NOTHING ELSE/u.test(output),
    `exit=${String(run.status)}. Exit 2 is how a PostToolUse hook's stderr reaches the agent at ` +
      `all, so an observation nobody can see is not one. And the line must name its own limit, ` +
      `because it is the sentence somebody reads before recording a firing.\nOutput:\n${output}`,
  );
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} reportControlCharacters case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('reportControlCharacters case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
