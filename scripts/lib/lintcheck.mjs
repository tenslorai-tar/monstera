// @ts-check
/**
 * The lint, invoked the way the local sweep can reach it (finding DDDD-7).
 *
 * ## The gap this closes, and it cost a red board
 *
 * `checkLocal.mjs` derives its set from every `check:*` and `proof:*` name in
 * `package.json`, and invokes only commands whose first token is `node`. `npm
 * run lint` is neither. So the rule set that governs every line of this
 * repository sat outside the sweep that runs before every push — and the sweep's
 * own disclosure names the PROOFS it did not run, so nothing named this hole
 * either. A file-naming convention was standing in for a check, one layer up
 * from where W-1 found it the first time.
 *
 * Measured: `7ba978c` added two files carrying four ordinary lint errors —
 * three `no-confusing-void-expression`, one `dot-notation`. `npm run local --
 * --only check:` reported **14 of 14 passed**, and CI 32828958338 failed at step
 * "Lint" on all three jobs. The files had been linted by hand, one at a time,
 * which is the compensation this project has written down three times as not
 * being a mechanism.
 *
 * This is `check:types`' sibling and is deliberately its near-copy: the same
 * gap, found the same way, closed the same way. Where the two differ is stated
 * at {@link EXPECTED_TARGETS}.
 *
 * ## `package.json` is the authority, and this file does not re-spell it
 *
 * The `lint` script says what the lint IS — which paths, with which flags.
 * Copying them here would be a second opinion about a question one manifest
 * already answers (B3a), and the dangerous kind: it would agree right up until
 * somebody added a flag to one and not the other.
 *
 * ## The interpreter is invoked directly, never the `.bin` shim
 *
 * `node_modules/eslint/bin/eslint.js` is a JavaScript entry point. The `.bin`
 * shim is a platform-specific wrapper, and this repository has already paid for
 * resolving a shim by hand — the pre-commit guard and its proof disagreed about
 * which `npm` exists because one followed *npm beside node* and the other did
 * not.
 *
 * ## Its control
 *
 * The reassuring answer here is *no problems*, and a parse that yielded no
 * invocations produces it too, silently, in the voice of a clean tree. So the
 * parse must yield exactly as many invocations as the authority has segments,
 * and their targets must match {@link EXPECTED_TARGETS}.
 * `proof:lintcheck` carries the resolution test neither control can: a fixture
 * with a deliberate violation beside a clean one, requiring the runner to
 * separate them.
 *
 * Usage: npm run check:lint
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';
import { segmentsOf } from './scriptSegments.mjs';

/** ESLint's JavaScript entry point, relative to the root. */
export const ESLINT_ENTRY = join('node_modules', 'eslint', 'bin', 'eslint.js');

/**
 * The paths this repository's lint may not quietly stop covering.
 *
 * THE ANCHOR, and it is a different one from `check:types`' because the danger
 * has a different shape. There, a shrink removes an `&&` segment and the count
 * catches it. Here the whole lint is ONE segment, and it shrinks by having its
 * argument changed — `eslint .` to `eslint packages` lints less and reports a
 * clean tree, faithfully, with the invocation count unmoved.
 *
 * Item 4c's rule either way: derive from a set only when the failure you fear
 * makes that set BIGGER. Extent shrinking is the failure here, so the extent
 * comes from a literal that a shrink has to touch separately.
 *
 * Compared as a SET, so reordering or adding a path is not an event — adding is
 * a widening and needs no ceremony. Removing one is the thing that must be
 * deliberate, and editing this line is what makes it something somebody wrote
 * down.
 */
export const EXPECTED_TARGETS = ['.'];

/**
 * The argument lists to hand ESLint, one per segment.
 *
 * A segment that does not start with `eslint` is returned as `null` rather than
 * skipped: the caller compares the count against {@link segmentsOf}, and a
 * silently dropped segment is a lint that got smaller with nothing saying so.
 *
 * @param {string} command
 * @returns {Array<string[] | null>}
 */
export function parseLintScript(command) {
  return segmentsOf(command).map((segment) => {
    const parts = segment.split(/\s+/u).filter((part) => part !== '');
    if (parts[0] !== 'eslint') return null;
    return parts.slice(1);
  });
}

