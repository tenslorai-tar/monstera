// @ts-check
/**
 * Every repository script a workflow runs goes through `scripts/ci/annotate.mjs`,
 * derived rather than listed (findings EEE-3 and FFF-2, and the precedent
 * finding Y-3 was waiting for).
 *
 * ## The failure this closes, which is a remedy rolled out by enumeration
 *
 * Actions serves step **logs** only to authenticated callers. Step names,
 * conclusions and durations are public; the text a failing step printed is not.
 * `scripts/ci/annotate.mjs` re-emits a failing script's own output as a public
 * annotation, and its header records that it was written after
 * `proof:rendererpolicy` failed on windows-latest with the only public evidence
 * being *"Process completed with exit code 1"* — and that the remedy was **made
 * reusable instead of copied**.
 *
 * It was then applied to three steps in `ci.yml` and to none in `guards.yml`,
 * where two dozen proof steps live. On 2026-08-22 Guards went red at
 * `a0d2ec0` on windows-latest with ubuntu-latest green, and the only public
 * evidence was the step name — the exact situation the wrapper exists to
 * prevent, in the file it had never reached. Before that it had been wrapped to
 * two Electron proofs and not to the RSS one.
 *
 * **A remedy rolled out by enumeration has the same defect as a guard by
 * enumeration: nothing makes the list complete.** That is finding Y-3 in one
 * sentence — sixteen handlers closed and nothing stopping the seventeenth — and
 * it is why this is a derivation and not a third list to keep in step.
 *
 * ## What it derives from, and why that source
 *
 * `package.json` is the authority. This reads every script whose command
 * invokes a repository script — `node scripts/….mjs` — together with the paths
 * those commands name, then requires every workflow line running one of them to
 * name the wrapper. No list lives here, so a script added tomorrow is covered
 * the moment it is registered, which is the property a list cannot have (B3a).
 *
 * ## The scope was `proof:*` for one range, and that was narrower than the gap
 *
 * FFF-2: the first version derived the **proof** set, and stated that limit
 * plainly. The limit was wrong, not merely narrow. `guardFiles.mjs --tree`,
 * `guardFiles.mjs --history` and `scanSecrets.mjs` are run from `guards.yml`
 * by path and are neither `proof:*` nor `check:*`, so they fell outside the
 * stated scope as well as outside the derivation — and **a stated limitation
 * narrower than the real one reads as surveyed**, which is worse than no
 * statement at all.
 *
 * FFF-3 is the same hole with a live consequence: `check:advisories` is the one
 * step in either workflow that reaches a third party on every run, so it is the
 * step most likely to go red for a reason nobody can see, and its public
 * evidence was the exit-code line. That is the failure diagnosed at `a0d2ec0`,
 * moved one step to the left.
 *
 * The criterion is now **what the wrapper can actually spawn**, which is a
 * property rather than a category: `annotate.mjs` runs a node script with
 * `process.execPath`, so a step that runs one is wrappable and a step that runs
 * `tsc`, `eslint` or `vitest` is not. `npm run build` chains two other scripts
 * and names no path of its own, so it is correctly outside — the derivation
 * reads each command's own text and does not follow chains.
 *
 * ## Why a path match also requires a `node` invocation on the line
 *
 * Dropping the `proof:` filter alone reports three `hashFiles('scripts/…')`
 * cache keys, which name a script and run nothing. Requiring the line to invoke
 * node on a repository script separates them, textually, with no YAML parser —
 * the same reason the rule is per line rather than per step.
 *
 * ## Why the rule is per LINE rather than per step
 *
 * A wrapped invocation is `node scripts/ci/annotate.mjs <path>`, so the wrapper
 * and the proof appear together on one line, including inside a multi-line
 * `run:` block where each command is its own line. Checking lines needs no YAML
 * parser and cannot be defeated by block scalars, indentation or a step whose
 * `name:` is absent — and a per-step rule would have to decide what a step *is*,
 * which is a second opinion about YAML that this repository does not need.
 *
 * **`npm run proof:x` can never satisfy the rule**, and that is deliberate:
 * `annotate.mjs` spawns its target with `process.execPath`, so a workflow that
 * wants the wrapper names the script path. The environment difference was
 * measured before the rollout — exactly two proofs in the repository touch npm
 * variables, and both are fine without them.
 *
 * ## The positive control, because this is a SEARCH
 *
 * Its reassuring answer is *no violations*, which is also what a wrong pattern,
 * an empty file set and a broken derivation all produce. So it must locate a
 * line it recognises as a **correctly wrapped invocation** on every run,
 * and refuse to report when it cannot. A scan that has found nothing and a scan
 * that cannot see are the same output otherwise, and this one is run by hand on
 * the day someone needs an answer.
 *
 * Usage: node scripts/lib/annotateCoverage.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { firstInvokedScriptPath, invokedScriptPaths } from './workflowInvocations.mjs';

const WORKFLOW_DIR = '.github/workflows';
const WRAPPER = 'scripts/ci/annotate.mjs';

// The invocation rule is `workflowInvocations.mjs`'s, not a copy. This file
// used to carry its own capturing global pattern and `nodeModulesPlacement.mjs`
// its own non-capturing one — both correct, which is precisely B3a's shape
// (AAAA-10).

/**
 * The wrappable entry points, read out of `package.json` rather than listed.
 *
 * Wrappable means what `annotate.mjs` can actually spawn: a node script. It runs
 * its target with `process.execPath`, so `npm run lint` and `npm run typecheck`
 * are outside the rule as a matter of mechanism rather than of category, and a
 * chain like `npm run build` is outside because its own command names no path —
 * each command is read as text and chains are not followed.
 *
 * Returns both the script NAMES (so `npm run x` is recognisable) and the FILE
 * PATHS they invoke (so a workflow naming a path directly is recognised too,
 * wrapped or not). `proof:guards` chains three scripts behind one name, which is
 * why paths are collected per script rather than assumed to be one.
 *
 * @param {string} root
 * @returns {{ names: string[], paths: string[] }}
 */
