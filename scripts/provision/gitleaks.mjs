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
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { commandPath } from '../lib/commandPath.mjs';
import { compareContents, downloadVerified, fileExists } from '../lib/fetchVerified.mjs';
// One extractor for every provisioned artefact. The copy that used to live in
// this file resolved an absolute bsdtar on Windows and returned the bare string
// 'tar' everywhere else, so PATH still decided the outcome on the platform CI
// actually runs — the Windows instance was fixed and the class left open.
import { extract } from '../lib/extract.mjs';
import { formatError } from '../lib/reportError.mjs';

export const GITLEAKS_VERSION = '8.30.1';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** github.com issues the release URL; it always redirects to the signed asset host. */
const ALLOWED_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/** Every published archive is under 9 MB; this ceiling is bounded, not tight. */
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;

/**
 * Every platform the release publishes, pinned.
 *
 * All ten digests were taken from the release's checksums file **and
 * independently recomputed** from the downloaded archives.
 *
 * Covering every published platform rather than the handful in use is the
 * point: an incomplete map does not fail loudly, it fails as "no pinned build
 * for linux-arm", which reads like an unsupported platform rather than an
 * omission. A contributor there would reach for the override, and an override
 * used to paper over a gap is a workaround with a config flag on it.
 *
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
  'win32-ia32': {
    asset: `gitleaks_${GITLEAKS_VERSION}_windows_x32.zip`,
    sha256: '190ad53db301eec3e90afe3a1a75270768b8ebf89e731345e19421c32c1ae1a1',
    binary: 'gitleaks.exe',
  },
  'linux-x64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
    sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    binary: 'gitleaks',
  },
  'linux-arm64': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`,
    sha256: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
    binary: 'gitleaks',
  },
  'linux-ia32': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_x32.tar.gz`,
    sha256: 'a87ba11adab22b4d6c6ea28b2da60f09154d5c2fdb44d4b07015d1e0433daecb',
    binary: 'gitleaks',
  },
  // process.arch reports 'arm' for both v6 and v7, so the two are distinguished
  // by the ABI Node itself was built against.
  'linux-armv6': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_armv6.tar.gz`,
    sha256: '5c2a4ee657a27614e10352bed2b8f1018ef9b05fc6c037cf737776bbe1255766',
    binary: 'gitleaks',
  },
  'linux-armv7': {
    asset: `gitleaks_${GITLEAKS_VERSION}_linux_armv7.tar.gz`,
    sha256: '8d39f0d94ba0d774b2282187656fb039a2d82893ec1fd6be7d7121aae759a57d',
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
  if (process.platform === 'linux' && process.arch === 'arm') {
    // gitleaks publishes separate armv6 and armv7 builds; an armv7 binary does
    // not run on armv6 hardware. Node records which ABI it was compiled for.
    //
    // `arm_version` is NOT on @types/node's declaration of
    // `process.config.variables`, and it is genuinely absent on every non-ARM
    // build — which is why the cast is narrow and the fallback is real rather
    // than defensive padding. The whole armv6/armv7 split rested on this
    // undeclared property, on a platform no CI job runs, and nothing
    // type-checked scripts/ to say so.
    const variables = /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (process.config.variables)
    );
    const armVersion = variables['arm_version'];
    return `linux-armv${typeof armVersion === 'number' ? String(armVersion) : '7'}`;
  }
  return `${process.platform}-${process.arch}`;
}

/**
 * Absolute path where the provisioned binary lives, whether or not it exists.
 * The version is part of the path so a version bump provisions afresh instead
 * of silently reusing an older binary — and so a deliberately older build can
 * sit beside the pinned one without either overwriting the other.
 *
 * @param {{ version?: string, builds?: Record<string, PlatformBuild> }} [options]
 * @returns {string}
 */
export function gitleaksBinaryPath(options = {}) {
  const version = options.version ?? GITLEAKS_VERSION;
  const build = (options.builds ?? BUILDS)[platformKey()];
  if (build === undefined) return '';
  return join(REPO_ROOT, '.tools', 'gitleaks', version, build.binary);
}

