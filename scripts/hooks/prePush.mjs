// @ts-check
/**
 * The pre-push gate: when a push changes a file the advisory register's
 * verdicts rest on, the register is checked before the push (finding GG-1).
 *
 * ## Three occurrences, all at push, all the same shape
 *
 * A commit changed a file `docs/security/engine-advisories.json`'s reachability
 * verdicts scan; nobody ran `check:advisories`; the board went red. Twice on
 * 2026-08-22 with the same file and the same neighbour run instead
 * (`check:advisories` rather than `proof:advisories`), and a third time when
 * `apps/desktop/src/rendererHarnessMain.ts` began naming the diagnostic type and
 * expired a verdict on the first push.
 *
 * GG-1 recorded the rule — *when a commit adds a file to a directory some proof
 * scans, that proof is in the pre-commit set* — and this project has written
 * three times that a rule you must recall at the moment you type a command is
 * not a remedy. The third occurrence was by the agent that wrote the second
 * one's entry.
 *
 * ## Why this one IS derivable, when GG-1 said the mapping was not
 *
 * GG-1's stated obstacle is that proofs address their inputs by construction —
 * `join(ROOT, 'docs', …)` — so no literal path exists to grep for. That is true
 * of proofs and **false of the register**: its `shippedPaths`, witness `in` and
 * control `from` entries are literal strings in a tracked JSON file, put there
 * so `git grep` can use them. The mapping already exists as data; this reads it.
 *
 * So GG-1 narrows rather than closes. The general mapping is still undecided;
 * one member of it is not, and it is the member that produced all three
 * occurrences.
 *
 * ## Pre-push, not pre-commit
 *
 * All three occurrences were at push, and the cost belongs where the harm is. A
 * commit that will be amended or rebased has not published anything; a push has.
 *
 * ## Offline and deterministic
 *
 * The run passes `--recorded-advisories`. What expires a verdict is the
 * reachability walk — the baseline, `git grep`, and the compiler — and none of
 * that consumes the feed; the advisory list drives triage only. So the local
 * gate reads the recording and cannot fail because a third party was
 * unreachable, which is the property that keeps a hook from being disabled.
 *
 * `check:advisories` itself still fetches, and a case in
 * `advisoryRegister.proof.mjs` requires that.
 *
 * ## The positive control
 *
 * This is a search: its reassuring answer is *this push touches nothing the
 * register watches*, which is also what an unreadable register, an empty glob
 * set and a broken range all produce. So the glob set must be non-empty AND at
 * least one glob must match a tracked file, every run, or the hook refuses.
 *
 * Usage: git push (via .githooks/pre-push), or
 *        node scripts/hooks/prePush.mjs --explain
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git, repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();
const REGISTER = join(ROOT, 'docs', 'security', 'engine-advisories.json');
const CHECKER = join(ROOT, 'scripts', 'security', 'engineAdvisories.mjs');

/** Git's all-zero sha, meaning "this ref does not exist on the remote yet". */
const NO_REMOTE = /^0+$/u;

/**
 * Every pathspec the register's verdicts rest on, read from the register.
 *
 * Three sources, and all three are inputs a verdict can be invalidated by: the
 * scanned scope, the scope each witness is found in, and the scope each control
 * proves resolves. Taking only the first would leave a change that breaks a
 * witness unchecked, and a witness that stops resolving is how a verdict goes
 * green forever.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function watchedPathspecs(root = ROOT) {
  const text = readFileSync(join(root, 'docs', 'security', 'engine-advisories.json'), 'utf8');
  const baseline = JSON.parse(text);
  /** @type {Set<string>} */
  const globs = new Set();
  for (const claim of Object.values(baseline.reachability ?? {})) {
    for (const glob of claim.shippedPaths ?? []) globs.add(glob);
    for (const witness of Object.values(claim.witness ?? {})) {
      for (const glob of witness.in ?? []) globs.add(glob);
    }
  }
  for (const control of baseline.reachabilityControl ?? []) {
    for (const glob of control.from ?? []) globs.add(glob);
  }

  if (globs.size === 0) {
    // An empty intermediate result is a broken parse, not a register that
    // watches nothing. Every push would then be reported as touching nothing.
    throw new Error(
      `No pathspecs were read from ${REGISTER}. That is a broken read, not a register with no ` +
        `verdicts, and "this push touches nothing watched" would be an artefact of it.`,
    );
  }
  return [...globs];
}

/**
 * THE POSITIVE CONTROL. At least one watched pathspec must match a tracked
 * file. A glob that matches nothing reports "not touched" for every push, and
 * so does a glob whose syntax git stopped understanding.
 *
 * Asked of git with the same pathspecs the register hands `git grep`, so there
 * is one opinion about what a glob means (B3a).
 *
 * @param {readonly string[]} globs
 * @param {string} [root]
 * @returns {boolean}
 */
