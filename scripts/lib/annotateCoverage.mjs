// @ts-check
/**
 * Every proof a workflow runs goes through `scripts/ci/annotate.mjs`, derived
 * rather than listed (finding EEE-3, and the precedent finding Y-3 was waiting
 * for).
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
 * where twenty-four proof steps live. On 2026-08-22 Guards went red at
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
 * `package.json` is the authority for what a proof *is*: a script named
 * `proof:*`. This reads that set and the file paths those scripts invoke, then
 * requires every workflow line that runs one of them to name the wrapper. No
 * list of proofs lives here, so a proof added tomorrow is covered the moment it
 * is registered — which is the property a list cannot have (B3a).
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
 * line it recognises as a **correctly wrapped proof invocation** on every run,
 * and refuse to report when it cannot. A scan that has found nothing and a scan
 * that cannot see are the same output otherwise, and this one is run by hand on
 * the day someone needs an answer.
 *
 * Usage: node scripts/lib/annotateCoverage.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

const WORKFLOW_DIR = '.github/workflows';
const WRAPPER = 'scripts/ci/annotate.mjs';

/**
 * The proof entry points, read out of `package.json` rather than listed.
 *
 * Returns both the script NAMES (so `npm run proof:x` is recognisable) and the
 * FILE PATHS they invoke (so a workflow naming the path directly is recognised
 * too, wrapped or not). `proof:guards` chains three scripts behind one name,
 * which is why paths are collected per script rather than assumed to be one.
 *
 * @param {string} root
 * @returns {{ names: string[], paths: string[] }}
 */
export function proofEntryPoints(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = /** @type {Record<string, string>} */ (manifest.scripts ?? {});
  const names = Object.keys(scripts).filter((name) => name.startsWith('proof:'));

  // An empty intermediate result is a broken parse, not a clean manifest. With
  // no names every workflow line below is unrecognised and the scan reports a
  // clean tree — the reassuring answer, produced by having looked at nothing.
  if (names.length === 0) {
    throw new Error(
      `No proof:* scripts found in package.json. That is a broken read, not a repository with ` +
        `no proofs, and everything this scan reports downstream would be an artefact of it.`,
    );
  }

  /** @type {Set<string>} */
  const paths = new Set();
  for (const name of names) {
    for (const match of `${scripts[name]}`.matchAll(/scripts\/[\w./-]+\.mjs/gu)) {
      paths.add(match[0]);
    }
  }
  if (paths.size === 0) {
    throw new Error(
      `Found ${String(names.length)} proof:* scripts and no script paths in any of them. The ` +
        `matcher and the manifest disagree, and a scan that recognises no paths finds no ` +
        `violations for the wrong reason.`,
    );
  }
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
 * }} ProofInvocation
 */

/**
 * Every proof invocation in every workflow, wrapped and unwrapped.
 *
 * Both are returned deliberately: the wrapped ones are the positive control, and
 * a function that returned only violations could not tell "all wrapped" from
 * "recognised nothing".
 *
 * @param {{ root?: string }} [options]
 * @returns {ProofInvocation[]}
 */
export function findProofInvocations({ root = repoRoot() } = {}) {
  const { names, paths } = proofEntryPoints(root);
  const dir = join(root, WORKFLOW_DIR);
  const files = readdirSync(dir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  if (files.length === 0) {
    throw new Error(
      `${WORKFLOW_DIR} holds no workflow files. An empty input set is a broken lookup, not a ` +
        `clean result.`,
    );
  }

  /** @type {ProofInvocation[]} */
  const found = [];
  for (const name of files) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index] ?? '';
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
      const viaPath = paths.find((path) => text.includes(path));
      if (viaName === undefined && viaPath === undefined) continue;
      found.push({
        file: `${WORKFLOW_DIR}/${name}`,
        line: index + 1,
        text: text.trim(),
        wrapped: text.includes(WRAPPER),
        why:
          viaName !== undefined
            ? `runs ${viaName}, an npm script the wrapper cannot spawn — name the script path`
            : `runs ${String(viaPath)}`,
      });
    }
  }
  return found;
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ violations: ProofInvocation[], wrapped: number, blind: boolean }}
 */
export function scan(options = {}) {
  const found = findProofInvocations(options);
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
      `\n  BLIND — no correctly wrapped proof invocation was found in any workflow.\n` +
        `        This scan cannot distinguish that from "nothing to report", so it reports\n` +
        `        nothing at all. Fix the derivation before believing any clean result.\n`,
    );
    process.exit(1);
  }
  for (const entry of result.violations) {
    process.stderr.write(
      `  FAIL  ${entry.file}:${String(entry.line)} — a proof step that is not wrapped.\n` +
        `        ${entry.text}\n` +
        `        ${entry.why}\n` +
        `        A failure here prints only "Process completed with exit code 1" to anyone\n` +
        `        without repository auth. Route it through ${WRAPPER}.\n`,
    );
  }
  if (result.violations.length > 0) {
    process.stderr.write(
      `\n${String(result.violations.length)} unwrapped proof step(s).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `  ok  ${String(result.wrapped)} proof invocation(s) in workflows, all wrapped\n` +
      `  ok  and the scan located wrapped invocations, so that result means something\n`,
  );
}
/* c8 ignore stop */
