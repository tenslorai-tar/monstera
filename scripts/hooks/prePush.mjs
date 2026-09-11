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
 * Every path the project's `typecheck` command reads.
 *
 * ## Why a pathspec set and not *always*
 *
 * A documentation push publishes no code, and 31 seconds on every one of those is
 * the cost that gets a hook disabled. A push that touches any of these is the one
 * where the answer can have changed.
 *
 * `*.mjs` is in the set because **the second half of `typecheck` is what sees
 * it**: `tsconfig.scripts.json` checks `scripts/**` through JSDoc with `checkJs`,
 * and that is the half that catches a stolen JSDoc comment and a `TS7016` on a
 * literal `require`. `*tsconfig*.json` and `*package.json` are here because a
 * project reference, a compiler option or a dependency changes what compiles
 * without any source file moving.
 *
 * Git pathspecs, so `*` crosses directory separators and each entry matches at
 * any depth — the same spelling the register's own globs use, asked of the same
 * `git diff`.
 */
export const TYPECHECKED_PATHSPECS = [
  '*.ts',
  '*.tsx',
  '*.mts',
  '*.cts',
  '*.mjs',
  '*tsconfig*.json',
  '*package.json',
];

/**
 * Whether this push publishes anything `npm run typecheck` would read.
 *
 * ## THE GATE THIS HOOK DID NOT HAVE, and three reds came through the gap
 *
 * `CLAUDE.md` records the habit and calls it open: *"`npm run typecheck` is two
 * invocations … `npx tsc -b` is the first half alone. That is what reddened
 * `main` on 2026-08-29"*, and the same shape bit twice more the same day. The
 * compensation there is a sentence telling you to run the project's command — and
 * this project has written three times that a rule you must recall at the moment
 * you type a command is not a mechanism.
 *
 * Between a tree that does not compile and a public red board there was exactly
 * one thing: somebody typing the whole command. There is now a hook.
 *
 * ## It runs `npm run typecheck`, never `tsc`
 *
 * Spelling the two invocations here would make this hook a **second opinion about
 * what typechecking means**, and the day a third joins the manifest's script the
 * hook would check two thirds of it while reporting a pass. The manifest is where
 * the project records that its one-word verb is several commands (B3a), so the
 * hook runs the verb.
 *
 * ## Cost, measured rather than assumed
 *
 * **31 s and 32 s on two consecutive warm runs** (2026-09-11, this machine, after
 * a build). A cold tree with no `.tsbuildinfo` pays more, and the pre-push pair's
 * own `build` step leaves it warm — so 31 s is the figure a push actually pays,
 * against three reds that cost a range each.
 *
 * @param {string} input The hook's stdin.
 * @param {string} [root]
 * @returns {{ check: boolean, why: string }}
 */
export function decideTypecheck(input, root = ROOT) {
  // THE SAME POSITIVE CONTROL AS THE REGISTER'S, for the same reason: a pathspec
  // set that matches nothing answers "not touched" for every push, and so does
  // one git no longer understands.
  if (!anyGlobResolves(TYPECHECKED_PATHSPECS, root)) {
    throw new Error(
      `None of the ${String(TYPECHECKED_PATHSPECS.length)} typechecked pathspecs matches a ` +
        `tracked file. A glob that matches nothing answers "no code changed" for every push. ` +
        `Refusing rather than reporting a clean push.`,
    );
  }

  const { ranges, unknown } = pushedRanges(input);
  if (unknown) {
    return {
      check: true,
      why: 'the pushed range could not be determined, so the tree is typechecked rather than assumed unchanged',
    };
  }
  for (const range of ranges) {
    const touched = `${
      git(['diff', '--name-only', range, '--', ...TYPECHECKED_PATHSPECS], { cwd: root }).stdout
    }`.trim();
    if (touched !== '') {
      return {
        check: true,
        why: `${range} changes ${touched.split('\n').length} file(s) the compiler reads`,
      };
    }
  }
  return { check: false, why: 'this push changes nothing the compiler reads' };
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
 * Runs the project's typecheck and reports what it found.
 *
 * ## It says WHICH TREE it read, because that is not the one being published
 *
 * `tsc --build` reads the working tree; a push publishes commits. With a clean
 * tree those are the same thing, and with a dirty one this answer is about the
 * files on disk — which can be greener than the commits, if a broken commit was
 * fixed without committing. Stated rather than refused: a hook that blocked every
 * push from a dirty checkout is one a developer turns off, and the line below is
 * what a reader needs to know the difference.
 *
 * @param {string} why What `decideTypecheck` found, for the line it prints.
 * @returns {Promise<number>}
 */
async function runTypecheck(why) {
  const { spawnSync } = await import('node:child_process');
  const { npmCliPath } = await import('./lockfileIntegrity.mjs');
  const dirty = `${git(['status', '--porcelain'], { cwd: ROOT }).stdout}`.trim() !== '';
  process.stdout.write(
    `  Typechecking — ${why}${dirty ? ' (working tree is DIRTY, so this reads the files on disk rather than the commits)' : ''}.\n`,
  );
  // THROUGH npm, never `tsc` (see `decideTypecheck`), and through node rather
  // than a shell: `npm` is `npm.cmd` on Windows and `shell: true` re-opens the
  // hole Node's refusal exists to close (`lockfileIntegrity.mjs`' own note).
  const result = spawnSync(process.execPath, [npmCliPath(), 'run', 'typecheck'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status === 0) return 0;

  process.stderr.write(
    `\n${result.stdout ?? ''}${result.stderr ?? ''}\n` +
      `Push blocked — the tree does not typecheck.\n\n` +
      `\`npm run typecheck\` is TWO invocations: \`tsc --build\` for the packages and\n` +
      `\`tsc -p tsconfig.scripts.json\` for the \`.mjs\` under scripts/. The second half is the\n` +
      `only one that sees a stolen JSDoc comment or a TS7016 on a literal require, and\n` +
      `\`npx tsc -b\` is the first half alone — which is how main went red on 2026-08-29.\n\n` +
      `Fix it and push again. This gate exists because three reds came through the gap\n` +
      `where the only thing between a tree that does not compile and a public board was\n` +
      `somebody remembering to type the whole command.\n\n`,
  );
  return 1;
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

  const stdin = readStdin();
  const decision = decide(stdin);
  const typecheck = decideTypecheck(stdin);
  if (explain) {
    process.stdout.write(
      `watched pathspecs (${String(decision.globs.length)}): ${decision.globs.join(', ')}\n` +
        `would check: ${String(decision.check)} — ${decision.why}\n` +
        `typechecked pathspecs (${String(TYPECHECKED_PATHSPECS.length)}): ` +
        `${TYPECHECKED_PATHSPECS.join(', ')}\n` +
        `would typecheck: ${String(typecheck.check)} — ${typecheck.why}\n`,
    );
    return 0;
  }

  // THE TYPECHECK FIRST, because it is the one that fails most often and a
  // developer reading a blocked push should meet the compiler before the
  // register.
  if (typecheck.check) {
    const status = await runTypecheck(typecheck.why);
    if (status !== 0) return status;
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
