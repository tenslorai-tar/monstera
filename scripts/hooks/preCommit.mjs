// @ts-check
/**
 * The pre-commit gate. All checks blocking:
 *
 *   1. Staged content policy (guardFiles.mjs).
 *   2. Emitted-source templates carry no backtick (emittedTemplates.mjs, WW-4).
 *   3. Only an owner renders a thrown value's stack (stackOwnership.mjs,
 *      HHH-2) — only when the commit stages a source file naming the property,
 *      because it costs 21 s and the other two cost under 2 s together.
 *   4. Secret scan of the staged diff (gitleaks).
 *
 * Both fail *closed*. If gitleaks cannot be found, the commit is rejected with
 * instructions rather than allowed through with a warning: a scanner that
 * silently skips itself when absent reports success for a scan that never ran,
 * which is precisely the green-check-that-verifies-nothing this project bans.
 * A rejected commit costs one command; a leaked credential in a public
 * repository's permanent history cannot be undone at any price.
 */

import { explainAuditBudget, pendingAuditScope } from '../lib/auditWatermark.mjs';
import { scan as scanEmittedTemplates } from '../lib/emittedTemplates.mjs';
import {
  report as reportTypeOnlyExports,
  scan as scanTypeOnlyExports,
} from '../lib/typeOnlyExports.mjs';
import { report as reportStagedSyntax, scan as scanStagedSyntax } from '../lib/stagedSyntax.mjs';
import { changedPaths, readStagedBlob } from '../lib/gitScope.mjs';
import { formatDisarmament, hookDisarmament } from '../lib/hookIntegrity.mjs';
import { explainDocumentFailures, runDocumentRules } from './documentConsistency.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  divergenceNotice,
  formatCanaryFailure,
  verifyScannerCapability,
} from '../lib/scannerCanary.mjs';
import { formatSuppressions, runSecretScan } from '../lib/secretScan.mjs';
import { GITLEAKS_VERSION, resolveGitleaks } from '../provision/gitleaks.mjs';
import {
  explainContractDrift,
  runContractProof,
  touchesContractTypes,
} from './contractDrift.mjs';
import { formatFailures, guardFiles } from './guardFiles.mjs';
import { checkLockfile, explain, touchesDependencies } from './lockfileIntegrity.mjs';

/** Extensions the stack-ownership scan can reach. */
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;

/**
 * Whether this commit stages a source file whose STAGED content names the
 * property. Read from the index, because a working-tree read passes a commit
 * whose staged content is the one that introduces the defect.
 *
 * The token, not the property access: this decides whether to spend twenty
 * seconds, and the scan itself decides what is a finding. Over-triggering costs
 * time; under-triggering costs a public commit.
 *
 * @returns {boolean}
 */
function stagesAStackRead() {
  return changedPaths(['--cached'])
    .filter((entry) => entry.state !== 'D' && SOURCE_EXTENSIONS.test(entry.path))
    .some((entry) => {
      const blob = readStagedBlob(entry.path);
      return blob !== null && /\bstack\b/u.test(`${blob}`);
    });
}

/**
 * @returns {Promise<number>} 0 when the tree is clean, 1 otherwise.
 */
async function runStackOwnership() {
  // Imported here rather than at the top: this module loads the TypeScript
  // compiler, and a commit that stages no stack read should not pay for it.
  const { report, scan } = await import('../lib/stackOwnership.mjs');
  const result = await scan();
  if (result.blind) {
    process.stderr.write(
      `\n${report(result)}\n` +
        `Commit blocked — the stack-ownership scan could not see, so its silence means\n` +
        `nothing. That is not the same as a clean tree.\n\n`,
    );
    return 1;
  }
  if (result.findings.length + result.unresolved.length === 0) return 0;
  process.stderr.write(
    `\n${report(result)}\n` +
      `Commit blocked — an Error's stack is read outside an owner (reported above).\n\n` +
      `\`Error.prototype.stack\` does not include \`cause\`, and the cause's errno is usually\n` +
      `the diagnosis. Sixteen sites were fixed by hand on 2026-08-20 and a seventeenth was\n` +
      `written on 2026-08-21, which is why this is a check and not a rule.\n\n`,
  );
  return 1;
}

