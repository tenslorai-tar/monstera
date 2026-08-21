// @ts-check
/**
 * The positive control `hostSurface.mjs`'s permission probe did not have.
 *
 * That instrument reported `process.permission` absent in a utility process
 * under `--permission`, and that reading was used to WITHDRAW Node's permission
 * model as a candidate mechanism for invariant 25's filesystem property — a
 * withdrawal now written into `docs/FEATURES.md` row 283.
 *
 * **`false` is the answer a broken probe gives too.** A misspelt property, a
 * check on the wrong object, a Node that never had the feature: every one of
 * them reports exactly what "the flag is inert" reports. The withdrawal is
 * therefore worth only as much as the probe's ability to say `true` somewhere,
 * and nothing had ever seen it do so.
 *
 * So: run the SAME probe under plain `node`, where the permission model is
 * known to work, and require it to report the model present. That is item 4b's
 * known-present anchor, and the ONLY reason this file exists.
 *
 * It also prints the same probe under plain `node` with no flag, because "the
 * probe can say true" and "the probe says true regardless" are different
 * instruments and only the pair separates them.
 *
 * Usage: node scripts/research/permissionProbeControl.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-perm-'));

/**
 * BYTE FOR BYTE the expression `hostSurface.mjs` evaluates inside the host. If
 * these drift, the control stops controlling the thing it names — which is the
 * B3a shape, two opinions about one question.
 */
const PROBE = `
const present = typeof process.permission === 'object' && process.permission !== null;
let fsRead = 'not asked';
if (present) {
  try {
    fsRead = process.permission.has('fs.read');
  } catch (error) {
    fsRead = 'threw: ' + String(error && error.message);
  }
}
process.stdout.write(JSON.stringify({
  node: process.versions.node,
  execArgv: process.execArgv,
  hasPermission: present,
  permissionFsRead: fsRead,
}) + '\\n');
`;

try {
  const probePath = join(scratch, 'probe.cjs');
  writeFileSync(probePath, PROBE, 'utf8');

  /** @param {string[]} flags @param {string} label */
  const run = (flags, label) => {
    const result = spawnSync(process.execPath, [...flags, probePath], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const out = `${result.stdout}`.trim();
    process.stdout.write(`${label}\n  ${out === '' ? `(no output) stderr: ${result.stderr}`.trim() : out}\n\n`);
    return out;
  };

  process.stdout.write(`plain node: ${process.execPath}\n\n`);

  const withFlag = run(['--permission', `--allow-fs-read=${scratch}`], 'ANCHOR — plain node, --permission');
  const withoutFlag = run([], 'CONTROL — plain node, no flag');

  const anchorSaysPresent = /"hasPermission":true/u.test(withFlag);
  const controlSaysAbsent = /"hasPermission":false/u.test(withoutFlag);

  process.stdout.write(
    `probe can report PRESENT: ${String(anchorSaysPresent)}\n` +
      `probe reports ABSENT without the flag: ${String(controlSaysAbsent)}\n\n` +
      (anchorSaysPresent && controlSaysAbsent
        ? `The probe distinguishes the two states, so the utility process reading of ABSENT\n` +
          `under the same flag is a fact about the utility process and not about the probe.\n` +
          `The withdrawal in FEATURES row 283 stands.\n`
        : `THE WITHDRAWAL DOES NOT STAND ON THIS EVIDENCE. The probe has not been shown to\n` +
          `distinguish the two states, so its ABSENT in a utility process is indistinguishable\n` +
          `from a probe that cannot say anything else.\n`),
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
