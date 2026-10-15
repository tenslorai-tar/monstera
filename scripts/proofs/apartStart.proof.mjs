// @ts-check
/**
 * Proves a thread that ends (`apart.ts`) answers its SYNCHRONOUS asker on every path, a failure to load the work's
 * entry included (GGGGGGGG-5, HHHHHHHH-6).
 *
 * ## The defect and why the asker runs in a child
 *
 * `runApartSync` waits in `Atomics.wait`, which runs no listener, so only the thread can wake it. The signal used to be
 * set up by `serveApart`, inside the entry, and so existed only once the entry's static imports had loaded: an entry
 * whose import failed ended with nothing raised and its asker waited for ever. Every thread now starts at
 * `apartEntry.ts`, which sets the signal up first and loads the entry by `import()`.
 *
 * A regression is therefore a HANG, and a proof that hung would be reported by the job's own limit an hour later as
 * something else. So each asker runs in a child bounded by `ASKER_BOUND_MS`, and a child that reaches it is this
 * proof's failure, named.
 *
 * ## The fixtures are entries of their own
 *
 * Written to a scratch folder, each importing `apartThread.js` from `dist` as a real entry does. The loadable one is
 * the control: the same entry minus its broken import must answer `done`, or a refusal below could be the fixture
 * failing for a reason of its own.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { APART_START, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';

const ROOT = repoRoot();
refuseStaleBuild(ROOT, APART_START, 3);

/**
 * The child's whole allowance. A child that answers does so in well under a second (measured 2026-10-15 in this cloud
 * session's Linux container, each case 0.1 to 0.2 s); one that waits for ever is what this bound turns into a failure.
 */
const ASKER_BOUND_MS = 30_000;

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const dist = (/** @type {string} */ file) => pathToFileURL(join(ROOT, 'packages', 'kernel', 'dist', file)).href;
const scratch = mkdtempSync(join(tmpdir(), 'monstera-apart-'));

/** Writes a fixture file into the scratch folder from its lines, and gives its URL. */
function fixture(/** @type {string} */ name, /** @type {readonly string[]} */ lines) {
  const path = join(scratch, name);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return pathToFileURL(path).href;
}

const serve = [
  `import { serveApart } from ${JSON.stringify(dist('apartThread.js'))};`,
  "await serveApart({ entry: new URL(import.meta.url), label: 'probe' }, (input) => input + 1);",
];
const entries = {
  loadable: fixture('loadable.mjs', serve),
  // A STATIC IMPORT THAT FAILS, before `serveApart` can run: the shape of GGGGGGGG-5's `@monstera/shared` failing.
  brokenImport: fixture('brokenImport.mjs', ["import './no-such-module.mjs';", ...serve]),
  // An entry that loads and ends without answering.
  silent: fixture('silent.mjs', ['process.exit(0);']),
};

const asker = fixture('asker.mjs', [
  `import { runApartSync } from ${JSON.stringify(dist('apart.js'))};`,
  'try {',
  "  const output = runApartSync({ entry: new URL(process.argv[2]), label: 'probe' }, 41);",
  "  process.stdout.write('done ' + String(output));",
  '} catch (error) {',
  "  process.stdout.write('failed ' + (error instanceof Error ? error.message : String(error)));",
  '}',
]);

/** What the synchronous asker said about `entry`, or that it was still waiting at the bound. */
function ask(/** @type {string} */ entry) {
  const run = spawnSync(process.execPath, [new URL(asker).pathname, entry], { encoding: 'utf8', timeout: ASKER_BOUND_MS });
  if (run.error !== undefined && /** @type {NodeJS.ErrnoException} */ (run.error).code === 'ETIMEDOUT') return 'still waiting';
  return `${run.stdout}${run.stderr === '' ? '' : ` | stderr: ${run.stderr}`}`;
}

try {
  const loadable = ask(entries.loadable);
  check('CONTROL: the fixture entry, loadable, answers its asker', loadable === 'done 42', loadable);

  const broken = ask(entries.brokenImport);
  check(
    'an entry whose static import fails is ANSWERED, as a failure to load, never waited on',
    broken.startsWith("failed probe failed in its thread: probe's entry could not be loaded") && broken.includes('no-such-module'),
    broken,
  );

  const silent = ask(entries.silent);
  check('an entry that ends without answering is answered as having ended', silent.includes("probe's thread ended without an answer"), silent);

  // THE START IS REFUSED BEFORE ANY THREAD where it is missing: a start that could not load could raise nothing.
  const missing = ask(pathToFileURL(join(scratch, 'absent.mjs')).href);
  check('an entry that is not there is refused by the asker before a thread starts', missing.includes('is not beside its asker'), missing);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`\nApart-start proof — ${String(failures.length)} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
  process.exit(1);
}
process.stdout.write(roster.format('apart start case'));
