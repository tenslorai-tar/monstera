// @ts-check
/**
 * The typecheck, invoked the way the local sweep can reach it.
 *
 * ## The gap this closes
 *
 * `checkLocal.mjs` derives its set from every `check:*` and `proof:*` name in
 * `package.json`, and invokes only commands whose first token is `node` — the
 * timeout on a shell kills the shell and leaves the real process running, which
 * that file measured and records. `npm run typecheck` is neither: not a
 * `check:*` name, and not a `node` command line. So the one gate that compiles
 * this repository sat outside the sweep that runs before every push, and the
 * sweep's own disclosure lists PROOFS it did not run, so nothing named the hole.
 *
 * Measured: `073e6d9` pushed a JSDoc block inserted between a function's
 * documentation and the function, which severs the two and makes every
 * documented parameter implicitly `any`. `npm run build` failed on every leg of
 * CI 324 and `main` was red. The commit before it passed because the typecheck
 * was run by hand — a compensation somebody has to remember, which this project
 * has written three times is not a mechanism.
 *
 * ## `package.json` is the authority, and this file does not re-spell it
 *
 * The `typecheck` script says what the typecheck IS: which projects, in which
 * order, with which flags. Copying those flags here would be a second opinion
 * about a question one manifest already answers (B3a), and the dangerous kind —
 * it would agree with the authority right up until somebody adds a third
 * project to one and not the other. This reads the script and runs what it says.
 *
 * ## The interpreter is invoked directly, never the `.bin` shim
 *
 * `node_modules/typescript/bin/tsc` is a JavaScript entry point. The `.bin/tsc`
 * shim is a platform-specific wrapper, and this repository has already paid for
 * resolving a shim by hand: the pre-commit guard and its proof disagreed about
 * which `npm` exists because one followed `npm beside node` and the other did
 * not. A JS entry run under this process's own `node` has no such second answer.
 *
 * ## Its control
 *
 * The reassuring answer here is *no type errors*, and a parse that yielded no
 * invocations produces it too — silently, in the voice of a clean build. So the
 * parse must yield exactly as many invocations as the authority has segments and
 * at least one, or this refuses to report. `proof:typecheck` carries the
 * resolution test the control cannot: a fixture project with a deliberate error
 * beside a clean one, requiring the runner to separate them.
 *
 * MUTATED on the real path and not only through those fixtures, 2026-08-24: a
 * `@type {number}` annotation on a string constant in this very file made
 * `npm run check:types` exit 1 and print `TS2322` with the file, the line and
 * the source span. Same error class as the one that reddened `main`, arriving
 * from the repository's own two projects. The proof shows the runner separates;
 * this showed the wiring reaches.
 *
 * ## What it does NOT claim
 *
 * That `npm run build` is green. The build also runs `build:preload`, and this
 * deliberately does not: `package.json` says the typecheck is those two compiler
 * invocations, and a check named `types` deciding that a build's other step
 * belongs to it would be the second opinion this file exists to avoid.
 *
 * Usage: npm run check:types
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';
import { segmentsOf } from './scriptSegments.mjs';

/** The TypeScript compiler's JavaScript entry point, relative to the root. */
export const TSC_ENTRY = join('node_modules', 'typescript', 'bin', 'tsc');

/**
 * The fewest compiler invocations this repository's typecheck may shrink to
 * without somebody saying so (finding BBBB-3).
 *
 * THE ANCHOR, and the reason there is one: every other constraint in this file
 * is DERIVED from `package.json`'s `typecheck` script — the parse must produce
 * one invocation per `&&` segment, and both sides of that comparison come from
 * the same string. A derived count tracks growth perfectly and agrees with any
 * shrink, because a number computed from a collection cannot disagree with that
 * collection. Delete a project from the script and the check reports a clean
 * typecheck, faithfully, having compiled less.
 *
 * Item 4c's rule: derive from a set only when the failure you fear makes that
 * set BIGGER. Here it makes it smaller, so the count comes from somewhere the
 * failure cannot reach — a literal, which a shrink has to touch separately.
 *
 * `<` rather than `!==` on purpose. Adding a project is a widening and needs no
 * ceremony; removing one is the thing that must be deliberate.
 *
 * Two today: `tsc --build` for the package graph, `tsc -p tsconfig.scripts.json`
 * for everything under `scripts/`.
 */
export const FEWEST_INVOCATIONS = 2;

/**
 * The `&&`-separated segments of a command line.
 *
 * MOVED to `scriptSegments.mjs` when `lintcheck.mjs` needed the same answer, and
 * re-exported here so this module's callers and its proof are unchanged. Two
 * implementations of *how an `&&`-composed script is read* would be a second
 * opinion about a question one manifest answers (B3a), and the dangerous kind:
 * they would agree until one of them learnt about quoting.
 *
 * Imported AND re-exported, not `export … from`: the latter would not bind the
 * name in this module's own scope, and two call sites below use it.
 */
export { segmentsOf };

