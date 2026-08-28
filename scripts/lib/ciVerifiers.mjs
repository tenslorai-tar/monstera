// @ts-check
/**
 * Which of this repository's own scripts the workflows run (finding ZZZZ-1).
 *
 * ## The defect this replaces
 *
 * `checkLocal.mjs` derived its roster from `package.json` **by name** — every
 * script starting `check:` or `proof:`. Seven real verification scripts sit
 * outside that pattern (`notice:check`, `brand:check`, `guard:staged`,
 * `guard:tree`, `perf:gate`, `electron:surface`, `shim:reach`, `ocr:doors`),
 * and one of them is the check that caught a stale `NOTICE` and reddened the
 * board. The sweep reported **29 of 29 and exited 0**: a script outside the
 * pattern produces no error, no warning and no absence anybody can see — the
 * set is simply smaller and the count is proudly complete against it.
 *
 * That is W-1's *a file-naming convention is not a check*, one layer up: about
 * which SCRIPTS count as verification rather than which FILES count as proofs.
 *
 * ## Why renaming was rejected, and why this is not a second classifier
 *
 * Renaming the seven into the pattern relocates the judgement rather than
 * removing it. The same prefix space already holds `brand:check` **and**
 * `brand:generate`, `notice:check` **and** `notice:generate`,
 * `provision:electron` and `perf:gate` — so deciding which names mean *verifier*
 * is exactly the call the rename was supposed to make unnecessary.
 *
 * **The authority on what must pass is the workflow files.** A check the board
 * runs is a check that can redden the board; one it does not run cannot. So the
 * question has an owner already, and this module asks it once (B3a) rather than
 * letting the sweep hold an opinion about names.
 *
 * ## The wrapper is the whole difficulty
 *
 * Every workflow step that runs a repository script runs it **through**
 * `scripts/ci/annotate.mjs`, which `check:annotatecoverage` enforces:
 *
 *     run: node scripts/ci/annotate.mjs scripts/proofs/borderTokens.proof.mjs
 *
 * `firstInvokedScriptPath` returns `scripts/ci/annotate.mjs` — the wrapper — and
 * `invokedScriptPaths` returns the same one path, because the real script is an
 * ARGUMENT and carries no `node` prefix. Measured on this corpus before this
 * module existed: the workflows contain **one** unique `node scripts/…` path
 * and four `npm run` targets. A derivation built on those helpers alone would
 * have resolved CI's entire verifier set to a single script and reported it
 * without complaint, which is the same silent shrink one level further in.
 *
 * **It was caught by measuring the derived set before wiring anything to it** —
 * checklist 4a applied to a RESOLVER rather than to an instrument. The question
 * 4a asks of a measuring device is whether it reports two values that differ as
 * different; the question here was whether a set derived from 30-odd workflow
 * steps comes back with 30-odd members or with one. Nothing downstream would
 * have asked: a sweep handed a one-element roster runs it, passes, and prints a
 * complete-looking count, exactly as the `29 of 29` it replaces did.
 *
 * So the rule here is two-step, and the first step is the existing authority:
 * **a line must invoke node on a repository script** — `invokesRepositoryScript`
 * decides that, so `hashFiles('scripts/x.mjs')` and a bare mention are excluded
 * by the module that already owns the question — and only then is every
 * `scripts/…` token on that line harvested. Gating first is what keeps the
 * harvest from turning a cache key into an invocation.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { WORKFLOW_DIR } from './workflowPins.mjs';
import { invokesRepositoryScript } from './workflowInvocations.mjs';

/**
 * Any repository script path, whether or not `node` precedes it.
 *
 * Only ever applied to a line {@link invokesRepositoryScript} has already
 * accepted, which is what makes dropping the `node` prefix safe.
 */
const SCRIPT_PATH = /scripts\/[\w./-]+\.mjs/gu;

/** `npm run <name>`, with the boundary that stops `proof:shim` matching `proof:shimreach`. */
const NPM_RUN = /npm run ([\w:-]+)/gu;

