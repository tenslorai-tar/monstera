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

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { childrenAmong, descendantsAmong, parseListing } from './childProcesses.mjs';
import { repoRoot } from './gitScope.mjs';
import { createRoster } from './passRoster.mjs';
import { formatError } from './reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 11 });

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

function main() {
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

  process.stdout.write(
    failures.length > 0 ? `${String(failures.length)} child-process failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n` : roster.format('child-process case'),
  );
  return failures.length > 0 ? 1 : 0;
}

try {
  process.exit(main());
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}
