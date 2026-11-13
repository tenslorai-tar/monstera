// @ts-check
/**
 * Proves the child-process rule (`childProcesses.mjs`) over written-down listings, so it runs on every platform, and
 * that every spelling of a parent-id query in the tree is that module's.
 *
 * Each rule case is run against the rule the engine-host harnesses used until 2026-11-01 as well, spelt here as they
 * spelt it in WQL: every process whose recorded parent is our pid. The first case must FAIL under that rule, or it does
 * not separate the fix from the bug; the controls must pass under both, or the fix has changed what a genuine child is.
 *
 * Usage: node scripts/lib/childProcesses.proof.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childrenAmong, descendantsAmong, endTree, listProcesses, parseListing, stillRunning, treeOf } from './childProcesses.mjs';
import { repoRoot } from './gitScope.mjs';
import { createRoster } from './passRoster.mjs';
import { formatError } from './reportError.mjs';

/**
 * THE LIVE TREE CASES need Windows' process listing; elsewhere they are named as not run. `--require-live` makes not
 * running them a failure, which CI's Windows leg passes, so a leg that should run them cannot report a pass without.
 */
const LIVE = process.platform === 'win32';
const LIVE_CASES = 2;
const REQUIRE_LIVE = process.argv.includes('--require-live');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 15 + (LIVE ? LIVE_CASES : 0) });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @typedef {import('./childProcesses.mjs').ListedProcess} ListedProcess */

/** @param {number} pid @param {number} parent @param {bigint | null} created @param {string} name @returns {ListedProcess} */
const listed = (pid, parent, created, name) => ({ pid, parent, created, name });

/** The rule the seven harnesses spelt as `-Filter "ParentProcessId=<pid>"`. @param {number} pid @param {readonly ListedProcess[]} listing */
const recordedParentOnly = (pid, listing) => listing.filter((each) => each.parent === pid && each.pid !== pid).map((each) => each.pid);

/** @param {number} pid @param {readonly ListedProcess[]} listing */
const counted = (pid, listing) => childrenAmong(pid, listing).children.map((each) => each.pid);

const US = 4000;
const STARTED = 133_000_000_000_000_000n;

// The run's shape: a build started worker nodes at an earlier tick and ended, and its id is now ours.
const WORKER_A = listed(8812, US, STARTED - 600_000_000n, 'MSBuild.exe');
const WORKER_B = listed(6912, US, STARTED - 590_000_000n, 'MSBuild.exe');
const SELF = listed(US, 9999, STARTED, 'electron.exe');
const HOST = listed(5100, US, STARTED + 20_000_000n, 'electron.exe');
const SECOND_HOST = listed(5200, US, STARTED + 40_000_000n, 'electron.exe');

