// @ts-check
/**
 * Proves the rendered suites refuse a case that would not hear PDF.js drop a picture (ADR-0296), and refuse to answer
 * when they cannot see.
 *
 * Over folders this proof writes, never the repository's: each case is a folder holding `renderedTest.ts` (or not) and
 * case files that take `test` one way or the other. The repository's own folder is read once at the end, as the guard
 * reads it, and must pass: that is the claim the rendered suites rest on.
 *
 * Usage: node scripts/lib/renderedCases.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from './passRoster.mjs';
import { casesTakingPlaywrightsTest, refuseUnwatchedCases } from './renderedCases.mjs';
import { formatError } from './reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const OWN = "import { type ConsoleMessage, test as base, expect } from '@playwright/test';\nexport const test = base.extend({});\n";
const WATCHED = "import { type Page } from '@playwright/test';\nimport { expect, test } from './renderedTest.js';\n";
const UNWATCHED = "import { type Page, expect, test } from '@playwright/test';\n";
const UNWATCHED_SPREAD = "import {\n  type Page,\n  expect,\n  test,\n} from '@playwright/test';\n";
const UNWATCHED_RENAMED = "import { test as it } from '@playwright/test';\n";

/**
 * A folder holding `files`, removed after `read` answers.
 *
 * @template T
 * @param {Record<string, string>} files
 * @param {(dir: string) => T} read
 * @returns {T}
 */
function inFolder(files, read) {
  const dir = mkdtempSync(join(tmpdir(), 'rendered-cases-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return read(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What refusing threw, or `null`. @param {() => void} run */
function thrown(run) {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const watched = inFolder({ 'renderedTest.ts': OWN, 'a.pw.ts': WATCHED, 'b.visual.ts': WATCHED }, (dir) => casesTakingPlaywrightsTest(dir));
check('cases that take test from renderedTest.js pass', Array.isArray(watched) && watched.length === 0, `found ${JSON.stringify(watched)}`);

for (const [label, text] of /** @type {const} */ ([
  ['on one line', UNWATCHED],
  ['spread over lines', UNWATCHED_SPREAD],
  ['under another name', UNWATCHED_RENAMED],
])) {
  const found = inFolder({ 'renderedTest.ts': OWN, 'a.pw.ts': WATCHED, 'c.pw.ts': text }, (dir) => casesTakingPlaywrightsTest(dir));
  check(`a case taking Playwright's test ${label} is found`, JSON.stringify(found) === '["c.pw.ts"]', `found ${JSON.stringify(found)}`);
}

const everySuite = inFolder(
  { 'renderedTest.ts': OWN, 'a.visual.ts': UNWATCHED, 'b.capture.ts': UNWATCHED, 'c.measure.ts': UNWATCHED, 'd.test.ts': UNWATCHED },
  (dir) => casesTakingPlaywrightsTest(dir),
);
check(
  'every rendered suite is read, and a unit test is not',
  JSON.stringify(everySuite) === '["a.visual.ts","b.capture.ts","c.measure.ts"]',
  `found ${JSON.stringify(everySuite)}`,
);

const refused = inFolder({ 'renderedTest.ts': OWN, 'c.pw.ts': UNWATCHED }, (dir) => thrown(() => refuseUnwatchedCases(dir)));
check('the refusal THROWS and names the file', refused !== null && refused.includes('c.pw.ts'), `threw ${String(refused)}`);

// THE POSITIVE CONTROL'S OWN CASE: a renderedTest.ts the scan cannot see its import in makes it refuse to answer, rather
// than report a folder of unwatched cases as clean.
const blind = inFolder({ 'renderedTest.ts': 'export {};\n', 'c.pw.ts': UNWATCHED }, (dir) => thrown(() => casesTakingPlaywrightsTest(dir)));
check('a scan that cannot find renderedTest.ts’s own import refuses to answer', blind !== null && blind.includes('cannot see'), `threw ${String(blind)}`);

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'testing', 'src');
const live = thrown(() => refuseUnwatchedCases(repository));
check('every rendered case in this repository takes renderedTest.js’s test', live === null, String(live));

let reportFailed = false;
try {
  process.stdout.write(
    failures.length > 0 ? `${failures.length} rendered-case failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n` : roster.format('rendered-case case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  reportFailed = true;
}
process.exitCode = failures.length > 0 || reportFailed ? 1 : 0;
