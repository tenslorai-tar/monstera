// @ts-check
/**
 * Proves the Electron pin cannot drift from the dependency, and cannot be
 * routed around.
 *
 * ## What this deliberately does NOT do
 *
 * Download anything. `proof:provision` already makes four live github.com
 * fetches per run and is a recorded open finding for exactly that; a second
 * proof pulling ~100 MB would be the third instance and the largest. Every case
 * here reads tracked files.
 *
 * The download path itself is not unproven as a result — `downloadVerified` is
 * the primitive `proof:provision` exercises against a real server, and this is
 * its third consumer, not a third copy.
 *
 * ## Which cases are load-bearing
 *
 * The VERSION AGREEMENT case. A pinned hash and a dependency version in two
 * files is exactly the drift shape this project keeps finding: both are correct
 * when written, and the day someone bumps `apps/desktop/package.json` the
 * provisioner silently fetches a different build from the one `electron.d.ts`
 * describes — and the derivation in `electronSurface.mjs` would then be reading
 * one version's declarations while the window ran another's.
 *
 * Nothing else in the repository ties them together, so if this case is deleted
 * the disagreement is invisible until a runtime symbol is missing.
 *
 * Usage: node scripts/provision/electron.proof.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { BUILDS, ELECTRON_VERSION, buildFor, electronBinaryPath } from './electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** The version `apps/desktop` actually depends on. */
function declaredVersion() {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, 'apps', 'desktop', 'package.json'), 'utf8'),
  );
  const raw = manifest?.devDependencies?.electron;
  if (typeof raw !== 'string' || raw === '') {
    throw new Error(
      'apps/desktop/package.json declares no `electron` devDependency. This proof compares the ' +
        'provisioned pin against it, and a missing value would make the comparison pass by ' +
        'having nothing to disagree with (audit item 4b).',
    );
  }
  return raw.replace(/^[\^~]/u, '');
}

const declared = declaredVersion();

// -----------------------------------------------------------------------------
// The one that matters.
// -----------------------------------------------------------------------------
check(
  'the provisioned version equals the DEPENDENCY version',
  ELECTRON_VERSION === declared,
  `the provisioner pins ${ELECTRON_VERSION} and apps/desktop depends on ${declared}. Nothing ` +
    `else ties them together: a bump to one fetches a different build from the one ` +
    `electron.d.ts describes, so the surface derivation would read one version's declarations ` +
    `while the window ran another's.`,
);

check(
  'every pinned archive names that same version',
  Object.values(BUILDS).every((build) => build.asset.includes(`v${ELECTRON_VERSION}`)),
  `assets: ${Object.values(BUILDS)
    .map((build) => build.asset)
    .join(', ')}. An asset naming a different version would be fetched, verified against its ` +
    `own recorded hash, and be the wrong build — verification cannot catch a correct hash for ` +
    `the wrong thing.`,
);

// -----------------------------------------------------------------------------
// The pins themselves.
// -----------------------------------------------------------------------------
check(
  'every pin is a full lowercase SHA-256',
  Object.values(BUILDS).every((build) => /^[0-9a-f]{64}$/u.test(build.sha256)),
  `a truncated or upper-cased digest is rejected by downloadVerified at fetch time, which is ` +
    `after the download. Catching it here costs nothing and names the entry.`,
);

check(
  'no two platforms share a pin',
  new Set(Object.values(BUILDS).map((build) => build.sha256)).size ===
    Object.keys(BUILDS).length,
  `two platforms with one digest means a copy-paste that verifies perfectly and installs the ` +
    `wrong architecture — the failure a hash check cannot see, because the hash is right.`,
);

check(
  'both CI platforms are pinned',
  BUILDS['win32-x64'] !== undefined && BUILDS['linux-x64'] !== undefined,
  `windows-latest and ubuntu-latest are the two runners. A platform CI uses and this does not ` +
    `pin would fail in the job rather than here.`,
);

// -----------------------------------------------------------------------------
// No route around the pin. This is CLAUDE.md item 1's shape: an escape hatch
// standing in for missing coverage is a workaround with a config flag on it.
// -----------------------------------------------------------------------------
check(
  'an unpinned platform is REFUSED, and the refusal says to add a pin',
  (() => {
    try {
      buildFor('plan9-mips');
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return message.includes('No Electron archive is pinned') && message.includes('Add its');
    }
  })(),
  `an unpinned platform must read as "add a pin", never as "provisioning is unavailable here" ` +
    `— the second invites the override that MONSTERA_GITLEAKS exists as a warning about.`,
);

check(
  'the provisioner reads no environment variable',
  !readFileSync(join(REPO_ROOT, 'scripts', 'provision', 'electron.mjs'), 'utf8').includes(
    'process.env',
  ),
  `install.js reads electron_use_remote_checksums, which repoints verification at a remote ` +
    `source. A pin an environment variable can replace is not a pin, and this is the file that ` +
    `must not acquire one.`,
);

check(
  'CONTROL: a pinned platform resolves, so the refusal above separates something',
  electronBinaryPath(REPO_ROOT, 'win32-x64').endsWith('electron.exe'),
  `without this, the refusal case is satisfied by a buildFor that throws for every input — the ` +
    `fixture half of item 4's direction rule.`,
);

// THE RULE — no plain-Node file may import `electron` — and the unpinned-runtime
// probe both live in scripts/proofs/electronImports.proof.mjs, which runs in
// ci.yml's build job. They arrived here and turned Guards red on both platforms:
// the scan calls loadTypeScript, and this job runs no `npm ci`, so there is no
// compiler to load. SPLIT BY WHAT A CASE NEEDS, not by what it is about — every
// case in this file reads a tracked file and nothing else, which is why it can
// run in a job that installs nothing.

try {
  process.stdout.write(
    failures.length > 0
      ? `${failures.length} electron-provision failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('electron-provision case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
