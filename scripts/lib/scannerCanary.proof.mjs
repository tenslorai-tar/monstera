// @ts-check
/**
 * Proof that the canary catches the scanner it exists to catch (rule B2).
 *
 * The canary's whole reason to exist is the binary that is NOT the pinned
 * build — a gitleaks a package manager installed, old enough to have a narrower
 * ruleset. Every case for it ran against the pinned build, and the divergence
 * path was exercised only synthetically, by handing the reporting function a
 * version string it could not match. That covers "a stub that exits 0 and does
 * nothing". It does not cover the case the MONSTERA_GITLEAKS override exists
 * for: a real scanner that runs, reports findings, exits non-zero, and quietly
 * misses one family.
 *
 * So this provisions one genuinely older build whose only job is to be wrong.
 *
 * ## Why 8.23.0, measured rather than guessed
 *
 * Three candidates were tried against the corpus before this one was pinned:
 *
 *   8.19.0  no JSON report on stdout — `--report-path -` is not supported, so
 *           it "missed" everything. That is an instrument artefact, not a
 *           ruleset difference, and pinning it would have proved nothing.
 *   8.21.0  same.
 *   8.24.0  finds all six families. Nothing to detect.
 *   8.23.0  runs the shipped invocation exactly, finds FIVE of six families,
 *           exits 1 like a healthy scan, and silently drops
 *           `cloud-connection-string` — the Azure storage connection string the
 *           entropy rule catches on 8.30.1.
 *
 * One family, no error, same exit code. That is precisely the failure a version
 * check cannot see and an exit-status check calls success.
 *
 * The fixture goes through `provisionGitleaks` with its own pinned digests
 * rather than a second downloader, so it is hash-verified by the same path as
 * every other binary. A test binary fetched by a weaker route would be the one
 * download in this project nobody verified.
 *
 * Usage: node scripts/lib/scannerCanary.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildCorpus, divergenceNotice, ownRepositoryEnv, verifyScannerCapability } from './scannerCanary.mjs';
import { formatError } from './reportError.mjs';
import { GITLEAKS_VERSION, gitleaksBinaryPath, provisionGitleaks } from '../provision/gitleaks.mjs';

/**
 * A gitleaks old enough to be wrong, pinned exactly like the real one.
 *
 * Digests are from the release's own checksums file; the win32-x64 archive was
 * additionally downloaded and its SHA-256 independently recomputed to confirm
 * the file matches what the checksums claim.
 *
 * win32-arm64 is deliberately absent: 8.23.0 published no such asset. For the
 * PINNED build an unlisted platform is an omission to fix; here it is a fact
 * about an old release, so the case skips rather than failing — a fixture
 * cannot be more complete than the release it comes from.
 */
export const LEGACY_VERSION = '8.23.0';

/** @type {Record<string, { asset: string, sha256: string, binary: string }>} */
const LEGACY_BUILDS = {
  'win32-x64': {
    asset: `gitleaks_${LEGACY_VERSION}_windows_x64.zip`,
    sha256: '89c8c8aa08a9050172d1b48616c96ce485cae2a23983429d7dce4b0ed82cdaef',
    binary: 'gitleaks.exe',
  },
  'win32-ia32': {
    asset: `gitleaks_${LEGACY_VERSION}_windows_x32.zip`,
    sha256: 'f26470f2f3027fd61f3f3af2353b8d7d058987765c215a7b6c3ae06b71532a2e',
    binary: 'gitleaks.exe',
  },
  'linux-x64': {
    asset: `gitleaks_${LEGACY_VERSION}_linux_x64.tar.gz`,
    sha256: 'd1c542f88efe2383469fef9c9bdddc809408ed8b5ba808b262720c03fddd8f8e',
    binary: 'gitleaks',
  },
  'linux-arm64': {
    asset: `gitleaks_${LEGACY_VERSION}_linux_arm64.tar.gz`,
    sha256: '8a921ff79e8d69349742981ea2c72f02a0a132e633da9d45036714ff676a7625',
    binary: 'gitleaks',
  },
  'linux-ia32': {
    asset: `gitleaks_${LEGACY_VERSION}_linux_x32.tar.gz`,
    sha256: '4a07a5424ef53ab5b5205c25f295dd08f2bf0fa1d5e46d6f0bec6b8b94666318',
    binary: 'gitleaks',
  },
  'linux-armv6': {
    asset: `gitleaks_${LEGACY_VERSION}_linux_armv6.tar.gz`,
    sha256: '8e913410b58c8a51ef13d48972b501e9d7f9c59e4124bda04285b2ce0d772a47',
    binary: 'gitleaks',
  },
  'linux-armv7': {
    asset: `gitleaks_${LEGACY_VERSION}_linux_armv7.tar.gz`,
    sha256: '0644c6247893d165e0c40ab1585cade9a4300761dda5c313d9b70c82bc900fc2',
    binary: 'gitleaks',
  },
  'darwin-arm64': {
    asset: `gitleaks_${LEGACY_VERSION}_darwin_arm64.tar.gz`,
    sha256: '9f02a8a0cb4731d2c9a134493d9a46035cdee5f81e1bebf11c4c1df0fd925ec8',
    binary: 'gitleaks',
  },
  'darwin-x64': {
    asset: `gitleaks_${LEGACY_VERSION}_darwin_x64.tar.gz`,
    sha256: 'b23d81c4cf059c7d5990a92522a5e34681b479c514bba90c3f881c31d90e67bc',
    binary: 'gitleaks',
  },
};