export function wrappableEntryPoints(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = /** @type {Record<string, string>} */ (manifest.scripts ?? {});

  /** @type {string[]} */
  const names = [];
  /** @type {Set<string>} */
  const paths = new Set();
  for (const [name, command] of Object.entries(scripts)) {
    const invoked = invokedScriptPaths(`${command}`);
    if (invoked.length === 0) continue;
    names.push(name);
    for (const path of invoked) if (path !== undefined) paths.add(path);
  }

  // An empty intermediate result is a broken parse, not a clean manifest. With
  // no names every workflow line below is unrecognised and the scan reports a
  // clean tree — the reassuring answer, produced by having looked at nothing.
  if (names.length === 0) {
    throw new Error(
      `No npm script in package.json invokes a scripts/*.mjs file. That is a broken read, not a ` +
        `repository with no scripts, and everything this scan reports downstream would be an ` +
        `artefact of it.`,
    );
  }
  // There is no separate "names but no paths" guard, and there deliberately is
  // not: both come from the same match, so a non-empty `names` implies a
  // non-empty `paths`. The `proof:*` version derived the two independently and
  // needed a second throw; making them one derivation made the state
  // unrepresentable instead of checked (B5).
  return { names, paths: [...paths] };
}

/**
 * One workflow line that runs a proof.
 *
 * @typedef {{
 *   file: string,
 *   line: number,
 *   text: string,
 *   wrapped: boolean,
 *   why: string,
 * }} WrappableInvocation
 */

/**
 * Every wrappable invocation in every workflow, wrapped and unwrapped.
 *
 * Both are returned deliberately: the wrapped ones are the positive control, and
 * a function that returned only violations could not tell "all wrapped" from
 * "recognised nothing".
 *
 * @param {{ root?: string }} [options]
 * @returns {WrappableInvocation[]}
 */
