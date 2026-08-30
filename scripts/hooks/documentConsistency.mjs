// @ts-check
/**
 * Machine-checks the claims documents make about each other.
 *
 * Three separate drifts were found by audit, all of the same kind: a fact stated
 * in one document and maintained by hand in another. None of them could have
 * been caught by review, because reviewing the changed file never shows the
 * stale one.
 *
 *   - CLAUDE.md cited "L1–L16" while ARCHITECTURE §9 had grown to 22. Five
 *     amendments had landed without the digest being updated, and CLAUDE.md's
 *     own header table requires the same-commit update. The five missing
 *     included two data-loss invariants.
 *   - The ADR index stopped at 0006 while ten ADRs existed, and listed ADR-0001
 *     as plain "Accepted" although that file carries a dated correction — the
 *     index positively asserted an uncorrected status for the one ADR whose
 *     correction exists to stop exactly that.
 *   - `.gitattributes` and `preCommit.mjs` both pointed at
 *     `scripts/hooks/guardStagedFiles.mjs`, which has never existed: git log
 *     --follow shows the file was ADDED as guardFiles.mjs. The name was wrong
 *     the day it was written and two documents carried it for the project's
 *     whole life.
 *
 * Each check derives one side from the source of truth rather than comparing two
 * hand-maintained lists.
 *
 * Usage: node scripts/hooks/documentConsistency.mjs
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  auditRecordDisagreement,
  auditScope,
  stagedWatermark,
  unansweredAuditItems,
} from '../lib/auditWatermark.mjs';
import { filesInCommit, git, readStagedBlob, repoRoot } from '../lib/gitScope.mjs';
import { probeCoverage, probeState } from '../lib/hookProbe.mjs';
import { probeState as pickerProbeState } from '../lib/pickerProbe.mjs';
import { isMain } from '../lib/isMain.mjs';
import { memoryBudgets } from '../lib/memoryBudgets.mjs';
import { ANCHOR_EVENT, ANCHOR_SCRIPT, claimedHooks, mechanismName } from '../lib/registeredHooks.mjs';
import { THREAT_MODEL_TOPICS, unraisedTopics } from '../lib/threatModelTopics.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { declaredPhrases, liveClaims } from '../lib/withdrawnPhrases.mjs';

// The root is asked of git, in one place, for the same reason the scope is:
// this file used to fall back to `resolve(__dirname, '..', '..')` when
// `rev-parse` failed, which is a second answer to a question that must have one.
// A fallback that silently substitutes a different repository is worse than an
// error, because the checks then pass against a tree nobody is committing to.
const ROOT = repoRoot();

/**
 * Content of a document, from the same scope it was enumerated from.
 *
 * `filesInCommit()` answers about the tree this commit will leave. Reading the
 * answer off the filesystem asks a different question — "whatever is on disk
 * right now" — and `gitScope.mjs` names that as a fifth scope that is almost
 * never the one wanted. The mismatch has a state: **tracked but absent from the
 * working tree**, which crashed this script on a stack trace where four
 * findings should have been.
 *
 * The first fix was `existsSync` and `continue`, which handles the state
 * instead of removing it, and buys a document that goes unchecked while the
 * checker reports success. This is finding 06 in a second file — every other
 * rule reads the staged blob through git, this one reached for the filesystem —
 * and it is closed the same way: align the scopes. A path present in the commit
 * always has a blob, so neither the crash nor the skip has anything left to
 * happen to.
 *
 * A null here is therefore not a routine absence to tolerate. It means the
 * enumeration and the read disagree, which is the defect itself resurfacing.
 *
 * @param {string} relativePath
 * @returns {string}
 */
function read(relativePath) {
  const blob = readStagedBlob(relativePath);
  if (blob === null) {
    throw new Error(
      `${relativePath} is in the commit scope but has no blob in the index. The enumeration and ` +
        `the content read disagree, which is the scope mismatch this function exists to prevent.`,
    );
  }
  return blob.toString('utf8');
}

/** @returns {string[]} Every tracked file, repo-relative, forward-slashed. */
function trackedFiles() {
  // The COMMIT scope: tracked plus staged, i.e. the tree as this commit will
  // leave it. `git ls-files` alone answers about the PREVIOUS commit, so a
  // brand-new ADR staged beside a missing index row stayed invisible until after
  // the commit that should have caught it.
  //
  // Shared with guardFiles.mjs rather than fixed twice — both had the same
  // defect, a guard asking git a question whose answer is not the thing it
  // guards. scripts/lib/gitScope.mjs names the four scopes and their semantics.
  return filesInCommit();
}

/**
 * A rule, and its SCOPE, which is required rather than defaulted (finding
 * AAAA-9).
 *
 * ## Why the scope exists
 *
 * These nine rules split cleanly by what decides them, and only one class was
 * involved in the defect that made this necessary:
 *
 *   - **`per-document`** — decided entirely by reading ONE staged blob. A
 *     markdown row's cell count is the example: nothing outside that file can
 *     make it right or wrong. These can run in pre-commit against the index, at
 *     near-zero cost, and that closes the class that went public — a `|` inside
 *     a table cell split a row, `check:docs` was run before `git add` so it read
 *     the old blob and passed, and Guards was the first thing that could see it.
 *   - **`whole-corpus`** — link resolution, the watermark sha appearing in the
 *     journal, a withdrawn phrase surviving anywhere. These cannot be scoped,
 *     because a DIFFERENT file's change is what breaks them. They stay in
 *     Guards, where reading everything is affordable.
 *
 * Moving the whole check into pre-commit was the obvious answer and it is a
 * false binary: 48 seconds on every commit, or nothing until CI. The scope is
 * the third option.
 *
 * ## The scope is REQUIRED
 *
 * {@link registerRule} throws on a rule that does not choose. A default would
 * mean the next rule silently lands in neither place — the second wiring place
 * arriving as an omission, which is the shape this repository keeps paying for.
 *
 * @typedef {object} DocumentRule
 * @property {string} name the roster line
 * @property {'per-document' | 'whole-corpus'} scope
 * @property {readonly string[]} documents for `per-document`: the one file it
 *   reads, so a staged-file selection can decide whether it applies. Empty for
 *   `whole-corpus`, which reads whatever it needs.
 * @property {(failures: string[]) => boolean | undefined} run
 *   pushes onto the failure list it is handed, and returns `false` where the
 *   rule does not APPLY — see rule 7, which is conditional on a threat model
 *   existing. The list is a parameter rather than a module-level array so a
 *   selection can be run without the rules writing into each other's results.
 */