/** The family 8.23.0 misses under the shipped configuration. */
const EXPECTED_MISS = 'cloud-connection-string';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/**
 * A FOREIGN repository — the one a hook's environment would name — and what it holds before the canary runs.
 *
 * It stands in for the real repository a linked worktree's hook points `GIT_DIR` at (AAAAAAA-1). Built through
 * `ownRepositoryEnv` itself, so a `GIT_` variable in the environment running this proof cannot aim the fixture
 * somewhere else.
 *
 * @returns {{ root: string, config: () => string, index: () => Buffer, environment: Record<string, string> }}
 */
function foreignRepository() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-foreign-'));
  const git = (/** @type {string[]} */ args) => spawnSync('git', args, { cwd: root, env: ownRepositoryEnv() });
  git(['init', '-q']);
  git(['config', 'user.email', 'foreign@monstera.invalid']);
  git(['config', 'user.name', 'foreign']);
  writeFileSync(join(root, 'kept.txt'), 'the foreign repository’s own staged file\n', 'utf8');
  git(['add', 'kept.txt']);
  const gitDir = join(root, '.git');
  return {
    root,
    config: () => readFileSync(join(gitDir, 'config'), 'utf8'),
    index: () => readFileSync(join(gitDir, 'index')),
    // WHAT A PRE-COMMIT HOOK IN A LINKED WORKTREE EXPORTS, as absolute paths: GIT_DIR and GIT_INDEX_FILE, and no
    // GIT_WORK_TREE, so git takes the process's own directory as the work tree and stages ITS files into the index
    // named here. With GIT_WORK_TREE set as well, an unfixed canary re-stages the foreign file and rewrites an
    // identical index, and the index case below could not tell the bug from the fix.
    environment: { GIT_DIR: gitDir, GIT_INDEX_FILE: join(gitDir, 'index') },
  };
}

/**
 * Runs `work` with `extra` set in this process's environment, as a hook would have it, and restores it after.
 *
 * @template T
 * @param {Record<string, string>} extra
 * @param {() => T} work
 * @returns {T}
 */
