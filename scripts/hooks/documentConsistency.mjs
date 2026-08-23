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

import { auditRecordDisagreement, auditScope, stagedWatermark } from '../lib/auditWatermark.mjs';
import { filesInCommit, readStagedBlob, repoRoot } from '../lib/gitScope.mjs';
import { probeState } from '../lib/hookProbe.mjs';
import { isMain } from '../lib/isMain.mjs';
import { memoryBudgets } from '../lib/memoryBudgets.mjs';
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
    // The dash class covers em, en and hyphen. The first version of this check
    // omitted the EM dash, which is the one the ADRs actually use — so it found
    // no corrections at all and reported that half as passing. A check that
    // cannot match its subject is indistinguishable from a subject that is
    // clean, which is the failure this whole file exists to prevent.
    const corrected = /^>\s*##\s*Correction\s*[—–-]\s*\d{4}-\d{2}-\d{2}/m.test(body);
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
// 5. The Stage 0 gate on the tool-use guard is marked done only when the guard
//    has actually been observed to fire.
// ---------------------------------------------------------------------------
registerRule({
  name: 'the tool-use guard gate is not claimed before the guard was seen to fire',
  // docs/FEATURES.md against docs/hook-probe.json — the claim and its evidence
  // are two files, and either one moving changes the answer.
  scope: 'whole-corpus',
  documents: [],
  run(failures) {
  // Deliberately quiet until someone claims the gate. Failing from the moment
  // the row exists would put the build permanently red for work that is
  // correctly outstanding, and a red build nobody caused is a red build people
  // learn to read past — which is how this gate would come to mean nothing.
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
    const { state, detail } = probeState(ROOT);
    if (state !== 'denied') {
      failures.push(
        `docs/FEATURES.md marks the tool-use guard gate done, but the guard has not been ` +
          `observed to fire (${state}).\n      ${detail}`,
      );
    }
  }
  },
});

// ---------------------------------------------------------------------------
// 6. §9.17 states each budget's numbers exactly once — in the declared line.
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