/**
 * A line whose first non-space character is `#` runs nothing.
 *
 * Under either reading — a YAML comment between steps, or a shell comment inside
 * a `run: |` block. `annotateCoverage.mjs` carries the same rule and the reason:
 * a comment in `ci.yml` quoting `npm run local -- --only check:` was reported as
 * a step. Written as narrowly as it can be, because it makes the found set
 * SMALLER, which is this module's dangerous direction.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isComment(text) {
  return text.trimStart().startsWith('#');
}

/**
 * Reverse index: script path → the npm scripts that run it, with their commands.
 *
 * ## One path, two npm scripts, and only one of them is a verifier
 *
 * `scripts/release/generateNotice.mjs` is run by **both** `notice:generate` and
 * `notice:check`; `scripts/brand/generateAssets.mjs` by `brand:generate` and
 * `brand:check`. Mapping a path to every owner puts a GENERATOR in the sweep's
 * roster — and this sweep asserts afterwards that the working tree is as it
 * found it, so running one would fail that assertion or, worse, quietly rewrite
 * a tracked file before the push it is meant to protect.
 *
 * The line decides it, so nothing has to guess: the workflow runs
 * `… generateNotice.mjs --check`, and `notice:check`'s command carries `--check`
 * where `notice:generate`'s does not. {@link ownerFor} picks the owner whose
 * command — minus its `node ` prefix — appears in the line, longest first, and
 * refuses when two are equally good rather than choosing one.
 *
 * @param {string} root
 * @returns {{ byPath: Map<string, {name: string, stripped: string}[]>, names: Set<string> }}
 */
function manifestIndex(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = /** @type {Record<string, string>} */ (manifest.scripts ?? {});

  /** @type {Map<string, {name: string, stripped: string}[]>} */
  const byPath = new Map();
  const names = new Set(Object.keys(scripts));
  for (const [name, command] of Object.entries(scripts)) {
    const stripped = `${command}`.replace(/^node\s+/u, '').trim();
    for (const match of `${command}`.matchAll(SCRIPT_PATH)) {
      const path = match[0];
      byPath.set(path, [...(byPath.get(path) ?? []), { name, stripped }]);
    }
  }

  // An empty intermediate result is a broken parse, not a clean manifest.
  // Everything downstream would be an artefact of it, and would read as a
  // repository whose workflows run nothing.
  if (byPath.size === 0) {
    throw new Error(
      `No npm script in package.json names a scripts/*.mjs file. That is a broken read of the ` +
        `manifest, not a repository without scripts.`,
    );
  }
  return { byPath, names };
}

/**
 * Which npm script a workflow line is running, when a path has more than one.
 *
 * Longest stripped command that the line contains wins, because `--check`'s
 * command is longer than the generator's and both are substrings of the step.
 *
 * ## A TIE TAKES ALL OF THEM, and the direction is the reason
 *
 * Two npm scripts whose commands are byte-identical are indistinguishable from
 * the line, so no rule can pick one. Returning neither was the first version and
 * it is wrong in the direction that matters: this set is a roster, its danger is
 * a silent SHRINK (checklist 4c), and dropping both members loses coverage while
 * taking both costs one duplicate run of the same command. Ties are still
 * reported, so a manifest that has grown two names for one command is visible
 * rather than merely handled.
 *
 * A tie is not the generator case. `notice:generate` and `notice:check` differ
 * by `--check`, which is exactly why the line decides them.
 *
 * @param {{name: string, stripped: string}[]} owners
 * @param {string} line
 * @returns {{ names: string[], tied: boolean } | null}
 */
function ownerFor(owners, line) {
  if (owners.length === 1) return { names: [owners[0]?.name ?? ''], tied: false };
  const matching = owners
    .filter((owner) => line.includes(owner.stripped))
    .sort((left, right) => right.stripped.length - left.stripped.length);
  const best = matching[0];
  if (best === undefined) return null;
  const tiedWithBest = matching.filter((owner) => owner.stripped.length === best.stripped.length);
  return { names: tiedWithBest.map((owner) => owner.name), tied: tiedWithBest.length > 1 };
}

/**
 * @typedef {{
 *   names: string[],
 *   unregisteredPaths: string[],
 *   ambiguous: string[],
 *   workflowFiles: number,
 *   invocationLines: number,
 * }} CiVerifiers
 */

/**
 * Every npm script the workflows run, derived from the workflows.
 *
 * `unregisteredPaths` are scripts a workflow runs by path that no npm script
 * registers — HHH-3's shape, e.g. a helper invoked inside a shell substitution.
 * They are returned rather than dropped so a caller can say so: a path nothing
 * registers cannot be run by name, and silently discarding it is how a roster
 * shrinks without anyone seeing.
 *
 * @param {{ root?: string }} [options]
 * @returns {CiVerifiers}
 */