export function anyGlobResolves(globs, root = ROOT) {
  return `${git(['ls-files', '--', ...globs], { cwd: root }).stdout}`.trim() !== '';
}

/**
 * The ranges this push would publish, from git's own stdin protocol.
 *
 * @param {string} input The hook's stdin: `<localRef> <localSha> <remoteRef> <remoteSha>`.
 * @returns {{ ranges: string[], unknown: boolean }} `unknown` when a ref is new
 *   on the remote, so there is no range to diff and the answer must be "check".
 */
export function pushedRanges(input) {
  /** @type {string[]} */
  const ranges = [];
  let unknown = false;
  for (const line of input.split('\n')) {
    const parts = line.trim().split(/\s+/u);
    if (parts.length < 4) continue;
    const localSha = parts[1] ?? '';
    const remoteSha = parts[3] ?? '';
    if (NO_REMOTE.test(localSha)) continue; // a deletion publishes no content
    if (NO_REMOTE.test(remoteSha)) {
      unknown = true;
      continue;
    }
    ranges.push(`${remoteSha}..${localSha}`);
  }
  // No parseable line at all: run by hand, or a protocol that changed. Either
  // way the honest answer is "cannot tell", and the safe one is to check.
  if (ranges.length === 0 && !unknown) unknown = true;
  return { ranges, unknown };
}

/**
 * @param {string} input The hook's stdin.
 * @param {string} [root]
 * @returns {{ check: boolean, why: string, globs: string[] }}
 */
export function decide(input, root = ROOT) {
  const globs = watchedPathspecs(root);
  if (!anyGlobResolves(globs, root)) {
    throw new Error(
      `None of the register's ${String(globs.length)} watched pathspecs matches a tracked file. ` +
        `A glob that matches nothing answers "not touched" for every push, and so does one git ` +
        `no longer understands. Refusing rather than reporting a clean push.`,
    );
  }

  const { ranges, unknown } = pushedRanges(input);
  if (unknown) {
    return {
      check: true,
      why: 'the pushed range could not be determined, so the register is checked rather than assumed unaffected',
      globs,
    };
  }
  for (const range of ranges) {
    const touched = `${git(['diff', '--name-only', range, '--', ...globs], { cwd: root }).stdout}`.trim();
    if (touched !== '') {
      return {
        check: true,
        why: `${range} changes ${touched.split('\n').length} file(s) the register watches`,
        globs,
      };
    }
  }
  return { check: false, why: 'this push changes nothing the register watches', globs };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const explain = process.argv.includes('--explain');
  /** @returns {string} */
  const readStdin = () => {
    if (explain) return '';
    try {
      return `${readFileSync(0, 'utf8')}`;
    } catch {
      // No stdin — run by hand. `decide` treats that as "cannot tell".
      return '';
    }
  };

  const decision = decide(readStdin());
  if (explain) {
    process.stdout.write(
      `watched pathspecs (${String(decision.globs.length)}): ${decision.globs.join(', ')}\n` +
        `would check: ${String(decision.check)} — ${decision.why}\n`,
    );
    return 0;
  }
  if (!decision.check) return 0;

  process.stdout.write(`  Checking the advisory register — ${decision.why}.\n`);
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [CHECKER, '--recorded-advisories'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0) return 0;

  process.stderr.write(
    `\n${output}\n` +
      `Push blocked — the advisory register does not hold against this tree.\n\n` +
      `This ran because the push changes a file the register's verdicts rest on, which is the ` +
      `mapping GG-1 said could not be derived. It can be, for this one check: the register's\n` +
      `pathspecs are literal strings in a tracked file.\n\n` +
      `A NOT-REACHABLE verdict expires the day shipped code names its symbol. Re-triage the\n` +
      `entry above, or route around the symbol — do not widen the verdict's scope so the code\n` +
      `fits inside it.\n\n` +
      `Run against the RECORDED feed, so this failure is about this repository and not about\n` +
      `whether OSV was reachable.\n\n`,
  );
  return 1;
}

/* c8 ignore start */
// Guarded, because this module is imported by its own proof. Without it, every
// import ran the gate — printing its decision and then calling process.exit,
// which ends the importing process wherever it happens to be.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
main().then(
  (status) => {
    process.exit(status);
  },
  (error) => {
    process.stderr.write(
      `\nPush blocked — the pre-push guard itself failed:\n${formatError(error)}\n\n` +
        `A guard that errors is treated as a guard that found something. Fix the guard.\n\n`,
    );
    process.exit(1);
  },
);
}
/* c8 ignore stop */