/** @type {DocumentRule[]} */
const RULES = [];

/** The registry, for the proof that asserts the scope contract. */
export const DOCUMENT_RULES = RULES;

/** @param {DocumentRule} rule @returns {void} */
function registerRule(rule) {
  if (rule.scope !== 'per-document' && rule.scope !== 'whole-corpus') {
    throw new Error(
      `Rule "${rule.name}" declares no scope. Every rule must choose 'per-document' (decided by ` +
        `one staged blob, so pre-commit can run it) or 'whole-corpus' (broken by a different ` +
        `file's change, so only Guards can). There is no default: a rule that does not choose ` +
        `would land in neither runner and be enforced by nothing.`,
    );
  }
  if (rule.scope === 'per-document' && rule.documents.length !== 1) {
    throw new Error(
      `Rule "${rule.name}" is per-document but names ${String(rule.documents.length)} documents. ` +
        `Per-document means decided by ONE blob; anything reading a second file is whole-corpus, ` +
        `whatever it feels like.`,
    );
  }
  RULES.push(rule);
}

/**
 * Runs a selection of the rules and returns what failed.
 *
 * @param {{ scope?: 'per-document', documents?: readonly string[] }} [selection]
 *   omitted runs everything, which is what `check:docs` does.
 * @returns {{ failures: string[], summary: string, selected: number, registered: number }}
 */
export function runDocumentRules(selection = {}) {
  /** @type {string[]} */
  const failures = [];
  const registered = RULES.filter(
    (rule) => selection.scope === undefined || rule.scope === selection.scope,
  );
  const chosen =
    selection.documents === undefined
      ? registered
      : registered.filter((rule) => rule.documents.some((path) => selection.documents?.includes(path)));

  // Section 7 applies only when a threat model exists, and the fixed block of
  // `ok` lines this replaces claimed it either way — see
  // scripts/lib/passRoster.mjs. The count is DERIVED from the selection rather
  // than written as a literal, because with a selection the literal would be
  // asserting the wrong thing; `roster.format` still throws on a mismatch, so a
  // rule that silently fails to run is still caught.
  const roster = createRoster(failures, { cases: chosen.length });
  for (const rule of chosen) {
    const mark = roster.mark();
    const applies = rule.run(failures);
    roster.record(mark, rule.name, applies);
  }
  // `format` ONLY WHEN NOTHING FAILED, and this is not a style choice. A failing
  // case is not RECORDED, so the roster's declared count and its recorded count
  // legitimately disagree — and `format` throws on that disagreement, which is
  // the guard against a case silently ceasing to run (Z-4). Calling it
  // unconditionally turns every real document failure into a roster stack trace
  // and buries the diagnosis. Written that way here first, and caught by the
  // probe that reproduced the defect this gate exists for: the commit was
  // refused, and for the wrong reason.
  return {
    failures,
    summary: failures.length > 0 ? '' : roster.format('document consistency check'),
    selected: chosen.length,
    registered: registered.length,
  };
}

// ---------------------------------------------------------------------------
// 1. The invariant count in the digest matches the law.
// ---------------------------------------------------------------------------
registerRule({
  name: 'CLAUDE.md cites the invariant count ARCHITECTURE §9 defines',
  // Two documents by construction — the digest and the law — so a change to
  // either breaks it and neither alone decides it.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  const architecture = read('docs/ARCHITECTURE.md');
  const start = architecture.indexOf('\n## 9. Invariants');
  const end = architecture.indexOf('\n## 10.', start + 1);
  if (start === -1 || end === -1) {
    failures.push(
      'Could not locate section 9 in docs/ARCHITECTURE.md. This check reads the section ' +
        'by heading, so a renamed heading must be reflected here rather than silently ' +
        'skipping the check.',
    );
  } else {
    const section = architecture.slice(start, end);
    const numbered = [...section.matchAll(/^(\d+)\.\s/gm)].map((match) => Number(match[1]));
    const highest = numbered.length === 0 ? 0 : Math.max(...numbered);

    const claude = read('CLAUDE.md');
    const cited = [...claude.matchAll(/L1\s*[–-]\s*L(\d+)/g)].map((match) => Number(match[1]));

    if (cited.length === 0) {
      failures.push(
        'CLAUDE.md no longer cites an invariant range (expected something like "L1–L22"). ' +
          'If the citation was deliberately removed, remove this check in the same commit.',
      );
    }
    for (const citation of cited) {
      if (citation !== highest) {
        failures.push(
          `CLAUDE.md cites invariants L1–L${citation}, but docs/ARCHITECTURE.md §9 defines ` +
            `${highest}. CLAUDE.md is the derived digest and its own header table requires it ` +
            `to be corrected in the same commit as any amendment.`,
        );
      }
    }
  }
  },
});

