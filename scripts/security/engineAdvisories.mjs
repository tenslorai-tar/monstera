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
 *   node scripts/security/engineAdvisories.mjs
 *       check, against the LIVE feed. This is what ships.
 *   node scripts/security/engineAdvisories.mjs --refresh
 *       rewrite the baseline
 *   node scripts/security/engineAdvisories.mjs --require-derivation
 *       fail rather than report UNVERIFIABLE when the OCR doors cannot be
 *       derived. Passed by the one job that provisions the MuPDF source.
 *   node scripts/security/engineAdvisories.mjs --record-advisories
 *       fetch the live feed once and write it to the tracked recording, then
 *       exit. The only way that file is written, so a recording is always
 *       something a live query produced.
 *   node scripts/security/engineAdvisories.mjs --recorded-advisories
 *       read the recording instead of fetching. An INPUT SUBSTITUTE for callers
 *       whose subject is the register, never for the shipped check: a security
 *       check reading a snapshot reports the world as it was on the day someone
 *       recorded it. `advisoryRegister.proof.mjs` asserts the shipped script
 *       does not pass this.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestInputs } from '../lib/verdict.mjs';
import { formatError } from '../lib/reportError.mjs';
import { MUPDF_VERSION, mupdfSourcePath } from '../provision/mupdf.mjs';
import { declaredNativeComponents } from '../release/generateNotice.mjs';
import { declaredSymbols, watchedSymbols } from './claimSymbols.mjs';
import { DERIVED_CLAIMS } from './derivedClaims.mjs';
import { deriveOcrDoors } from './ocrDoors.mjs';
import { readElectronSurface } from './electronSurface.mjs';

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
 * A recorded OSV response, for callers whose subject is the register rather than
 * the feed.
 *
 * ## Why this exists — a guard whose red can mean something else
 *
 * `advisoryRegister.proof.mjs` runs this checker against ~20 deliberately broken
 * registers. Every one of those runs fetched OSV live, so a single proof run
 * reached a third party dozens of times, and `fetchAdvisories` **throws on any
 * non-OK status by design** — correctly, since a security check that passes when
 * it could not look is a green tick meaning *did not look*. The consequence is
 * that the proof could go red for a reason that has nothing to do with what it
 * proves. Measured on 2026-08-22: Guards failed at `a0d2ec0` on windows-latest
 * with ubuntu-latest green, at a step whose register, checker and proof were
 * byte-identical to the green run three commits later on the same platform.
 *
 * A red that can mean something other than what it says is one people re-run,
 * and a check people re-run is one people eventually disable. Removing a second
 * opinion about a third party's availability from a check that was never about
 * it is not "retrying until green" — it is deleting an input the subject never
 * had.
 *
 * ## Why there is no path argument, unlike `--baseline`
 *
 * `--baseline` changes *which register* is read and every rule still applies to
 * it, so pointing it somewhere lenient means writing a lenient register — as
 * visible in a diff as editing the tracked one. **This flag is different in
 * kind:** it substitutes what the checker *sees of the outside world*, and a
 * stale or trimmed feed hides advisories rather than announcing them. So it
 * takes no argument and can only ever name this one reviewed, tracked file —
 * B5, rather than a check that the supplied path is acceptable.
 *
 * The shipped `check:advisories` must never pass it, and
 * `advisoryRegister.proof.mjs` asserts that against the tracked `package.json`.
 */
const RECORDED_ADVISORIES = join(
  ROOT,
  'packages',
  'testing',
  'fixtures',
  'security',
  'osv-recorded.json',
);

/**
 * @returns {Advisory[]}
 */