export function findWrappableInvocations({ root = repoRoot() } = {}) {
  const { names, paths } = wrappableEntryPoints(root);
  const dir = join(root, WORKFLOW_DIR);
  const files = readdirSync(dir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  if (files.length === 0) {
    throw new Error(
      `${WORKFLOW_DIR} holds no workflow files. An empty input set is a broken lookup, not a ` +
        `clean result.`,
    );
  }

  /** @type {WrappableInvocation[]} */
  const found = [];
  for (const name of files) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index] ?? '';
      // A COMMENT IS NOT A COMMAND. A line whose first non-space character is
      // `#` runs nothing under either reading of this file — a YAML comment
      // between steps, or a shell comment inside a `run: |` block — so a
      // workflow comment that MENTIONS a command was being reported as an
      // unwrapped step. Measured: a comment recording why `check:lint` exists
      // quoted `npm run local -- --only check:` and the scan named it at
      // ci.yml:292.
      //
      // This makes the found set SMALLER, which is the dangerous direction for a
      // search (item 4c), so it is written as narrowly as it can be: the first
      // non-space character, nothing about `#` anywhere else on the line. A step
      // with a trailing comment is untouched, and a commented-out invocation
      // genuinely does not run. `annotateCoverage.proof.mjs` carries both
      // directions.
      //
      // Textual still, and therefore no second opinion about YAML — which is why
      // the fix is here rather than in a parser.
      if (text.trimStart().startsWith('#')) continue;
      // The wrapper's own path contains no proof path, so it is never mistaken
      // for one; a line naming it is only interesting because of what follows.
      // MATCHED WHOLE, not by prefix. `text.includes('npm run proof:shim')` is
      // true of a line running `proof:shimreach`, so the first version named the
      // wrong script in its diagnostic — a violation reported against a step
      // that was not the one on the line. It never changed WHETHER a line was
      // reported, which is why it would have survived a pass/fail test and had
      // to be caught by reading the output.
      const viaName = names.find((script) =>
        new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\w:-])`, 'u').test(
          text,
        ),
      );
      // A path alone is not an invocation. `hashFiles('scripts/x.mjs')` names a
      // script in a cache key and runs nothing — three such lines in ci.yml —
      // so the line must INVOKE node on a repository script. Textual, and
      // therefore no second opinion about YAML.
      //
      // And the invocation is the whole rule: the path does NOT have to be one
      // `package.json` names. HHH-3 — `helper="$(node scripts/ci/
      // sandboxHelperPath.mjs)"` is invoked by no npm script, so a
      // manifest-derived path set could not see it and its failures were
      // exit-code-only in public. The manifest is still the authority for what
      // `npm run x` MEANS; it is not the authority for what a workflow runs.
      const invoked = firstInvokedScriptPath(text) ?? undefined;
      if (viaName === undefined && invoked === undefined) continue;
      // Named separately from `invoked` so the diagnostic can say whether the
      // manifest knows this script — a path nothing registers is worth seeing.
      const viaPath = invoked === undefined ? undefined : invoked;
      const registered = invoked !== undefined && paths.includes(invoked);
      found.push({
        file: `${WORKFLOW_DIR}/${name}`,
        line: index + 1,
        text: text.trim(),
        wrapped: text.includes(WRAPPER),
        why:
          viaName !== undefined
            ? `runs ${viaName}, an npm script the wrapper cannot spawn — name the script path`
            : `runs ${String(viaPath)}${registered ? '' : ', which no npm script registers'}`,
      });
    }
  }
  return found;
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ violations: WrappableInvocation[], wrapped: number, blind: boolean }}
 */
export function scan(options = {}) {
  const found = findWrappableInvocations(options);
  const wrapped = found.filter((entry) => entry.wrapped).length;
  return {
    violations: found.filter((entry) => !entry.wrapped),
    wrapped,
    // THE CONTROL. Zero wrapped invocations means either every proof step is
    // unwrapped — which the violations list would say loudly — or that nothing
    // was recognised at all, which it would say silently.
    blind: wrapped === 0,
  };
}

/* c8 ignore start */
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/gu, '/'))) {
  const result = scan();
  if (result.blind) {
    process.stderr.write(
      `\n  BLIND — no correctly wrapped invocation was found in any workflow.\n` +
        `        This scan cannot distinguish that from "nothing to report", so it reports\n` +
        `        nothing at all. Fix the derivation before believing any clean result.\n`,
    );
    process.exit(1);
  }
  for (const entry of result.violations) {
    process.stderr.write(
      `  FAIL  ${entry.file}:${String(entry.line)} — a script step that is not wrapped.\n` +
        `        ${entry.text}\n` +
        `        ${entry.why}\n` +
        `        A failure here prints only "Process completed with exit code 1" to anyone\n` +
        `        without repository auth. Route it through ${WRAPPER}.\n`,
    );
  }
  if (result.violations.length > 0) {
    process.stderr.write(
      `\n${String(result.violations.length)} unwrapped script step(s).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `  ok  ${String(result.wrapped)} script invocation(s) in workflows, all wrapped\n` +
      `  ok  and the scan located wrapped invocations, so that result means something\n`,
  );
}
/* c8 ignore stop */