// ---------------------------------------------------------------------------
// 2. The ADR index lists every ADR, and does not assert a status the file
//    contradicts.
// ---------------------------------------------------------------------------
/**
 * A dated correction heading, in every form this corpus actually writes.
 *
 * ## What it matches, MEASURED rather than assumed (finding XXXX-2)
 *
 * Counted across `docs/DECISIONS/` on 2026-08-28:
 *
 * | form | count |
 * |---|---|
 * | `## Correction, DATE — …` | 25 |
 * | `### Correction, DATE — …` | 14 |
 * | `> ## Correction — DATE` | 3 |
 * | `#### Correction, DATE — …` | 2 |
 *
 * The previous pattern was `^>\s*##\s*Correction\s*[—–-]\s*DATE`, which matches
 * **only the third row**. It missed the other 41 three ways at once: the `>` it
 * required, the heading depth it fixed at two, and the ORDER — the common form
 * puts a comma and the date first and the em dash after, where that pattern
 * wanted the dash immediately.
 *
 * So nine ADRs carrying dated corrections were reported as uncorrected, and
 * every one of their index rows read *Accepted* with nothing recorded. Three of
 * those corrections were appended in the range that found this.
 *
 * **It had already been fixed once for the same class of blindness**, and its
 * own comment recorded that: the first version omitted the em dash and *"found
 * no corrections at all and reported that half as passing"*. The dash was
 * widened and the other three axes were never looked at — half a fix, reporting
 * *found nothing* in exactly the voice of a clean corpus.
 *
 * ## The two forms mean the same thing, which is why this widens rather than splits
 *
 * Nothing in `CLAUDE.md` or `DECISIONS/README.md` distinguishes a blockquoted
 * correction from a body-level one. The rule is *append a dated correction,
 * never edit*, and it says nothing about presentation. Checked against the
 * corpus before widening: both forms carry outright withdrawals — ADR-0007's
 * banner is *"largely withdrawn"*, and ADR-0023's body-level blocks include
 * *"a poisoned document is still saveable is WITHDRAWN"*. The banner is
 * placement, not a different kind of claim.
 *
 * The date is required anywhere on the heading line rather than in a fixed
 * position, because the three orderings above are all in use and a fourth costs
 * nothing to accept. What is NOT optional is the date itself: an undated
 * correction is the thing the append-only rule exists to prevent.
 */
const CORRECTION_HEADING = /^>?\s*#{2,4}\s+Correction\b[^\n]*\d{4}-\d{2}-\d{2}/mu;

/**
 * An ADR known to carry a body-level correction, so this rule's silence means
 * something (item 4b).
 *
 * *No ADR is corrected* is this rule's passing answer and it has now been the
 * WRONG answer for weeks, so the pattern must be shown to find something on
 * every run. Anchored on a body-level heading deliberately: the form the old
 * pattern could see is the one least likely to regress.
 *
 * Safe as a permanent anchor because corrections are append-only — ADR-0023's
 * blocks cannot be deleted by any rule this repository has.
 */
const CORRECTION_CONTROL = 'docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md';

registerRule({
  name: 'every ADR is indexed, and no index row contradicts its file',
  // Enumerates every ADR to decide whether the index is complete: a new ADR
  // added elsewhere is exactly what breaks it.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  const index = read('docs/DECISIONS/README.md');
  const adrFiles = trackedFiles()
    .filter((path) => /^docs\/DECISIONS\/\d{4}-.*\.md$/.test(path))
    .sort();

  // THE POSITIVE CONTROL, BEFORE ANY VERDICT. Every way of breaking the
  // correction scan — a wrong pattern, an empty file list, a heading form
  // nobody anticipated — reports the same clean *no ADR is corrected*, and that
  // is the answer this rule is hoping for. It was also the WRONG answer for
  // weeks (XXXX-2). So the pattern has to find something known to be there
  // before its silence about anything else is worth reading.
  if (!adrFiles.includes(CORRECTION_CONTROL)) {
    failures.push(
      `the correction control ${CORRECTION_CONTROL} is not in the enumerated ADR set, so this ` +
        `rule cannot establish that it can see anything. Point the control at another ADR that ` +
        `carries a dated correction rather than deleting it.`,
    );
  } else if (!CORRECTION_HEADING.test(read(CORRECTION_CONTROL))) {
    failures.push(
      `the correction scan did not find a dated correction in ${CORRECTION_CONTROL}, which is ` +
        `known to carry several. Every clean result from this rule is therefore worthless: a ` +
        `pattern that cannot match its subject reads exactly like a corpus with nothing to ` +
        `report, which is the failure this rule has already had once.`,
    );
  }

  for (const path of adrFiles) {
    const id = /(\d{4})/.exec(path)?.[1] ?? '';
    const fileName = path.slice('docs/DECISIONS/'.length);

    const row = index
      .split('\n')
      .find((line) => line.startsWith('|') && line.includes(`(${fileName})`));

    if (row === undefined) {
      failures.push(
        `ADR-${id} (${fileName}) has no row in docs/DECISIONS/README.md, whose opening line ` +
          `claims every amendment is recorded there.`,
      );
      continue;
    }

    // A correction is a dated block the ADR carries. Its status must not read as
    // though nothing happened.
    const body = read(path);
    const corrected = CORRECTION_HEADING.test(body);
    const rowMentionsCorrection = /correct/i.test(row);

    if (corrected && !rowMentionsCorrection) {
      failures.push(
        `ADR-${id} carries a dated Correction block, but its index row does not mention it:\n` +
          `      ${row.trim()}\n` +
          `    The index asserts an uncorrected status for an ADR that was corrected, which is ` +
          `the failure the correction exists to prevent.`,
      );
    }
    if (!corrected && rowMentionsCorrection) {
      failures.push(
        `ADR-${id}'s index row mentions a correction, but the file carries no dated Correction ` +
          `block. An ADR is corrected by adding that block, never by editing it to look right.`,
      );
    }
  }
  },
});

// ---------------------------------------------------------------------------
// 3. Every scripts/ path named in a tracked text document actually resolves.
// ---------------------------------------------------------------------------
registerRule({
  name: 'every scripts/ path named in a tracked document resolves',
  // Reads every tracked document AND the filesystem: a path is broken by a
  // script being renamed, which is not a change to the document naming it.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  const documents = trackedFiles().filter((path) =>
    /\.(md|ya?ml|json|gitattributes)$|^\.gitattributes$/.test(path),
  );

  for (const document of documents) {
    // package-lock is machine-written and enormous; nothing in it names a script.
    if (document === 'package-lock.json') continue;

    const text = read(document);
    const lines = text.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      for (const match of line.matchAll(/\bscripts\/[\w./-]*\.(?:mjs|js|ts)\b/g)) {
        const path = match[0];
        if (existsSync(join(ROOT, path))) continue;

        // A path can be named as HISTORY rather than as a pointer. ADR
        // discipline requires a withdrawn decision to keep saying what it
        // withdrew, so "scripts/provision/mutool.mjs is withdrawn" must stay
        // exactly as written — demanding that file exist would force the record
        // to be falsified. The sentence, not just the line, decides: the phrase
        // often lands on the line after the path.
        const context = `${lines[index - 1] ?? ''} ${line} ${lines[index + 1] ?? ''}`;
        if (/withdrawn|removed|deleted|no longer|never existed|replaced by/i.test(context)) {
          continue;
        }

        failures.push(
          `${document}:${index + 1} names ${path}, which does not exist and is not described as ` +
            `withdrawn. A documented entry point that resolves to nothing costs exactly the ` +
            `person trying to audit it.`,
        );
      }
    }
  }
  },
});

