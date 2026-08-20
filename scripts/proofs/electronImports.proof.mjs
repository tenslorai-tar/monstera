// @ts-check
/**
 * Proves that no plain-Node code in this repository can trigger Electron's
 * lazy download, and that an unpinned runtime arriving by any other route is
 * detectable.
 *
 * ## Why this is a separate file from `provision/electron.proof.mjs`
 *
 * **Split by what a case NEEDS, not by what it is about.** The eight cases left
 * behind read tracked files and nothing else, so they run in the Guards job,
 * which performs no `npm ci` at all. These two need the TypeScript compiler —
 * `loadTypeScript` resolves `node_modules/typescript/lib/typescript.js` and
 * THROWS when it is absent, deliberately, because a fallback here would print
 * "no plain-Node file imports electron" on a runner that could not look.
 *
 * They shipped inside the Guards-run file and turned both platforms red at
 * once, skipping nineteen later steps including the full-history secret scan.
 * The step's own comment said it "reads tracked files only", written one commit
 * before the case that made it false — audit item 7, in the comment directly
 * above the step that broke.
 *
 * `loadTypeScript` now has three consumers and the other two — `electronSurface`
 * and `preloadSurface` — were already registered in `ci.yml`'s build job, after
 * the install. This belongs beside them, and does.
 *
 * ## Which cases are load-bearing
 *
 * Both CONTROLS, and neither is decoration. A scan and a filesystem probe have
 * one output for every way they can be broken — the reassuring one — so each
 * needs a case that must find something known-present, every run.
 *
 * The second control earned its place immediately: `unpinnedRuntimeExists` was
 * built on `fileExists`, which ends in `.isFile()`, and `dist` is a directory.
 * It could not return true for the only path it looks at, and asserting `false`
 * against a checkout where the directory is absent agreed with it perfectly.
 *
 * Usage: node scripts/proofs/electronImports.proof.mjs
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { scriptsImporting, unpinnedRuntimeExists } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

try {
  // ---------------------------------------------------------------------------
  // THE RULE: no plain-Node code may import `electron`, because the import
  // itself is the download trigger — `index.js` ends with `module.exports =
  // getElectronPath()`, which calls `downloadElectron()` when the binary is
  // absent.
  // ---------------------------------------------------------------------------
  const nodeSide = await scriptsImporting('electron', REPO_ROOT);
  check(
    'no plain-Node file imports `electron`',
    nodeSide.length === 0,
    `${nodeSide.join(', ')} import(s) electron from plain Node. That import resolves to ` +
      `index.js, whose module.exports IS getElectronPath() — so requiring it downloads an ` +
      `unpinned binary through install.js, which reads electron_use_remote_checksums. Spawn ` +
      `electronBinaryPath() instead. apps/desktop/src/preload.ts is not in scope: it runs ` +
      `inside the Electron runtime, where the specifier is the API surface.`,
  );

  check(
    'CONTROL: the scan finds a real import when one exists',
    (await scriptsImporting('node:path', REPO_ROOT)).length > 0,
    `the scan reported no plain-Node file importing "node:path", which nearly every script ` +
      `under scripts/ does. A scan that finds nothing reports the same clean result whether ` +
      `the rule holds or the parse is broken (audit item 4b) — and six lines under this very ` +
      `root hold a fixture string reading \`import … from 'electron'\`, which is why the scan ` +
      `parses rather than greps in the first place.`,
  );

  // ---------------------------------------------------------------------------
  // Prevention above, detection here, neither substituting for the other: the
  // rule covers the route this repository controls, this covers the rest — a
  // contributor's plain `npm install`, or a lazy download that already fired.
  // ---------------------------------------------------------------------------
  check(
    'no unpinned runtime is present in THIS checkout',
    (await unpinnedRuntimeExists(REPO_ROOT)) === false,
    `node_modules/electron/dist exists at ${REPO_ROOT}. Either a plain \`npm install\` ran ` +
      `the install script, or an import triggered the lazy download. Remove it and install ` +
      `with --ignore-scripts; the pinned runtime lives under .tools/.`,
  );

  const fixture = await mkdtemp(join(tmpdir(), 'monstera-unpinned-'));
  try {
    await mkdir(join(fixture, 'node_modules', 'electron', 'dist'), { recursive: true });
    check(
      'CONTROL: a root that HAS an unpinned runtime is reported as having one',
      (await unpinnedRuntimeExists(fixture)) === true,
      `unpinnedRuntimeExists said false for a root where node_modules/electron/dist was just ` +
        `created. Without this the case above asserts false in all three worlds that run it ` +
        `— this machine, Guards (no node_modules at all) and ci.yml (--ignore-scripts never ` +
        `runs the script that creates dist) — so a wrong join, a typo in the path, or a ` +
        `predicate that cannot see a directory would every one of them pass.`,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} electron-import failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('electron-import case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