function readRecordedAdvisories() {
  const parsed = JSON.parse(readFileSync(RECORDED_ADVISORIES, 'utf8'));
  // An empty intermediate result is a broken parse, not a clean input. An empty
  // recording would make every register look fully triaged — the reassuring
  // answer — which is the same failure `fetchAdvisories` refuses for a live
  // query returning nothing.
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      `The recorded advisory feed at ${RECORDED_ADVISORIES} is empty or is not an array. ` +
        `That is a broken recording, not a clean bill of health: every watched component has a ` +
        `published history. Re-record it with --record-advisories.`,
    );
  }
  return parsed;
}

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
 * ## What belongs in the `reachability` register, and what does not
 *
 * **Use this register when the expiry is a CODE MOVEMENT. Use a
 * `docs/FEATURES.md` row when the expiry is an EVENT.**
 *
 * The whole mechanism here is *"the day shipped code names X, this verdict
 * expires and the build goes red"*. That is a symbol scan, so it can only see
 * something a scan can see. A claim waiting on packaging, on a release, on an
 * elevated read, or on a stage beginning has nothing for it to look at — and
 * parking one here produces the worst object this file can hold: a verdict that
 * will never fire, sitting green, reading as coverage.
 *
 * Measured against this file's own history. `engine-host-containment` watched
 * `utilityProcess`; ADR-0022 then moved the hosts to `CreateProcessW`, so the
 * symbol could no longer appear and the trigger went dead without changing.
 * It was re-pointed on 2026-08-22. Premise P1 — whether the Store install root
 * grants application packages read and execute — was considered for this
 * register at the same time and **refused**, because its three expiry
 * conditions are all events; it lives on the packaging row instead.
 *
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
 *     witness?: Record<string, {
 *       in: string[] | null,
 *       acceptedWhile?: { absent: string, from: string[] },
 *       why: string,
 *     }>,
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
/**
 * The keys this register cannot be read without, and what an absent or empty
 * one actually means.
 *
 * This is a table rather than four `if` blocks because the first two guards
 * were written one at a time, in response to one instance each, and the third
 * key went on being guarded by accident: `reviewed` was defaulted from a spread
 * and would arrive `undefined` from a truncated file, at which point the
 * untriaged filter died on a `TypeError` instead of naming the register.
 *
 * That was loud enough to notice — but only while the advisory feed returns
 * entries, which is exactly the condition that made the *previous* accidental
 * control conditional. A truncated register plus an empty feed is the same
 * compound clean pass, reached through a different key. Enumerating the keys
 * closes the class; adding a third `if` would have closed three-quarters of it.
 *
 * `emptyMeans: null` marks a key that may legitimately be empty. `watch` is
 * hand-curated and "nothing is currently watched upstream" is a real state; its
 * KEY still has to be present, because that is what distinguishes it from a
 * file that lost the section.
 *
 * @type {readonly { key: string, array: boolean, emptyMeans: string | null, why: string }[]}
 */
const LOAD_BEARING_KEYS = [
  {
    key: 'reviewed',
    array: false,
    emptyMeans: 'declares no triaged advisories',
    why:
      'Every published advisory has a recorded verdict here. An empty map means the ' +
      'file was truncated, not that nothing needed triage — and it reads as "nothing ' +
      'needed triage" the moment the advisory feed returns zero entries, which has ' +
      'already happened once to this project under a renamed package key.',
  },
  {
    key: 'watch',
    array: false,
    emptyMeans: null,
    why:
      'Upstream fixes with no CVE and no release. Zero of them is a real state, so an ' +
      'empty map is legitimate; a missing KEY is a file that lost the section.',
  },
  {
    key: 'reachability',
    array: false,
    emptyMeans: 'declares no reachability verdicts',
    why:
      'Every NOT-REACHABLE verdict rests on one, so an empty map means the file was ' +
      'truncated or the key was renamed — not that nothing is watched.',
  },
  {
    key: 'reachabilityControl',
    array: true,
    emptyMeans: 'declares no reachability controls',
    why:
      'The walk that resolves those verdicts reports "no references" for every way it ' +
      'can be broken, so without a symbol it is known to find, its silence about every ' +
      'other symbol is worthless.',
  },
];

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
  const baseline = /** @type {Baseline} */ (parsed);

  for (const rule of LOAD_BEARING_KEYS) {
    const value = /** @type {Record<string, unknown>} */ (parsed)[rule.key];
    // `typeof null === 'object'`, so null must be excluded explicitly — a
    // `"reviewed": null` would otherwise pass the shape check and die later on
    // a TypeError, which is the exact failure mode this table exists to end.
    if (
      value === null ||
      value === undefined ||
      (rule.array ? !Array.isArray(value) : typeof value !== 'object' || Array.isArray(value))
    ) {
      throw new Error(
        `The advisory register at ${BASELINE} is missing its "${rule.key}" key.\n` +
          'A truncated file and a renamed key both land here, and neither is a ' +
          `register with nothing in it. ${rule.why}`,
      );
    }
    const count = Array.isArray(value) ? value.length : Object.keys(value).length;
    if (count === 0 && rule.emptyMeans !== null) {
      throw new Error(
        `The advisory register at ${BASELINE} ${rule.emptyMeans}.\n${rule.why}`,
      );
    }
  }

  assertVerdictShape(baseline);
  return baseline;
}