// ---------------------------------------------------------------------------
// 4. No document states, as a live claim, something an ADR's correction
//    withdrew.
// ---------------------------------------------------------------------------
registerRule({
  name: 'no document states a claim an ADR correction withdrew',
  // The canonical whole-corpus rule: a phrase declared withdrawn in ONE ADR
  // must be absent from EVERY other document, so the file that breaks it is
  // never the file that changed.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  // An ADR's `Amends:` field names the documents it changes, and a correction to
  // that ADR has to reach all of them. ADR-0007's correction reached
  // docs/ARCHITECTURE.md §9 and did not reach the Stage 0 exit gate in
  // docs/FEATURES.md, so the gate went on citing ADR-0007 as authority for a
  // ~650 MB ceiling that same ADR had retracted — and Stage 0 could not exit
  // without satisfying it. Nothing could have caught that by reading the changed
  // file, which is the property this whole module exists for.
  //
  // So a correction declares its withdrawn phrases and they are enforced. The
  // ADR that declares them is exempt: it must keep saying what it withdrew, and
  // its Evidence section deliberately leaves the original measurements standing.
  const declaring = trackedFiles().filter((path) => /^docs\/DECISIONS\/\d{4}-.*\.md$/.test(path));

  /** @type {Array<{ adr: string, phrase: string }>} */
  const declarations = [];
  for (const path of declaring) {
    for (const phrase of declaredPhrases(read(path))) declarations.push({ adr: path, phrase });
  }

  if (declarations.length === 0) {
    failures.push(
      'No ADR declares any withdrawn phrases. If every correction has genuinely been absorbed ' +
        'everywhere, delete this check in the same commit rather than leaving one that inspects ' +
        'nothing.',
    );
  }

  /** @type {Map<string, string>} */
  const documents = new Map();
  for (const path of trackedFiles().filter((p) => p.endsWith('.md'))) documents.set(path, read(path));

  for (const claim of liveClaims({ declarations, documents })) {
    failures.push(
      `${claim.document}:${claim.line} states "${claim.phrase}" as a live claim, but ` +
        `${claim.adr}'s correction withdrew it:\n      ${claim.quote}\n    Either remove the ` +
        `claim, or say in the same sentence that it is withdrawn. A retracted number that ` +
        `survives in a second document is the one people find.`,
    );
  }
  },
});

// ---------------------------------------------------------------------------
// 5. Every registered hook owes its own evidence, and the Stage 0 gate on the
//    tool-use guard is marked done only when that guard was seen to fire.
// ---------------------------------------------------------------------------
registerRule({
  name: 'every registered hook has its own probe entry, and the gate is not claimed without one',
  // docs/FEATURES.md against docs/hook-probe.json against .claude/settings.json
  // — the claim, its evidence, and the roster of what owes evidence. Any of the
  // three moving changes the answer.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  // The roster half is loud from the moment a hook is registered, and that is
  // deliberate: it goes red only for a real, momentary, actionable condition —
  // somebody wired up a hook and recorded nothing about it. Finding AAAA-13 is
  // what it exists to make impossible. While the record held ONE outcome, a
  // second hook inherited the first one's certificate without a sentence
  // anywhere overstating anything; the widening was in the data shape. So the
  // set of entries that must exist is derived from the settings file, and a
  // third hook arrives already owing evidence.
  const coverage = probeCoverage(ROOT);
  for (const name of coverage.missing) {
    const hook = coverage.hooks.find((entry) => entry.name === name);
    failures.push(
      `.claude/settings.json registers ${name} (${hook?.event}) and docs/hook-probe.json has no ` +
        `entry for it. A hook with no entry of its own is one covered by somebody else's ` +
        `evidence.\n      Record it — "unobserved" is an honest entry and satisfies no gate: ` +
        `npm run probe:hook -- ${name} unobserved --exercise "..."`,
    );
  }
  for (const name of coverage.unrecognised) {
    failures.push(
      `docs/hook-probe.json carries an entry for ${name}, which .claude/settings.json no longer ` +
        `registers. Delete the entry in the commit that unregistered the hook rather than ` +
        `leaving evidence about a mechanism that is not in force.`,
    );
  }
  // The other direction of the same agreement. hookIntegrity refuses a CLAIMED
  // hook that is not registered; this refuses a REGISTERED hook that no document
  // claims. Both are needed and neither implies the other: the first stops a
  // document lying about a mechanism, the second stops a hook existing that the
  // claim-anchor cannot protect — because a hook nobody names can be deleted
  // without touching anything outside the file that registers it, which is
  // AAAA-16 all over again.
  const claims = claimedHooks(ROOT);
  for (const hook of coverage.hooks) {
    if (claims.some((claim) => claim.script === hook.script)) continue;
    failures.push(
      `.claude/settings.json registers ${hook.script} and no document names it, so nothing ` +
        `outside that file would notice it being removed.\n      Name it by its full path in ` +
        `docs/FEATURES.md or CLAUDE.md — the claim is what makes unregistering it a red build.`,
    );
  }

  if (coverage.untracked.length > 0) {
    failures.push(
      `.claude/settings.local.json registers ${coverage.untracked.join(', ')}. Those hooks are in ` +
        `force and no tracked entry can ever vouch for them, so this record would be describing ` +
        `a smaller machine than the one you are running on.\n      Move them into ` +
        `.claude/settings.json, where they get an entry, or remove them. The roster is what this ` +
        `repository registers; it cannot become a claim about a file nobody else has.`,
    );
  }

  // The gate half is deliberately quiet until someone claims it. Failing from
  // the moment the row exists would put the build permanently red for work that
  // is correctly outstanding, and a red build nobody caused is a red build
  // people learn to read past — which is how this gate would come to mean
  // nothing.
  //
  // What it does close is the route that actually worries: marking the row done
  // because the mechanism is BUILT. Every part of it is built and proven. The
  // one thing no proof can reach is whether it is ever loaded, and that is the
  // part CLAUDE.md asserts. See scripts/lib/hookProbe.mjs.
  const features = read('docs/FEATURES.md');
  const row = features
    .split('\n')
    .find((line) => line.includes('the PreToolUse write guard has been'));

  if (row === undefined) {
    failures.push(
      'docs/FEATURES.md no longer carries the Stage 0 gate row for the PreToolUse write guard. ' +
        'If the gate was genuinely satisfied and retired, delete this check in the same commit ' +
        'rather than leaving one that inspects nothing.',
    );
  } else if (/\|\s*\*\*done\*\*\s*\|?\s*$/.test(row)) {
    // The gate names ONE mechanism — the escape guard — and says nothing about
    // any other hook. Naming it through the resolver's anchor keeps that
    // narrow: a row claiming this gate can never come to vouch for a hook
    // registered later.
    const { state, detail } = probeState(mechanismName(ANCHOR_SCRIPT, ANCHOR_EVENT), ROOT);
    if (state !== 'fired') {
      failures.push(
        `docs/FEATURES.md marks the tool-use guard gate done, but the guard has not been ` +
          `observed to fire (${state}).\n      ${detail}`,
      );
    }
  }
  },
});