function underEnvironment(extra, work) {
  const before = Object.fromEntries(Object.keys(extra).map((key) => [key, process.env[key]]));
  Object.assign(process.env, extra);
  try {
    return work();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

/** AAAAAAA-1's cases, which need no scanner: the corpus is built in its own repository whatever the hook exported. */
function corpusCases() {
  const foreign = foreignRepository();
  const corpus = mkdtempSync(join(tmpdir(), 'monstera-canary-proof-'));
  try {
    const [config, index] = [foreign.config(), foreign.index()];
    const families = underEnvironment(foreign.environment, () => buildCorpus(corpus));

    check(
      'with a FOREIGN repository named by GIT_DIR and GIT_INDEX_FILE, as a hook names it, its config is untouched',
      foreign.config() === config,
      `the canary wrote into the repository the environment named:\n${foreign.config()}\n      ` +
        `This is AAAAAAA-1: in a linked worktree a hook's GIT_DIR is that real repository.`,
    );
    check(
      'and its index is byte for byte what it was',
      foreign.index().equals(index),
      'the foreign index changed, so the canary staged its corpus there instead of in its own repository.',
    );

    // THE POSITIVE HALF, without which the two above pass for a canary that built nothing at all.
    const listed = spawnSync('git', ['ls-files'], { cwd: corpus, env: ownRepositoryEnv(), encoding: 'utf8' });
    const staged = listed.stdout.split('\n').filter((line) => line !== '').sort();
    const expected = families.map((family) => family.file).sort();
    check(
      'and the corpus is staged in ITS OWN repository, every family file in it',
      staged.length > 0 && JSON.stringify(staged) === JSON.stringify(expected),
      `the corpus's own index lists ${JSON.stringify(staged)}; the families are ${JSON.stringify(expected)}.`,
    );

    // THE HELPER ITSELF: every git variable gone, gitleaks' own kept, whatever the case of the key.
    const cleaned = ownRepositoryEnv({ GIT_DIR: 'a', git_index_file: 'b', GITLEAKS_CONFIG_TOML: 'c', PATH: 'd' });
    check(
      'ownRepositoryEnv drops every GIT_ variable in any case, and keeps GITLEAKS_ and the rest',
      JSON.stringify(cleaned) === JSON.stringify({ GITLEAKS_CONFIG_TOML: 'c', PATH: 'd' }),
      `it answered ${JSON.stringify(cleaned)}.`,
    );
  } finally {
    rmSync(corpus, { recursive: true, force: true });
    rmSync(foreign.root, { recursive: true, force: true });
  }
}

async function main() {
  corpusCases();

  const legacyPath = gitleaksBinaryPath({ version: LEGACY_VERSION, builds: LEGACY_BUILDS });
  if (legacyPath === '') {
    process.stdout.write(
      `  --  skipped: gitleaks ${LEGACY_VERSION} published no build for this platform, so the ` +
        `differential fixture cannot exist here.\n`,
    );
    // THE CORPUS CASES STILL COUNT: they need no scanner, so a platform without the old build reports them.
    return report();
  }

  // Control first. If the canary does not pass the PINNED build, a failure
  // against the old one says nothing — it would just mean the canary is broken.
  const pinnedBinary = await provisionGitleaks();
  const pinned = verifyScannerCapability({
    binary: pinnedBinary,
    pinnedVersion: GITLEAKS_VERSION,
    force: true,
  });
  check(
    `CONTROL: the pinned ${GITLEAKS_VERSION} build passes the canary`,
    pinned.ok,
    `${pinned.problems.join('\n      ')}\n      Without this, the case below cannot distinguish ` +
      `"the old scanner is weaker" from "the canary is broken".`,
  );

  // THE WHOLE CANARY under a hook's environment: gitleaks starts git too, and with GIT_INDEX_FILE inherited it scanned
  // the foreign index and found none of the corpus's families. So the canary must still pass, and leave it untouched.
  const foreign = foreignRepository();
  try {
    const index = foreign.index();
    const hooked = underEnvironment(foreign.environment, () =>
      verifyScannerCapability({ binary: pinnedBinary, pinnedVersion: GITLEAKS_VERSION, force: true }),
    );
    check(
      'under a FOREIGN repository’s GIT_ variables the pinned build still passes, scanning the corpus',
      hooked.ok,
      `${hooked.problems.join('\n      ')}\n      The scan read the repository the environment named.`,
    );
    check(
      'and the foreign index is untouched by the whole run',
      foreign.index().equals(index),
      'the foreign index changed during the canary run.',
    );
  } finally {
    rmSync(foreign.root, { recursive: true, force: true });
  }

  const legacy = await provisionGitleaks({ version: LEGACY_VERSION, builds: LEGACY_BUILDS });
  const verdict = verifyScannerCapability({
    binary: legacy,
    pinnedVersion: GITLEAKS_VERSION,
    force: true,
  });

  check(
    `the canary REJECTS gitleaks ${LEGACY_VERSION}`,
    !verdict.ok,
    `it passed. A build that runs the shipped invocation, exits like a healthy scan, and finds ` +
      `one family fewer is exactly what this check exists for — if it passes here, the check is ` +
      `only catching stubs.`,
  );

  check(
    'the rejection names the family that went missing',
    verdict.problems.some((problem) => problem.startsWith(`${EXPECTED_MISS} was NOT DETECTED`)),
    `problems were:\n      ${verdict.problems.join('\n      ') || '(none)'}\n      ` +
      `"the scanner failed" is not actionable; "${EXPECTED_MISS} was not detected" is.`,
  );

  check(
    'only that one family is missing, so the fixture still measures a NARROW difference',
    verdict.problems.length === 1,
    `${verdict.problems.length} problems reported. If the old build fails wholesale — no JSON ` +
      `report, unsupported flag — this proves the canary catches a broken invocation, not a ` +
      `weaker ruleset. 8.19.0 and 8.21.0 both failed that way and were rejected as fixtures.`,
  );

  check(
    'the old build reports its real version, and divergence is announced',
    verdict.version.includes(LEGACY_VERSION) &&
      divergenceNotice(verdict, GITLEAKS_VERSION).includes(LEGACY_VERSION),
    `version=${JSON.stringify(verdict.version)}. Silent divergence is the failure mode; the ` +
      `notice has to name what is actually in use.`,
  );

  check(
    'a rejected verdict is NOT cached',
    !verifyScannerCapability({ binary: legacy, pinnedVersion: GITLEAKS_VERSION }).cached,
    `a cached failure would be re-read as a verdict rather than re-measured, and the next run ` +
      `would inherit it without looking.`,
  );

  // Leave nothing behind: the fixture is a test artefact, not a provisioned tool.
  await rm(dirname(legacyPath), { recursive: true, force: true });

  return report();
}

/** Prints every case's outcome and answers the exit status: one place, so neither exit path can skip it. */
function report() {
  if (failures.length > 0) {
    process.stderr.write(
      `\nScanner canary proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        `\n\n`,
    );
    return 1;
  }

  for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
  process.stdout.write(`\n${passed.length} scanner canary cases passed.\n`);
  return 0;
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  },
);