/**
 * The keys a reachability verdict and a witness may carry. THIS SET IS THE
 * WRITER OF RECORD; the `Baseline` typedef above is a reader's summary and
 * cannot enforce anything, because the register is `JSON.parse`d and cast.
 *
 * Kept as data rather than as prose for the reason {@link assertVerdictShape}
 * exists: a hand-edited JSON file has no compiler, so the only thing standing
 * between a mistyped key and silence is a check that reads the keys.
 */
const VERDICT_KEYS = new Set(['guards', 'why', 'shippedPaths', 'symbols', 'symbolsWhy', 'witness']);
const WITNESS_KEYS = new Set(['in', 'acceptedWhile', 'why']);

/**
 * Rejects a key nobody declared, and a witness for a symbol nobody watches
 * (finding OOO-1).
 *
 * ## Why this is a fail-open and not untidiness
 *
 * A witness exists so that a MISSPELT symbol fails: the symbol is scanned for
 * absence under `shippedPaths`, and witnessed for presence somewhere else, so a
 * typo cannot satisfy both (finding T-1). Remove that symbol from `symbols` and
 * leave its witness, and the register reports the same confident count as
 * before — the witness is simply never consulted. So a typo in `symbols` beside
 * the correct spelling in `witness` is green forever, which is precisely the
 * pair T-1 was bought to prevent, reconstructed through the other door.
 *
 * The unknown-key half is the same failure one level up. `witnes` or `witnesses`
 * disarms every witness on a verdict and prints nothing, because an absent
 * optional key and a misspelt one are the same observation to a reader that only
 * looks for the names it knows.
 *
 * ## How this was found, which is the part worth keeping
 *
 * By accident. Removing the four Win32 symbols after the surface shipped left
 * their witnesses behind and `check:advisories` stayed green; a placeholder key
 * parked in the file to hold the finding was also swallowed. Nothing was looking
 * for either, and neither has any output of its own — which is 4b's shape at the
 * level of a schema: **a key that is never read and a key that is satisfied
 * produce identical silence.**
 *
 * @param {Baseline} baseline
 */