// ---------------------------------------------------------------------------
// 6. The open row is not marked done while the picker has never been driven.
// ---------------------------------------------------------------------------
registerRule({
  name: 'the open clause is not claimed done without a picker the dialog actually drove',
  // docs/FEATURES.md against docs/picker-probe.json against the picker's own
  // source — the claim, its evidence, and the code the evidence is about. The
  // third is why this cannot be per-document: the record expires when
  // `documentPicker.ts` changes, and that file is not a document.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
    // WHAT THIS EXISTS FOR, stated once. The row carried **done** directly above
    // its own sentence saying `documentPicker.ts` has never executed anywhere —
    // a status column contradicting its own body, which is §10.4's display-only
    // sin at document scale and worse than a false body, because a reader takes
    // the status as the contract and may never reach the paragraph.
    //
    // Quiet until somebody claims it, for the reason rule 5 states: a gate that
    // reddens the build for work correctly outstanding is one people learn to
    // read past.
    const features = read('docs/FEATURES.md');
    const row = features
      .split('\n')
      .find((line) => line.includes('**Opening a document —'));

    if (row === undefined) {
      failures.push(
        'docs/FEATURES.md no longer carries the row for opening a document. If the clause was ' +
          'retired, delete this rule in the same commit rather than leaving one that inspects ' +
          'nothing.',
      );
      return;
    }
    if (!/\|\s*\*\*done\*\*\s*\|?\s*$/u.test(row)) return;

    const { state, detail } = pickerProbeState(ROOT);
    if (state !== 'observed') {
      failures.push(
        `docs/FEATURES.md marks the open clause done, and Electron's file dialog has not been ` +
          `observed to return a path (${state}).\n      ${detail}\n      ` +
          `Every other part of opening is proven; this is the one a proof cannot reach, which ` +
          `is why it is executed and recorded rather than asserted.`,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// 7. §9.17 states each budget's numbers exactly once — in the declared line.
// ---------------------------------------------------------------------------
registerRule({
  name: '§9.17 states each budget value once, in the machine-read line',
  // PER-DOCUMENT. Both the declared line and any second statement of the same
  // numbers are inside docs/ARCHITECTURE.md; nothing outside it can make this
  // right or wrong.
  scope: 'per-document',
  documents: ['docs/ARCHITECTURE.md'],
  run(failures) {
  // ADR-0012's first condition, enforced rather than trusted. The whole value of
  // machine-reading the budgets is that a reader of the invariant sees the
  // number the build enforces; a second copy in the surrounding prose destroys
  // that quietly, because the two only have to disagree once and the prose is
  // what a human reads.
  //
  // Parsed from the declared line rather than listed here, so this cannot
  // become the third statement of the same numbers.
  const architecture = read('docs/ARCHITECTURE.md');
  const budgets = memoryBudgets({ text: architecture });

  // §9.17 runs from its own list marker to the next one. Bounded rather than
  // whole-file: ADR-0007's own prose and the amendment log both state these
  // numbers legitimately, and they are not this section.
  const section = /^\s*17\.\s[\s\S]*?(?=^\s*18\.\s)/mu.exec(architecture)?.[0] ?? '';
  if (section === '') {
    failures.push('Could not locate §9.17 in docs/ARCHITECTURE.md to check it for restated budgets.');
  } else {
    const prose = section
      .split('\n')
      .filter((line) => !/^\s*>/u.test(line))
      .join('\n');

    for (const budget of budgets.values()) {
      if (budget.kind !== 'assertable') continue;
      for (const value of [
        `${budget.multiplier}x`,
        `${budget.multiplier}×`,
        budget.absoluteText,
        budget.baselineText,
      ]) {
        if (prose.includes(value)) {
          failures.push(
            `docs/ARCHITECTURE.md §9.17 restates the ${budget.name} budget's "${value}" in prose. ` +
              `The declared line is the only place that section states a value (ADR-0012); the ` +
              `prose names each budget and argues it. Two statements of one number is the drift ` +
              `the machine-read line exists to remove.`,
          );
        }
      }
    }
  }
  },
});

// ---------------------------------------------------------------------------
// 7. The threat model, when it is written, covers the questions that were
//    established before it existed.
// ---------------------------------------------------------------------------
//
// The table and the reasoning behind each entry live in
// scripts/lib/threatModelTopics.mjs — separated so a proof can exercise the
// patterns without running this whole pass, and because "does this document
// raise the question" is a different concern from "do these documents agree".
//
// Applied only when a threat model EXISTS. It is its own scheduled work, and a
// check that fails until then is one somebody disables.
registerRule({
  name: `the threat model raises all ${THREAT_MODEL_TOPICS.length} carried questions`,
  // It FINDS the document by enumerating the corpus rather than naming a path,
  // deliberately — the document does not exist yet and its eventual name is not
  // this rule's to fix. An enumeration is a corpus read.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  const threatModel = trackedFiles().find((path) => /docs\/security\/.*THREAT.*\.md$/iu.test(path));
  if (threatModel !== undefined) {
    for (const problem of unraisedTopics(read(threatModel), threatModel)) failures.push(problem);
  }
  // The condition IS the return value. This is the section that made the old
  // roster false by construction: with no threat model there is nothing to
  // read, and the fixed block printed `ok` for it anyway.
  return threatModel !== undefined;
  },
});

// ---------------------------------------------------------------------------
// 8. The stage audit is owed for a RANGE, and the watermark cannot advance
//    without a record.
// ---------------------------------------------------------------------------
//
// Two properties, and each fails differently.
//
// The watermark and the newest audit the journal records must be the SAME
// STRING. That is what makes an audit claimable only with evidence — the same
// shape as a FEATURES.md row that turns this check red when marked done without
// one.
//
// This used to ask whether the watermark's sha appeared anywhere in the journal,
// which is a search whose reassuring answer any previously recorded sha also
// produces. Comparing two structured values closes both directions instead: a
// watermark advanced with no findings, and findings written without the
// watermark advancing (OO-3b, and see `auditRecordDisagreement`).
//
// And HEAD must be within one batch of the watermark, where "one batch" is the
// median of batches 4 to 7 measured from this repository's own history. Past
// that, the checklist stops being applicable to a diff anybody reads.
registerRule({
  name: "the watermark and the journal's newest audit are the same string, and the range is within one batch",
  // Two documents and git's own history. Nothing here is decided by one blob.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  // FROM THE INDEX, like every other document this file compares. Left to read
  // the file, `auditScope` answers from the working tree, so this check would
  // decide about a pair no commit ever contains — a journal from the index
  // beside a watermark from an unstaged edit. It failed that way, which is how
  // it was found (OO-3a).
  //
  const staged = stagedWatermark(ROOT);
  if (staged === null) {
    throw new Error(
      'docs/audit-watermark.json is not tracked in the index, so the audit gate has nothing to ' +
        'measure from. Absent is not the same as zero: an unreadable watermark makes the ' +
        'unaudited range unknowable, and "unknown" must never be allowed to read as "empty".',
    );
  }
  const scope = auditScope({ root: ROOT, watermark: staged });
  const journal = read('docs/JOURNAL.md');

  const disagreement = auditRecordDisagreement({ journalText: journal, watermark: scope.watermark });
  if (disagreement !== null) failures.push(disagreement);

  // THE NEWEST ENTRY ONLY, and that scope is what keeps this from rewriting
  // history. An audit entry is a record: the three that lost the checklist take
  // an appended correction, never an edit, so a rule that judged every entry
  // would demand the one operation item 7 forbids. Checking the newest is not a
  // weaker rule — every audit is the newest one at the moment it is written, so
  // nothing reaches a commit unchecked.
  const unanswered = unansweredAuditItems(journal);
  if (unanswered !== null) failures.push(unanswered);

  if (scope.overBudget.length > 0) {
    failures.push(
      `The unaudited range ${scope.watermark}..HEAD has grown past one batch: ` +
        `${scope.overBudget.join('; ')}. Run \`npm run audit:scope\` and apply CLAUDE.md's stage ` +
        `audit to that range. The threshold is the MEDIAN of batches 4-7, not the maximum — the ` +
        `maximum was batch 7, the one stretch that was plainly too large to audit as a unit.`,
    );
  }
  },
});

// ---------------------------------------------------------------------------
// 9. Every row in a FEATURES table carries a Status cell.
//
// `docs/FEATURES.md:283` lost its trailing `| **partly done** |` and kept only
// the leading pipe. That is not a malformed row — it is not a ROW. The table
// above it terminates, the item renders as prose with a stray pipe, and it
// appears in no status count. Nothing was red: every check here reads rows it
// can find, and this one had stopped being one.
//
// **An absent status reads exactly like an empty one**, which is DDD-1's
// sentence arriving in a document instead of a report. A FEATURES row is a live
// specification of what is owed, so an item that silently leaves the table is a
// commitment that stops being counted while still looking present.
//
// One occurrence, so this is an instance — the check exists because the way it
// hid is a class.
// ---------------------------------------------------------------------------
registerRule({
  name: 'every row in a FEATURES table has as many cells as its table declares',
  // PER-DOCUMENT, and this is the rule that made the scope necessary. A row's
  // cell count is decided entirely by its own file — measured, when a `|` inside
  // a cell split a row and `check:docs`, run before `git add`, read the previous
  // blob and passed. Nothing outside docs/FEATURES.md can make this right or
  // wrong, so pre-commit can decide it against the index for nothing.
  scope: 'per-document',
  documents: ['docs/FEATURES.md'],
  run(failures) {
  const lines = read('docs/FEATURES.md').split('\n');

  /** A table's separator: `|---|---|`, however many columns. */
  const SEPARATOR = /^\|[\s:|-]+\|$/u;
  /** A line that opens a table row. */
  const OPENS_ROW = /^\|/u;

  /** @type {string[]} */
  const malformed = [];
  let wellFormed = 0;
  let inTable = false;
  let columns = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (SEPARATOR.test(line)) {
      inTable = true;
      columns = line.split('|').length - 2;
      continue;
    }
    if (!OPENS_ROW.test(line)) {
      // A blank line ends the table. Any other prose does too — a row cannot
      // begin without a pipe.
      inTable = false;
      continue;
    }
    if (!inTable) continue;
    const cells = line.split('|').length - 2;
    if (cells === columns) {
      wellFormed += 1;
      continue;
    }
    malformed.push(
      `docs/FEATURES.md:${String(index + 1)} opens a row with ${String(cells)} cell(s) where ` +
        `the table declares ${String(columns)}. It renders as prose and is counted by nothing.` +
        `\n        ${line.slice(0, 110)}…`,
    );
  }

  // THE POSITIVE CONTROL. This is a search, and "no malformed rows" is also
  // what a separator pattern that matches nothing produces — every table would
  // then be invisible and every row skipped, silently.
  if (wellFormed < 20) {
    failures.push(
      `The FEATURES row scan found only ${String(wellFormed)} well-formed rows. It cannot ` +
        `report a missing Status cell if it cannot find the tables, and a low count means the ` +
        `separator or row pattern stopped matching — not that the document shrank.`,
    );
  }
  failures.push(...malformed);
  },
});

// ---------------------------------------------------------------------------
// 11. A FEATURES row this commit edited does not get LONGER once it is past 250
// words (finding RRRR-4).
//
// The trial that produced this: a row was rewritten in a commit whose stated
// intent was compression, and it went from 1470 words to 1756 — up 19% — while
// the report to the owner said it had not been rewritten at all. Nothing was
// lost and the added content was substantive; what failed is that an operation
// meant to shrink a row grew it, and nobody could see that from the diff, which
// showed one line changed.
//
// **The rule is on the DELTA, not the absolute**, and that is what makes it
// compatible with everything around it:
//
//   - it never asks anyone to touch a row they did not edit, so it does not
//     collide with item 7's rule that a live specification is edited only when
//     it is wrong. Four rows are past 1750 words today and none needs touching.
//   - it never forbids adding a fact. The remedy is to move detail into the
//     JOURNAL entry or ADR that owns it and leave a pointer, which is where that
//     detail belongs anyway.
//   - it is computable from the two blobs this commit is between, so it names a
//     number this run produced rather than restating a target. A compensation
//     that could have been printed before the change is a disclaimer.
//
// The 250-word floor is deliberate. Under it a row is short enough that growth
// is not the problem, and a rule that fired on a 40-word row gaining ten would
// be one people learn to ignore.
// ---------------------------------------------------------------------------

/** Below this a row may grow freely: it is short enough that growth is not the defect. */
const ROW_WORD_FLOOR = 250;

/**
 * How many leading words of a row's first cell make its key.
 *
 * Long enough that two rows do not collide by accident — a collision is a hard
 * failure below, so the cost of too few is a build nobody can green — and short
 * enough that editing a row's body does not change its identity, which is the
 * whole reason a key exists here.
 */
const KEY_WORDS = 8;

/**
 * A row's identity: the opening words of its first cell, markup removed.
 *
 * Line NUMBER is not the key and cannot be: inserting a row above shifts every
 * row below it, which would report the whole table as rewritten. That is how
 * RRRR-4's own figure came to be misread — a row measured at 291 before an
 * insert and reported at 291 after it, when it had become 292.
 *
 * **THE LEADING BOLD TITLE WAS NOT THE KEY EITHER, AND THAT WAS THIS
 * FUNCTION'S DEFECT UNTIL 2026-08-30.** It matched `^\|\s*\*\*(.+?)\*\*`, so a
 * row whose first cell does not open in bold appeared in neither map and was
 * judged by nothing. Measured at the moment it bit: `docs/FEATURES.md`'s design
 * substrate row grew from 385 words to 493 in one edit and the rule reported a
 * clean pass. Five rows over the target were invisible, 43 keyed against 204
 * table lines.
 *
 * The failure is 4b's, in a renderer rather than in a search: a row the key
 * cannot see and a row that did not grow produce the same output, and one of
 * them is the answer everybody wants. Keying **every** row is what closes it —
 * the bold title was a convention, and a convention is not a check.
 *
 * @param {string} line one table row, pipes included
 * @returns {string} the key, or the empty string for a line that is not a row
 */
export function featureRowKey(line) {
  if (!/^\|/u.test(line) || /^\|\s*[-:]{3,}/u.test(line)) return '';
  const cell = line.slice(1).split('|')[0] ?? '';
  const words = cell
    // Link TEXT, never the target: a row whose ADR moves keeps its identity,
    // and a path is not what a reader calls the row.
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`]/gu, '')
    .split(/\s+/u)
    .filter(Boolean);
  return words.slice(0, KEY_WORDS).join(' ').toLowerCase();
}

/**
 * Rows keyed by {@link featureRowKey}, with their word counts.
 *
 * A COLLISION THROWS rather than overwriting. Two rows sharing their opening
 * words would silently become one entry, and the survivor's length would then
 * stand in for both — the same shape as the blindness above, one row narrower.
 *
 * @param {string} markdown
 * @returns {Map<string, number>} key → word count
 */
export function featureRowWords(markdown) {
  /** @type {Map<string, number>} */
  const rows = new Map();
  const lines = markdown.split('\n');
  let section = '';
  for (const [index, line] of lines.entries()) {
    const heading = /^#{2,}\s+(.*\S)/u.exec(line);
    if (heading !== null) section = (heading[1] ?? '').trim();
    const opening = featureRowKey(line);
    if (opening === '') continue;
    // A HEADER ROW IS NOT A ROW. It is the line a separator follows, and every
    // table in this document heads its first column the same way — so keying
    // them would collide on the first two tables and take the whole check down.
    // Identified structurally rather than by the word "Feature", which is a
    // convention, and the defect this function had is what a convention
    // standing in for a check costs.
    if (/^\|\s*[-:]{3,}/u.test(lines[index + 1] ?? '')) continue;
    // SCOPED TO ITS SECTION, because two tables legitimately carry a row with
    // the same name — `Typewriter` appears in the annotation table and again in
    // the tool table, and neither is wrong. The section heading is the scope
    // rather than a table ordinal: inserting a table above would renumber every
    // key below it and report the document as wholly rewritten.
    const key = `${section} :: ${opening}`;
    if (rows.has(key)) {
      throw new Error(
        `two docs/FEATURES.md rows under "${section}" open with the same ${String(KEY_WORDS)} ` +
          `words ("${opening}"), so the length ratchet cannot tell them apart and one would ` +
          `stand in for the other. Give one of them a different opening.`,
      );
    }
    rows.set(key, line.split(/\s+/u).filter(Boolean).length);
  }
  return rows;
}

/**
 * Pairs rows whose key changed, so a rewritten opening is judged rather than
 * skipped.
 *
 * A key nobody matched is ambiguous by nature: it is a new row, a deleted row,
 * or a rename. Ruling 3's rule is that **one** unmatched key on each side is a
 * rename and must be paired — a retitled row otherwise reads as new, and a new
 * row is deliberately not judged, so renaming is a way to grow a row past the
 * target with the check green.
 *
 * More than one on each side cannot be paired without guessing, and this
 * refuses rather than guessing. The alternative — pairing by order, or against
 * the smallest previous length — would be a check inventing the comparison it
 * exists to make, which is the reason new rows are not judged in the first
 * place.
 *
 * @param {Map<string, number>} before
 * @param {Map<string, number>} after
 * @returns {{ pairs: [string, number][], ambiguous: { before: string[], after: string[] } | null }}
 */
export function pairRenamedRows(before, after) {
  const goneKeys = [...before.keys()].filter((key) => !after.has(key));
  const newKeys = [...after.keys()].filter((key) => !before.has(key));

  if (goneKeys.length === 0 || newKeys.length === 0) return { pairs: [], ambiguous: null };
  if (goneKeys.length > 1 && newKeys.length > 1) {
    return { pairs: [], ambiguous: { before: goneKeys, after: newKeys } };
  }
  // One side has exactly one, so the pairing is decidable. Every key on the
  // other side is measured against the STRICTEST previous length available —
  // a row split in two, or two rows merged into one, cannot use "it is new" to
  // escape the ceiling it had.
  const strictest = Math.min(...goneKeys.map((key) => before.get(key) ?? 0));
  const pairs = /** @type {[string, number][]} */ (
    newKeys.map((key) => [key, strictest])
  );
  return { pairs, ambiguous: null };
}

/**
 * The whole decision, over two blobs, with no git and no filesystem in it.
 *
 * Separated from the rule so a proof drives **the judgement** rather than the
 * helpers underneath it. A well-tested `featureRowWords` beside an untested
 * decision is the shape where the call site sits inside a feeling of coverage:
 * the keying is where the last defect was, and the floor comparison is where
 * the next one will be.
 *
 * @param {string} previous the blob at HEAD
 * @param {string} current the staged blob
 * @returns {string[]} one message per row that grew past the target
 */
export function judgeRowLengths(previous, current) {
  /** @type {string[]} */
  const failures = [];
  const before = featureRowWords(previous);
  const after = featureRowWords(current);

  // RENAMES FIRST, because a retitled row otherwise reads as new and a new row
  // is deliberately not judged — which makes rewriting the opening a way past
  // the target with the check green.
  const renamed = pairRenamedRows(before, after);
  if (renamed.ambiguous !== null) {
    failures.push(
      `docs/FEATURES.md — ${String(renamed.ambiguous.before.length)} row opening(s) ` +
        `disappeared and ${String(renamed.ambiguous.after.length)} appeared in one commit, so ` +
        `this rule cannot tell a rename from a new row and refuses to guess.\n` +
        `  GONE: ${renamed.ambiguous.before.map((key) => `"${key}"`).join(', ')}\n` +
        `  NEW:  ${renamed.ambiguous.after.map((key) => `"${key}"`).join(', ')}\n` +
        `  Commit the renames separately from the additions, or leave each row's first ` +
        `${String(KEY_WORDS)} words alone while its body changes.`,
    );
    return failures;
  }
  /** @type {Map<string, number>} */
  const previousLength = new Map([...before, ...renamed.pairs]);

  for (const [title, words] of after) {
    const was = previousLength.get(title);
    // A NEW row is not judged here. It has no previous length, so "grew" has
    // no meaning for it — and a rule that guessed one would be inventing the
    // comparison it exists to make.
    if (was === undefined) continue;
    if (words <= ROW_WORD_FLOOR || words <= was) continue;
    failures.push(
      `docs/FEATURES.md — the row "${title.slice(0, 60)}…" grew from ${String(was)} to ` +
        `${String(words)} words (+${String(words - was)}), and it is past the ${String(ROW_WORD_FLOOR)}-word ` +
        `target.\n\n` +
        `  A row is a live specification, and detail past that belongs in the JOURNAL entry or ` +
        `ADR that owns it, with a pointer left behind. Move it there rather than deleting it — ` +
        `nothing here asks you to lose a fact, only to put it where its owner is.\n` +
        `  This fires only on a row THIS commit edited. Rows you did not touch are not its ` +
        `business, whatever their length.`,
    );
  }
  return failures;
}

