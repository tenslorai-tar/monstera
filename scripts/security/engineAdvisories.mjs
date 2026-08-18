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
const TRACKED_BASELINE = join(ROOT, 'docs', 'security', 'engine-advisories.json');

/**
 * The register to read. `--baseline <path>` points it at a fixture.
 *
 * This exists so `advisoryRegister.proof.mjs` can run the real checker against
 * deliberately broken registers **without editing the tracked one**. The
 * alternative — mutate `engine-advisories.json`, run, restore — leaves a
 * corrupt security register behind on any crash between the two steps.
 *
 * It is not an escape hatch, and the distinction is the one `MONSTERA_GITLEAKS`
 * failed: this changes *which* register is read, never *whether* a check runs.
 * Every rule below applies identically to whatever file it names, so pointing it
 * somewhere lenient requires writing a lenient register, which is exactly as
 * visible in a diff as editing the tracked one.
 */
const BASELINE = (() => {
  const flag = process.argv.indexOf('--baseline');
  const supplied = flag === -1 ? undefined : process.argv[flag + 1];
  return supplied === undefined ? TRACKED_BASELINE : resolve(supplied);
})();

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
/**
 * Verdicts that are not closed, and must be printed on every run.
 *
 * `UNDER REVIEW` is here because of the case that added it: a NOT-AFFECTED
 * verdict whose stated premise was later measured to be false. Marking it that
 * way put it in a state matching neither `UNTRIAGED` (so the build stayed green,
 * correctly — it HAS been triaged) nor this pattern (so it printed nowhere at
 * all). An entry visible in no output is one that has been closed by accident,
 * which is the failure this whole register exists to prevent.
 */
const OPEN_VERDICT = /^(AFFECTED|UNRESOLVED|UNDER REVIEW)/u;

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
 *   reachabilityControl: { symbol: string, from: string[], why: string }[],
 * }} Baseline
 * @returns {Baseline}
 */
/**
 * Reads the register, or throws.
 *
 * This used to wrap the parse in a bare `catch` returning an empty baseline,
 * and there is no bootstrapping case that justified it: `engine-advisories.json`
 * is tracked, so it exists in every checkout. The only states that `catch` could
 * actually reach were **missing** and **unparseable** — and it turned both into
 * a clean pass. A trailing comma from a hand-edit disarmed the entire
 * reachability mechanism and printed the identical silence to every verdict
 * holding.
 *
 * That is item 4b's corollary word for word: **an empty intermediate result is
 * a broken parse, not a clean input.** A register nobody can read is not a
 * register with nothing in it.
 *
 * `--refresh` throws here too, deliberately. A refresh that found no baseline
 * would rewrite the file with every entry marked UNTRIAGED, discarding every
 * triage verdict in it — recovering a deleted register is a `git checkout`, not
 * a regeneration.
 */
function readBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read the advisory register at ${BASELINE}: ${String(error)}\n` +
        'It is tracked, so it exists in every checkout. A missing register is not an ' +
        'empty one — restore it with git rather than regenerating it, which would ' +
        'discard every triage verdict.',
      { cause: error },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `The advisory register at ${BASELINE} is not valid JSON: ${String(error)}\n` +
        'This check reads its every claim from that file. Failing here is the ' +
        'point: the alternative is a hand-edit typo disarming the whole ' +
        'reachability mechanism while the output looks exactly like success.',
      { cause: error },
    );
  }

  /** @type {Baseline} */
  const baseline = { watch: {}, ...parsed };

  // Neither of these can be defaulted to empty. A verdict register with no
  // verdicts, and a walk with no control, are the two states whose output is
  // indistinguishable from everything being fine.
  if (typeof baseline.reachability !== 'object' || Object.keys(baseline.reachability).length === 0) {
    throw new Error(
      `The advisory register at ${BASELINE} declares no reachability verdicts.\n` +
        'Every NOT-REACHABLE verdict in it rests on one, so an empty map means the ' +
        'file was truncated or the key was renamed — not that nothing is watched.',
    );
  }
  if (!Array.isArray(baseline.reachabilityControl) || baseline.reachabilityControl.length === 0) {
    throw new Error(
      `The advisory register at ${BASELINE} declares no reachability controls.\n` +
        'The walk that resolves those verdicts reports "no references" for every way ' +
        'it can be broken, so without a symbol it is known to find, its silence about ' +
        'every other symbol is worthless.',
    );
  }

  return baseline;
}

/**
 * Fails when the reachability walk cannot find a symbol that is known to be
 * there.
 *
 * Every reachability verdict here is a **search**, and a search has one output
 * for every way it can be broken: *no references*. A path glob that matches
 * nothing, a symbol misspelt in the register, a `git grep` invoked from the
 * wrong root — all of them print the same reassuring result as a genuine
 * absence, and in this file "found nothing" is always the answer someone hoped
 * for (audit item 4b).
 *
 * A count of verdicts checked is necessary and not sufficient: a resolver that
 * reads no files at all still produces a count. What proves the walk can see
 * anything is an entry it is **known to be able to find**, asserted on every
 * run — the same control `DocumentService.checkWriteTarget` carries, for the
 * same reason.
 *
 * One control per distinct path glob any verdict names, because a control that
 * proves the `native` glob resolves says nothing about whether the `apps` one
 * does, and the entry scanning `apps` is the one whose blindness would be
 * silent — `kernel-error-path-sanitisation` names that glob and no other.
 * The coverage requirement is derived from the verdicts rather than listed, so
 * a new verdict naming a new glob demands a control instead of inheriting one.
 *
 * @param {Baseline} baseline
 * @returns {{ failures: string[], found: number }}
 */
function brokenReachabilityControls(baseline) {
  /** @type {string[]} */
  const failures = [];
  let found = 0;

  for (const control of baseline.reachabilityControl) {
    /** @type {import('../lib/verdict.mjs').Input[]} */
    const inputs = [{ absent: control.symbol, from: control.from, why: control.why }];
    const detail = digestInputs(inputs, { root: ROOT }).inputs[0]?.detail ?? '';
    if (detail === 'no references') {
      failures.push(
        `${control.symbol} was NOT found in ${control.from.join(', ')}, and it is the ` +
          `control for those paths.\n` +
          `      Expected: present. This says the WALK is broken, not that the symbol is gone —\n` +
          `      and while it is broken, every "no references" this check prints is worthless.\n` +
          `      Why this symbol: ${control.why}`,
      );
      continue;
    }
    found += 1;
  }

  // Every glob a verdict scans must have a control proving that glob resolves.
  const controlled = new Set(baseline.reachabilityControl.flatMap((control) => control.from));
  const uncontrolled = [
    ...new Set(Object.values(baseline.reachability).flatMap((claim) => claim.shippedPaths)),
  ].filter((glob) => !controlled.has(glob));
  for (const glob of uncontrolled) {
    failures.push(
      `${glob} is scanned by a reachability verdict and has no control.\n` +
        `      Add one to reachabilityControl naming a symbol known to be present there.\n` +
        `      Without it, a glob that matches no files reads as a clean verdict.`,
    );
  }

  return { failures, found };
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
          // Carried through explicitly. A refresh that dropped the controls
          // would leave the walk unverified while every other check kept
          // passing, which is the failure the controls exist to make loud.
          reachabilityControl: baseline.reachabilityControl,
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
    OPEN_VERDICT.test(baseline.reviewed[advisory.id] ?? ''),
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

  // Can the walk see anything at all? Asked BEFORE asking what it found, for
  // the same reason the OCR door drift is: "your instrument is blind" has to be
  // reported before "your instrument found nothing", because the second
  // statement means nothing while the first is outstanding.
  const controls = brokenReachabilityControls(baseline);
  if (controls.failures.length > 0) {
    process.stderr.write(
      `\nThe reachability walk failed its own control(s):\n\n` +
        controls.failures.map((entry) => `  - ${entry}`).join('\n\n') +
        `\n\nEvery verdict below rests on this walk reporting "no references" honestly. ` +
        `A broken walk reports exactly that, for every symbol, on every run — which is ` +
        `why it must first find something it is known to be able to find.\n\n`,
    );
    return 1;
  }

  const symbolCount = Object.entries(baseline.reachability).reduce(
    (total, [name, claim]) => total + (claim.symbols ?? [name]).length,
    0,
  );
  if (symbolCount === 0) {
    process.stderr.write(
      `\nThe reachability verdicts name no symbols at all, so nothing was searched for.\n\n`,
    );
    return 1;
  }
  process.stdout.write(
    `  ok  reachability walk: ${controls.found} control(s) found, ` +
      `${Object.keys(baseline.reachability).length} verdict(s) / ${symbolCount} symbol(s) checked\n`,
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

  const watchOpen = watchEntries.filter(([, verdict]) => OPEN_VERDICT.test(verdict));
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
