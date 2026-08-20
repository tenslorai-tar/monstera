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
import { copyFile, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
 * Directories this process has started an executable out of.
 *
 * The defect this makes deterministic: on Windows the image section outlives the
 * process, so renaming such a directory races kernel cleanup. That failure is
 * INTERMITTENT and platform-specific — it passed CI many times, then took a job
 * down at 93cd471 — which is the worst shape a defect can have, because every
 * green run is evidence for the wrong conclusion.
 *
 * Recording the spawn converts it into a refusal on every platform: `publish`
 * will not rename a tree this process has run something out of, so a
 * reintroduction fails the same way on a Linux laptop as on a Windows runner,
 * immediately, with the mechanism in the message.
 */
const spawnedFrom = new Set();

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
 * Two questions decide whether a caller qualifies, and the SECOND one was not
 * here until 93cd471 took a job down.
 *
 * 1. Is a wrong answer safe? `publish` did NOT qualify and was the caller — a
 *    scanner holding a freshly published .exe open for a few milliseconds made
 *    this return `false`, which demoted "another process won the race" into
 *    "replace what it published". It compares content instead, and takes no
 *    `version`, so the question is not available to it.
 * 2. **Is the directory about to be renamed?** Spawning leaves an image-section
 *    handle on it, and on Windows that blocks RENAME. Every direct caller failed
 *    this second question: the staged copy is renamed by `publish` five lines
 *    later, and the fast path's binary sits in the very directory `publish`
 *    moves aside to a quarantine.
 *
 * So there are now no direct callers in the provisioning path at all — both go
 * through {@link probeOutsideStaging}, which runs a copy somewhere nothing
 * renames. What remains here is the spawn itself, and the recording that makes
 * a reintroduction refuse rather than race.
 *
 * @param {string} binary
 * @param {string} [version]
 * @returns {boolean}
 */
export function reportsPinnedVersion(binary, version = GITLEAKS_VERSION) {
  spawnedFrom.add(resolve(dirname(binary)));
  const probe = spawnSync(binary, ['version'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) return false;
  return `${probe.stdout}`.includes(version);
}

/**
 * Refuses to rename a directory this process has spawned an executable from.
 *
 * @param {string} directory
 * @param {string} role What the directory is, for the message.
 * @returns {void}
 */
function refuseIfSpawnedFrom(directory, role) {
  if (!spawnedFrom.has(resolve(directory))) return;
  throw new Error(
    `Refusing to rename ${directory} (${role}): this process started an executable out of it. ` +
      `On Windows the image section outlives the process and a directory holding a file with an ` +
      `outstanding handle cannot be renamed, so this rename would fail with EPERM — sometimes, ` +
      `on one platform, which is how it survived CI until 93cd471. Probe a COPY instead: see ` +
      `probeOutsideStaging.`,
  );
}

/**
 * Errnos that mean *something is holding this*, as distinct from *the
 * filesystem is in a state waiting will not change*.
 *
 * `ENOTEMPTY` and `EEXIST` are deliberately absent: a directory does not become
 * empty because you waited.
 */
const HELD_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ETXTBSY']);

/**
 * The first held-looking errno in a cause chain, or `null`.
 *
 * @param {unknown} thrown
 * @returns {string | null}
 */
function heldCodeIn(thrown) {
  const seen = new Set();
  let current = thrown;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = /** @type {NodeJS.ErrnoException} */ (current).code;
    if (code !== undefined && HELD_CODES.has(code)) return code;
    current = current.cause;
  }
  return null;
}

/**
 * Runs the staged binary from a COPY, outside the tree that is about to move.
 *
 * ## The mechanism, which is Part K's own and was reintroduced here
 *
 * Windows keeps an image section on an executable after the process exits;
 * teardown is asynchronous, and **a directory containing a file with an
 * outstanding handle cannot be renamed**. `provisionGitleaks` spawned the staged
 * binary out of `staging` and then handed `staging` to `publish`, which renames
 * it five lines later. So the probe left a lock on the tree the next step had to
 * move, and the publish raced kernel cleanup.
 *
 * Measured on a `windows-latest` runner at 93cd471: `EPERM` on the rename into
 * an **absent** destination — so "renaming onto an existing directory" is
 * excluded — while `rm` of the same tree in the `finally` immediately after
 * succeeded. Linux renames a running binary happily, which is why only one of
 * the two jobs ever went red.
 *
 * ## Why this is the fix and a retry is not
 *
 * Rule 0 permits a workaround only when the root cause is proven to lie outside
 * this repository. **The handle is ours**, so a retry with backoff is the banned
 * reflex — and it would have looked like it worked, which is the expensive part.
 *
 * The probe is not dropped. Publishing a binary nobody started is the
 * `available: true` sin: a truncated download exists, has the right name, and
 * cannot run.
 *
 * ## The falsification control, written down so a retry cannot arrive as a guess
 *
 * One candidate is NOT eliminated by this: Microsoft Defender scanning a
 * freshly extracted `.exe` holds a handle too, and it is consistent with every
 * observation above. The image-section candidate is inside this repository and
 * removable without measuring anything, which is why it goes first.
 *
 * **If `EPERM` recurs on the publish rename after this change, the remaining
 * cause is external** — nothing this process started is inside the renamed tree
 * any more — and only then does a bounded retry become legal under Rule 0. The
 * measurement that will say so is in `provisionGitleaks`'s `finally`.
 *
 * @param {string} staged The extracted binary, inside the staging tree.
 * @param {string} version
 * @returns {Promise<{ ok: boolean, ranFrom: string }>} `ranFrom` is the
 *   directory the copy was executed from, so a proof can assert it is not the
 *   one that gets renamed.
 */
export async function probeOutsideStaging(staged, version) {
  const isolated = await mkdtemp(join(tmpdir(), 'monstera-gitleaks-probe-'));
  try {
    const copy = join(isolated, basename(staged));
    await copyFile(staged, copy);
    return { ok: reportsPinnedVersion(copy, version), ranFrom: isolated };
  } finally {
    // Best effort, and it is THIS directory that may now be locked. That is the
    // point: the lock lands where nothing renames anything.
    await rm(isolated, { recursive: true, force: true }).catch(() => undefined);
  }
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
 * measurement **of the destination's CONTENT, and of nothing else** — the rule
 * and its reason are below, under "What decides the swap". The one exception is
 * a caller that explicitly asked to replace it, which is all `--force` still
 * means.
 *
 * That sentence used to end differently: it said the measurement was "a
 * destination that runs and reports the pinned version". It stopped being true
 * when the spawn was removed, and it survived the audit of the very range that
 * removed it. The new section below explained the change, while the paragraph a
 * reader treats as the contract went on stating the old rule eighteen lines
 * above it — and someone deciding what this function may ask reads the contract,
 * not the correction. **A removed behaviour has to leave the FIRST place the
 * function describes itself, not merely be answered in a later one.**
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
export async function publish({ staging, versionDirectory, binary, force }) {
  await mkdir(dirname(versionDirectory), { recursive: true });

  // Before anything else, and not only this process's own name — see
  // sweepAbandonedQuarantines for why a live pid is skipped rather than raced.
  await sweepAbandonedQuarantines(versionDirectory);

  const staged = join(staging, basename(binary));

  // Both trees this function can rename, checked before either is touched.
  refuseIfSpawnedFrom(staging, 'the staged copy');
  refuseIfSpawnedFrom(versionDirectory, 'the published install');

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
      const restored = await rename(quarantine, versionDirectory).then(
        () => true,
        () => false,
      );
      // Both throw sites used to say exactly `Could not publish gitleaks to
      // <dir>`. Two unrelated failures reading identically in a log nobody can
      // attach a debugger to cost a diagnosis: the 93cd471 failure was placed on
      // this branch or the other one only by reading a line number out of the
      // stack.
      throw new Error(
        `Could not publish gitleaks to ${versionDirectory}: the existing install was moved aside ` +
          `to ${quarantine} and the staged copy could not be renamed into the hole. ` +
          (restored
            ? `The original was put back, so the path still holds a working tool.`
            : `THE ORIGINAL COULD NOT BE PUT BACK — ${versionDirectory} is now absent and the ` +
              `previous install is at ${quarantine}.`),
        { cause },
      );
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
    const rivalAppeared = await fileExists(binary);
    const winner = rivalAppeared
      ? await compareContents(binary, staged)
      : /** @type {const} */ ({ kind: 'different' });
    if (winner.kind !== 'same') {
      // Which branch of `winner` was taken is the whole diagnosis, and it used
      // to be absent: "no rival appeared" means the rename failed on its own
      // terms, while "a rival appeared and differs" means a real race with a
      // different build. Reporting them as one string sent the reader to the
      // wrong mechanism.
      throw new Error(
        `Could not publish gitleaks to ${versionDirectory}: the destination did not exist and ` +
          `the staged copy could not be renamed into it. ` +
          (!rivalAppeared
            ? `No rival copy appeared, so this was not a lost race — the rename itself failed.`
            : winner.kind === 'unreadable'
              ? `A rival copy appeared but could not be read, so whether it is the same binary ` +
                `is unknown and this refuses rather than guessing.`
              : `A rival copy appeared and is a DIFFERENT binary.`),
        { cause },
      );
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
  // THE SECOND SPAWN SITE, and it has the same mechanism as the staging one. If
  // this probe says no, the very next thing that can happen is `publish`
  // renaming `versionDirectory` aside to a quarantine — an unguarded rename of
  // the directory this line just started an executable out of. Narrower than the
  // staging site (it needs an existing binary of the wrong version, so the spawn
  // has to have succeeded to return false) and the same repair, which is the
  // point: fixing one site and leaving the other is the half-fix Rule 0 names.
  if (!force && (await fileExists(binary)) && (await probeOutsideStaging(binary, version)).ok) {
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

  /** @type {unknown} */
  let failure = null;
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
    // NOT `reportsPinnedVersion(staged, …)`. Spawning the staged file leaves an
    // image-section handle on `staging`, and `publish` renames `staging` five
    // lines below — see probeOutsideStaging for the mechanism and for the one
    // candidate it deliberately does not eliminate.
    const probe = await probeOutsideStaging(staged, version);
    if (!probe.ok) {
      throw new Error(
        `${staged} was extracted but does not report version ${version} when run.`,
      );
    }

    await publish({ staging, versionDirectory, binary, force });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // THE TRANSIENCE MEASUREMENT, and it costs nothing because this removal
    // happens either way. If the publish rename failed because something held
    // the tree, whether the SAME tree can be deleted a moment later answers
    // whether the block was transient — and that is how the 93cd471 failure was
    // diagnosed, from a log that happened to contain both facts and said neither.
    //
    // It lives HERE, at the operation, rather than in one caller's proof. The
    // rename behaviour belongs to a function three callers reach — the
    // provisioning proof, the concurrency proof and the canary — and an
    // instrument scoped to one of them measures a call site instead of a
    // mechanism.
    const startedAt = Date.now();
    const removed = await rm(staging, { recursive: true, force: true }).then(
      () => true,
      () => false,
    );
    const code = heldCodeIn(failure);
    if (code !== null) {
      process.stderr.write(
        removed
          ? `MEASUREMENT: the publish above failed with ${code}, and ${staging} was then removed ` +
              `successfully ${Date.now() - startedAt} ms later. The block CLEARED between the two ` +
              `operations, so it was a handle rather than a permission. Nothing this process ` +
              `started is inside that tree any more, so the remaining holder is external — see ` +
              `the falsification control in probeOutsideStaging before adding any retry.\n`
          : `MEASUREMENT: the publish above failed with ${code} and ${staging} could not be ` +
              `removed either. The block PERSISTED, so waiting would not have helped and this is ` +
              `not the transient-handle mechanism.\n`,
      );
    }
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