/**
 * Spawns the binary and confirms it reports the expected version.
 *
 * Existence on disk is not evidence a binary works: a truncated download or a
 * wrong-architecture build both leave a file that stat() is happy with and
 * exec() is not. Reporting "provisioned" for a binary nobody has run is the
 * green-check-that-verifies-nothing this project bans outright.
 *
 * ## Where this may be asked, and where it may not
 *
 * `false` here means one of two unrelated things — the binary ran and is the
 * wrong version, or it could not be started at this instant. Nothing in the
 * return value separates them, so this must only gate steps that are safe under
 * BOTH readings.
 *
 * Two callers qualify. The staged copy: a file this process just wrote, at a
 * path no other process knows, where a spawn failure really is a bad download.
 * And the fast path in `provisionGitleaks`: a wrong answer there costs a
 * download, not an install.
 *
 * `publish` did NOT qualify, and it was the caller — a scanner holding a freshly
 * published .exe open for a few milliseconds made this return `false`, which
 * demoted "another process won the race" into "replace what it published". It
 * now compares content instead, and takes no `version`, so the question is not
 * available to it. See `publish`.
 *
 * @param {string} binary
 * @param {string} [version]
 * @returns {boolean}
 */
function reportsPinnedVersion(binary, version = GITLEAKS_VERSION) {
  const probe = spawnSync(binary, ['version'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) return false;
  return `${probe.stdout}`.includes(version);
}

/**
 * Locates a usable gitleaks without downloading one.
 *
 * Order: an explicit override, then the pinned hash-verified binary this
 * repository provisions, then a gitleaks already on PATH (so a contributor who
 * manages it through their own package manager is not forced into a second
 * copy).
 *
 * MONSTERA_GITLEAKS is an escape hatch for a platform the release does not
 * publish at all — a distribution's own build, or an architecture gitleaks has
 * not shipped. It is deliberately **not** how a published platform gets
 * covered: BUILDS pins every one of those, because an override standing in for
 * a missing pin is a workaround wearing a config flag.
 *
 * ## Selection, not verification
 *
 * This used to spawn each candidate and treat exit 0 from `version` as evidence
 * it was usable. That check was doing two jobs badly. It cost about 600 ms on
 * the most frequent action in the project, and it established only that a
 * process starts — which says nothing about the ruleset, the thing a secret
 * scanner actually is. A distribution build years out of date passes it.
 *
 * Verification now belongs to scripts/lib/scannerCanary.mjs, which makes the
 * binary find real secret shapes and caches the verdict against the binary's own
 * hash. So this function only has to answer "which file would run", and answers
 * it by resolving the path rather than by executing it. Every caller runs the
 * canary immediately afterwards; a candidate that resolves but cannot scan is
 * reported as a broken scanner rather than silently skipped in favour of
 * another, because "your provisioned copy is broken" is the message that leads
 * somewhere.
 *
 * @returns {Promise<string | null>} A command to run, or null if none resolves.
 */
export async function resolveGitleaks() {
  const override = process.env['MONSTERA_GITLEAKS'];
  if (override !== undefined && override !== '') {
    return commandPath(override) === null ? null : override;
  }

  const provisioned = gitleaksBinaryPath();
  if (provisioned !== '' && (await fileExists(provisioned))) return provisioned;

  return commandPath('gitleaks') === null ? null : 'gitleaks';
}

/**
 * Whether a process id currently belongs to a running process.
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything. `ESRCH` is the only code that means "nobody is there": `EPERM` says
 * the process exists and belongs to someone else, which is still alive.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function pidIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH';
  }
}

/**
 * Removes quarantine directories left by processes that are no longer running.
 *
 * ## Why the pid in the name is load-bearing, and which way to be wrong
 *
 * `publish` rolls back through its quarantine: if the second rename fails it
 * renames the quarantined directory back, so between those two moments that
 * directory is the ONLY copy of a working tool. Sweeping one that belongs to a
 * live racer would delete the thing it is about to restore — turning a cleanup
 * into the outage it exists to prevent.
 *
 * A pid is a slot the operating system hands back out, exactly like an inode,
 * so "this name says pid 4812" does not establish that pid 4812 is the owner.
 * The asymmetry runs in our favour here, which is why this is safe without
 * anything stronger:
 *
 *   - a pid that is **dead** cannot be a running owner, whoever it was, so the
 *     directory is abandoned and sweeping it is unconditionally correct;
 *   - a pid that is **alive** may be an unrelated process that inherited the
 *     slot — and skipping it costs exactly one leftover directory, which the
 *     next run reconsiders.
 *
 * So the reuse hazard can only produce the harmless outcome. Nothing here needs
 * to distinguish the owner from a stranger, and a stronger identity — a lock
 * file, a recorded start time — would buy only the leftover back.
 *
 * Best-effort throughout: a directory that cannot be removed is left for the
 * next run, which is now a statement that is true.
 *
 * @param {string} versionDirectory
 * @returns {Promise<void>}
 */
export async function sweepAbandonedQuarantines(versionDirectory) {
  const parent = dirname(versionDirectory);
  const prefix = `${basename(versionDirectory)}.superseded-`;

  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;

    // A suffix this cannot read is not evidence of abandonment, so it is left
    // alone rather than swept on a guess.
    const pid = Number.parseInt(entry.name.slice(prefix.length), 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pidIsRunning(pid)) continue;

    await rm(join(parent, entry.name), { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Publishes the staged copy, deciding from the destination's MEASURED state.
 *
 * The previous shape deleted the destination whenever `--force` was passed, then
 * renamed into the hole. Two things were wrong with taking the decision from a
 * flag:
 *
 *   - `--force` says what the CALLER wants, not what is there. A destination
 *     that already holds a working binary was destroyed and re-downloaded; a
 *     destination holding a broken one survived untouched whenever the flag was
 *     absent, which is the case that actually needs replacing. Recovering from
 *     a truncated binary — exactly what an interrupted download leaves — needed
 *     an option nothing tells you about.
 *   - the delete opened a window. Between `rm` and `rename` the tool does not
 *     exist, so a concurrent hook resolves nothing and blocks a commit — and on
 *     Windows the `rm` simply fails with EBUSY while another process has the
 *     .exe mapped, leaving a half-deleted directory behind.
 *
 * So the published path is only ever changed by a rename, never by a delete: an
 * occupied destination is moved aside and the staged copy renamed in, so the
 * path holds a working tool at every instant. Whether to swap at all is then a
 * measurement — a destination that runs and reports the pinned version is kept —
 * except when the caller explicitly asked to replace it, which is the one thing
 * `--force` still means.
 *
 * The quarantined copy is deleted afterwards, and failing to delete it is not
 * fatal — but the reason given for that used to be false. It said "a locked
 * executable leaves a directory the next run cleans up". Nothing cleaned it up.
 * The name is `${versionDirectory}.superseded-${process.pid}` and the only
 * removal named that exact path, so a later run computed a different pid, looked
 * for a directory that had never existed, and left the real one where it was.
 * Leftovers accumulated forever, and the proof's last case asserted a property
 * the implementation merely hoped for.
 *
 * `sweepAbandonedQuarantines` makes the claim true: every `.superseded-*`
 * sibling is considered, not only this process's own.
 *
 * ## What decides the swap, and what must never decide it
 *
 * The destination is compared to the staged copy BY CONTENT. It used to be
 * compared by spawning it and asking its version, and that question has two
 * different false answers wearing one boolean: "this is the wrong binary", and
 * "I could not start it just this instant". Only the first is a reason to
 * replace anything. The second is what a virus scanner produces by holding a
 * newly written executable open for a few milliseconds — and it was authorising
 * `rename(versionDirectory, quarantine)` on a directory another process may have
 * mapped, which is the open-handle-blocks-RENAME mechanism in Part K, reached
 * through a question that was never meant to authorise anything.
 *
 * So `version` is deliberately NOT a parameter here. Removing it is what stops
 * the check coming back: this function cannot ask whether the destination runs,
 * because it has nothing to compare a version against. `reportsPinnedVersion`
 * still guards the STAGED copy, where the file is this process's own, no other
 * process knows its path, and a spawn failure really does mean a bad download.
 *
 * @param {{
 *   staging: string,
 *   versionDirectory: string,
 *   binary: string,
 *   force: boolean,
 * }} options
 * @returns {Promise<void>}
 */
async function publish({ staging, versionDirectory, binary, force }) {
  await mkdir(dirname(versionDirectory), { recursive: true });

  // Before anything else, and not only this process's own name — see
  // sweepAbandonedQuarantines for why a live pid is skipped rather than raced.
  await sweepAbandonedQuarantines(versionDirectory);

  const staged = join(staging, basename(binary));

  if (await fileExists(binary)) {
    if (!force) {
      const destination = await compareContents(binary, staged);
      if (destination.kind === 'same') {
        // Another process published this exact binary while this one was
        // downloading. It is byte-for-byte what we staged and proved runnable,
        // so there is nothing to replace and no reason to touch the path.
        return;
      }
      if (destination.kind === 'unreadable') {
        // Not evidence about the binary, so it may not authorise destroying it.
        // Failing here leaves a working tool in place and says why; a re-run
        // repairs it once whatever held the file has let go.
        throw new Error(
          `Could not read ${binary} to decide whether it needs replacing`,
          { cause: destination.cause },
        );
      }
    }

    const quarantine = `${versionDirectory}.superseded-${process.pid}`;
    await rm(quarantine, { recursive: true, force: true });
    await rename(versionDirectory, quarantine);
    try {
      await rename(staging, versionDirectory);
    } catch (cause) {
      // Put the original back rather than leaving no tool at all.
      await rename(quarantine, versionDirectory).catch(() => undefined);
      throw new Error(`Could not publish gitleaks to ${versionDirectory}`, { cause });
    }
    await rm(quarantine, { recursive: true, force: true }).catch(() => undefined);
    return;
  }

  try {
    await rename(staging, versionDirectory);
  } catch (cause) {
    // rename onto an existing directory fails on Windows rather than replacing
    // it, which is what happens when another process published between the
    // check above and here. Accept its copy — but only after confirming it is
    // the same binary, or a genuine failure is mistaken for a lost race.
    //
    // By content, for the reason in this function's header: a copy we cannot
    // start right now is not the same thing as a copy that is wrong, and only
    // the second justifies calling this a publish failure.
    const winner = (await fileExists(binary))
      ? await compareContents(binary, staged)
      : /** @type {const} */ ({ kind: 'different' });
    if (winner.kind !== 'same') {
      throw new Error(`Could not publish gitleaks to ${versionDirectory}`, { cause });
    }
  }
}

/**
 * @param {{
 *   force?: boolean,
 *   version?: string,
 *   builds?: Record<string, PlatformBuild>,
 * }} [options]
 *   `force` re-downloads and re-verifies rather than taking the
 *   already-provisioned fast path. It does NOT mean "delete the destination" —
 *   see `publish` for why that decision belongs to the destination's measured
 *   state instead.
 *
 *   `version`/`builds` exist for ONE caller: the canary's proof, which
 *   provisions a deliberately older gitleaks whose job is to be wrong. They are
 *   parameters rather than a second downloader so that fixture goes through
 *   exactly this hash-verified, atomically-published path — a test binary
 *   fetched by a weaker route would be the one download in the project nobody
 *   verified.
 * @returns {Promise<string>} Absolute path to a binary proven to run.
 */
export async function provisionGitleaks({
  force = false,
  version = GITLEAKS_VERSION,
  builds = BUILDS,
} = {}) {
  const key = platformKey();
  const build = builds[key];
  if (build === undefined) {
    throw new Error(
      `No pinned gitleaks ${version} build for ${key}. Add one to scripts/provision/gitleaks.mjs ` +
        `with the digest from the release checksums file.`,
    );
  }

  const binary = gitleaksBinaryPath({ version, builds });
  if (!force && (await fileExists(binary)) && reportsPinnedVersion(binary, version)) {
    return binary;
  }

  const versionDirectory = dirname(binary);

  // Build in a private staging directory and publish by rename, rather than
  // clearing the destination and extracting into it. Two processes can provision
  // at once — CI steps, a hook and a proof, two terminals — and the
  // clear-then-extract shape lets one delete the directory the other is
  // mid-extraction into, leaving a half-populated tree that `fileExists` is
  // perfectly happy with. Rename is the only step that touches the destination
  // and it is atomic.
  const staging = `${versionDirectory}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    const archive = join(staging, build.asset);
    process.stderr.write(`Provisioning gitleaks ${version} for ${key}…\n`);

    await downloadVerified({
      url: `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${build.asset}`,
      allowedHosts: ALLOWED_HOSTS,
      sha256: build.sha256,
      maxBytes: MAX_ARCHIVE_BYTES,
      destination: archive,
    });

    extract(staging, build.asset);
    await rm(archive, { force: true });

    const staged = join(staging, build.binary);
    if (!(await fileExists(staged))) {
      throw new Error(`${build.asset} did not contain ${build.binary}`);
    }
    if (!reportsPinnedVersion(staged, version)) {
      throw new Error(
        `${staged} was extracted but does not report version ${version} when run.`,
      );
    }

    await publish({ staging, versionDirectory, binary, force });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  process.stderr.write(`gitleaks ${version} ready at ${binary}\n`);
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
    // formatError, not `error.stack`: `publish` attaches the failing rename as
    // `cause`, and the errno inside it is the whole diagnosis. `stack` does not
    // include `cause`, so printing it discarded the chain at the one step that
    // was going to be read — see scripts/lib/reportError.mjs.
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  });
}