export function ciVerifiers({ root = repoRoot() } = {}) {
  const { byPath, names: registered } = manifestIndex(root);
  const dir = join(root, WORKFLOW_DIR);
  const files = readdirSync(dir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  if (files.length === 0) {
    throw new Error(
      `${WORKFLOW_DIR} holds no workflow files. An empty input set is a broken lookup, not a ` +
        `repository whose board runs nothing.`,
    );
  }

  /** @type {Set<string>} */
  const found = new Set();
  /** @type {Set<string>} */
  const unregistered = new Set();
  /** @type {Set<string>} */
  const ambiguous = new Set();
  let invocationLines = 0;

  for (const file of files) {
    for (const text of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (isComment(text)) continue;

      for (const match of text.matchAll(NPM_RUN)) {
        const name = match[1];
        if (name !== undefined && registered.has(name)) {
          found.add(name);
          invocationLines += 1;
        }
      }

      // THE GATE COMES FIRST. Only a line the existing authority accepts as an
      // invocation has its paths harvested, so a cache key naming a script is
      // not turned into a step by the looser pattern below it.
      if (!invokesRepositoryScript(text)) continue;
      invocationLines += 1;
      for (const match of text.matchAll(SCRIPT_PATH)) {
        const path = match[0];
        const owners = byPath.get(path);
        if (owners === undefined) {
          unregistered.add(path);
          continue;
        }
        const owner = ownerFor(owners, text);
        if (owner === null) {
          unregistered.add(path);
          continue;
        }
        for (const name of owner.names) found.add(name);
        if (owner.tied) ambiguous.add(`${path} → ${owner.names.join(', ')}`);
      }
    }
  }

  if (found.size === 0) {
    throw new Error(
      `No workflow line was recognised as running a repository script. The workflows exist and ` +
        `were read, so this is a broken match rather than a board that verifies nothing.`,
    );
  }

  return {
    names: [...found].sort(),
    unregisteredPaths: [...unregistered].sort(),
    ambiguous: [...ambiguous].sort(),
    workflowFiles: files.length,
    invocationLines,
  };
}

/**
 * The anchor, and it runs the other way from the derivation (checklist 4c).
 *
 * A set derived from the workflows tracks GROWTH perfectly — a check added to CI
 * joins the sweep the moment it is registered — and **agrees with any shrink**,
 * because a number computed from a collection cannot disagree with that
 * collection. Drop a check from CI and it leaves the sweep too, silently, which
 * is the failure the derivation was supposed to close arriving from the other
 * side.
 *
 * So the count comes from somewhere the shrink cannot reach: `package.json`
 * still names every `check:` and `proof:` script, and every one of them must be
 * run by some workflow. That is an independent claim a shrinker has to touch
 * separately — deleting a CI step now leaves an orphan here rather than a
 * quieter sweep.
 *
 * It does not cover the reverse gap, and saying so is the point: a verification
 * script named neither `check:` nor `proof:` is invisible to this anchor exactly
 * as it was to the old roster. `perf:gate`, `electron:surface`, `shim:reach` and
 * `ocr:doors` were four of those, run by no workflow at all until they were
 * registered — found by building this and looking, not by any check.
 *
 * `declaredNames` is returned, not just a count, because a caller holding a list
 * of accounted exceptions has to be able to ask whether an entry APPLIES to this
 * root at all. Without it, an exception naming a script the manifest does not
 * declare reads as *stale* — which is true of every entry when this runs against
 * a fixture repository, and would make the harness that exercises these failure
 * paths unable to run.
 *
 * @param {{ root?: string }} [options]
 * @returns {{ orphans: string[], declaredNames: string[], declared: number, run: number }}
 */
export function verifiersNotRunByCi({ root = repoRoot() } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const scripts = /** @type {Record<string, string>} */ (manifest.scripts ?? {});
  const declared = Object.keys(scripts).filter(
    (name) => name.startsWith('check:') || name.startsWith('proof:'),
  );
  const run = new Set(ciVerifiers({ root }).names);
  return {
    orphans: declared.filter((name) => !run.has(name)).sort(),
    declaredNames: declared.sort(),
    declared: declared.length,
    run: declared.filter((name) => run.has(name)).length,
  };
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const result = ciVerifiers();
  const anchor = verifiersNotRunByCi();
  process.stdout.write(
    `ANCHOR: ${String(anchor.run)} of ${String(anchor.declared)} declared check:/proof: ` +
      `script(s) are run by a workflow.\n` +
      (anchor.orphans.length === 0
        ? `  none orphaned.\n\n`
        : `  ORPHANED — declared but run by no workflow:\n` +
          anchor.orphans.map((name) => `    ${name}`).join('\n') +
          `\n\n`),
  );
  process.stdout.write(
    `${String(result.names.length)} npm script(s) run by ${String(result.workflowFiles)} ` +
      `workflow file(s), from ${String(result.invocationLines)} invocation line(s):\n` +
      result.names.map((name) => `  ${name}`).join('\n') +
      `\n\n${String(result.unregisteredPaths.length)} path(s) run by no npm script:\n` +
      result.unregisteredPaths.map((path) => `  ${path}`).join('\n') +
      `\n\n${String(result.ambiguous.length)} path(s) whose owner the line does not decide:\n` +
      result.ambiguous.map((entry) => `  ${entry}`).join('\n') +
      `\n`,
  );
}
