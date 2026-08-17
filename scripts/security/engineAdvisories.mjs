// @ts-check
/**
 * Tracks published advisories against the native engine, and fails when one has
 * not been looked at.
 *
 * ## What this deliberately does NOT do
 *
 * It does not decide whether this application is exploitable. The advisory data
 * available for MuPDF is keyed to *distribution* packages — OSV carries 57
 * entries under `Debian:12` and none under a bare `mupdf` name — and Debian's
 * package versions do not map onto upstream releases. Deriving "1.28.0 is
 * affected" from a Debian version range would be a manufactured verdict, and a
 * manufactured verdict is worse than no verdict: it is believed.
 *
 * So the check answers the question it can answer honestly: **has every
 * published advisory been triaged against our pinned version by a human, with
 * the reasoning written down?** New advisory, no recorded triage, build red.
 *
 * That is the same discipline the signature work will need later — validate the
 * chain or return no verdict, never a green tick that means "did not check".
 *
 * ## HOW TO TRIAGE — read this before recording any verdict
 *
 * A verdict is established from UPSTREAM COMMIT HISTORY, never from the CVE text.
 * The first triage on this project got CVE-2026-7233 wrong by reading the CVE,
 * which says "up to 1.28.0" — and reading that as "1.28.0 is affected". It is
 * not: the fixing commits (Artifex bugs 709364, 709365) landed 2026-05-13,
 * before 1.28.0 shipped on 2026-06-26, and are in the source we build. "Up to X"
 * is the upper bound KNOWN AT REPORT TIME, not a statement that release X ships
 * the bug.
 *
 * The procedure, per advisory:
 *   1. Find the fixing commit(s) upstream — the actual diff, in the file the
 *      advisory names.
 *   2. Check whether that commit is in the pinned source tree
 *      (.tools/mupdf/<version>): grep the fix into the file, do not infer it
 *      from a version number.
 *   3. If fixed in our tree -> NOT-AFFECTED, citing the commit.
 *      If not -> AFFECTED or UNRESOLVED, and whether it is REACHABLE here (does
 *      any code path we ship call the vulnerable function?).
 * A Debian version range is a distribution mapping and is NOT upstream history;
 * it does not establish a verdict for our source build.
 *
 * ## COVERAGE HOLE this closes
 *
 * Advisory feeds only see published CVEs. For this upstream, a memory-safety fix
 * often lands as a bug-tracker commit with no CVE and no release for weeks —
 * Artifex bug 709567 (a CFF2 memory OVERWRITE, more serious than the over-read
 * above) is fixed only on master and appears in no advisory feed at all. So the
 * baseline also tracks upstream commits/bugs under a `watch` key, checked the
 * same way: is the fix in our pinned tree, and does it reach us. These are the
 * normal case for this project, not the exception.
 *
 * ## Why this exists at all
 *
 * MuPDF is compiled into the shim and parses the single largest thing an
 * attacker controls in this application. It is pinned at 1.28.0 and pinning is
 * correct — it makes builds reproducible — but a pin with nothing watching it is
 * how a project ships a known-vulnerable parser for a year.
 *
 * Usage:
 *   node scripts/security/engineAdvisories.mjs           check
 *   node scripts/security/engineAdvisories.mjs --refresh rewrite the baseline
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MUPDF_VERSION } from '../provision/mupdf.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASELINE = join(ROOT, 'docs', 'security', 'engine-advisories.json');

/**
 * OSV's Debian ecosystem is the only source that carries MuPDF advisories in a
 * queryable form. The ecosystem is an addressing detail, not a claim that this
 * project ships Debian's build.
 */
const QUERY = { package: { name: 'mupdf', ecosystem: 'Debian:12' } };

/** @returns {Promise<{id: string, summary: string, published: string}[]>} */
async function fetchAdvisories() {
  const response = await fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(QUERY),
  });
  if (!response.ok) {
    throw new Error(`OSV returned HTTP ${response.status} ${response.statusText}`);
  }
  const body = /** @type {{vulns?: {id: string, summary?: string, published?: string, aliases?: string[]}[]}} */ (
    await response.json()
  );
  return (body.vulns ?? [])
    .map((vuln) => ({
      id: vuln.id,
      summary: (vuln.summary ?? vuln.aliases?.join(', ') ?? '').slice(0, 200),
      published: vuln.published ?? '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @typedef {{
 *   version: string,
 *   reviewed: Record<string, string>,
 *   watch: Record<string, string>,
 *   reachability: Record<string, { guards: string[], why: string, shippedPaths: string[] }>,
 * }} Baseline
 * @returns {Baseline}
 */
function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8'));
    return { watch: {}, reachability: {}, ...parsed };
  } catch {
    return { version: MUPDF_VERSION, reviewed: {}, watch: {}, reachability: {} };
  }
}

