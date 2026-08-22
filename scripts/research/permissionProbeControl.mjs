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
 * ## And the anchor alone crosses runtimes, which is finding PP-3
 *
 * The anchor runs plain `node`; the subject is Electron's embedded Node. Those
 * are different builds, so the anchor shows the probe is not broken and does
 * **not** show why the flag is inert. Two causes remain, with different
 * consequences for **ADR-0023**, which chooses the mechanisms — ADR-0022 chose
 * the process type:
 *
 *   1. `utilityProcess.fork` does not apply `execArgv` early enough for the
 *      permission model's initialisation — the model is alive, just unreachable
 *      by that route, and another route might exist;
 *   2. Electron's Node does not carry the permission model at all — in which
 *      case no Electron process of any kind can have it, and that is the durable
 *      sentence.
 *
 * `ELECTRON_RUN_AS_NODE=1` against the pinned binary separates them: it is
 * Electron's own Node with no utility process anywhere in the path. Absent there
 * too means cause 2.
 *
 * **A reader acts on the reason, not on the observation**, which is why one
 * extra spawn is worth more than the paragraph explaining its absence.
 *
 * Usage: node scripts/research/permissionProbeControl.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronBinaryPath } from '../provision/electron.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-perm-'));

/**
 * BYTE FOR BYTE the expression `hostSurface.mjs` evaluates inside the host. If
 * these drift, the control stops controlling the thing it names — which is the
 * B3a shape, two opinions about one question.
 */
const PROBE = String.raw`
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
}) + '\n');
`;

try {
  const probePath = join(scratch, 'probe.cjs');
  writeFileSync(probePath, PROBE, 'utf8');

  /** @param {string} exe @param {string[]} flags @param {NodeJS.ProcessEnv} env @param {string} label */
  const run = (exe, flags, env, label) => {
    const result = spawnSync(exe, [...flags, probePath], { encoding: 'utf8', env, timeout: 30_000 });
    const out = `${result.stdout}`.trim();
    process.stdout.write(`${label}\n  ${out === '' ? `(no output) stderr: ${result.stderr}`.trim() : out}\n\n`);
    return out;
  };

  const electron = electronBinaryPath();
  process.stdout.write(`plain node: ${process.execPath}\nelectron:   ${electron}\n\n`);

  const permissionFlags = ['--permission', `--allow-fs-read=${scratch}`];

  const withFlag = run(process.execPath, permissionFlags, process.env, 'ANCHOR — plain node, --permission');
  const withoutFlag = run(process.execPath, [], process.env, 'CONTROL — plain node, no flag');
  const electronAsNode = run(
    electron,
    permissionFlags,
    { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    "PP-3 — Electron's own Node, --permission, no utility process in the path",
  );

  // Is the flag even PERMITTED through the environment? Node refuses a set of
  // flags in NODE_OPTIONS, and if `--permission` is among them the env route is
  // closed before any Electron spawn is worth paying for. Asked of plain node
  // first for exactly that reason.
  const viaEnv = run(
    process.execPath,
    [],
    { ...process.env, NODE_OPTIONS: `--permission --allow-fs-read=${scratch}` },
    'ENV ROUTE — plain node, --permission through NODE_OPTIONS',
  );

  const anchorSaysPresent = /"hasPermission":true/u.test(withFlag);
  const controlSaysAbsent = /"hasPermission":false/u.test(withoutFlag);
  const electronSaysPresent = /"hasPermission":true/u.test(electronAsNode);

  process.stdout.write(
    `probe can report PRESENT: ${String(anchorSaysPresent)}\n` +
      `probe reports ABSENT without the flag: ${String(controlSaysAbsent)}\n` +
      `Electron's own Node reports PRESENT: ${String(electronSaysPresent)}\n` +
      `NODE_OPTIONS route works in plain node: ${String(/"hasPermission":true/u.test(viaEnv))}\n\n` +
      (anchorSaysPresent && controlSaysAbsent
        ? `The probe distinguishes the two states, so the utility process reading of ABSENT\n` +
          `under the same flag is a fact about the utility process and not about the probe.\n` +
          `The withdrawal in FEATURES row 283 stands.\n\n`
        : `THE WITHDRAWAL DOES NOT STAND ON THIS EVIDENCE. The probe has not been shown to\n` +
          `distinguish the two states, so its ABSENT in a utility process is indistinguishable\n` +
          `from a probe that cannot say anything else.\n\n`) +
      (electronSaysPresent
        ? `CAUSE 1: Electron's Node HAS the permission model, so what fails is the route —\n` +
          `utilityProcess.fork does not apply execArgv early enough for it. The model is not\n` +
          `dead and another route may reach it. This is a claim about how fork starts a\n` +
          `process, not about Electron's Node.\n`
        : `CAUSE 2: Electron's own Node does not carry the permission model either, with no\n` +
          `utility process anywhere in the path. No Electron process of any kind can have it,\n` +
          `which is the durable sentence for ADR-0023 — and it is a claim about Electron\n` +
          `43.4.1 specifically, so it expires when the pin moves.\n`),
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