function assertVerdictShape(baseline) {
  /** @type {string[]} */
  const problems = [];

  for (const [name, claim] of Object.entries(baseline.reachability)) {
    for (const key of Object.keys(claim)) {
      if (!VERDICT_KEYS.has(key)) {
        problems.push(
          `reachability.${name} carries "${key}", which no verdict may. Permitted: ` +
            `${[...VERDICT_KEYS].join(', ')}. A misspelt "witness" disarms every witness on ` +
            `this verdict and prints nothing, so an unknown key is refused rather than ignored.`,
        );
      }
    }

    const witness = claim.witness;
    if (witness === undefined) continue;
    const watched = new Set(watchedSymbols(name, claim));
    for (const [symbol, entry] of Object.entries(witness)) {
      if (!watched.has(symbol)) {
        problems.push(
          `reachability.${name}.witness names "${symbol}", which is not in its symbols list. ` +
            `A witness exists so a MISSPELT symbol fails; one keyed on a symbol the verdict ` +
            `does not watch is never consulted and passes exactly as loudly as one doing its ` +
            `job. Either the symbol was dropped and this witness is dead, or the symbol is ` +
            `misspelt in symbols and this is the spelling that was meant.`,
        );
      }
      for (const key of Object.keys(entry)) {
        if (!WITNESS_KEYS.has(key)) {
          problems.push(
            `reachability.${name}.witness.${symbol} carries "${key}", which no witness may. ` +
              `Permitted: ${[...WITNESS_KEYS].join(', ')}.`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `The advisory register at ${BASELINE} has ${String(problems.length)} shape problem(s):\n\n` +
        `  - ${problems.join('\n\n  - ')}\n`,
    );
  }
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

/** The tracked register's repo-relative path, as `git grep` reports it. */
const REGISTER_PATH = 'docs/security/engine-advisories.json';

/**
 * Fails when a verdict's SYMBOL cannot be shown to be findable — the half of
 * audit item 4b that the glob controls above do not reach.
 *
 * ## The hole this closes, measured rather than argued
 *
 * `brokenReachabilityControls` proves each path glob resolves. It says nothing
 * about the symbol searched for inside it. Misspell `utilityProcess` to
 * `utilityProcesss` and this whole check exited **0**, printing the same
 * `18 symbol(s) checked` — because a count of declarations is not a count of
 * findings. (Past tense, and the figure is what was measured the day T-1 was
 * found. The register has since gained a symbol and the walk reports 19; a
 * reader comparing 18 against a live run should not conclude the account is
 * wrong.) Invariant 25's containment verdict would then read green forever,
 * and nothing anywhere would say otherwise. That is finding T-1, and it is this
 * file's own stated failure mode occurring inside it: the comment on
 * `brokenReachabilityControls` names *"a symbol misspelt in the register"* as a
 * way the walk breaks, and the control it built catches the glob.
 *
 * ## Three states, and the third is the one that has to be got right
 *
 * - **derived** — the engine source confirms the symbol (the OCR doors). The
 *   strongest form, because the list is computed rather than recalled, and it
 *   is the shape every other symbol here should eventually take.
 * - **witnessed** — the symbol is found in a declared scope, on every run. The
 *   scope must be **disjoint from the paths the verdict scans**, or the witness
 *   could be satisfied by the very reference whose appearance expires the
 *   verdict. A witness may never resolve to the register itself: a misspelling
 *   would be present there too and would find itself, which is a search
 *   confirming its own typo.
 * - **unverifiable** — nothing in the repository can witness it. Printed on
 *   every run and **counted apart from the verified**, never folded in. "Could
 *   not look" must not render as "looked and found nothing" — the same
 *   distinction `checkWriteTarget` draws between `target-absent` and
 *   `sole-writer`, and the reason T-1 stayed invisible is precisely that one
 *   number covered both.
 *
 * ## Why `in: null` is not an escape hatch
 *
 * Because it is not permitted by declaration. It is permitted by a **condition
 * the register checks itself**: `acceptedWhile` names an input, this resolves
 * it every run, and the null holds only while the condition does. For the
 * Electron host symbols the condition is *"electron is named in no
 * package.json"* — one file read, and false the moment it stops being true.
 *
 * So an author cannot assert their way past this. They can only state a fact,
 * and the fact is checked. A symbol with no checkable condition gets no null.
 * That is the difference between a derived state and a config flag, and it is
 * the same difference as between the OCR door set and a hand-written list.
 *
 * The expiry falls out with no second mechanism: the day Electron becomes a
 * dependency the condition fails, the null stops being accepted, and this says
 * so — which is also the day a witness becomes possible AND the day the symbol
 * list can stop being hand-picked, because it can then be derived from
 * Electron's own API surface. One condition, three consequences.
 *
 * **That day was 2026-08-20 and all three happened.** The paragraph above is
 * kept in the future tense it was written in, because it is a prediction the
 * register made and met; everything below describes what is now in place.
 *
 * ## Completeness, and where it lives
 *
 * This function checks **spelling**. Completeness is checked too, by a separate
 * pass further down this file: it derives Electron's spawn surface BY TYPE from
 * `electron.d.ts` — every declaration whose type is the utility-process factory
 * — and fails when the register's `symbols` does not name one, printing
 * `does not name: …`. It proved the hand-picked list short on its first run, and
 * `symbols` now names three: `utilityProcess`, `UtilityProcess` and
 * `MessageChannelMain`.
 *
 * **This section used to say the opposite, and that is finding BB-2.** It read:
 * *"It checks spelling, not completeness. `utilityProcess` and
 * `MessageChannelMain` are two hand-picked names … Only derivation fixes that,
 * and derivation needs the same dependency the condition above watches for."*
 * All three halves moved when Electron landed — the derivation exists, the pair
 * became a derived triple, and the dependency arrived — and the paragraph stood
 * for a range under the heading *"what this still does not do"*, which is where
 * a reader looks to find out what is **not** covered.
 *
 * The mechanism that made it survive is worth more than the correction. The
 * completeness pass is a SIBLING of this function rather than part of it, so
 * *"it checks spelling, not completeness"* was literally true **of this
 * function** — and that is the clause a reader verifies. It then vouched for the
 * two beside it that were simply false. Item 7's compound-claim shape, and the
 * only instance so far where the surviving clause is true by SCOPE rather than
 * by luck.
 *
 * It is also the only one of the six that **authorises** rather than
 * misdescribes. `publish`, the lockfile header, `guards.yml:220` and
 * `passRoster` all told a reader something untrue about behaviour. This one told
 * a reader that a mechanism was absent when it exists, and the action it invites
 * is to build a second one — a **B3 violation with a comment vouching for it**,
 * one range after B3a became law. Hence the pointer above naming where the check
 * lives, rather than a bare deletion of the stale claim.
 *
 * ## "COULD NOT DERIVE" IS NOT "WAS NOT DERIVED", and this rule broke on that
 *
 * The OCR doors are derived from the engine source rather than witnessed, so
 * they carry no `witness` entry — correctly, since a derivation is stronger than
 * a witness. On a machine with no provisioned MuPDF source the derivation cannot
 * run, and this rule then met eleven symbols that were neither derived nor
 * witnessed and failed the build on all eleven.
 *
 * That is this rule's own distinction, violated by its own implementation, four
 * lines after the check prints *"OCR door set NOT verified here — MuPDF source
 * not provisioned"*. **Measured** in a worktree with no `.tools/`: every Guards
 * run failed from the commit that added this rule, on both platforms, while the
 * same command passed on a provisioned machine.
 *
 * So the derivation's *state* is an input here, not just its result. When it
 * could not run, its symbols are **unverifiable** — printed, counted apart, and
 * never folded into `verified`. What stops that being a hole is the other half:
 * `--require-derivation` turns an unprovisioned source into a failure, and the
 * one CI job that has the source runs it that way. Unverifiable where nothing
 * could look, mandatory where something can.
 *
 * @param {Baseline} baseline
 * @param {ReadonlyArray<{
 *   verified: readonly string[],
 *   checked: boolean,
 *   claim: string,
 *   reason: string,
 * }>} derivations One per verdict that declares its symbols derived rather than
 *   witnessed. `reason` is printed when a derivation could not run, so the
 *   unverifiable line says WHY rather than naming one derivation's condition for
 *   all of them.
 * @returns {{ failures: string[], verified: number, unverifiable: string[] }}
 */
function unwitnessedSymbols(baseline, derivations) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const unverifiable = [];
  let verified = 0;

  for (const [name, claim] of Object.entries(baseline.reachability)) {
    // A LIST, because there are now two derivations with different provisioning
    // conditions: the OCR doors need the MuPDF source, the Electron surface needs
    // node_modules. A single derivation slot would have forced the second to
    // arrive as a witness, and a witness for these symbols is a 1.1 MB file
    // digest that says the file changed rather than that the symbol is declared
    // — finding T-1 exactly.
    const derivation = derivations.find((entry) => entry.claim === name);

    for (const symbol of watchedSymbols(name, claim)) {
      // SCOPED TO THIS VERDICT'S OWN DERIVATION. Asking whether ANY derivation
      // verified the symbol lets one verdict's evidence stand in for another's —
      // an Electron declaration confirming an OCR door because the two sets
      // happen to share a name. Nothing collides today; the point is that the
      // collision would report as a clean verification.
      if (derivation?.verified.includes(symbol) === true) {
        verified += 1;
        continue;
      }

      const witness = claim.witness?.[symbol];
      if (witness === undefined) {
        if (derivation !== undefined && !derivation.checked) {
          // The derivation could not RUN. That is not the same as its having
          // run and confirmed nothing, and collapsing the two is the exact
          // failure this rule exists to prevent — arriving inside the rule.
          // These symbols are declared as derived, so they carry no witness by
          // design; reporting them as unwitnessed would be a true-sounding
          // sentence about the wrong thing.
          unverifiable.push(`${name}: ${symbol} — ${derivation.reason}`);
          continue;
        }
        // A symbol the engine source did not confirm and the register does not
        // account for. Not tolerated as an omission: an unaccounted symbol is
        // exactly the state a misspelt one is in.
        failures.push(
          `${name}: ${symbol} has no witness and no derivation.\n` +
            `      Its absence from shipped code is therefore unproven — a misspelling here reads\n` +
            `      identically to a clean verdict. Declare witness.${symbol} with a scope the\n` +
            `      symbol IS found in, or with in: null plus an acceptedWhile condition.`,
        );
        continue;
      }

      if (witness.in === null) {
        if (witness.acceptedWhile === undefined) {
          failures.push(
            `${name}: ${symbol} declares no witness and states no condition.\n` +
              `      A bare null is an author asserting an exemption, which is the escape hatch\n` +
              `      this rule exists to refuse. Name a condition the register can resolve.`,
          );
          continue;
        }
        const condition = { ...witness.acceptedWhile, why: witness.why };
        const detail = digestInputs([condition], { root: ROOT }).inputs[0]?.detail ?? '';
        if (detail !== 'no references') {
          failures.push(
            `${name}: ${symbol} is unwitnessed on a condition that NO LONGER HOLDS.\n` +
              `      Condition: ${witness.acceptedWhile.absent} absent from ` +
              `${witness.acceptedWhile.from.join(', ')}\n` +
              `      Now: ${detail}\n` +
              `      The null was accepted only while nothing could witness this symbol. Something\n` +
              `      can now. Witness it — and reconsider whether the symbol LIST can stop being\n` +
              `      hand-picked at the same time.\n` +
              `      Why it was unwitnessed: ${witness.why}`,
          );
          continue;
        }
        unverifiable.push(`${name}: ${symbol} — ${witness.acceptedWhile.absent} is not present`);
        continue;
      }

      if (witness.in.length === 0) {
        failures.push(
          `${name}: ${symbol} declares an empty witness scope, which finds nothing by\n` +
            `      construction and would pass as an absence. Name a scope or state a condition.`,
        );
        continue;
      }

      const resolved = digestInputs([{ absent: symbol, from: witness.in, why: witness.why }], {
        root: ROOT,
      }).inputs[0];
      const detail = resolved?.detail ?? '';
      if (detail === 'no references') {
        failures.push(
          `${name}: ${symbol} was NOT found in its own witness scope ` +
            `${witness.in.join(', ')}.\n` +
            `      Either the symbol is misspelt in this register — the failure this rule exists\n` +
            `      for, and one that leaves the verdict green forever — or the witness scope moved.\n` +
            `      Both are the walk being blind, not the symbol being absent from shipped code.\n` +
            `      Why this scope: ${witness.why}`,
        );
        continue;
      }
      if (detail.includes(REGISTER_PATH)) {
        failures.push(
          `${name}: ${symbol}'s witness resolves to the register itself ` +
            `(${REGISTER_PATH}).\n` +
            `      That is circular: a misspelling is present there too, so the search finds its\n` +
            `      own typo and reports success. Witness it in text that does not declare it.`,
        );
        continue;
      }
      verified += 1;
    }
  }

  return { failures, verified, unverifiable };
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
    const symbols = watchedSymbols(name, claim);

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
 * `verified` is what makes this a **witness** for those symbols and not only a
 * drift check: a symbol the engine source confirms cannot be misspelt here, so
 * the witness rule below has nothing left to add for it. It is the intersection
 * of derived and declared rather than the declaration, so the coverage is
 * COMPUTED — rename the entry this reads and `verified` empties, which surfaces
 * those symbols as unverifiable instead of leaving a stale exemption behind.
 *
 * @param {Baseline} baseline
 * @returns {{ checked: boolean, missing: string[], extra: string[], verified: string[] }}
 */
function ocrDoorDrift(baseline) {
  const source = mupdfSourcePath(ROOT);
  const shimProject = join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');
  if (!existsSync(join(source, 'source', 'fitz', 'tessocr.h')) || !existsSync(shimProject)) {
    return { checked: false, missing: [], extra: [], verified: [] };
  }

  const derived = deriveOcrDoors(source, shimProject);
  const declared = declaredSymbols(baseline.reachability['ocr']);
  return {
    checked: true,
    missing: derived.doors.filter((door) => !declared.includes(door)),
    extra: declared.filter((symbol) => !derived.doors.includes(symbol)),
    verified: derived.doors.filter((door) => declared.includes(door)),
  };
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  // Passed by the one CI job that provisions the MuPDF source. Everywhere else
  // an absent source makes the OCR doors unverifiable rather than failing; here
  // it fails, because here something could have looked.
  const requireDerivation = process.argv.includes('--require-derivation');
  const baseline = readBaseline();

  // The feed, live or recorded. `--record-advisories` refreshes the recording
  // and exits; it is the only way the fixture is written, so a recording is
  // always something a live query produced rather than something hand-edited.
  if (process.argv.includes('--record-advisories')) {
    const fresh = await fetchAdvisories();
    writeFileSync(RECORDED_ADVISORIES, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `Recorded ${String(fresh.length)} advisories to ${RECORDED_ADVISORIES}.\n` +
        `This is an INPUT SUBSTITUTE for callers whose subject is the register. The shipped ` +
        `check must keep fetching live.\n`,
    );
    return 0;
  }
  const useRecorded = process.argv.includes('--recorded-advisories');

  /** @type {Advisory[]} */
  let advisories;
  try {
    advisories = useRecorded ? readRecordedAdvisories() : await fetchAdvisories();
  } catch (error) {
    // A network failure is NOT a pass. Saying so out loud is the whole point:
    // "could not check" and "nothing to report" must never print the same way.
    process.stderr.write(
      `\n${useRecorded ? 'Could not read the RECORDED advisory feed' : 'Could not reach the advisory database'}: ${String(error)}\n\n` +
        `This is reported as a failure rather than skipped. A security check that ` +
        `passes when it could not run is a green tick meaning "did not look".\n` +
        `${useRecorded ? 'Re-record it with --record-advisories.\n' : ''}\n`,
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
  // The SOURCE is printed, not only the count. `--recorded-advisories` had no
  // case proving it took effect: a broken parse would fetch live and every
  // register case would still pass, slowly, while the proof's comment claimed
  // exactly one live call (finding GGG-2). A count cannot separate them — the
  // recording was made from the live feed, so the two agree by construction, and
  // asserting on it is a fixture the bug also handles correctly. This label is
  // downstream of the same `useRecorded` decision, so it moves when the flag
  // does.
  process.stdout.write(
    `  ok  ${advisories.length} advisories (${perComponent}) from the ` +
      `${useRecorded ? 'RECORDED' : 'LIVE'} feed, all triaged\n`,
  );

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

  // The one job that HAS the engine source runs with this flag, so an
  // unprovisioned source is a failure exactly where something could have looked.
  // Without it, "unverifiable everywhere" would be a stable, quiet state — which
  // is what the unverifiable bucket exists to make visible, not to permit.
  // The Electron API surface, derived from electron.d.ts by the TypeScript
  // compiler. Read here so both derivations are resolved before any verdict is
  // reported, and so --require-derivation can speak for both.
  const electron = await readElectronSurface({ root: ROOT });

  if (requireDerivation && !electron.checked) {
    process.stderr.write(
      `\nThe Electron surface derivation could not run: ${electron.reason}.\n\n` +
        `This invocation passed --require-derivation, which is used where node_modules IS ` +
        `expected — so "could not look" is a failure here rather than a count. Elsewhere the ` +
        `same absence reports invariant 25's symbols as unverifiable.\n\n` +
        `  Run:  npm ci --ignore-scripts\n\n`,
    );
    return 1;
  }

  if (requireDerivation && !drift.checked) {
    process.stderr.write(
      `\nThe OCR door derivation could not run: the MuPDF source is not provisioned.\n\n` +
        `This invocation passed --require-derivation, which is used where the source IS ` +
        `expected — so "could not look" is a failure here rather than a count. Elsewhere the ` +
        `same absence reports the doors as unverifiable.\n\n` +
        `  Run:  npm run provision:mupdf\n\n`,
    );
    return 1;
  }

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
      ? `  ok  ${declaredSymbols(baseline.reachability['ocr']).length} OCR doors match the engine source\n`
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
    (total, [name, claim]) => total + watchedSymbols(name, claim).length,
    0,
  );
  if (symbolCount === 0) {
    process.stderr.write(
      `\nThe reachability verdicts name no symbols at all, so nothing was searched for.\n\n`,
    );
    return 1;
  }
  // Can it see the SYMBOL, not only the path? Asked here, before the expiry
  // check, for the third time and the same reason: an instrument that cannot
  // find what it is looking for reports "no references" for every symbol, and
  // that is the answer every verdict below wants to hear.
  const witnesses = unwitnessedSymbols(baseline, [
    {
      verified: drift.verified,
      checked: drift.checked,
      claim: DERIVED_CLAIMS[0],
      reason: 'the engine source is not provisioned, so the derivation could not run',
    },
    {
      // DECLARATIONS, parsed. Not a file digest: a digest of electron.d.ts says
      // the file changed, not that the symbol is still declared in it, and the
      // file is 56% comments so a text search would witness a symbol that had
      // been REMOVED. See scripts/security/electronSurface.mjs.
      verified: electron.checked ? electron.declared : [],
      checked: electron.checked,
      claim: DERIVED_CLAIMS[1],
      reason: electron.reason,
    },
  ]);
  if (witnesses.failures.length > 0) {
    process.stderr.write(
      `\n${witnesses.failures.length} reachability symbol(s) cannot be shown to be findable:\n\n` +
        witnesses.failures.map((entry) => `  - ${entry}`).join('\n\n') +
        `\n\nA path glob with a control proves the walk reads files. It says nothing about ` +
        `whether the string it searches for is one that could ever match. A misspelt symbol ` +
        `produces "no references" on every run, forever, which is the verdict's passing answer.\n\n`,
    );
    return 1;
  }

  // Completeness, which is what a DERIVATION buys over a witness. The register's
  // symbol list was hand-picked and its own `why` said so — "a correctly spelt
  // list can still be short". Every name Electron declares as the utility-process
  // factory must be on it, so a new spawning API turns this red instead of
  // silently escaping the invariant.
  //
  // AFTER the witness check, not before, and the ordering is the same one
  // `ocrDoorDrift` follows: "your list is wrong" is reported before "your list is
  // short". A misspelt symbol is ALSO an uncovered one, so running this first
  // answered a spelling mistake with a coverage message — the less specific of
  // the two, for a defect the other check names exactly.
  if (electron.checked) {
    const claim = baseline.reachability['engine-host-containment'];
    const named = new Set(declaredSymbols(claim));
    const uncovered = electron.spawnSurface.filter((symbol) => !named.has(symbol));
    if (uncovered.length > 0) {
      process.stderr.write(
        `\nElectron declares process-spawning entry point(s) that invariant 25's symbol list ` +
          `does not name: ${uncovered.join(', ')}\n\n` +
          `Derived from electron ${electron.version} by TYPE — every declaration whose type is ` +
          `the utility-process factory — rather than by name, so this grows when Electron adds ` +
          `one. The list was hand-picked and the register's own why predicted this: a correctly ` +
          `spelt list can still be short.\n\n` +
          `Add them to symbols[] in ${BASELINE}, or say in why[] which is not an entry point ` +
          `and how that was established.\n\n`,
      );
      return 1;
    }
  }

  // Two numbers, never one. A single count covering both is how T-1 stayed
  // invisible: "18 symbol(s) checked" was true of a register with two symbols
  // misspelt, because it counted declarations rather than findings.
  process.stdout.write(
    `  ok  reachability walk: ${controls.found} control(s) found, ` +
      `${Object.keys(baseline.reachability).length} verdict(s) / ${symbolCount} symbol(s): ` +
      `${witnesses.verified} verified, ${witnesses.unverifiable.length} unverifiable\n`,
  );
  if (witnesses.unverifiable.length > 0) {
    process.stdout.write(
      `  --  ${witnesses.unverifiable.length} symbol(s) UNVERIFIABLE — nothing here can witness ` +
        `them, so their spelling is unchecked:\n` +
        witnesses.unverifiable.map((entry) => `        ${entry}\n`).join('') +
        `      These verdicts do not hold on this evidence. "Could not look" is not "looked and ` +
        `found nothing".\n`,
    );
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
    process.stderr.write(`\n${formatError(error)}\n`);
    process.exitCode = 1;
  },
);