async function main() {
  // Before anything else: is the tool-use guard actually in force? A settings
  // file at a higher-precedence scope can carry `disableAllHooks` or a competing
  // `hooks` block, and neither appears in any diff. Checked HERE rather than in
  // the Claude Code hook because a hook cannot detect its own absence.
  const disarmed = hookDisarmament();
  if (disarmed.length > 0) {
    process.stderr.write(formatDisarmament(disarmed));
    return 1;
  }

  const failures = guardFiles('staged');
  if (failures.length > 0) {
    process.stderr.write(formatFailures(failures, 'staged'));
    return 1;
  }

  // WW-4. This scan lived only on the Guards job, and that is the wrong place
  // for it by the escape guard's own argument: a backtick in an emitted template
  // is composed at authoring time, and a check that runs at review time catches
  // it after the commit is public — which B10 makes permanent.
  //
  // Not a lament about occurrence four, which was mine, one commit after I
  // shipped the check, as its author. That is the ARGUMENT: what stopped it was
  // a hand-run `node --check`, which is me remembering, and remembering is the
  // thing a mechanism replaces. The escape guard is the precedent and it is
  // exact — the rule was written down for seven occurrences before a hook made
  // the path unavailable rather than forbidden.
  //
  // Scanned against the INDEX. Reading the working tree would pass a commit
  // whose staged content is broken.
  const templates = scanEmittedTemplates({ source: 'staged' });
  if (templates !== 0) {
    process.stderr.write(
      `\nCommit blocked — an emitted-source template carries a backtick (reported above).\n\n` +
        `A backtick pair inside a String.raw that holds a program we write to disk CLOSES the\n` +
        `literal and reopens it, so the parser blames whatever follows and names a line that is\n` +
        `fine. Four occurrences, the third in a file whose own header carried the rule and the\n` +
        `fourth one commit after this scan shipped.\n\n` +
        `Concatenate with + instead, or move the prose out of the emitted body.\n\n`,
    );
    return 1;
  }

  // ADR-0026's class, the half no lint rule covers (PPPP-2).
  // `no-import-type-side-effects` registers `ImportDeclaration` only, and
  // `consistent-type-exports` treats an inline `type` specifier as already
  // satisfying it — so `export { type X } from './y.js'` emits
  // `export {} from './y.js'`, a runtime load, and is reported by neither.
  //
  // Here rather than CI only, for WW-4's reason: a CI-only guard catches the
  // defect after the commit is public, and B10 makes that permanent.
  //
  // AGAINST THE INDEX, and never blind (finding QQQQ-1's remedy).
  //
  // This used to be `emittedSideEffects.mjs`, which reads `dist`. Registered
  // fail-closed it blocked every case in `proof:guards`, whose fixture
  // repository has no build and legitimately never will; softened to
  // report-and-continue it contributed nothing on a machine where nobody runs
  // `tsc`, and printed one line that was furniture by its third reading. A gate
  // keyed on whether something is installed has a side that never executes where
  // the thing is always present.
  //
  // `export { type X } from './y.js'` and `export type { X } from './y.js'` are
  // different TEXT, so this spelling needs no build to decide — which is what
  // makes an index read possible and removes the blind state entirely. The emit
  // scan stays in CI as the completeness control over both halves, answering
  // *did a build emit one* rather than *did you write one*.
  const typeOnly = scanTypeOnlyExports();
  if (typeOnly.blind !== null || typeOnly.violations.length > 0) {
    process.stderr.write(`\n${reportTypeOnlyExports(typeOnly)}`);
    process.stderr.write(
      typeOnly.blind !== null
        ? `\nCommit blocked — the type-only export scan could not see (reported above).\n\n`
        : `\nCommit blocked — a re-export will emit a runtime load (reported above).\n\n` +
            `An inline \`type\` marker elides the SPECIFIERS and keeps the STATEMENT. One of\n` +
            `these cost the kernel barrel 41.7 MB, because the module it kept loading bound\n` +
            `MuPDF at module scope (ADR-0026). No rule in the pinned plugin reports it.\n\n`,
    );
    return 1;
  }

  // UUU-2, AND IT IS THE PARAGRAPH ABOVE APPLIED TO ITSELF.
  //
  // That comment says what stopped occurrence four was a hand-run `node
  // --check` — "me remembering, and remembering is the thing a mechanism
  // replaces" — and then does not add the parse. On 2026-08-23 a
  // comment-closing sequence inside a JSDoc block, from a sed expression quoted
  // in prose, broke a file. Same class as the backtick: prose and code sharing
  // a delimiter, composed while writing about something else. The scan above
  // cannot see it, because it looks for a different delimiter.
  //
  // The generalising guard is not a third delimiter-specific scan. It is ASKING
  // THE PARSER, which catches that class and every other way a file stops being
  // parseable, at milliseconds per file.
  //
  // SCOPE, stated rather than left to be discovered: JavaScript only. `.ts` is
  // out because `node --check` reads JavaScript and would report every
  // annotated file as broken; `tsc` covers those in `npm run typecheck`. So
  // this closes the JavaScript half and leaves the TypeScript half exactly
  // where it was.
  const syntax = scanStagedSyntax();
  if (syntax.blind !== null || syntax.problems.length > 0) {
    process.stderr.write(`\n${reportStagedSyntax(syntax)}`);
    process.stderr.write(
      syntax.blind !== null
        ? `\nCommit blocked — the syntax check could not see (reported above).\n\n`
        : `\nCommit blocked — a staged JavaScript file does not parse (reported above).\n\n` +
            `The file on disk may be fine: this reads the INDEX, so staging a broken file and\n` +
            `then fixing it leaves the broken bytes in the commit. Re-stage after fixing.\n\n`,
    );
    return 1;
  }

  // HHH-2. WW-4's argument applies here unchanged: a guard that runs only in CI
  // catches the defect after the commit is public, and B10 makes that
  // permanent. It applies with unusual force to this class — the seventeenth
  // `.stack` handler was written ONE DAY after the sixteen were fixed, in
  // ordinary work.
  //
  // The counterweight is real and measured. `check:stackowner` builds a
  // TypeScript Program per project: 21.2 s, 20.5 s, 21.5 s over three runs,
  // against 1.0 s for the emitted-template scan and 0.7 s for the file guard.
  // Twenty seconds on every commit is how a hook becomes something people
  // bypass, and `--no-verify` on this repository is a Rule 0 violation with a
  // permanent public consequence. Making the gate painful raises the odds of
  // the one action the project most forbids.
  //
  // So it runs on the commits that can INTRODUCE the defect, and the trigger is
  // read from the INDEX: a new Error-stack read requires the token in a staged
  // source file. Cost is a grep over staged blobs on every other commit.
  //
  // THE RESIDUAL, stated rather than implied: a type change elsewhere can turn
  // an existing access from a declared field into an Error's stack without any
  // staged file naming it. That commit is not scanned here and is caught by CI.
  // And unlike `emittedTemplates`, this scan reads the WORKING TREE — the
  // compiler needs a file system, and materialising the index into one is a
  // different unit of work. A commit that stages a defect and then fixes it
  // without staging the fix is not seen here.
  if (stagesAStackRead()) {
    const stack = await runStackOwnership();
    if (stack !== 0) return stack;
  }

  // THE PER-DOCUMENT DOCUMENT RULES, against the index (finding AAAA-9).
  //
  // `check:docs` as a whole takes ~48 seconds and stays in Guards. But its rules
  // split by what decides them, and the ones decided entirely by ONE staged blob
  // — a markdown row's cell count, a budget stated twice in the same file — cost
  // nothing and close the class that went public: a `|` inside a FEATURES cell
  // split a row, `check:docs` was run before `git add` so it read the previous
  // blob and passed, and CI was the first thing that could see it. B10 makes
  // that commit permanent.
  //
  // The whole-corpus rules cannot come with it. A withdrawn phrase surviving in
  // a document nobody touched is broken by a DIFFERENT file's change, so
  // scoping it to the staged set would be scoping it to the wrong thing.
  {
    const staged = changedPaths(['--cached'])
      .filter((entry) => entry.state !== 'D')
      .map((entry) => entry.path);
    const documents = runDocumentRules({ scope: 'per-document', documents: staged });

    // A SCOPING EXPRESSION THAT MATCHES NOTHING PRODUCES THE REASSURING ANSWER,
    // and this repository has been bitten by that twice in eight commits. The
    // REGISTERED count is what must be non-zero — a run where no per-document
    // rule applies because neither of their documents is staged is a legitimate
    // zero and is reported as itself.
    if (documents.registered === 0) {
      process.stderr.write(
        '\nNo rule in documentConsistency.mjs declares scope per-document, so this gate ran ' +
          'nothing.\n  That is a broken selection rather than a clean commit: the whole point ' +
          'of the scope is that\n  some rules are cheap enough to run here, and a selection ' +
          'matching none of them reports\n  success for a check that did not happen.\n',
      );
      return 1;
    }
    process.stdout.write(
      `  ${String(documents.selected)} of ${String(documents.registered)} per-document ` +
        `rule(s) apply to this commit's staged documents\n`,
    );
    if (documents.failures.length > 0) {
      process.stderr.write(explainDocumentFailures(documents.failures));
      return 1;
    }
  }

  // Only when the commit touches dependency resolution — it costs a few
  // seconds, and nothing else can break the lockfile.
  if (touchesDependencies()) {
    const lockfile = checkLockfile();
    if (!lockfile.ok) {
      process.stderr.write(explain(lockfile.output));
      return 1;
    }
  }

  // Only when the commit can change what the contract proof compiles against.
  // It costs about fifty seconds, and it is the only check here that a running
  // `typecheck` cannot substitute for — the proof's fixtures are strings. See
  // contractDrift.mjs for the two occurrences that made this a mechanism rather
  // than a rule.
  if (touchesContractTypes()) {
    const proof = runContractProof();
    if (!proof.ok) {
      process.stderr.write(explainContractDrift(proof.output));
      return 1;
    }
  }

  // The audit budget, counted WITH the commit being made. `check:docs` measures
  // watermark..HEAD, where HEAD is the parent at this moment, so the commit that
  // crosses one batch is invisible to it and the board goes red a push later.
  // Blocking here is the same move the contract-drift gate makes: a red board
  // nobody reads becomes a commit that does not happen.
  const budget = pendingAuditScope();
  if (!budget.recordsAudit && budget.overBudget.length > 0) {
    process.stderr.write(explainAuditBudget(budget));
    return 1;
  }

  const binary = await resolveGitleaks();
  if (binary === null) {
    process.stderr.write(
      `\nCommit blocked — the secret scanner is not installed, so nothing was scanned.\n\n` +
        `  Run:  node scripts/provision/gitleaks.mjs\n\n` +
        `That downloads gitleaks ${GITLEAKS_VERSION} against a pinned SHA-256 into .tools/ ` +
        `(gitignored — Part J forbids binaries in git).\n\n` +
        `This hook refuses to pass a commit it did not scan. Skipping the check when the ` +
        `scanner is missing would report success for a scan that never ran.\n\n`,
    );
    return 1;
  }

  // The binary exists and runs. That is not the same as it being able to find a
  // secret — see scripts/lib/scannerCanary.mjs. Cached against the binary's own
  // hash, so this is a file read on all but the first commit after a scanner
  // changes.
  const canary = verifyScannerCapability({ binary, pinnedVersion: GITLEAKS_VERSION });
  if (!canary.ok) {
    process.stderr.write(formatCanaryFailure(canary, GITLEAKS_VERSION));
    return 1;
  }
  process.stderr.write(divergenceNotice(canary, GITLEAKS_VERSION));

  const scan = runSecretScan({ binary, staged: true });
  if (scan.blocked.length > 0) {
    process.stderr.write(formatSuppressions(scan.blocked));
    return 1;
  }

  const status = scan.status;
  if (status !== 0) {
    process.stderr.write(
      `\nCommit blocked — gitleaks found a secret in the staged changes (shown redacted above).\n\n` +
        `Remove it from the staged content. If it is a real credential, treat it as ` +
        `compromised and rotate it: assume anything that reaches a public repository is ` +
        `public the moment it is pushed.\n\n` +
        `If it is a genuine false positive, add a narrow [allowlist] entry to .gitleaks.toml ` +
        `in its own commit, naming the finding and why it is not a secret. That is the only ` +
        `suppression route left open: inline gitleaks:allow comments and .gitleaksignore files ` +
        `are both closed, because neither ever appears in a diff.\n\n`,
    );
  }
  return status;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(
      `\nCommit blocked — the pre-commit guard itself failed:\n` +
        `${formatError(error)}\n\n` +
        `A guard that errors is treated as a guard that found something. Fix the guard.\n\n`,
    );
    process.exit(1);
  },
);