/**
 * The argument lists to hand `tsc`, one per segment.
 *
 * A segment that does not start with `tsc` is returned as `null` rather than
 * skipped: the caller compares the count against {@link segmentsOf}, and a
 * silently dropped segment is a typecheck that got smaller with nothing saying
 * so. `null` makes it visible.
 *
 * @param {string} command
 * @returns {Array<string[] | null>}
 */
export function parseTypecheckScript(command) {
  return segmentsOf(command).map((segment) => {
    const parts = segment.split(/\s+/u).filter((part) => part !== '');
    if (parts[0] !== 'tsc') return null;
    return parts.slice(1);
  });
}

/**
 * Runs each argument list under this process's own `node`, stopping at the first
 * failure.
 *
 * ## `&&` IS PART OF WHAT THE AUTHORITY SAID (finding BBBB-2)
 *
 * The first version ran every invocation and collected the failures. That is a
 * second opinion about the script's meaning: `tsc --build && tsc -p …` runs the
 * second only if the first succeeded, and this file exists precisely so that
 * `package.json` decides what the typecheck is. Continuing past a failure also
 * produces the wrong OUTPUT — the second project is checked against artefacts
 * the first did not build, so its errors are cascades of the real one, and the
 * reader is handed two problems where there is one.
 *
 * Found by asking why no fixture reached the loop's second iteration (audit item
 * 4, *mutate the branches no fixture reached*). The branch was not merely
 * unexercised; it was wrong.
 *
 * Injectable rather than reading `package.json` itself, so the proof can drive
 * it against fixture projects instead of against this repository — a runner that
 * could only be exercised by compiling the whole tree would be exercised by
 * nothing.
 *
 * @param {string} tscPath Absolute path to the compiler's JS entry point.
 * @param {ReadonlyArray<string[]>} invocations
 * @param {string} cwd
 * @returns {{ failed: Array<{ args: string[], status: number | null, output: string }>, ran: number }}
 */
export function runInvocations(tscPath, invocations, cwd) {
  /** @type {Array<{ args: string[], status: number | null, output: string }>} */
  const failed = [];
  let ran = 0;
  for (const args of invocations) {
    const run = spawnSync(process.execPath, [tscPath, ...args], {
      cwd,
      encoding: 'utf8',
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
  const authority = String(manifest.scripts?.typecheck ?? '');
  const segments = segmentsOf(authority);
  const parsed = parseTypecheckScript(authority);
  const invocations = parsed.filter((args) => args !== null);
  const tscPath = join(root, TSC_ENTRY);

  if (segments.length === 0 || invocations.length !== segments.length) {
    process.stderr.write(
      `The typecheck script could not be read as compiler invocations, so this check cannot ` +
        `report on it and its silence would mean nothing.\n\n` +
        `  package.json "typecheck": ${authority || '(absent)'}\n` +
        `  segments: ${String(segments.length)}, understood as tsc: ${String(invocations.length)}\n\n` +
        `Every segment must be a \`tsc\` command line. package.json is the authority for what the ` +
        `typecheck is; this file runs what it says rather than restating it, so a segment it ` +
        `cannot read is a hole and not a shorter build.\n`,
    );
    process.exit(1);
  }

  if (invocations.length < FEWEST_INVOCATIONS) {
    process.stderr.write(
      `The typecheck script now names ${String(invocations.length)} compiler invocation(s), and ` +
        `this repository's typecheck has never been fewer than ${String(FEWEST_INVOCATIONS)}.\n\n` +
        `  package.json "typecheck": ${authority}\n\n` +
        `Every other constraint here is derived from that script, so a project deleted from it ` +
        `would leave this check agreeing with a smaller typecheck and reporting a clean tree ` +
        `(finding BBBB-3). If the reduction is deliberate — two projects merged, or one genuinely ` +
        `gone — say so by changing FEWEST_INVOCATIONS in the same commit. That edit is the point: ` +
        `it makes the shrink something somebody wrote down.\n`,
    );
    process.exit(1);
  }

  if (!existsSync(tscPath)) {
    process.stderr.write(
      `The TypeScript compiler is not at ${TSC_ENTRY}, so nothing was compiled. Run \`npm ci\` ` +
        `and try again — a typecheck that cannot find its compiler must not report a clean tree.\n`,
    );
    process.exit(1);
  }

  const { failed } = runInvocations(tscPath, invocations, root);

  if (failed.length > 0) {
    for (const failure of failed) {
      process.stderr.write(`\ntsc ${failure.args.join(' ')} exited ${String(failure.status)}\n\n`);
      process.stderr.write(`${failure.output}\n`);
    }
    process.stderr.write(
      `\n${String(failed.length)} of ${String(invocations.length)} compiler invocation(s) failed. ` +
        `This is what \`npm run build\` runs on every CI leg, so a red here is a red board.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `  ok  ${String(invocations.length)} compiler invocation(s) from package.json's typecheck ` +
      `script reported no errors\n` +
      `  ok  and every segment of that script was understood, so the count is the whole of it\n`,
  );
}
