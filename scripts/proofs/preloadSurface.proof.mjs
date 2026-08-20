// @ts-check
/**
 * Proves the preload check can fail, and fails for the right reasons.
 *
 * ## Which cases are load-bearing
 *
 * The FIXTURE cases. The tracked preload is compliant, so running the check
 * against it proves only that a compliant file passes — which is also what a
 * check that always passes produces. Every mechanism here is therefore exercised
 * against a file built to violate it.
 *
 * And the fixtures are built so that the bug could not answer them correctly by
 * accident: the forbidden-import fixture still imports `contextBridge`, so a
 * check that simply refused anything importing Electron would not distinguish
 * itself from one reading the name. That is item 4's fixture half — do not build
 * a fixture the bug also handles correctly.
 *
 * ## The allowlist is read from the invariant, so the parse of the DOCUMENT is
 * under test too
 *
 * `permittedImports` reads `docs/ARCHITECTURE.md` §9 invariant 1. Two failure
 * modes matter and both are covered: a document whose invariant 1 cannot be
 * found must THROW rather than yield an empty set, and the real document must
 * yield exactly the three names the invariant states — a positive control on the
 * parse, since an allowlist that came back empty would forbid everything and
 * point the next reader at the preload instead of at the parse.
 *
 * Usage: node scripts/proofs/preloadSurface.proof.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  PRELOAD,
  invariantOneViolations,
  permittedImports,
  readImports,
} from '../security/preloadSurface.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 10 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-preload-'));

/** @param {string} name @param {string} source @returns {string} */
function fixture(name, source) {
  const path = join(scratch, name);
  writeFileSync(path, source, 'utf8');
  return path;
}

/** @param {() => Promise<unknown>} run @returns {Promise<string>} */
async function refusal(run) {
  try {
    await run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main() {
  // ---------------------------------------------------------------------------
  // The allowlist, read from the invariant rather than restated here.
  // ---------------------------------------------------------------------------
  const permitted = permittedImports();

  check(
    'the allowlist is READ from invariant 1 and names exactly three APIs',
    permitted.length === 3 &&
      permitted.includes('contextBridge') &&
      permitted.includes('ipcRenderer') &&
      permitted.includes('webUtils'),
    `read ${JSON.stringify(permitted)} from ARCHITECTURE §9 invariant 1. A constant in the ` +
      `checker would be a second opinion about an invariant the document owns (B3a), and the ` +
      `two would agree until someone amended one.`,
  );

  check(
    'a document whose invariant 1 is missing THROWS rather than yielding an empty set',
    (() => {
      try {
        permittedImports('## 9. Invariants\n\n2. Something else entirely.\n');
        return false;
      } catch {
        return true;
      }
    })(),
    `an empty allowlist forbids every import and reads as a failing preload, which sends the ` +
      `next reader to the wrong file. A permissive fallback would be worse.`,
  );

  check(
    'an invariant 1 with no backticked names THROWS',
    (() => {
      try {
        permittedImports('1. Renderer sandbox on; the preload uses only the approved APIs.\n');
        return false;
      } catch {
        return true;
      }
    })(),
    `the line was found and named nothing. That is a broken parse, not a preload permitted to ` +
      `import nothing.`,
  );

  // ---------------------------------------------------------------------------
  // The tracked preload.
  // ---------------------------------------------------------------------------
  const real = await readImports({ path: PRELOAD, describe: 'the tracked preload' });

  check(
    'the tracked preload satisfies invariant 1',
    invariantOneViolations(real, permitted).length === 0,
    `violations: ${invariantOneViolations(real, permitted).join('; ')}`,
  );

  check(
    'and the derivation actually read it — contextBridge is present',
    real.imports.some((entry) => entry.module === 'electron' && entry.names.includes('contextBridge')),
    `imports read: ${JSON.stringify(real.imports)}. A pass from a scan that read nothing is the ` +
      `reassuring answer; the check must have located the import the preload cannot work without.`,
  );

  // ---------------------------------------------------------------------------
  // FIXTURES. Each keeps `contextBridge` so the check cannot pass them by
  // refusing anything Electron-shaped.
  // ---------------------------------------------------------------------------
  const forbiddenElectron = await readImports({
    path: fixture(
      'forbidden-electron.ts',
      "import { app, contextBridge } from 'electron';\ncontextBridge.exposeInMainWorld('x', { v: app.getVersion() });\n",
    ),
    describe: 'a preload importing `app`',
  });
  const appProblems = invariantOneViolations(forbiddenElectron, permitted);
  check(
    'a preload importing `app` from electron is REFUSED',
    appProblems.length === 1 && appProblems[0]?.includes('`app`') === true,
    `got ${JSON.stringify(appProblems)}. \`app\` reaches the whole application object from the ` +
      `renderer's side of the bridge.`,
  );

  const nodeBuiltin = await readImports({
    path: fixture(
      'node-builtin.ts',
      "import { readFileSync } from 'node:fs';\nimport { contextBridge } from 'electron';\ncontextBridge.exposeInMainWorld('x', { read: readFileSync });\n",
    ),
    describe: 'a preload importing node:fs',
  });
  const fsProblems = invariantOneViolations(nodeBuiltin, permitted);
  check(
    'a preload importing a Node builtin is REFUSED',
    fsProblems.length === 1 && fsProblems[0]?.includes('node:fs') === true,
    `got ${JSON.stringify(fsProblems)}. This is the exact shape invariant 2 forbids: a ` +
      `filesystem one exposeInMainWorld away from the sandbox.`,
  );

  check(
    'CONTROL: the same fixture WITHOUT the forbidden import passes',
    invariantOneViolations(
      await readImports({
        path: fixture(
          'clean.ts',
          "import { contextBridge, ipcRenderer } from 'electron';\ncontextBridge.exposeInMainWorld('x', { invoke: ipcRenderer.invoke });\n",
        ),
        describe: 'a compliant fixture',
      }),
      permitted,
    ).length === 0,
    `without this, every case above is satisfied by a checker that refuses everything — and ` +
      `each fixture above deliberately keeps contextBridge, so refusing "anything importing ` +
      `electron" would answer them all correctly for the wrong reason.`,
  );

  // ---------------------------------------------------------------------------
  // The two ways the derivation can be blind, both refused.
  // ---------------------------------------------------------------------------
  check(
    'a file with NO electron import is a broken read, not a compliant preload',
    (
      await refusal(async () =>
        invariantOneViolations(
          await readImports({
            path: fixture('no-electron.ts', "import { join } from 'node:path';\nexport const x = join;\n"),
            describe: 'a file importing no electron',
          }),
          permitted,
        ),
      )
    ).includes('has not found a compliant preload'),
    `a preload must import contextBridge to expose anything, so finding no Electron import ` +
      `means the wrong file was read. Reporting it as clean is item 4b exactly.`,
  );

  check(
    'a file that does not PARSE is refused rather than read as importing nothing',
    (
      await refusal(() =>
        readImports({
          path: fixture('broken.ts', "import { contextBridge } from 'electron'\nfunction ( {\n"),
          describe: 'a file with a syntax error',
        }),
      )
    ).includes('syntax error'),
    `an unparsed file yields an empty import set, which is indistinguishable from a preload ` +
      `that imports nothing — and from one that imports everything, since neither is seen.`,
  );

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} preload-surface failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('preload-surface case'),
  );
  return failures.length > 0 ? 1 : 0;
}

main()
  .then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      process.stderr.write(`${formatError(error)}\n`);
      process.exitCode = 1;
    },
  )
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