registerRule({
  name: 'no FEATURES row this commit edited grew past its length target',
  // PER-DOCUMENT: decided entirely by two blobs of one file.
  scope: 'per-document',
  documents: ['docs/FEATURES.md'],
  run(failures) {
    // NARROWLY CAUGHT, and this rule is why the width matters. Written with a
    // bare `catch { return; }` it passed on its first run for the wrong reason:
    // `git` was not imported, the `ReferenceError` landed in the catch, and the
    // rule reported a clean result having read nothing. A catch that cannot tell
    // "no HEAD yet" from "this code is broken" turns every defect in the try
    // block into the answer the check was hoping for.
    /** @type {string} */
    let previous;
    try {
      previous = `${git(['show', 'HEAD:docs/FEATURES.md']).stdout}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The only tolerable absence: no commit yet, so there is no previous
      // length and "grew" has no meaning. Anything else is this rule failing to
      // look, which must be loud.
      if (/unknown revision|bad revision|ambiguous argument/iu.test(message)) return;
      throw error;
    }

    failures.push(...judgeRowLengths(previous, read('docs/FEATURES.md')));
  },
});

/**
 * The failure report, shared by both runners so a committer and CI read the
 * same words about the same defect.
 *
 * @param {string[]} failures
 * @returns {string}
 */
export function explainDocumentFailures(failures) {
  return (
    `\nDocument consistency — ${failures.length} problem(s):\n\n` +
    failures.map((failure) => `  - ${failure}`).join('\n\n') +
    `\n\nThese are facts one document states about another. They drifted because they were ` +
    `maintained by hand, and reviewing the changed file never shows the stale one.\n\n`
  );
}

// `check:docs` runs EVERYTHING — the scope selects, it does not exclude. A
// per-document rule is cheap enough for pre-commit as well, not instead.
if (isMain(import.meta.url)) {
  const result = runDocumentRules();
  if (result.failures.length > 0) {
    process.stderr.write(explainDocumentFailures(result.failures));
    process.exit(1);
  }
  process.stdout.write(result.summary);
}
