// @ts-check
/**
 * Proves the rendered tests look for the browser where `provision:playwright` put it, whatever the environment says,
 * and that reading that place from the provisioner does not run it.
 *
 * ## The two halves, and why both
 *
 * The config defaulted `PLAYWRIGHT_BROWSERS_PATH` with `??=` while the provisioner installed into `BROWSERS_PATH`
 * regardless, so a machine that sets the variable — the cloud environment sets `/opt/pw-browsers` — provisioned one
 * place and launched from another (measured 2026-10-01: `Executable doesn't exist at /opt/pw-browsers/...`). The
 * config now SETS the provisioner's path, which means it IMPORTS the provisioner, and that import was unsafe: its main
 * guard tested `import.meta.url.endsWith('playwright.mjs')`, a fact about the module's own URL and so true on every
 * import. Either half alone leaves a defect, so each has a case.
 *
 * Each child reports its own INPUT as well as its result, because a harness fix changes an input and assertions look
 * at outputs: a child that never received the foreign value would satisfy "ends at BROWSERS_PATH" for nothing.
 *
 * Needs `node_modules` (the config imports `@playwright/test`). Downloads nothing.
 *
 * Usage: node scripts/provision/playwright.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { BROWSERS_PATH } from './playwright.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = pathToFileURL(join(REPO_ROOT, 'scripts', 'test', 'playwright.config.mjs')).href;
const PROVISIONER = pathToFileURL(join(REPO_ROOT, 'scripts', 'provision', 'playwright.mjs')).href;
const FOREIGN = '/a/browser/set/this/repository/never/chose';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-playwright-proof-'));

/**
 * Runs a module body as a SCRIPT FILE in a child with the foreign value set, and answers the lines it printed.
 *
 * A file and not `--eval`, because the real caller is a script: the Playwright CLI is `argv[1]` when it imports the
 * config. Under `--eval` there is no `argv[1]`, and the old guard's first clause (`argv[1] !== undefined`) was false
 * there — so a first version of this proof, run with `--eval`, passed against the very guard it exists to refuse.
 * Every body also prints whether it had an entry point, which the cases require.
 *
 * @param {string} name the script's file name
 * @param {string} body ES module source
 * @returns {{ lines: string[], output: string, status: number | null }}
 */
function child(name, body) {
  const path = join(scratch, name);
  writeFileSync(path, `process.stdout.write('entry=' + String(process.argv[1] !== undefined) + '\\n');\n${body}\n`);
  const run = spawnSync(process.execPath, [path], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: FOREIGN },
  });
  const output = `${run.stdout}${run.stderr}`;
  return { lines: `${run.stdout}`.split('\n').filter((line) => line !== ''), output, status: run.status };
}

try {
  const config = child(
    'imports-config.mjs',
    [
      `process.stdout.write('before=' + process.env.PLAYWRIGHT_BROWSERS_PATH + '\\n');`,
      `await import(${JSON.stringify(CONFIG)});`,
      `process.stdout.write('after=' + process.env.PLAYWRIGHT_BROWSERS_PATH + '\\n');`,
    ].join('\n'),
  );
  check(
    'CONTROL: the child that imports the config was handed the foreign value',
    config.lines.includes(`before=${FOREIGN}`),
    `it printed ${JSON.stringify(config.lines)} (exit ${String(config.status)}). Without the foreign value the case ` +
      `below is satisfied by a config that only defaults.\n      ${config.output}`,
  );
  check(
    'importing the rendered config leaves the browsers path at the PROVISIONER’S, over an ambient value',
    config.lines.includes(`after=${BROWSERS_PATH}`),
    `it printed ${JSON.stringify(config.lines)}; the provisioner installs into ${BROWSERS_PATH}, so any other value ` +
      `launches a browser that was never provisioned.\n      ${config.output}`,
  );

  const imported = child(
    'imports-provisioner.mjs',
    [`await import(${JSON.stringify(PROVISIONER)});`, `process.stdout.write('imported\\n');`].join('\n'),
  );
  check(
    'CONTROL: the child that imports the provisioner is a script with an entry point, and got through the import',
    imported.lines.includes('entry=true') && imported.lines.includes('imported'),
    `it printed ${JSON.stringify(imported.lines)} (exit ${String(imported.status)}). Silence from a child that died ` +
      `at the import would pass the case below for nothing.\n      ${imported.output}`,
  );
  check(
    'importing the provisioner RUNS NOTHING: no install, no report',
    !/chromium|installing|provisioned/iu.test(imported.output),
    `the import printed:\n      ${imported.output}\n      Its main guard must be \`isMain\`; a test of the module's ` +
      `own URL is true on every import.`,
  );
} catch (error) {
  failures.push(`the proof itself failed: ${formatError(error)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} playwright-provisioning failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
    : roster.format('playwright-provisioning case'),
);
process.exitCode = failures.length > 0 ? 1 : 0;
