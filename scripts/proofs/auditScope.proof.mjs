// @ts-check
/**
 * Proof that the audit watermark gate can fail (rule B2).
 *
 * The gate guards a condition that is false almost all the time — the range is
 * usually within one batch and the sha is usually in the journal — so nothing in
 * ordinary work ever exercises it. A gate never observed to fail is
 * indistinguishable from one that cannot, and this one exists precisely to fire
 * on the day somebody is moving fast.
 *
 * Both halves are checked, and each fails differently:
 *
 *   - **the size threshold**, which must trip past one batch and must NOT trip
 *     below it. Only the second case rules out a gate that is always red, and an
 *     always-red gate gets switched off rather than obeyed;
 *   - **the record requirement**, that the watermark's sha appears in the
 *     journal. This is the half that stops an audit being claimed by advancing
 *     one file.
 *
 * Built over a throwaway repository rather than this one: the assertions are
 * about ranges of history, and shaping real history to trip a threshold is not
 * something a proof should do.
 *
 * Usage: node scripts/proofs/auditScope.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  auditRecordDisagreement,
  auditScope,
  BATCH,
  newestRecordedAudit,
  pendingAuditScope,
  readWatermark,
  stagedWatermark,
  AUDIT_ITEMS,
  unansweredAuditItems,
} from '../lib/auditWatermark.mjs';
import { git as gitAt, parseNameStatus, repoRoot } from '../lib/gitScope.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return `${result.stdout}`.trim();
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-audit-'));

try {
  git(scratch, ['init', '--quiet']);
  git(scratch, ['config', 'user.email', 'proof@example.invalid']);
  git(scratch, ['config', 'user.name', 'proof']);
  mkdirSync(join(scratch, 'docs'), { recursive: true });

  /** @param {string} name @param {string} content */
  const commit = (name, content) => {
    writeFileSync(join(scratch, name), content, 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', `add ${name}`]);
    return git(scratch, ['rev-parse', '--short', 'HEAD']);
  };

  /** @param {string} sha */
  const setWatermark = (sha) => {
    writeFileSync(
      join(scratch, 'docs', 'audit-watermark.json'),
      `${JSON.stringify({ commit: sha, audited: 'proof' }, null, 2)}\n`,
      'utf8',
    );
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'watermark']);
  };

  commit('a.txt', 'a\n');
  // This proof must exist AT the watermark. "Modified" is relative to the last
  // audited commit, not to anywhere inside the range: a proof both added and
  // edited within the range is new coverage the auditor reads whole, and git
  // correctly calls that A. The case that matters — and the one this fixture
  // has to create — is a check that was already audited and has since changed.
  commit('scripts.proof.mjs', 'export const a = 1;\n');
  // A SECOND proof that already existed at the watermark, so it too lands in the
  // MODIFIED column when it changes. Finding V-1: the append-only control used a
  // proof ADDED inside the range, which therefore never reached that column at
  // all — the control looked up an entry that could not exist and passed on not
  // finding it.
  // A vitest TEST that existed at the watermark, and beside it an ordinary
  // source file. Finding W-1: `isProof` matched `*.proof.mjs` and `proofs/`
  // only, so every `*.test.ts` in the workspace was invisible to both columns —
  // and that is where most of this project's controls live. The pair is what
  // makes the widening checkable: without the source file, "counts tests" and
  // "counts everything" produce the same non-empty columns.
  commit('unit.test.ts', 'export const a = 1;\n');
  commit('plain.ts', 'export const a = 1;\n');
  // WW-2's subject: a NON-PROOF SOURCE file that existed at the watermark, so a
  // later edit to it lands in the CHANGED column rather than in none at all.
  // The added-only filter is what hid four converted instruments in one range,
  // and a fixture created inside the range cannot show it — git calls that `A`
  // however many times it is edited afterwards.
  mkdirSync(join(scratch, 'scripts'), { recursive: true });
  commit(join('scripts', 'existing.mjs'), 'export const a = 1;\n');
  const base = commit('appended.proof.mjs', 'export const a = 1;\n');
  setWatermark(base);

  {
    const scope = auditScope({ root: scratch });
    check(
      'a range within one batch does not trip the gate',
      scope.overBudget.length === 0,
      `tripped on ${scope.overBudget.join('; ')} at ${scope.commits} commits — an always-red gate ` +
        `is one somebody switches off, and then neither half protects anything`,
    );
  }

  // Past the threshold, by commits.
  for (let i = 0; i < BATCH.commits + 1; i += 1) commit(`f${i}.txt`, `${i}\n`);

  {
    const scope = auditScope({ root: scratch });
    check(
      'a range past one batch trips the gate',
      scope.overBudget.length > 0 && scope.commits > BATCH.commits,
      `${scope.commits} commits against a threshold of ${BATCH.commits}, and the gate reported ` +
        `${scope.overBudget.length} problem(s). If this passes clean the threshold never fires.`,
    );
  }

  // The columns the report exists for.
  {
    mkdirSync(join(scratch, 'scripts', 'proofs'), { recursive: true });
    writeFileSync(join(scratch, 'scripts', 'proofs', 'fresh.proof.mjs'), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(scratch, 'scripts', 'tool.mjs'), 'export const b = 1;\n', 'utf8');
    // The one that was already audited, now loosened.
    writeFileSync(join(scratch, 'scripts.proof.mjs'), 'export const a = 2;\n', 'utf8');
    // W-1's trio: a test added, a test already audited and changed, and an
    // ordinary source file changed alongside them.
    writeFileSync(join(scratch, 'added.test.ts'), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(scratch, 'unit.test.ts'), 'export const a = 2;\n', 'utf8');
    writeFileSync(join(scratch, 'plain.ts'), 'export const a = 2;\n', 'utf8');
    // WW-2's subject, edited.
    writeFileSync(join(scratch, 'scripts', 'existing.mjs'), 'export const a = 2;\n', 'utf8');
    // X-1's subject: an instrument that is not under scripts/.
    mkdirSync(join(scratch, 'packages', 'kernel', 'src'), { recursive: true });
    writeFileSync(join(scratch, 'packages', 'kernel', 'src', 'probe.ts'), 'export const a = 1;\n', 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'add a proof and a script, and edit an audited proof']);

    const scope = auditScope({ root: scratch });
    check(
      'a proof added since the watermark is reported as ADDED',
      scope.proofsAdded.includes('scripts/proofs/fresh.proof.mjs'),
      `added: ${scope.proofsAdded.join(', ') || '(none)'}`,
    );
    check(
      'a new non-proof script is reported as an instrument to check',
      scope.newScripts.includes('scripts/tool.mjs'),
      `new scripts: ${scope.newScripts.join(', ') || '(none)'} — items 4a and 4b apply to these`,
    );

    // X-1: an instrument is not a directory. This column was scoped to
    // `scripts/` while a filesystem probe landed in packages/kernel/src, doing
    // exactly what 4a and 4b are about.
    check(
      'X-1: a new instrument under a package src is reported too',
      scope.newScripts.includes('packages/kernel/src/probe.ts'),
      `new scripts: ${scope.newScripts.join(', ') || '(none)'} — scoping this column to one ` +
        `directory is the same blind spot as scoping the proof column to one filename shape.`,
    );

    check(
      'CONTROL: a new TEST is not listed as an instrument',
      !scope.newScripts.includes('added.test.ts'),
      `new scripts: ${scope.newScripts.join(', ') || '(none)'} — a test belongs in the proofs ` +
        `column. Without this the widening above is satisfied by listing every added file, ` +
        `which makes the column the file list it sits next to.`,
    );
    check(
      'RESOLUTION: a proof that existed at the watermark and changed is MODIFIED',
      scope.proofsModified.includes('scripts.proof.mjs') &&
        !scope.proofsAdded.includes('scripts.proof.mjs'),
      `added: ${scope.proofsAdded.join(', ') || '(none)'} | modified: ` +
        `${scope.proofsModified.join(', ') || '(none)'} — this is the column the report exists ` +
        `for. A fix that quietly loosened an already-audited check looks exactly like one that ` +
        `corrected it, and merging the two categories hides the only signal there is.`,
    );

    // W-1. A vitest test is a check, and both columns must see one. The
    // instrument reported "proofs ADDED: none" for a range that added 254 lines
    // of test carrying its strongest control, and listed nothing for a test file
    // at +312/−77 whose controls had changed meaning — the reassuring answer,
    // from the column this report calls load-bearing.
    check(
      'W-1: a vitest TEST added since the watermark is reported as ADDED',
      scope.proofsAdded.includes('added.test.ts'),
      `added: ${scope.proofsAdded.join(', ') || '(none)'} — most of this project's controls are ` +
        `in *.test.ts, so a column blind to them answers "found nothing" for a range full of ` +
        `new coverage, which is indistinguishable from a range with none.`,
    );
    check(
      'W-1: a vitest TEST that existed at the watermark and changed is MODIFIED',
      scope.proofsModified.includes('unit.test.ts'),
      `modified: ${scope.proofsModified.join(', ') || '(none)'} — a control whose assertion ` +
        `changed is exactly what this column exists to make someone read.`,
    );
    // WW-2. The instrument column filtered ADDED FILES, so an instrument that
    // already existed and whose behaviour moved was in no column at all — and
    // that was carried as AA-1's granularity limitation on a compensation
    // ("read the modified-PROOF diffs") which by construction cannot reach a
    // file that is not a proof.
    const changed = new Set(scope.changedScripts.map((entry) => entry.path));
    check(
      'WW-2: a source file that existed at the watermark and changed is reported as CHANGED',
      changed.has('scripts/existing.mjs'),
      `changed: ${[...changed].join(', ') || '(none)'} — this is the column WW-2 added. Four ` +
        `research instruments were converted in one range and appeared here in no form; what ` +
        `caught them was running all four, which is diligence and not a mechanism.`,
    );

    // The three controls that stop this column becoming the file list. Each
    // names a file the column MUST NOT contain, and each is a different way the
    // widening could have been satisfied without being right.
    check(
      'CONTROL: an ADDED source file is not also reported as changed',
      !changed.has('scripts/tool.mjs') && scope.newScripts.includes('scripts/tool.mjs'),
      `changed: ${[...changed].join(', ') || '(none)'} — added and changed mean different work ` +
        `for an auditor: one is read whole, the other is read as a diff. A column listing both ` +
        `is satisfied by the case above while telling nobody which is which.`,
    );
    check(
      'CONTROL: a modified PROOF stays in the proofs column and is not double-counted here',
      !changed.has('scripts.proof.mjs') && scope.proofsModified.includes('scripts.proof.mjs'),
      `changed: ${[...changed].join(', ') || '(none)'} — the proofs column carries the reading ` +
        `for a check whose meaning moved. Repeating it here would dilute the column that exists ` +
        `for instruments.`,
    );
    check(
      'CONTROL: a changed file outside every source root is in neither column',
      !changed.has('plain.ts'),
      `changed: ${[...changed].join(', ') || '(none)'} — plain.ts sits at the repository root, ` +
        `which is not a place source lives. Without this, "lists changed source" and "lists ` +
        `every changed file" produce the same non-empty column.`,
    );
    check(
      'and the CHANGED column carries churn, so an auditor can sort rather than skim',
      scope.changedScripts.some((entry) => entry.path === 'scripts/existing.mjs' && entry.net.added > 0),
      `changed: ${JSON.stringify(scope.changedScripts)} — a wall of paths with no figure is ` +
        `skimmed, which reproduces one level up the failure this column was added to stop.`,
    );

    check(
      'CONTROL: an ordinary source file is in NEITHER column',
      !scope.proofsAdded.includes('plain.ts') && !scope.proofsModified.includes('plain.ts'),
      `added: ${scope.proofsAdded.join(', ') || '(none)'} | modified: ` +
        `${scope.proofsModified.join(', ') || '(none)'} — without this, "counts tests" and ` +
        `"counts every changed file" pass the two cases above identically, and the column ` +
        `becomes the file list it sits next to.`,
    );
  }

  // Finding U-2: the column reported the NET range diff, so a line added in one
  // commit and rewritten in a later one showed as an insertion with the deletion
  // nowhere. The column exists to make a loosened check visible; reporting the
  // net turned it into a tree-wide sweep at smaller scale.
  {
    // A rewrite INSIDE the range. Two commits: one appends, the next changes the
    // line it appended.
    writeFileSync(join(scratch, 'scripts.proof.mjs'), 'export const a = 2;\nexport const b = 2;\n', 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'append a line']);
    writeFileSync(join(scratch, 'scripts.proof.mjs'), 'export const a = 2;\nexport const b = 3;\n', 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'rewrite the line just appended']);

    const scope = auditScope({ root: scratch });
    const churn = scope.proofChurn.find((entry) => entry.path === 'scripts.proof.mjs');

    check(
      'RESOLUTION: per-commit churn reports a deletion the NET range diff does not',
      churn !== undefined && churn.perCommit.removed > churn.net.removed,
      `net -${String(churn?.net.removed ?? '?')} vs per-commit -${String(churn?.perCommit.removed ?? '?')}. ` +
        `These must DIFFER on a rewrite inside the range, by the smallest amount that changes a ` +
        `decision — one hidden deletion. Equal figures mean the report is reading one number ` +
        `twice, which is the shape the finding was about.`,
    );

    // Append only, no rewrite: the two figures must AGREE. Without this the case
    // above is satisfied by a report that always claims a difference, which
    // would send an auditor to `git log -p` on every clean range and get the
    // line ignored.
    //
    // The subject is `appended.proof.mjs`, which existed AT the watermark.
    // Finding V-1 was that this used a proof added inside the range: added
    // proofs never enter `proofChurn`, so the lookup returned `undefined` and
    // the guard accepted that as agreement. Item 4b's corollary reaches tests
    // too — an empty lookup is a broken fixture, not a clean result.
    writeFileSync(join(scratch, 'appended.proof.mjs'), 'export const a = 2;\nexport const c = 1;\n', 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'append only']);

    const after = auditScope({ root: scratch });
    const appended = after.proofChurn.find((e) => e.path === 'appended.proof.mjs');
    check(
      'CONTROL: an append-only proof reports the SAME figures both ways',
      // `!==`, never `===`. Not-found must FAIL here: the whole finding was a
      // control that could not locate its own subject and reported success.
      appended !== undefined && appended.net.removed === appended.perCommit.removed,
      `net -${String(appended?.net.removed ?? '(NOT IN THE COLUMN AT ALL)')} vs per-commit ` +
        `-${String(appended?.perCommit.removed ?? '(NOT IN THE COLUMN AT ALL)')} — a report ` +
        `that always differs is a warning nobody reads by the third range, and a control that ` +
        `cannot find its subject is not a control.`,
    );
  }

  // Finding V-2: everything above tests `auditScope`'s DATA, and nothing ran
  // `scripts/audit/scope.mjs` — the report a human actually reads. Deleting the
  // hidden-deletions line entirely passed every case, and that line is the whole
  // of U-2's value: without it the figures are two numbers an auditor has to
  // subtract in their head.
  //
  // The part that changes behaviour is the part being read, so it is the part
  // that needs asserting.
  {
    const report = spawnSync(process.execPath, [join(repoRoot(), 'scripts', 'audit', 'scope.mjs')], {
      cwd: scratch,
      encoding: 'utf8',
    });
    const output = `${report.stdout ?? ''}${report.stderr ?? ''}`;

    check(
      'THE REPORT NAMES the deletions the range diff hides, and how to see them',
      /\d+ deletion\(s\) DO NOT APPEAR/u.test(output) && /git log -p/u.test(output),
      `The rewrite fixture above has a hidden deletion, so the report must say so and name the ` +
        `command that shows it. Printing the two figures and leaving the reader to subtract is ` +
        `the state U-2 was about.\n${output}`,
    );

    // AA-1's honesty half, now narrowed by WW-2. The added-only filter was the
    // reported limit and is fixed; what remains is genuinely granularity — an
    // instrument arriving as a function inside a file the columns DO name. The
    // disclosure is not optional either way, because a deferral nobody can see
    // is the same defect one level up.
    check(
      'THE REPORT DECLARES what the instrument columns still cannot see',
      /granularity/iu.test(output) && /FUNCTION INSIDE/u.test(output),
      `the instrument columns printed their result without saying what they cannot resolve. ` +
        `A column that says "none" and a column that cannot see are the same output.\n${output}`,
    );

    // AAAA-20. THE VERDICT MUST SIT WITH THE COUNTS, because it used to live
    // sixty lines below them and quoting the answer meant assembling two
    // fragments — which is where composing starts. Two reports of this
    // instrument gave figures it never printed, and one of them stated the
    // opposite conclusion to the one at the end of its own output.
    //
    // Asserted on ADJACENCY rather than on presence: the verdict was always
    // present somewhere, so "the output contains it" is satisfied by the broken
    // version too. That is item 4's direction rule — mutate towards the defect,
    // and assert something only the fixed arrangement produces.
    const header = output.split('\n').slice(0, 6).join('\n');
    check(
      'THE VERDICT SITS WITH THE COUNTS, in one block a report can paste whole',
      /commits:/u.test(header) &&
        /files:/u.test(header) &&
        // The VERDICT's own words. Written first as /one batch/, which the counts'
        // own parenthetical — "(one batch is 24)" — already satisfies, so the
        // case passed with the verdict removed. A fixture the defect also
        // produces separates nothing, and this one was written in the same commit
        // as the rule against it.
        /An audit is not yet owed|OVER ONE BATCH|Nothing to audit/u.test(header),
      `The first six lines must carry the range, both counts and the verdict. Presence anywhere ` +
        `is not enough: the verdict was always present, sixty lines away, and a reader who has to ` +
        `assemble two fragments is a reader who will restate them instead.\n${header}`,
    );

    check(
      '  ...and the same verdict appears at the end, from the same writer',
      (output.match(/Within one batch\.|OVER ONE BATCH|Nothing to audit\./gu) ?? []).length === 2,
      `A long report is read from the end as often as from the top, so the verdict prints twice — ` +
        `and two hand-kept copies of a verdict are two verdicts. Exactly two occurrences means one ` +
        `writer produced both.`,
    );

    // AAAA-21. THE ARITHMETIC, NOT THE SHAPE.
    //
    // This asserted `/Fires at \d+ commits, or on the next commit touching a
    // file outside these \d+/` — the line's SHAPE. `\d+` matches whatever the
    // formula produced, so a wrong number passed, and one did: the sentence
    // claimed the file axis fired on the next new file, which is true only at
    // exactly BATCH.files and was false by twenty everywhere else.
    //
    // That is the second fixture-the-defect-also-produces in two commits, and
    // both were in cases enforcing the specificity rule. The pattern is worth
    // more than either instance: **a case about specificity kept checking that
    // specificity was PRESENT rather than CORRECT.** A number is present in the
    // broken version too.
    //
    // So the expectation is recomputed here from BATCH and from the counts the
    // report itself printed, and compared as an exact string. A formula error
    // reddens; a boundary-only truth cannot survive, because headroom is a
    // distance rather than a prediction.
    // ...AGAINST A RANGE THAT IS ACTUALLY WITHIN ONE BATCH, which `scratch` is
    // not: it carries BATCH.commits + 1 commits so the over-budget branch can be
    // tested, and the trigger line never prints there. Written first against
    // `scratch` with a `!/Within one batch/ ||` escape, and the mutation found
    // it green — a case guarded by a condition its own fixture never satisfies.
    //
    // Third fixture-the-defect-also-produces in three commits, all three in
    // cases enforcing the specificity rule. The pattern is the finding: **a case
    // about specificity keeps checking that specificity is PRESENT rather than
    // CORRECT**, and presence survives every mutation that changes a value.
    const small = mkdtempSync(join(tmpdir(), 'monstera-audit-small-'));
    try {
      git(small, ['init', '--quiet']);
      git(small, ['config', 'user.email', 'proof@example.invalid']);
      git(small, ['config', 'user.name', 'proof']);
      mkdirSync(join(small, 'docs'), { recursive: true });
      writeFileSync(join(small, 'base.txt'), 'base\n', 'utf8');
      git(small, ['add', '-A']);
      git(small, ['commit', '--quiet', '-m', 'base']);
      const mark = git(small, ['rev-parse', '--short', 'HEAD']);
      writeFileSync(
        join(small, 'docs', 'audit-watermark.json'),
        `${JSON.stringify({ commit: mark, audited: 'proof' }, null, 2)}\n`,
        'utf8',
      );
      git(small, ['add', '-A']);
      git(small, ['commit', '--quiet', '-m', 'watermark']);

      const within = spawnSync(process.execPath, [join(repoRoot(), 'scripts', 'audit', 'scope.mjs')], {
        cwd: small,
        encoding: 'utf8',
      });
      const report = `${within.stdout ?? ''}${within.stderr ?? ''}`;
      const printedCommits = Number(/commits:\s*(\d+)/u.exec(report)?.[1]);
      const printedFiles = Number(/files:\s*(\d+)/u.exec(report)?.[1]);
      const expectedTrigger =
        `Fires at ${BATCH.commits + 1} commits (${BATCH.commits + 1 - printedCommits} more) or ` +
        `${BATCH.files + 1} files (${BATCH.files + 1 - printedFiles} more).`;

      check(
        '  ...and on a within-budget range the trigger line is ARITHMETICALLY right',
        // No escape clause. If this fixture stops being within budget the case
        // must FAIL rather than pass vacuously, which is what the escape did.
        /Within one batch/u.test(report) &&
          Number.isFinite(printedCommits) &&
          Number.isFinite(printedFiles) &&
          report.includes(expectedTrigger),
        `Both thresholds are BATCH.<axis> + 1, because auditWatermark.mjs compares with strictly ` +
          `greater on EACH axis — so the file axis fires at ${BATCH.files + 1}, not on the next ` +
          `new file. Stating it as the next new file is true only at exactly ${BATCH.files}, ` +
          `which is where the range sat when that sentence was written.\n` +
          `        expected: ${expectedTrigger}\n${report}`,
      );
    } finally {
      rmSync(small, { recursive: true, force: true });
    }

    // The report must also NAME the changed column, not merely compute it. V-2's
    // finding was that every case here tested auditScope's data while the thing
    // a human reads went unasserted, and deleting a whole section passed.
    check(
      'THE REPORT PRINTS the changed-source column with its subject in it',
      /source FILES CHANGED/u.test(output) && /scripts\/existing\.mjs/u.test(output),
      `WW-2's column has to reach the page, not just the return value.\n${output}`,
    );

    check(
      'CONTROL: and it stays silent about a file with nothing hidden',
      !new RegExp(`appended\\.proof\\.mjs\\n[^\\n]*\\n\\s+\\d+ deletion`, 'u').test(output),
      `A report that prints the warning for every file is one nobody reads by the third range. ` +
        `The append-only proof must get figures and no warning.\n${output}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Y-2: the gate must count the commit being made.
  //
  // `auditScope` measures watermark..HEAD, and at pre-commit HEAD is the PARENT.
  // So the commit that takes a range past one batch is invisible to the gate by
  // construction, and the board goes red a push later — measured: check:docs
  // reported 8/8 immediately before 8130551, and CI reported the gate red at
  // 8130551.
  //
  // The two cases that make this checkable are the two directions. Only the
  // refusal, and the gate can be always-red — which is a gate somebody switches
  // off. Only the pass, and it can be vacuous.
  // ---------------------------------------------------------------------------
  {
    setWatermark(git(scratch, ['rev-parse', '--short', 'HEAD']));

    writeFileSync(join(scratch, 'staged-under.txt'), 'x\n', 'utf8');
    git(scratch, ['add', '-A']);

    const committedNow = auditScope({ root: scratch });
    const under = pendingAuditScope({ root: scratch });

    // Without this, "a small change is allowed" is satisfied by a gate that
    // ignores the staged change entirely — which is the defect, passing.
    check(
      'RESOLUTION: the pending commit is counted, not the committed range alone',
      under.commits === committedNow.commits + 1 && under.files.includes('staged-under.txt'),
      `committed ${String(committedNow.commits)} commits / ${String(committedNow.files.length)} ` +
        `files, pending ${String(under.commits)} / ${String(under.files.length)}. The pending ` +
        `scope must be the committed range PLUS this commit, or it is the number that was ` +
        `already too late.`,
    );

    check(
      'a staged change that leaves the range under one batch is allowed',
      under.overBudget.length === 0,
      `tripped on ${under.overBudget.join('; ')} at ${String(under.commits)} commits. An ` +
        `always-red gate is one somebody switches off, and then neither direction protects ` +
        `anything.`,
    );

    git(scratch, ['commit', '--quiet', '-m', 'staged-under']);

    // Take the COMMITTED range to exactly one batch, so the crossing below is
    // caused by the staged change and by nothing else.
    let pad = 0;
    while (auditScope({ root: scratch }).commits < BATCH.commits) {
      commit(`pad${String(pad)}.txt`, 'x\n');
      pad += 1;
    }

    const atLimit = auditScope({ root: scratch });
    check(
      'CONTROL: exactly one batch does not trip, so the crossing is the staged change',
      atLimit.commits === BATCH.commits && atLimit.overBudget.length === 0,
      `${String(atLimit.commits)} committed commits reported ${atLimit.overBudget.length} ` +
        `problem(s). The comparison is \`>\`, so the threshold itself must be allowed — ` +
        `otherwise the case below fires on the range rather than on the pending commit.`,
    );

    writeFileSync(join(scratch, 'crossing.txt'), 'x\n', 'utf8');
    git(scratch, ['add', '-A']);
    const crossing = pendingAuditScope({ root: scratch });

    check(
      'a staged change that takes the range OVER one batch is refused',
      crossing.overBudget.length > 0,
      `the same tree passed as a committed range and must fail as a pending one: ` +
        `${String(crossing.commits)} commits against a threshold of ${String(BATCH.commits)}, ` +
        `and the gate reported nothing.`,
    );

    check(
      'CONTROL: an ordinary commit is not exempt',
      !crossing.recordsAudit,
      `a commit that does not advance the watermark claimed the audit exemption, which switches ` +
        `the gate off for everything.`,
    );

    // The recording commit, and the fixture has to be built with care: advancing
    // the watermark all the way to HEAD empties the range, so the exemption
    // would pass for the wrong reason — the gate simply would not fire. Measured
    // by getting it wrong first.
    //
    // A PARTIAL advance is the case that needs the exemption, and it is not
    // hypothetical: this repository's own watermark records one batch closed in
    // four ranges. The rest of the range stays over budget while the commit that
    // records the audited part is being made.
    git(scratch, ['commit', '--quiet', '-m', 'crossing']);
    const audited = git(scratch, ['rev-parse', '--short', 'HEAD']);
    for (let grown = 0; grown < BATCH.commits + 2; grown += 1) {
      commit(`grow${String(grown)}.txt`, 'x\n');
    }

    writeFileSync(
      join(scratch, 'docs', 'audit-watermark.json'),
      `${JSON.stringify({ commit: audited, audited: 'proof' }, null, 2)}\n`,
      'utf8',
    );
    git(scratch, ['add', '-A']);
    const recording = pendingAuditScope({ root: scratch });

    check(
      'the commit that advances the watermark is exempt, while still over budget',
      recording.recordsAudit && recording.overBudget.length > 0,
      `recordsAudit=${String(recording.recordsAudit)}, overBudget=` +
        `${recording.overBudget.join('; ') || '(none)'}. Both halves matter: the exemption must ` +
        `apply, and it must apply to a tree that WOULD otherwise be refused — otherwise this ` +
        `case passes because the range shrank.`,
    );

    git(scratch, ['commit', '--quiet', '-m', 'record the audit']);
  }

  // ---------------------------------------------------------------------------
  // Z-2: every input comes from the scope the decision is about.
  //
  // `pendingAuditScope` models "the index applied to HEAD". It used to read
  // THREE scopes for one decision — `recordsAudit` from HEAD and the index, and
  // the range from the WORKING TREE, because `auditScope` falls back to
  // `readFileSync`. Measured on this repository with nothing staged at all:
  // index 9303bb5, working tree 8519e64, hook exit 0, where the identical
  // invocation minutes earlier had refused.
  //
  // THIS CASE STAGES NOTHING, and that is the whole point of it. Every case
  // above calls `git add -A`, which moves index and working tree together — and
  // moving together is exactly what the ABSENCE of this bug also produces, so no
  // fixture built that way can separate the two. Item 4's direction rule.
  // ---------------------------------------------------------------------------
  {
    const watermarkFile = join(scratch, 'docs', 'audit-watermark.json');
    const committedRange = pendingAuditScope({ root: scratch });

    check(
      'CONTROL: the range is over budget before the working tree is touched',
      committedRange.overBudget.length > 0,
      `${String(committedRange.commits)} commits reported no problem. The case below asks ` +
        `whether an unstaged edit can make an over-budget range look clean, and it can prove ` +
        `nothing if the range was already clean.`,
    );

    // Read BEFORE the unstaged edit, so the case below is a before/after rather
    // than a comparison of two calls to the same reader (OO-3).
    const indexBeforeEdit = stagedWatermark(scratch);

    // Edit the file and DO NOT stage it. `checkout --` restores it below.
    const head = git(scratch, ['rev-parse', '--short', 'HEAD']);
    writeFileSync(
      watermarkFile,
      `${JSON.stringify({ commit: head, audited: 'never staged' }, null, 2)}\n`,
      'utf8',
    );

    // RESOLUTION: the two scopes must give OPPOSITE answers here, or the case
    // below passes without separating them. This is also the report's own
    // reading, and it stays the working tree deliberately — `audit:scope`
    // describes the tree a human is looking at.
    const fromWorkingTree = auditScope({ root: scratch });
    check(
      'RESOLUTION: the working tree and the index disagree about the range',
      fromWorkingTree.overBudget.length === 0 && committedRange.overBudget.length > 0,
      `working tree reported ${fromWorkingTree.overBudget.join('; ') || 'no problem'} at ` +
        `${String(fromWorkingTree.commits)} commits, index reported ` +
        `${committedRange.overBudget.join('; ') || 'no problem'}. If both scopes agree here the ` +
        `case below is satisfied by a gate reading either one.`,
    );

    const gated = pendingAuditScope({ root: scratch });
    check(
      'an UNSTAGED watermark advance does not shrink the range the gate measures',
      gated.overBudget.length > 0,
      `the gate reported no problem for a tree whose INDEX still carries the old watermark. ` +
        `Editing the file and forgetting to \`git add\` it must not collapse the range — that ` +
        `is the pre-Y-2 failure arriving through the working tree instead of through HEAD.`,
    );

    check(
      'CONTROL: and it earns no exemption either — the exemption is not what fires',
      !gated.recordsAudit,
      `an unstaged edit claimed the audit-recording exemption. It must not, and the reason ` +
        `matters for whoever fixes this next: with an unstaged advance the committed and index ` +
        `watermarks are EQUAL, so the bug above was the range collapsing, not the exemption ` +
        `granting anything. A fix that hardens the exemption does not touch it.`,
    );

    // OO-3a: the SAME rule, for the other caller.
    //
    // Z-2 was closed by converting `pendingAuditScope` to read the watermark
    // from the scope its decision is about. `documentConsistency.mjs` reads
    // every document it compares through the index and then asked `auditScope`
    // for the range with no watermark — so the range came from the working
    // tree. One caller was converted and the other was not.
    //
    // The symptom is a false POSITIVE: `check:docs` failed on a pair no commit
    // would ever contain. It does NOT close the case of a journal entry written
    // without an advance — that exits 0 both before and after, measured both
    // ways, because the sha compared is then the old one and the journal still
    // names it from its own older entry. That is OO-3b and it is open.
    //
    // This case rides the fixture above precisely because that fixture has
    // already been made to disagree across the two scopes.
    const fromIndex = stagedWatermark(scratch);
    check(
      'the STAGED watermark reader answers from the index, not the working tree',
      fromIndex !== null && fromIndex === indexBeforeEdit && fromIndex !== head,
      `stagedWatermark returned ${String(fromIndex)}. It read ${String(indexBeforeEdit)} before ` +
        `the unstaged edit, and the working tree now carries ${head}. An unstaged edit must not ` +
        `move this reader, and returning the tree's value is the defect: a check whose every ` +
        `other input comes from the index would then compare a pair that never co-exists in any ` +
        `single scope.`,
    );

    check(
      'CONTROL: the edit this case rides is genuinely visible to a tree-scoped reader',
      readWatermark(scratch).commit === head && head !== indexBeforeEdit,
      `the working tree reads ${readWatermark(scratch).commit} and the index read ` +
        `${String(indexBeforeEdit)}. If the unstaged write did not actually change what a ` +
        `tree-scoped reader sees, the case above passes against a reader that consults either ` +
        `scope — which is the shape it exists to separate.`,
    );

    git(scratch, ['checkout', '--', 'docs/audit-watermark.json']);
  }

  // ---------------------------------------------------------------------------
  // Two opinions about what a valid watermark IS, and the Z-2 fix routed through
  // the one without the check.
  //
  // `readWatermark` has always required /^[0-9a-f]{7,40}$/. `watermarkAt`
  // accepted any string that parsed as JSON with a string `commit`. Injecting
  // the watermark skipped `readWatermark` entirely — so a staged
  // `{"commit":"HEAD"}` resolved, passed `merge-base --is-ancestor HEAD HEAD`,
  // and yielded a 0-commit range. Before Z-2 the same content threw and the hook
  // failed closed. A fail-closed became a fail-open on the path the fix created.
  //
  // It is Z-1's shape one level up, which is why the regex now lives in ONE
  // place that both readers take.
  // ---------------------------------------------------------------------------
  {
    const watermarkFile = join(scratch, 'docs', 'audit-watermark.json');
    const good = git(scratch, ['rev-parse', '--short', 'HEAD~2']);

    for (const ref of ['HEAD', 'main', '@']) {
      writeFileSync(
        watermarkFile,
        `${JSON.stringify({ commit: ref, audited: 'a ref, not a sha' }, null, 2)}\n`,
        'utf8',
      );
      git(scratch, ['add', 'docs/audit-watermark.json']);

      let refused = '';
      try {
        pendingAuditScope({ root: scratch });
      } catch (error) {
        refused = error instanceof Error ? error.message : String(error);
      }
      check(
        `a staged watermark naming "${ref}" is refused rather than resolved`,
        refused.includes('does not name a commit'),
        `pendingAuditScope ${refused === '' ? 'returned normally' : `threw: ${refused}`}. Every ` +
          `one of these resolves as a git revision, so the ancestor check passes and the range ` +
          `collapses to zero — the gate then permits any commit at all, quietly.`,
      );
    }

    // CONTROL: the refusal is about the VALUE, not about staging a watermark.
    // Without it, "a bogus watermark is refused" is satisfied by a gate that
    // refuses the audit-recording commit too, which is the one it must not.
    writeFileSync(
      watermarkFile,
      `${JSON.stringify({ commit: good, audited: 'proof' }, null, 2)}\n`,
      'utf8',
    );
    git(scratch, ['add', 'docs/audit-watermark.json']);

    let accepted = null;
    let threw = '';
    try {
      accepted = pendingAuditScope({ root: scratch });
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
    check(
      'CONTROL: a staged watermark naming a real sha is still accepted and still exempt',
      accepted !== null && accepted.recordsAudit && accepted.watermark === good,
      `${threw === '' ? `watermark=${String(accepted?.watermark)}, recordsAudit=${String(accepted?.recordsAudit)}` : `it threw: ${threw}`}. ` +
        `A validator that rejects the audit-recording commit blocks the only commit this gate ` +
        `must always let through.`,
    );

    git(scratch, ['checkout', 'HEAD', '--', 'docs/audit-watermark.json']);
  }

  // ---------------------------------------------------------------------------
  // Z-1: the classifier recognised A and M, and this report had a SECOND
  // opinion about `--name-status` from the one in lockfileIntegrity.mjs.
  //
  // The parser is now shared (gitScope.parseNameStatus). These cases are its
  // contract, stated without a repository so a fixture cannot make them pass by
  // accident.
  // ---------------------------------------------------------------------------
  {
    const renamed = parseNameStatus('R090\0old.proof.mjs\0new.proof.mjs\0');
    check(
      'a rename is one entry, reported at its DESTINATION, carrying its source',
      renamed.length === 1 &&
        renamed[0]?.state === 'R' &&
        renamed[0]?.path === 'new.proof.mjs' &&
        renamed[0]?.from === 'old.proof.mjs',
      `parsed ${JSON.stringify(renamed)}. Splitting on tab with no -z made this one entry whose ` +
        `path was two paths joined by a tab, matching no state the classifier recognised.`,
    );

    // The alignment control. A misparse here is not a crash — it is a quiet
    // wrong answer about a DIFFERENT file, which is what makes it worth a case.
    const after = parseNameStatus('R100\0a\0b\0M\0later.proof.mjs\0D\0gone.proof.mjs\0');
    check(
      'CONTROL: entries AFTER a rename stay aligned with their states',
      after.length === 3 &&
        after[1]?.state === 'M' &&
        after[1]?.path === 'later.proof.mjs' &&
        after[2]?.state === 'D' &&
        after[2]?.path === 'gone.proof.mjs',
      `parsed ${JSON.stringify(after)}. Consuming one field for a rename shifts every state onto ` +
        `the wrong path for the rest of the list, and the report still prints figures.`,
    );

    check(
      'a state with no similarity score consumes one path, not two',
      parseNameStatus('M\0a\0M\0b\0').map((entry) => entry.path).join(',') === 'a,b',
      `parsed ${JSON.stringify(parseNameStatus('M\0a\0M\0b\0'))}`,
    );
  }

  // The same three states through the real porcelain, because the parse being
  // right is not the same as the report asking git the right question.
  {
    const churned = Array.from({ length: 30 }, (_, line) => `// line ${String(line)}`).join('\n');
    commit('travelling.proof.mjs', `${churned}\n`);
    // Content distinct from every other fixture file on purpose. An earlier
    // draft gave this and the accented file below the same one line, and git
    // paired them as R100 — so the DELETE case failed while the code was right.
    // Rename detection is content-based; a fixture that wants a delete has to
    // leave nothing for the deleted file to be mistaken for.
    commit('doomed.proof.mjs', 'export const doomed = "removed in this range";\n');
    // DDD-1's fixture, and it has to exist BEFORE the watermark. A file created
    // and deleted inside one range appears in that range's diff not at all, so
    // a fixture built after the mark would exercise the new column with nothing
    // — passing for the same reason a missing column passes.
    //
    // A deleted SOURCE instrument, not a proof: that is the state the source
    // columns could not represent. Distinct content for the reason
    // `doomed.proof.mjs` has it — rename detection is content-based, and a
    // fixture that wants a delete must leave nothing to be paired with.
    commit(
      'scripts/retired.mjs',
      'export const retired = "a research instrument, deleted in this range";\n',
    );
    const mark = git(scratch, ['rev-parse', '--short', 'HEAD']);
    setWatermark(mark);

    // Churn BEFORE the move — this is what a pathspec walk cannot see once the
    // file changes address.
    const beforeMove = 12;
    writeFileSync(
      join(scratch, 'travelling.proof.mjs'),
      `${churned}\n${Array.from({ length: beforeMove }, (_, n) => `// pre ${String(n)}`).join('\n')}\n`,
      'utf8',
    );
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'edit before the move']);

    git(scratch, ['mv', 'travelling.proof.mjs', 'arrived.proof.mjs']);
    writeFileSync(
      join(scratch, 'arrived.proof.mjs'),
      `${churned}\n${Array.from({ length: beforeMove }, (_, n) => `// pre ${String(n)}`).join('\n')}\n// the control was loosened here\n`,
      'utf8',
    );
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'move it and change what it asserts']);

    git(scratch, ['rm', '--quiet', 'doomed.proof.mjs']);
    git(scratch, ['commit', '--quiet', '-m', 'delete a proof']);

    git(scratch, ['rm', '--quiet', 'scripts/retired.mjs']);
    git(scratch, ['commit', '--quiet', '-m', 'delete a source instrument']);

    // core.quotePath defaults true, so without -z this arrives as
    // "caf\303\251.proof.mjs" — a path that matches no glob and resolves to
    // nothing. No such path exists in this repository today, which is an expiry
    // to hold a case against rather than a reason to leave the flag off.
    const accented = 'café.proof.mjs';
    commit(accented, 'export const accented = "a path git would C-quote";\n');

    const scope = auditScope({ root: scratch });

    check(
      'a proof MOVED AND EDITED lands in the modified column, at its destination',
      scope.proofsModified.includes('arrived.proof.mjs') &&
        !scope.proofsModified.includes('travelling.proof.mjs'),
      `proofsModified = ${JSON.stringify(scope.proofsModified)}. A check that changed address AND ` +
        `meaning is exactly what this column's "read each diff" instruction is written for, and ` +
        `it used to appear in no column at all.`,
    );

    check(
      'a DELETED proof is reported as coverage leaving, not as an ordinary file',
      scope.proofsRemoved.includes('doomed.proof.mjs'),
      `proofsRemoved = ${JSON.stringify(scope.proofsRemoved)}. Unlike rename this can fire today: ` +
        `the classifier recognised A and M only, so a deleted proof showed up as one more line in ` +
        `the file count.`,
    );

    check(
      'a DELETED SOURCE INSTRUMENT is reported as coverage leaving (DDD-1)',
      scope.removedScripts.includes('scripts/retired.mjs'),
      `removedScripts = ${JSON.stringify(scope.removedScripts)}. The proofs columns carried ` +
        `added, modified and removed; these carried added and changed only, and a 636-line ` +
        `research instrument was deleted into that gap and named in NO column. An asymmetry ` +
        `between two halves of one classifier is the finding, because nobody audits for a ` +
        `column that does not exist.`,
    );

    check(
      'CONTROL: the deleted source instrument is NOT also reported as added or changed',
      !scope.newScripts.includes('scripts/retired.mjs') &&
        !scope.changedScripts.some((entry) => entry.path === 'scripts/retired.mjs'),
      `newScripts = ${JSON.stringify(scope.newScripts)}, changedScripts = ` +
        `${JSON.stringify(scope.changedScripts.map((entry) => entry.path))}. A path in two ` +
        `columns means the state filters overlap, and the auditor reads a deletion as an ` +
        `instrument that arrived.`,
    );

    check(
      'a non-ASCII path is reported raw, not C-quoted',
      scope.files.includes(accented) && !scope.files.some((path) => path.startsWith('"')),
      `files = ${JSON.stringify(scope.files)}. Without -z git quotes it, and the report names a ` +
        `path that does not exist.`,
    );

    // RESOLUTION, and this is the trap inside the fix rather than a formality.
    //
    // The failure is not the one it looks like from the outside. A pathspec walk
    // does not report the TAIL of the churn — `git log` does no rename detection
    // for pathspec limiting, so the rename commit reports the destination as a
    // NEW FILE and the whole body counts as inserted. Measured on this fixture:
    // 43 insertions against the 13 the range actually made, most of them lines
    // that existed before the watermark. A figure that is too large reads as a
    // big change worth attention, which is a plausible number rather than an
    // obviously broken one — the exact shape item 4a is about.
    //
    // So the case pins the RIGHT number and requires the naive walk to disagree
    // with it. Asserting only "they differ" would pass if `--follow` were wrong
    // in some other way.
    const followed = scope.proofChurn.find((entry) => entry.path === 'arrived.proof.mjs');
    const pathspecOnly = `${
      gitAt(['log', '--numstat', '--format=', `${mark}..HEAD`, '--', 'arrived.proof.mjs'], {
        cwd: scratch,
      }).stdout
    }`
      .split('\n')
      .reduce((total, line) => {
        const [added = ''] = line.trim().split('\t');
        return added === '' || added === '-' ? total : total + Number(added);
      }, 0);

    const churnInRange = beforeMove + 1;
    check(
      'RESOLUTION: per-commit churn follows the rename and counts only the range',
      followed?.perCommit.added === churnInRange && pathspecOnly !== churnInRange,
      `--follow reported ${String(followed?.perCommit.added ?? -1)} insertions where this range ` +
        `made ${String(churnInRange)}; a pathspec-only walk reported ${String(pathspecOnly)}. ` +
        `Both halves are required: the first pins the right number, and the second proves the ` +
        `naive walk gives a different one — without it this case passes for a column that never ` +
        `followed anything.`,
    );
  }

  // An unreachable watermark must throw rather than report an empty range.
  {
    setWatermark('deadbee');
    let threw = false;
    try {
      auditScope({ root: scratch });
    } catch {
      threw = true;
    }
    check(
      'a watermark that is not an ancestor throws rather than reporting nothing to audit',
      threw,
      'an unresolvable watermark produced a range instead of an error, and an empty range reads ' +
        'as "nothing to audit" — the reassuring answer',
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// OO-3b: the record requirement is a COMPARISON, not a search.
//
// "Does this sha appear in the journal" answers yes for any sha the journal has
// ever named, and it names every one of them forever. So the property was
// satisfied by history: it caught a watermark advanced with no entry only while
// the sha happened to be new, and it could never catch an entry written with no
// advance.
// ---------------------------------------------------------------------------
{
  const FIXTURE = [
    '# Build journal',
    '',
    '## 2026-08-21 — Stage audit: `bbbbbbb..ccccccc` — the newest',
    '',
    'prose',
    '',
    '## 2026-08-20 — Stage audit: `aaaaaaa..bbbbbbb` — an older one',
    '',
    'prose',
    '',
  ].join('\n');

  check(
    'CONTROL: the separating fixture is one the ABSENT guard lets through',
    FIXTURE.includes('bbbbbbb'),
    `The case below sets the watermark to bbbbbbb, and its whole value is that the OLD property — ` +
      `"the sha appears in the journal" — is satisfied by this input. If the sha were absent the ` +
      `case would go red against the old check too and separate nothing, which is the ` +
      `negative-probe rule: build the input from something that would SUCCEED without the guard.`,
  );

  check(
    'a watermark naming an OLDER entry is refused, though its sha is in the journal',
    auditRecordDisagreement({ journalText: FIXTURE, watermark: 'bbbbbbb' }) !== null,
    `This is findings-written-without-an-advance: the newest audit ends at ccccccc while the ` +
      `watermark still says bbbbbbb. It passed for as long as the check was a search.`,
  );

  check(
    'a watermark naming no entry at all is refused',
    auditRecordDisagreement({ journalText: FIXTURE, watermark: 'ddddddd' }) !== null,
    `The other direction — a watermark advanced with no findings written — which the search did ` +
      `catch, and which must not be lost in the replacement.`,
  );

  check(
    'and an agreeing pair is accepted',
    auditRecordDisagreement({ journalText: FIXTURE, watermark: 'ccccccc' }) === null,
    `Without this the three cases above are satisfied by a check that refuses everything, which ` +
      `is the always-red gate somebody switches off.`,
  );

  // Asserting the MESSAGE, because the verdict is not this branch's to make. A
  // watermark is always a commit id, so `HEAD` is refused by the mismatch branch
  // whatever the ref check says — the first version of this case asserted
  // `!== null` and survived the mutation that deletes the branch entirely, which
  // is the fixture rule again: the defect produced the expected output.
  const refMessage = auditRecordDisagreement({
    journalText: '## 2026-08-21 — Stage audit: `bbbbbbb..HEAD` — a ref\n',
    watermark: 'ccccccc',
  });
  check(
    'a newest entry naming a REF says so, rather than reporting a puzzling inequality',
    refMessage !== null && /not a commit id/u.test(refMessage),
    `Got: ${JSON.stringify(refMessage)}. Two 2026-08-18 entries name \`..HEAD\`, so this shape is ` +
      `in the document's own history and a maintainer will meet it.`,
  );

  // VACUITY. Every way this parser can break — a renamed section, a changed
  // dash, a heading that wrapped — reports "no audit recorded", and that is the
  // answer the check would most like to give.
  check(
    'a journal the parser cannot read is a PROBLEM, never a pass',
    auditRecordDisagreement({ journalText: '# Build journal\n\nno headings here\n', watermark: 'ccccccc' }) !==
      null && newestRecordedAudit('# Build journal\n') === null,
    `An empty result from a search is a broken lookup, not a clean one. If this returns null the ` +
      `check goes green the moment the heading format changes, and stays green.`,
  );
}

// The real watermark, and the record requirement it rests on.
{
  const watermark = readWatermark(repoRoot());
  check(
    'this repository has a watermark naming a real commit',
    /^[0-9a-f]{7,40}$/u.test(watermark.commit),
    `commit was ${JSON.stringify(watermark.commit)}`,
  );

  // POSITIVE CONTROL, in the instrument's real input rather than in a fixture:
  // the parser must locate something known-present in the document it actually
  // reads, every run. 23 stage-audit headings exist; finding none is a broken
  // parse reporting the reassuring answer.
  const realJournal = readFileSync(join(repoRoot(), 'docs', 'JOURNAL.md'), 'utf8');
  const newest = newestRecordedAudit(realJournal);
  check(
    "the parser finds this repository's own newest audit heading",
    newest !== null && /^[0-9a-f]{7,40}$/u.test(newest.to),
    `newestRecordedAudit returned ${JSON.stringify(newest)} for a journal that carries ` +
      `${String(realJournal.split('\n').filter((line) => /^##.*\bStage audit\b/u.test(line)).length)} ` +
      `stage-audit headings. A parse that finds none reports exactly what a clean document would.`,
  );

  check(
    'and it is the FIRST heading in the file, not merely some heading',
    newest !== null &&
      realJournal.indexOf(newest.heading) ===
        realJournal.search(/^##[^\n]*?\bStage audit\b/mu),
    `matched at ${String(newest === null ? -1 : realJournal.indexOf(newest.heading))}, first ` +
      `heading at ${String(realJournal.search(/^##[^\n]*?\bStage audit\b/mu))}. Entries are ` +
      `prepended, so "newest" is a position claim — a parser that found the last one would agree ` +
      `with the watermark only by accident.`,
  );
}

// ---------------------------------------------------------------------------
// The checklist roster (finding RRRR-1). Three consecutive audit entries carried
// no item headings at all, so the requirement got a caller.
//
// The cases that matter are the two that SEPARATE. A rule reporting every entry
// as incomplete satisfies "it can see" perfectly, and a rule reporting none
// satisfies "it does not false-positive" just as well; only both together say
// anything.
// ---------------------------------------------------------------------------
{
  /** @param {string[]} items */
  const entryAnswering = (items) =>
    [
      '## 2026-01-01 — Stage audit: `aaaaaaa..bbbbbbb` — a probe',
      '',
      ...items.flatMap((item) => [`### ${item}. answered`, '', 'Nothing in this range.', '']),
      '## 2025-12-31 — Stage audit: `ccccccc..aaaaaaa` — the one before',
      '',
    ].join('\n');

  check(
    'an entry answering every item is accepted',
    unansweredAuditItems(entryAnswering(AUDIT_ITEMS)) === null,
    `got a failure for a complete entry. "Nothing in this range" is a valid answer costing one ` +
      `line, and a rule that refused it would push people to write filler instead.`,
  );

  const withoutItem3 = AUDIT_ITEMS.filter((item) => item !== '3');
  const missing3 = unansweredAuditItems(entryAnswering(withoutItem3));
  check(
    'an entry missing ONE item is reported, and the message names which',
    missing3 !== null && missing3.includes('### 3.') && !missing3.includes('### 4.'),
    `got ${JSON.stringify(missing3)}. Naming the missing item is the whole value: "incomplete" ` +
      `sends a reader through eleven headings, and item 3 is the one this rule exists for.`,
  );

  check(
    'an entry with NO item headings is reported as answering none',
    (unansweredAuditItems(entryAnswering([])) ?? '').includes(
      `0 of ${String(AUDIT_ITEMS.length)}`,
    ),
    `that is the founding case — three entries in a row looked exactly like this.`,
  );

  check(
    'a `####` heading counts, so an appended correction can carry the answers',
    unansweredAuditItems(
      entryAnswering(AUDIT_ITEMS).replaceAll(/^### (\d)/gmu, '#### $1'),
    ) === null,
    `an entry is a record, so answers added later arrive under a dated correction and sit one ` +
      `heading level in. Refusing them for their depth would refuse a complete answer set for a ` +
      `property this rule holds no opinion about.`,
  );

  check(
    'the roster is a literal rather than derived from the entry',
    AUDIT_ITEMS.length === 11 && AUDIT_ITEMS.includes('2a') && AUDIT_ITEMS.includes('4c'),
    `AUDIT_ITEMS is ${JSON.stringify(AUDIT_ITEMS)}. The failure to fear makes the set SMALLER ` +
      `(item 4c), so a roster computed from what the entries contain would agree with any ` +
      `omission — which is the defect this rule exists to catch.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nAudit scope proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} audit scope cases passed.\n`);
