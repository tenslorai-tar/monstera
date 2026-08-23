// @ts-check
/**
 * The child the host-surface probe creates. Not a fixture — a real process,
 * started suspended, assigned to a job, and resumed by shipped code.
 *
 * It reports two things and then exits:
 *
 *   - that it RAN AT ALL, which is what separates "the surface created a
 *     process" from "the surface returned a handle to something that never
 *     executed". A suspended process that is never resumed looks identical to a
 *     resumed one from the parent's side until you ask the child.
 *   - whether it can CREATE A PROCESS, which is invariant 25(b). The job carries
 *     `ActiveProcessLimit = 1`, so a spawn must fail here and must succeed in
 *     the no-job cell beside it. One variable between the two.
 *
 * Written as a file rather than emitted from a template on purpose: an
 * emitted-source template is the one place prose and code share a delimiter, and
 * this repository has paid for that seven times. A real file has no such edge.
 *
 * `--version` is the spawn attempt because it needs no arguments to be quoted
 * and no code to be evaluated — the question is whether the kernel permits a
 * process at all, not what that process does.
 *
 * Usage: <node> hostSurfaceProbeChild.mjs <reportPath>
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const reportPath = process.argv[2];
if (reportPath === undefined) {
  process.stderr.write('hostSurfaceProbeChild: no report path was passed\n');
  process.exit(64);
}

/** @type {{ ran: true, spawn: string, detail: string }} */
const report = { ran: true, spawn: 'unknown', detail: '' };

const attempt = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
if (attempt.error !== undefined && attempt.error !== null) {
  report.spawn = 'refused';
  report.detail = String(attempt.error.message);
} else if (attempt.status === 0) {
  report.spawn = 'allowed';
  report.detail = String(attempt.stdout).trim();
} else {
  // Neither refused nor clean: recorded as its own answer rather than folded
  // into one of the two, because a child that started and exited non-zero is
  // not the same observation as a child the kernel would not create.
  report.spawn = 'started-then-failed';
  report.detail = `status ${String(attempt.status)}: ${String(attempt.stderr).trim()}`;
}

writeFileSync(reportPath, JSON.stringify(report), 'utf8');