async function main() {
  const reused = [SELF, WORKER_A, WORKER_B, HOST];
  check(
    'a process that records our pid as its parent but was created BEFORE us is not counted',
    JSON.stringify(counted(US, reused)) === JSON.stringify([HOST.pid]),
    `counted ${JSON.stringify(counted(US, reused))}; only the host ${String(HOST.pid)} was made by us`,
  );
  check(
    'and the old rule counts it, so the case above separates the fix from the bug',
    recordedParentOnly(US, reused).length === 3,
    `the old rule counted ${JSON.stringify(recordedParentOnly(US, reused))}; it found 3 in run 41347349873`,
  );

  const one = [SELF, HOST];
  check(
    'CONTROL: a genuine child created after we started is counted, under the new rule and the old',
    JSON.stringify(counted(US, one)) === JSON.stringify([HOST.pid]) && JSON.stringify(recordedParentOnly(US, one)) === JSON.stringify([HOST.pid]),
    `counted ${JSON.stringify(counted(US, one))}`,
  );

  const two = [SELF, HOST, SECOND_HOST, WORKER_A];
  check(
    'CONTROL: two genuine children are both counted, so an "exactly one host" check still fails when a second exists',
    counted(US, two).length === 2 && recordedParentOnly(US, two).length === 3,
    `counted ${JSON.stringify(counted(US, two))}`,
  );

  check(
    'a child created in the same tick as us is counted (at or after, not after)',
    counted(US, [SELF, listed(5300, US, STARTED, 'x.exe')]).length === 1,
    'a child made in our own tick was left out',
  );

  const unreadable = childrenAmong(US, [SELF, listed(5400, US, null, 'x.exe')]);
  check(
    'a process whose creation time could not be read is not counted, and is reported as left out',
    unreadable.children.length === 0 && unreadable.olderThanParent.length === 1,
    `counted ${String(unreadable.children.length)}, left out ${String(unreadable.olderThanParent.length)}`,
  );

  const gone = childrenAmong(US, [WORKER_A, HOST]);
  check(
    'a parent that is not in the listing has no children, and the answer says it was not listed',
    gone.children.length === 0 && gone.parentListed === false,
    `counted ${String(gone.children.length)}, listed ${String(gone.parentListed)}`,
  );

  // A TREE WALK takes the same rule at every edge: a worker node's own child is not walked into.
  const tree = [SELF, HOST, listed(5101, HOST.pid, STARTED + 30_000_000n, 'conhost.exe'), WORKER_A, listed(8813, WORKER_A.pid, STARTED - 500_000_000n, 'cl.exe')];
  const below = [...descendantsAmong(US, tree)].sort((a, b) => a - b);
  check(
    'a tree walk counts the host and its child, and nothing under a process older than us',
    JSON.stringify(below) === JSON.stringify([US, HOST.pid, 5101].sort((a, b) => a - b)),
    `walked ${JSON.stringify(below)}`,
  );

  // RESOLUTION (audit item 4a): two creation times one tick apart, past 2^53, are kept apart.
  const parsed = parseListing(
    JSON.stringify({
      asker: 1,
      processes: [
        { pid: US, parent: 1, created: '133000000000000001', name: 'self', commandLine: null },
        { pid: 7, parent: US, created: '133000000000000000', name: 'older', commandLine: null },
      ],
    }),
  );
  check(
    'the listing keeps creation times one tick apart as different, past what a JSON number carries',
    counted(US, parsed.processes).length === 0 && parsed.processes[0]?.created === 133_000_000_000_000_001n,
    `parsed ${JSON.stringify(parsed.processes.map((each) => String(each.created)))}`,
  );

  let refused = false;
  try {
    parseListing('[]');
  } catch {
    refused = true;
  }
  check('a listing without its shape is refused rather than read as no processes', refused, 'parseListing accepted []');

  // EVERY SPELLING of a parent-id query in the tree is the helper's (B3a). The positive control is the helper's own.
  const root = repoRoot();
  const files = `${spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout}`.split('\n').filter((file) => /\.(?:[cm]?[jt]sx?|ps1|ya?ml|[ch]|cs|py)$/u.test(file));
  const SPELLING = /ParentProcessId|th32ParentProcessID|InheritedFromUniqueProcessId|\bPPid\b/iu;
  const OWN = new Set(['scripts/lib/childProcesses.mjs', 'scripts/lib/childProcesses.proof.mjs']);
  const spelling = files.filter((file) => SPELLING.test(readFileSync(join(root, file), 'utf8')));
  const elsewhere = spelling.filter((file) => !OWN.has(file));
  check(
    'every file that spells a parent-id query is the helper (positive control: the helper itself is found)',
    spelling.includes('scripts/lib/childProcesses.mjs') && elsewhere.length === 0 && files.length > 100,
    `found in ${JSON.stringify(spelling)} across ${String(files.length)} files; outside the helper: ${JSON.stringify(elsewhere)}`,
  );

  // THE TREE TO END is the rule's tree, with each process's creation time, so a survivor is the same process.
  const toEnd = treeOf(US, tree).map((each) => each.pid).sort((a, b) => a - b);
  check(
    'the tree to end is the rule’s tree: the root, the host and its child, never a process older than the root',
    JSON.stringify(toEnd) === JSON.stringify([US, HOST.pid, 5101].sort((a, b) => a - b)),
    `would end ${JSON.stringify(toEnd)}`,
  );
  const reusedId = listed(HOST.pid, 1, STARTED + 900_000_000n, 'notepad.exe');
  check(
    'a target whose id now belongs to a newer process is not still running, so a stranger is never ended in its place',
    stillRunning([HOST], [reusedId]).length === 0,
    `read ${JSON.stringify(stillRunning([HOST], [reusedId]).map((each) => each.pid))} as still running`,
  );
  check(
    'CONTROL: the same id with the same creation time is still running',
    stillRunning([HOST], [HOST]).length === 1,
    'the target itself was not read as running',
  );

  // NO SCRIPT ENDS A PROCESS TREE BY ITS OWN SPELLING (B3a): `taskkill /T` follows the recorded parent id the rule above
  // refuses. The positive control is the spelling the walks used, which the pattern must find; the files are the list
  // the scan above already read and found the helper in.
  const TASKKILL = /['"]taskkill['"]/u;
  const spelt = ['execFileSync(', "'task", "kill', ['/PID', pid, '/T', '/F'])"].join('');
  const killing = files.filter((file) => TASKKILL.test(readFileSync(join(root, file), 'utf8')));
  check(
    'no file runs taskkill; every tree is ended by `endProcesses` (positive control: the walks’ own spelling is found)',
    TASKKILL.test(spelt) && killing.length === 0,
    `pattern finds the walks’ spelling: ${String(TASKKILL.test(spelt))}; found in ${JSON.stringify(killing)}`,
  );

  if (LIVE) await liveTree();
  else if (REQUIRE_LIVE) failures.push(`--require-live was given on ${process.platform}, where the ${String(LIVE_CASES)} live tree cases cannot run`);
  else process.stdout.write(`NOT RUN on ${process.platform}: the ${String(LIVE_CASES)} live tree cases, which read Windows' process listing\n`);

  process.stdout.write(
    failures.length > 0 ? `${String(failures.length)} child-process failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n` : roster.format('child-process case'),
  );
  return failures.length > 0 ? 1 : 0;
}

/**
 * A parent node process that starts a child node process and prints its id, the shape of an Electron app whose launched
 * process is one of several. Started fresh for each case.
 *
 * THE CHILD IS DETACHED, which is the app's shape and not node's default: libuv puts every process node starts in a job
 * object that ends them when the parent's handle closes, so an undetached child ends with its parent (measured
 * 2026-11-12, the first run of this case). Chromium's processes are in no such job, which is why the walk's survived.
 *
 * AND IT ENDS WHEN THIS PROOF DOES. A detached process is out of reach of the tree-kill `checkLocal.mjs` applies on a
 * timeout, so the child polls this proof's id and exits once that id is gone: it outlives its own parent, which is
 * what the control needs, and never the proof, which is what the harness needs (`checkLocal.proof.mjs`' detached
 * spawn case names this file for that reason).
 *
 * @returns {Promise<{ parent: import('node:child_process').ChildProcess, child: number }>}
 */
function startPair() {
  const grandchild = `setInterval(() => { try { process.kill(${String(process.pid)}, 0); } catch { process.exit(0); } }, 250);`;
  const program = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore', detached: true });`,
    'process.stdout.write(String(child.pid));',
    'setInterval(() => undefined, 1000);',
  ].join(' ');
  const parent = spawn(process.execPath, ['-e', program], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    parent.stdout?.once('data', (chunk) => resolve({ parent, child: Number(String(chunk)) }));
    parent.once('error', reject);
  });
}