/**
 * The non-flag arguments across every invocation — what is actually linted.
 *
 * `--flag value` is not handled: a value-taking flag's VALUE arrives here as a
 * target, so `eslint --max-warnings 0 .` reads as `['0', '.']`.
 *
 * That is harmless, and the reason is the anchor's shape rather than luck. The
 * check asks whether every {@link EXPECTED_TARGETS} entry is still present — a
 * subset test, not an equality — so a spurious extra changes nothing. Equality
 * would make adding a flag an event, and adding is a widening that needs no
 * ceremony; it is the SHRINK this file exists to make somebody write down.
 *
 * This paragraph said the opposite first — that a flag's value would fail the
 * anchor and refuse — and the proof's own case reddened on it. Recorded rather
 * than quietly fixed, because a comment describing a stricter guard than the
 * code has is the shape that gets believed by the next reader.
 *
 * @param {ReadonlyArray<string[]>} invocations
 * @returns {string[]}
 */
export function targetsOf(invocations) {
  return invocations.flatMap((args) => args.filter((arg) => !arg.startsWith('-')));
}

/**
 * Runs each argument list under this process's own `node`, stopping at the first
 * failure — `&&` is part of what the authority said.
 *
 * Injectable rather than reading `package.json` itself, so the proof can drive
 * it against fixture trees instead of against this repository. A runner that
 * could only be exercised by linting the whole tree would be exercised by
 * nothing.
 *
 * @param {string} eslintPath Absolute path to ESLint's JS entry point.
 * @param {ReadonlyArray<string[]>} invocations
 * @param {string} cwd
 * @returns {{ failed: Array<{ args: string[], status: number | null, output: string }>, ran: number }}
 */
export function runLint(eslintPath, invocations, cwd) {
  /** @type {Array<{ args: string[], status: number | null, output: string }>} */
  const failed = [];
  let ran = 0;
  for (const args of invocations) {
    const run = spawnSync(process.execPath, [eslintPath, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    ran += 1;
    if (run.status !== 0) {
      failed.push({
        args,
        status: run.status,
        output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim(),
      });
      break;
    }
  }
  return { failed, ran };
}

if (isMain(import.meta.url)) {
  const root = repoRoot();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const authority = String(manifest.scripts?.lint ?? '');
  const segments = segmentsOf(authority);
  const parsed = parseLintScript(authority);
  const invocations = parsed.filter((args) => args !== null);
  const eslintPath = join(root, ESLINT_ENTRY);

  if (segments.length === 0 || invocations.length !== segments.length) {
    process.stderr.write(
      `The lint script could not be read as ESLint invocations, so this check cannot report on ` +
        `it and its silence would mean nothing.\n\n` +
        `  package.json "lint": ${authority || '(absent)'}\n` +
        `  segments: ${String(segments.length)}, understood as eslint: ${String(invocations.length)}\n\n` +
        `Every segment must be an \`eslint\` command line. package.json is the authority for what ` +
        `the lint is; this file runs what it says rather than restating it, so a segment it ` +
        `cannot read is a hole and not a shorter lint.\n`,
    );
    process.exit(1);
  }

  const targets = targetsOf(invocations);
  const missing = EXPECTED_TARGETS.filter((expected) => !targets.includes(expected));
  if (missing.length > 0) {
    process.stderr.write(
      `The lint script no longer covers ${missing.join(', ')}.\n\n` +
        `  package.json "lint": ${authority}\n` +
        `  linted: ${targets.join(', ') || '(nothing)'}\n\n` +
        `A narrowed lint reports a clean tree, faithfully, having examined less — and the ` +
        `invocation count does not move, which is why the extent is anchored to a literal here ` +
        `rather than derived (item 4c). If the reduction is deliberate, change EXPECTED_TARGETS ` +
        `in the same commit. That edit is the point: it makes the shrink something somebody ` +
        `wrote down.\n`,
    );
    process.exit(1);
  }

  if (!existsSync(eslintPath)) {
    process.stderr.write(
      `ESLint is not at ${ESLINT_ENTRY}, so nothing was linted. Run \`npm ci\` and try again — a ` +
        `lint that cannot find its linter must not report a clean tree.\n`,
    );
    process.exit(1);
  }

  const { failed } = runLint(eslintPath, invocations, root);

  if (failed.length > 0) {
    for (const failure of failed) {
      process.stderr.write(`\neslint ${failure.args.join(' ')} exited ${String(failure.status)}\n\n`);
      process.stderr.write(`${failure.output}\n`);
    }
    process.stderr.write(
      `\n${String(failed.length)} of ${String(invocations.length)} ESLint invocation(s) failed. ` +
        `This is what CI runs on every leg, so a red here is a red board.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `  ok  ${String(invocations.length)} ESLint invocation(s) from package.json's lint script ` +
      `reported no problems\n` +
      `  ok  and they cover ${EXPECTED_TARGETS.join(', ')}, so the count is the whole tree\n`,
  );
}
