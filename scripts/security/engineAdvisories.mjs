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

/** @returns {{version: string, reviewed: Record<string, string>}} */
function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    return { version: MUPDF_VERSION, reviewed: {} };
  }
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
      `${JSON.stringify({ version: MUPDF_VERSION, generated: advisories.length, reviewed }, null, 2)}\n`,
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
  return 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`\n${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
