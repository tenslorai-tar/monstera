// @ts-check
/**
 * Provisions the gitleaks secret scanner used by the pre-commit hook and CI.
 *
 * gitleaks is a native binary, and Part J forbids binaries in git absolutely —
 * a public repository's history is permanent, so a binary committed once is a
 * binary shipped forever. It is therefore downloaded here against a pinned
 * version and a pinned SHA-256, into the gitignored .tools/ directory.
 *
 * The digests below were taken from the release's own checksums file and
 * independently recomputed from the downloaded archives before being pinned.
 *
 * gitleaks is MIT licensed: compatible with AGPL-3.0, and in any case a
 * development-time tool that is never redistributed with the app.
 *
 * Usage: node scripts/provision/gitleaks.mjs [--force]
 */

import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadVerified, fileExists } from '../lib/fetchVerified.mjs';

export const GITLEAKS_VERSION = '8.30.1';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** github.com issues the release URL; it always redirects to the signed asset host. */
const ALLOWED_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/** Every published archive is under 9 MB; this ceiling is bounded, not tight. */
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;

/**
 * @typedef {{ asset: string, sha256: string, binary: string }} PlatformBuild
 * @type {Record<string, PlatformBuild>}
 */
const BUILDS = {
  'win32-x64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`,
    sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
    binary: 'gitleaks.exe',
  },
  'win32-arm64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_windows_arm64.zip`,
    sha256: 'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f',
    binary: 'gitleaks.exe',
  },
  'linux-x64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
    sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    binary: 'gitleaks',
  },
  'darwin-arm64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`,
    sha256: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
    binary: 'gitleaks',
  },
  'darwin-x64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`,
    sha256: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
    binary: 'gitleaks',
  },
};

/** @returns {string} */
function platformKey() {
  return `${process.platform}-${process.arch}`;
}

/**
 * Absolute path where the provisioned binary lives, whether or not it exists.
 * The version is part of the path so a version bump provisions afresh instead
 * of silently reusing an older binary.
 *
 * @returns {string}
 */
export function gitleaksBinaryPath() {
  const build = BUILDS[platformKey()];
  if (build === undefined) return '';
  return join(REPO_ROOT, '.tools', 'gitleaks', GITLEAKS_VERSION, build.binary);
}

/**
 * Spawns the binary and confirms it reports the pinned version.
 *
 * Existence on disk is not evidence a binary works: a truncated download or a
 * wrong-architecture build both leave a file that stat() is happy with and
 * exec() is not. Reporting "provisioned" for a binary nobody has run is the
 * green-check-that-verifies-nothing this project bans outright.
 *
 * @param {string} binary
 * @returns {boolean}
 */
function reportsPinnedVersion(binary) {
  const probe = spawnSync(binary, ['version'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) return false;
  return `${probe.stdout}`.includes(GITLEAKS_VERSION);
}

/**
 * @param {string} archive
 * @param {string} intoDirectory
 */
function extract(archive, intoDirectory) {
  // bsdtar ships in System32 on Windows 10 1803+ and reads zip as well as
  // tar.gz, so one extraction call covers every platform's asset format.
  const result = spawnSync('tar', ['-xf', archive, '-C', intoDirectory], { encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(`Could not run "tar" to extract ${archive}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`tar exited ${result.status} extracting ${archive}: ${result.stderr}`);
  }
}

/**
 * @param {string} command
 * @returns {boolean} True when the command exists and runs.
 */
function isSpawnable(command) {
  const probe = spawnSync(command, ['version'], { encoding: 'utf8' });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Locates a usable gitleaks without downloading one.
 *
 * Order: an explicit override, then the pinned hash-verified binary this
 * repository provisions, then a gitleaks already on PATH (so a contributor who
 * manages it through their own package manager is not forced into a second
 * copy).
 *
 * MONSTERA_GITLEAKS exists because BUILDS covers five platforms and the
 * project runs on more: linux-armv7 and the 32-bit targets have published
 * releases but no pin here, and a contributor on one of those otherwise has no
 * route to a working hook at all. The override is verified by spawning it,
 * exactly like every other candidate — it selects a binary, it does not excuse
 * one from working.
 *
 * @returns {Promise<string | null>} A spawnable command, or null if none exists.
 */
export async function resolveGitleaks() {
  const override = process.env['MONSTERA_GITLEAKS'];
  if (override !== undefined && override !== '') {
    return isSpawnable(override) ? override : null;
  }

  const provisioned = gitleaksBinaryPath();
  if (provisioned !== '' && (await fileExists(provisioned)) && isSpawnable(provisioned)) {
    return provisioned;
  }

  return isSpawnable('gitleaks') ? 'gitleaks' : null;
}

/**
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<string>} Absolute path to a binary proven to run.
 */
export async function provisionGitleaks({ force = false } = {}) {
  const key = platformKey();
  const build = BUILDS[key];
  if (build === undefined) {
    throw new Error(
      `No pinned gitleaks build for ${key}. Add one to scripts/provision/gitleaks.mjs ` +
        `with the digest from the release checksums file.`,
    );
  }

  const binary = gitleaksBinaryPath();
  if (!force && (await fileExists(binary)) && reportsPinnedVersion(binary)) {
    return binary;
  }

  const versionDirectory = dirname(binary);
  await rm(versionDirectory, { recursive: true, force: true });
  await mkdir(versionDirectory, { recursive: true });

  const archive = join(versionDirectory, build.asset);
  process.stderr.write(`Provisioning gitleaks ${GITLEAKS_VERSION} for ${key}…\n`);

  await downloadVerified({
    url: `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${build.asset}`,
    allowedHosts: ALLOWED_HOSTS,
    sha256: build.sha256,
    maxBytes: MAX_ARCHIVE_BYTES,
    destination: archive,
  });

  extract(archive, versionDirectory);
  await rm(archive, { force: true });

  if (!(await fileExists(binary))) {
    throw new Error(`${build.asset} did not contain ${build.binary}`);
  }
  if (!reportsPinnedVersion(binary)) {
    throw new Error(
      `${binary} was extracted but does not report version ${GITLEAKS_VERSION} when run.`,
    );
  }

  process.stderr.write(`gitleaks ${GITLEAKS_VERSION} ready at ${binary}\n`);
  return binary;
}

// Run only when invoked directly, not when imported by the hook. Comparing
// resolved filesystem paths rather than URL strings avoids the Windows case
// where file:///C:/… and file://C:\… describe the same file and compare unequal.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  provisionGitleaks({ force: process.argv.includes('--force') }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