/** @param {number} pid */
const running = (pid) => listProcesses({ filter: `ProcessId=${String(pid)}` }).length > 0;

async function liveTree() {
  // CONTROL, the defect itself: ending the launched process alone leaves its child running.
  const alone = await startPair();
  alone.parent.kill();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const survived = running(alone.child);
  // The orphan is out of the rule's reach now (its parent is gone), so it is ended by the id it printed.
  if (survived) process.kill(alone.child);
  check(
    'CONTROL: ending only the launched process leaves its child running, which is what held the walk of 2026-11-12',
    survived,
    `child ${String(alone.child)} ended with its parent, so this case cannot separate the fix from the bug on this machine`,
  );

  const pair = await startPair();
  const { ended, left } = await endTree(pair.parent.pid ?? -1);
  const gone = !running(pair.parent.pid ?? -1) && !running(pair.child);
  if (!gone) process.kill(pair.child);
  check(
    'ending the tree ends the launched process AND its child, and says it ended both',
    gone && left.length === 0 && ended.some((each) => each.pid === pair.child),
    `ended ${JSON.stringify(ended.map((each) => each.pid))}, left ${JSON.stringify(left.map((each) => each.pid))}, child ${String(pair.child)}`,
  );
}

try {
  process.exit(await main());
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}
