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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditScope, BATCH, pendingAuditScope, readWatermark } from '../lib/auditWatermark.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

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

    git(scratch, ['checkout', '--', 'docs/audit-watermark.json']);
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

// The real watermark, and the record requirement it rests on.
{
  const watermark = readWatermark(repoRoot());
  check(
    'this repository has a watermark naming a real commit',
    /^[0-9a-f]{7,40}$/u.test(watermark.commit),
    `commit was ${JSON.stringify(watermark.commit)}`,
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
