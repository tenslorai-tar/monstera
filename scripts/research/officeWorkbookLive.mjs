// @ts-check
/**
 * Does a workbook arrive WHOLE through the shipped import — every visible sheet, and a sheet past x2t's 1,500-page
 * cut-off in parts, joined? (decision C)
 *
 * A generated workbook of three sheets (`officeWorkbookLiveHost.mjs`) is imported through the real composition, the
 * contained x2t and the real compose host, and Poppler reads which rows of each sheet reached the PDF.
 *
 * ## Its control is the input, asserted
 *
 * The same workbook through x2t alone — the conversion every workbook had before decision C — must come out CUT at
 * exactly 1,500 pages with rows of the active sheet missing, and without the visible sheet that is not active. A
 * workbook that x2t alone carried whole would pass every product case here and say nothing about the parts.
 *
 * Not a registered proof: x2t is provisioned on no CI runner, and one run converts about 150,000 rows, which took
 * minutes when measured. The CI half is `officeConversion.test.ts`' cases, whose fake converter stops at the same page.
 *
 * Usage (Windows, after npm run build, the ONLYOFFICE and Poppler provisioning, and npm run provision:grants):
 *   node scripts/research/officeWorkbookLive.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HOST_FILE_ANSWERS_LIVE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { developmentEnvironment } from '../lib/launchEnvironment.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { x2tPath } from '../provision/onlyoffice.mjs';
import { pdftotextPath } from '../provision/poppler.mjs';

const ROOT = repoRoot();
const CHILD = join(ROOT, 'scripts', 'research', 'officeWorkbookLiveHost.mjs');
const ELECTRON_BINARY = electronBinaryPath(ROOT);

/** x2t's cut-off, as `officeConversion.ts` names it — read from the build rather than written again. */
const { X2T_MAX_PRINT_PAGES } = await import('../../apps/desktop/dist/officeConversion.js');

const CASES = [
  'CONTROL: x2t alone loses rows of the active sheet — cut at exactly the cut-off, or no PDF at all',
  'CONTROL: x2t alone leaves out the visible sheet that is not active',
  'the import answered opened, not opened-incomplete: nothing was missing',
  'every row of the active sheet reached the PDF, first to last',
  'every row of the visible sheet that is not active reached the PDF',
  'no row of the hidden sheet reached the PDF',
  'no host ended, no incident, and no rows were named missing during the import',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });
if (CASES.length !== 7) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 7`);

/** @param {number} index @param {boolean} condition @param {string} detail */
function check(index, condition, detail) {
  const mark = roster.mark();
  const name = CASES[index] ?? '';
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

for (const [what, path] of [
  ['the pinned Electron binary', ELECTRON_BINARY],
  ['x2t', x2tPath(ROOT)],
  ['pdftotext', pdftotextPath(ROOT)],
]) {
  if (!existsSync(path ?? '')) throw new Error(`${what} is not provisioned here (${String(path)}).`);
}
refuseStaleBuild(ROOT, HOST_FILE_ANSWERS_LIVE, 4);

const scratch = mkdtempSync(join(tmpdir(), 'monstera-workbook-live-driver-'));
const reportPath = join(scratch, 'report.json');
/** @type {any} */
let seen;
try {
  // INHERITED STDIO, `hostFileAnswersLive.mjs`' measured reason: the hosts inherit the child's handles.
  const result = spawnSync(ELECTRON_BINARY, [CHILD, reportPath], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 40 * 60_000,
    // THE DEVELOPMENT LAUNCHER'S ONE ANSWER, as `hostFileAnswersLive.mjs` takes it (SSSSSSS-1), and the converter named
    // after it whether or not it is provisioned, so a missing x2t is this harness's own refusal rather than an import
    // the shell quietly has no converter for.
    env: {
      ...process.env,
      ...(await developmentEnvironment(ROOT)),
      MONSTERA_ONLYOFFICE_EXECUTABLE: x2tPath(ROOT),
      ELECTRON_RUN_AS_NODE: '1',
    },
  });
  if (result.error !== undefined) throw new Error(`could not run ${CHILD}`, { cause: result.error });
  if (!existsSync(reportPath)) throw new Error(`the harness wrote no report (exit ${String(result.status)}).`);
  seen = JSON.parse(readFileSync(reportPath, 'utf8'));
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

const { control, product, rows } = seen;
const controlFailed = 'failed' in control;
console.log(
  controlFailed
    ? `x2t alone: no PDF — ${String(control.failed)}`
    : `x2t alone: ${String(control.pages)} pages, rows ${JSON.stringify(control.rows)}`,
);
console.log(`import:    ${JSON.stringify(seen.answer)} in ${String(seen.seconds)} s`);
console.log(`           ${String(product?.pages)} pages, rows ${JSON.stringify(product?.rows)}`);
console.log(`logged:    ${seen.failures.length === 0 ? 'nothing' : seen.failures.map((/** @type {string} */ line) => line.slice(0, 160)).join('\n           ')}`);

check(
  0,
  controlFailed || (control.pages === X2T_MAX_PRINT_PAGES && control.rows.Big.count < rows.Big),
  controlFailed
    ? ''
    : `x2t alone answered ${String(control.pages)} pages holding ${String(control.rows.Big.count)} of ${String(rows.Big)} rows. ` +
        'A workbook it carries whole proves nothing about the parts — make it longer.',
);
check(1, controlFailed || control.rows.Small.count === 0, `x2t alone printed ${String(control.rows?.Small?.count)} rows of the sheet that is not active.`);
check(2, seen.answer?.kind === 'opened', `document.newFromOffice answered ${JSON.stringify(seen.answer)}.`);
check(
  3,
  product?.rows.Big.count === rows.Big && product.rows.Big.low === 1 && product.rows.Big.high === rows.Big,
  `the PDF holds ${JSON.stringify(product?.rows.Big)} of ${String(rows.Big)} rows.`,
);
check(4, product?.rows.Small.count === rows.Small, `the PDF holds ${JSON.stringify(product?.rows.Small)} of ${String(rows.Small)} rows.`);
check(5, product?.rows.Hidden.count === 0, `the PDF holds ${JSON.stringify(product?.rows.Hidden)} hidden rows.`);
// A `converter-failed` line is a part that was halved, and is expected where a part exhausted the job; anything else is not.
const unexpected = seen.failures.filter((/** @type {string} */ line) => !line.startsWith('converter-failed:'));
check(6, unexpected.length === 0, `logged:\n        ${unexpected.join('\n        ')}`);

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} workbook case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('workbook case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
