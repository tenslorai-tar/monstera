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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestInputs } from '../lib/verdict.mjs';
import { MUPDF_VERSION, mupdfSourcePath } from '../provision/mupdf.mjs';
import { declaredNativeComponents } from '../release/generateNotice.mjs';
import { deriveOcrDoors } from './ocrDoors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASELINE = join(ROOT, 'docs', 'security', 'engine-advisories.json');

/**
 * The components this watches, and the name each is addressable by.
 *
 * OSV's Debian ecosystem is the only source carrying these in a queryable form.
 * The ecosystem is an addressing detail, not a claim that this project ships
 * Debian's builds — the module header explains why that is precisely why no
 * verdict may be derived from a Debian version range.
 *
 * MuPDF is not the only parser compiled into the shim. `libtesseract` and
 * `libleptonica` are on the shim's link line, both are statically linked into
 * the shipped DLL, and both have real advisory histories — 4 and 13 entries.
 * Watching only MuPDF left two parsers with no baseline at all, which is not the
 * same as their having nothing outstanding: Tesseract has two heap memory-safety
 * advisories published 2026-08-11 and fixed in 5.5.3, and MuPDF 1.28.0 vendors
 * 5.5.2.
 */
const ADVISORY_SOURCES = [
  { component: 'MuPDF', package: 'mupdf' },
  { component: 'Tesseract', package: 'tesseract' },
  // Debian packages Leptonica as `leptonlib`. Querying `leptonica` returns zero
  // results and would have read as "no advisories" rather than "wrong name".
  { component: 'Leptonica', package: 'leptonlib' },
];

/**
 * @typedef {{ id: string, component: string, summary: string, published: string }} Advisory
 */

/** @param {string} name @returns {Promise<{id: string, summary?: string, published?: string, aliases?: string[]}[]>} */
async function queryOsv(name) {
  const response = await fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { name, ecosystem: 'Debian:12' } }),
  });
  if (!response.ok) {
    throw new Error(`OSV returned HTTP ${response.status} ${response.statusText} for ${name}`);
  }
  const body = /** @type {{vulns?: {id: string, summary?: string, published?: string, aliases?: string[]}[]}} */ (
    await response.json()
  );
  return body.vulns ?? [];
}

