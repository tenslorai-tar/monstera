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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { filesInCommit, repoRoot } from '../lib/gitScope.mjs';
import { probeState } from '../lib/hookProbe.mjs';
import { memoryBudgets } from '../lib/memoryBudgets.mjs';
import { declaredPhrases, liveClaims } from '../lib/withdrawnPhrases.mjs';

// The root is asked of git, in one place, for the same reason the scope is:
// this file used to fall back to `resolve(__dirname, '..', '..')` when
// `rev-parse` failed, which is a second answer to a question that must have one.
// A fallback that silently substitutes a different repository is worse than an
// error, because the checks then pass against a tree nobody is committing to.
const ROOT = repoRoot();

/** @param {string} relativePath @returns {string} */
function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
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

/** @type {string[]} */
const failures = [];

// ---------------------------------------------------------------------------
// 1. The invariant count in the digest matches the law.
// ---------------------------------------------------------------------------
{
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
}

// ---------------------------------------------------------------------------
// 2. The ADR index lists every ADR, and does not assert a status the file
//    contradicts.
// ---------------------------------------------------------------------------
{
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
}

// ---------------------------------------------------------------------------
// 3. Every scripts/ path named in a tracked text document actually resolves.
// ---------------------------------------------------------------------------
{
  const documents = trackedFiles().filter((path) =>
    /\.(md|ya?ml|json|gitattributes)$|^\.gitattributes$/.test(path),
  );

  for (const document of documents) {
    // package-lock is machine-written and enormous; nothing in it names a script.
    if (document === 'package-lock.json') continue;

    const text = readFileSync(join(ROOT, document), 'utf8');
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
}

// ---------------------------------------------------------------------------
// 4. No document states, as a live claim, something an ADR's correction
//    withdrew.
// ---------------------------------------------------------------------------
{
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
}

// ---------------------------------------------------------------------------
// 5. The Stage 0 gate on the tool-use guard is marked done only when the guard
//    has actually been observed to fire.
// ---------------------------------------------------------------------------
{
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
}

// ---------------------------------------------------------------------------
// 6. §9.17 states each budget's numbers exactly once — in the declared line.
// ---------------------------------------------------------------------------
{
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
}

if (failures.length > 0) {
  process.stderr.write(
    `\nDocument consistency — ${failures.length} problem(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nThese are facts one document states about another. They drifted because they were ` +
      `maintained by hand, and reviewing the changed file never shows the stale one.\n\n`,
  );
  process.exit(1);
}

process.stdout.write('  ok  CLAUDE.md cites the invariant count ARCHITECTURE §9 defines\n');
process.stdout.write('  ok  every ADR is indexed, and no index row contradicts its file\n');
process.stdout.write('  ok  every scripts/ path named in a tracked document resolves\n');
process.stdout.write('  ok  no document states a claim an ADR correction withdrew\n');
process.stdout.write('  ok  the tool-use guard gate is not claimed before the guard was seen to fire\n');
process.stdout.write('  ok  §9.17 states each budget value once, in the machine-read line\n');
process.stdout.write('\n6 document consistency checks passed.\n');