/**
 * Fails when a verdict that rests on "we never call that function" stops being
 * true.
 *
 * A NOT-REACHABLE verdict is a claim about THIS codebase at THIS moment, not
 * about the engine, and it expires silently the moment a feature calls the
 * function. Two verdicts here rest on `pdf_subset_fonts` being uncalled —
 * including Artifex bug 709567, a memory OVERWRITE that no release fixes — and
 * `pdf_subset_fonts` is exactly what an optimise or export feature will call.
 * Enabling subsetting would inherit a live memory-safety bug with no signal.
 *
 * This is finding 32's lesson: "the blast radius is empty today" is not a
 * verdict, because ordinary progress fills it and nobody re-reads the finding
 * when it does. So each such verdict names the symbol its truth depends on, and
 * the symbol is checked against the paths that actually ship.
 *
 * @param {Baseline} baseline
 * @returns {string[]} One entry per expired verdict.
 */
function expiredReachabilityVerdicts(baseline) {
  /** @type {string[]} */
  const expired = [];

  for (const [symbol, claim] of Object.entries(baseline.reachability)) {
    /** @type {string[]} */
    const found = [];

    for (const globPath of claim.shippedPaths) {
      // `git grep` over tracked files only: a build artefact or a vendored
      // upstream tree under .tools/ is not something we ship, and matching it
      // would make this fire constantly and be turned off.
      const result = spawnSync(
        'git',
        ['grep', '-l', '--fixed-strings', '-e', symbol, '--', globPath],
        { cwd: ROOT, encoding: 'utf8' },
      );
      // Exit 1 means "no match", which is the expected, healthy case.
      if (result.status === 0) {
        found.push(...`${result.stdout}`.split('\n').filter((line) => line.length > 0));
      }
    }

    if (found.length > 0) {
      expired.push(
        `${symbol} is now referenced from shipped code:\n` +
          found.map((file) => `        ${file}`).join('\n') +
          `\n      This INVALIDATES the NOT-REACHABLE half of: ${claim.guards.join(', ')}\n` +
          `      The verdict said: ${claim.why}\n` +
          `      Re-triage those entries against ${MUPDF_VERSION} before shipping the feature ` +
          `that calls it.`,
      );
    }
  }
  return expired;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const baseline = readBaseline();

  /** @type {{id: string, summary: string, published: string}[]} */
  let advisories;
  try {
    advisories = await fetchAdvisories();
  } catch (error) {
    // A network failure is NOT a pass. Saying so out loud is the whole point:
    // "could not check" and "nothing to report" must never print the same way.
    process.stderr.write(
      `\nCould not reach the advisory database: ${String(error)}\n\n` +
        `This is reported as a failure rather than skipped. A security check that ` +
        `passes when it could not run is a green tick meaning "did not look".\n\n`,
    );
    return 1;
  }

  if (refresh) {
    /** @type {Record<string, string>} */
    const reviewed = { ...baseline.reviewed };
    for (const advisory of advisories) {
      reviewed[advisory.id] ??= 'UNTRIAGED — record the verdict for our pinned version here';
    }
    writeFileSync(
      BASELINE,
      `${JSON.stringify({ version: MUPDF_VERSION, generated: advisories.length, reviewed, watch: baseline.watch }, null, 2)}\n`,
      'utf8',
    );
    process.stderr.write(`Wrote ${Object.keys(reviewed).length} advisories to ${BASELINE}\n`);
    return 0;
  }

  if (baseline.version !== MUPDF_VERSION) {
    process.stderr.write(
      `\nThe advisory baseline was recorded against MuPDF ${baseline.version}, but the pinned ` +
        `version is now ${MUPDF_VERSION}.\n\nEvery triage verdict below was reached about a ` +
        `different parser. Re-run with --refresh and review them again.\n\n`,
    );
    return 1;
  }

  const untriaged = advisories.filter(
    (advisory) =>
      baseline.reviewed[advisory.id] === undefined ||
      /^UNTRIAGED/.test(baseline.reviewed[advisory.id] ?? ''),
  );

  if (untriaged.length > 0) {
    process.stderr.write(
      `\n${untriaged.length} MuPDF advisory/advisories have no recorded verdict for ` +
        `${MUPDF_VERSION}:\n\n` +
        untriaged
          .map((a) => `  ${a.id}${a.published ? ` (${a.published.slice(0, 10)})` : ''}\n      ${a.summary || '(no summary)'}`)
          .join('\n\n') +
        `\n\nTriage each in ${BASELINE}: state whether ${MUPDF_VERSION} is affected and why.\n` +
        `This check does not decide that for you — the data is keyed to distribution\n` +
        `packages whose versions do not map onto upstream releases, so any automatic\n` +
        `verdict would be manufactured.\n\n`,
    );
    return 1;
  }

  // Triaged is not the same as harmless. An advisory that DOES affect the pinned
  // version passes this gate — blocking every build until upstream ships a fix
  // would be a permanently red check, and those get ignored — but it is printed
  // on every run rather than filed away. An open security item that stops being
  // visible has been closed by accident.
  const open = advisories.filter((advisory) =>
    /^(AFFECTED|UNRESOLVED)/.test(baseline.reviewed[advisory.id] ?? ''),
  );

  process.stdout.write(
    `  ok  ${advisories.length} MuPDF advisories, all triaged against ${MUPDF_VERSION}\n`,
  );

  if (open.length > 0) {
    process.stdout.write(
      `\n  ${open.length} advisory/advisories are NOT closed for ${MUPDF_VERSION}:\n\n` +
        open
          .map((advisory) => `    ${advisory.id}\n      ${baseline.reviewed[advisory.id] ?? ''}`)
          .join('\n\n') +
        `\n`,
    );
  }

  // Upstream fixes with no CVE and no release. These are curated by hand — no
  // feed carries them — and every entry must have a verdict, exactly like an
  // advisory. An UNTRIAGED watch item fails the build; an open one is printed.
  const watchEntries = Object.entries(baseline.watch);
  const watchUntriaged = watchEntries.filter(([, verdict]) => /^UNTRIAGED/.test(verdict));
  if (watchUntriaged.length > 0) {
    process.stderr.write(
      `\n${watchUntriaged.length} watched upstream item(s) have no verdict:\n\n` +
        watchUntriaged.map(([id]) => `  ${id}`).join('\n') +
        `\n\nThese are memory-safety fixes with no CVE. Triage from upstream history.\n\n`,
    );
    return 1;
  }

  // Verdicts that rest on unreachability expire when the code changes under
  // them. Checked LAST so its message is the final thing printed.
  const expired = expiredReachabilityVerdicts(baseline);
  if (expired.length > 0) {
    process.stderr.write(
      `\n${expired.length} reachability claim(s) have EXPIRED:\n\n` +
        expired.map((entry) => `  - ${entry}`).join('\n\n') +
        `\n\nA NOT-REACHABLE verdict is a statement about this codebase, not about the engine. ` +
        `It stops being true the moment a feature calls the function, and nothing re-reads the ` +
        `verdict when that happens — which is why it is checked rather than remembered.\n\n`,
    );
    return 1;
  }

  const watchOpen = watchEntries.filter(([, verdict]) => /^(AFFECTED|UNRESOLVED)/.test(verdict));
  if (watchOpen.length > 0) {
    process.stdout.write(
      `\n  ${watchOpen.length} watched upstream item(s), not in any release:\n\n` +
        watchOpen.map(([id, verdict]) => `    ${id}\n      ${verdict}`).join('\n\n') +
        `\n`,
    );
  } else if (watchEntries.length > 0) {
    process.stdout.write(`  ok  ${watchEntries.length} watched upstream item(s), all resolved\n`);
  }

  return 0;
}

// Set exitCode and let the event loop drain, rather than process.exit(). Node's
// fetch keeps its socket in a pool with a live teardown timer, and forcing exit
// mid-teardown trips a libuv assertion (`UV_HANDLE_CLOSING`, async.c:76) that
// surfaces as a spurious exit 127 AFTER the real output — a green check reported
// as a crash. Draining naturally avoids it; the pool's timer is unref'd, so the
// process still exits promptly.
main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    process.stderr.write(`\n${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
