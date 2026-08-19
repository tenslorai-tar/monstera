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

import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { divergenceNotice, verifyScannerCapability } from './scannerCanary.mjs';
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

async function main() {
  const legacyPath = gitleaksBinaryPath({ version: LEGACY_VERSION, builds: LEGACY_BUILDS });
  if (legacyPath === '') {
    process.stdout.write(
      `  --  skipped: gitleaks ${LEGACY_VERSION} published no build for this platform, so the ` +
        `differential fixture cannot exist here.\n`,
    );
    return 0;
  }

  // Control first. If the canary does not pass the PINNED build, a failure
  // against the old one says nothing — it would just mean the canary is broken.
  const pinned = verifyScannerCapability({
    binary: await provisionGitleaks(),
    pinnedVersion: GITLEAKS_VERSION,
    force: true,
  });
  check(
    `CONTROL: the pinned ${GITLEAKS_VERSION} build passes the canary`,
    pinned.ok,
    `${pinned.problems.join('\n      ')}\n      Without this, the case below cannot distinguish ` +
      `"the old scanner is weaker" from "the canary is broken".`,
  );

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