/** @returns {Promise<Advisory[]>} */
async function fetchAdvisories() {
  /** @type {Advisory[]} */
  const all = [];
  for (const source of ADVISORY_SOURCES) {
    const vulns = await queryOsv(source.package);
    if (vulns.length === 0) {
      // Every one of these packages is known to carry advisories. An empty
      // result means the name stopped resolving, and "no advisories" is the
      // most dangerous thing this check could print without noticing.
      throw new Error(
        `OSV returned no advisories for ${source.package} (${source.component}). Every watched ` +
          `component has a published history, so an empty result is a broken query, not a clean ` +
          `bill of health.`,
      );
    }
    for (const vuln of vulns) {
      all.push({
        id: vuln.id,
        component: source.component,
        summary: (vuln.summary ?? vuln.aliases?.join(', ') ?? '').slice(0, 200),
        published: vuln.published ?? '',
      });
    }
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @typedef {{
 *   version: string,
 *   bundledVersions?: Record<string, string>,
 *   reviewed: Record<string, string>,
 *   watch: Record<string, string>,
 *   reachability: Record<string, {
 *     guards: string[],
 *     why: string,
 *     shippedPaths: string[],
 *     symbols?: string[],
 *   }>,
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

  for (const [name, claim] of Object.entries(baseline.reachability)) {
    // A claim may rest on one symbol or on a whole door set. OCR is the second
    // kind: eleven public functions reach Tesseract, and a verdict resting on
    // only the obvious one would survive a feature calling any of the other ten.
    const symbols = claim.symbols ?? [name];

    // The inputs this verdict rests on, declared rather than re-implemented.
    // scripts/lib/verdict.mjs owns how an "absent symbol" input is resolved and
    // digested, so this call site cannot quietly disagree with the scanner
    // canary about what "the inputs changed" means — they were two hand-rolled
    // copies of one idea before the third instance made it a class.
    for (const symbol of symbols) {
      /** @type {import('../lib/verdict.mjs').Input[]} */
      const inputs = [{ absent: symbol, from: claim.shippedPaths, why: claim.why }];
      const resolved = digestInputs(inputs, { root: ROOT });
      const detail = resolved.inputs[0]?.detail ?? '';
      if (detail === 'no references') continue;

      expired.push(
        `${symbol} is now referenced from shipped code:\n` +
          `        ${detail.replace(/^referenced by /, '').split(', ').join('\n        ')}\n` +
          `      This INVALIDATES the NOT-REACHABLE half of: ${claim.guards.join(', ')}\n` +
          `      The verdict said: ${claim.why}\n` +
          `      Re-triage those entries before shipping the feature that calls it.`,
      );
    }
  }
  return expired;
}

/**
 * Fails when the OCR door set the register names is not the set the engine
 * source actually has.
 *
 * The `reachability` mechanism above is only as sound as the symbol list it is
 * given, and a hand-written list of doors is a claim of exactly the kind the
 * verdict it supports is: correct when written, unreviewed when MuPDF adds an
 * entry point. So the list is derived from the compiled source and compared.
 *
 * Under-declaring is the failure that matters — a door nobody watches — but
 * over-declaring is reported too, because a symbol that is not a door makes the
 * check fire on innocent code, and a check that fires on innocent code is the
 * one someone eventually switches off.
 *
 * Skipped, and reported as skipped, without the provisioned source.
 *
 * @param {Baseline} baseline
 * @returns {{ checked: boolean, missing: string[], extra: string[] }}
 */
function ocrDoorDrift(baseline) {
  const source = mupdfSourcePath(ROOT);
  const shimProject = join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');
  if (!existsSync(join(source, 'source', 'fitz', 'tessocr.h')) || !existsSync(shimProject)) {
    return { checked: false, missing: [], extra: [] };
  }

  const derived = deriveOcrDoors(source, shimProject);
  const declared = baseline.reachability['ocr']?.symbols ?? [];
  return {
    checked: true,
    missing: derived.doors.filter((door) => !declared.includes(door)),
    extra: declared.filter((symbol) => !derived.doors.includes(symbol)),
  };
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const baseline = readBaseline();

  /** @type {Advisory[]} */
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
      `${JSON.stringify(
        {
          version: MUPDF_VERSION,
          bundledVersions: baseline.bundledVersions,
          generated: advisories.length,
          reviewed,
          watch: baseline.watch,
          reachability: baseline.reachability,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stderr.write(`Wrote ${Object.keys(reviewed).length} advisories to ${BASELINE}\n`);
    return 0;
  }

  // The bundled parsers have their own versions, and a triage verdict is about
  // a version. They are read from nativeComponents.json rather than restated
  // here: that file records where each was read from in the source tree, so the
  // pin has one home and a MuPDF bump that changes a vendored library turns this
  // red instead of leaving verdicts attached to a parser nobody ships any more.
  const bundled = declaredNativeComponents().find((component) => component.name === 'MuPDF')?.licences ?? {};
  /** @type {string[]} */
  const movedVersions = [];
  for (const [name, recorded] of Object.entries(baseline.bundledVersions ?? {})) {
    const current = bundled[name]?.version;
    if (current !== recorded) {
      movedVersions.push(`${name}: triaged against ${recorded}, now ${current ?? '(not recorded)'}`);
    }
  }
  if (movedVersions.length > 0) {
    process.stderr.write(
      `\nA bundled parser's version has moved since its advisories were triaged:\n\n` +
        movedVersions.map((entry) => `  ${entry}\n`).join('') +
        `\nEvery verdict for that component was reached about different code. Re-triage from ` +
        `upstream history and update docs/security/engine-advisories.json.\n\n`,
    );
    return 1;
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
      `\n${untriaged.length} advisory/advisories have no recorded verdict:\n\n` +
        untriaged
          .map(
            (a) =>
              `  ${a.id} [${a.component}]${a.published ? ` (${a.published.slice(0, 10)})` : ''}\n` +
              `      ${a.summary || '(no summary)'}`,
          )
          .join('\n\n') +
        `\n\nTriage each in ${BASELINE}: state whether the vendored version is affected and why.\n` +
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

  const perComponent = ADVISORY_SOURCES.map(
    (source) =>
      `${advisories.filter((a) => a.component === source.component).length} ${source.component}`,
  ).join(', ');
  process.stdout.write(`  ok  ${advisories.length} advisories (${perComponent}), all triaged\n`);

  if (open.length > 0) {
    process.stdout.write(
      `\n  ${open.length} advisory/advisories are NOT closed:\n\n` +
        open
          .map(
            (advisory) =>
              `    ${advisory.id} [${advisory.component}]\n      ${baseline.reviewed[advisory.id] ?? ''}`,
          )
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

  // The door set a reachability verdict rests on, checked against the engine
  // rather than trusted. Runs before the expiry check so that "your list is
  // wrong" is reported before "nothing on your list was called" — the second
  // statement is worthless while the first is outstanding.
  const drift = ocrDoorDrift(baseline);
  if (drift.missing.length > 0 || drift.extra.length > 0) {
    process.stderr.write(
      `\nThe OCR door set in ${BASELINE} does not match the engine source:\n\n` +
        (drift.missing.length > 0
          ? `  reaches OCR, not declared: ${drift.missing.join(', ')}\n` +
            `    Each of these is a public function that can reach Tesseract, and the ` +
            `NOT-REACHABLE verdict does not watch it.\n`
          : '') +
        (drift.extra.length > 0
          ? `  declared, reaches nothing: ${drift.extra.join(', ')}\n` +
            `    A symbol that is not a door makes this check fire on innocent code.\n`
          : '') +
        `\nRun: node scripts/security/ocrDoors.mjs — it prints each door with its call chain.\n\n`,
    );
    return 1;
  }

  process.stdout.write(
    drift.checked
      ? `  ok  ${(baseline.reachability['ocr']?.symbols ?? []).length} OCR doors match the engine source\n`
      : `  --  OCR door set NOT verified here — MuPDF source not provisioned\n`,
  );

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
