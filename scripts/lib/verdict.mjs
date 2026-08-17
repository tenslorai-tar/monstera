// @ts-check
/**
 * A verdict names every input its truth depends on, and stops being believed
 * when one of them changes.
 *
 * ## Why this is a mechanism and not a habit
 *
 * Three times in two days a claim was recorded that was true only because of
 * the state of something else, with nothing to notice when that state moved:
 *
 *   1. **Audit finding 32.** A proof deleted the whole `.tools` root; the
 *      severity was argued down to low because "the blast radius is empty
 *      today". It stopped being empty the moment a second artefact was
 *      provisioned, and it took a 69 MB in-flight download with it. The input
 *      was: what else lives under `.tools`.
 *   2. **The MuPDF reachability verdict.** Two advisories were marked NOT
 *      REACHABLE because nothing calls `pdf_subset_fonts`. One of them is a
 *      memory overwrite that no release fixes, and optimise and export are
 *      exactly the features that will call it. The input was: whether shipped
 *      code references that symbol.
 *   3. **The scanner canary cache.** The verdict was keyed on the scanner
 *      binary's hash, so editing `.gitleaks.toml` to drop `[extend]
 *      useDefault = true` would have kept reusing an "ok" measured before the
 *      default ruleset was switched off. The input was: the configuration's
 *      bytes.
 *
 * Each was found separately and fixed separately, by hand, by remembering. The
 * third was found by the stage audit rather than by anything failing, which is
 * the tell: vigilance caught it, and vigilance is not a control. Three
 * instances is where the class earns a mechanism.
 *
 * ## What the mechanism is
 *
 * `digestInputs` turns a list of DECLARED inputs into one digest plus a
 * per-input breakdown. A verdict stores that digest alongside the claim.
 * `changedInputs` re-resolves them later and says which ones moved — by name,
 * so the failure message points at the thing that changed rather than saying
 * "something did".
 *
 * Two properties are deliberate:
 *
 *   - **An empty input list is an error, not an empty digest.** A verdict that
 *     depends on nothing is a verdict nobody can invalidate, which is the state
 *     all three instances above were in.
 *   - **A missing file resolves to a distinct digest rather than throwing.**
 *     Deleting `.gitleaks.toml` must invalidate the verdict that was measured
 *     with it, not crash the checker into a state where nothing is checked.
 *
 * What happens on a change is the caller's to decide: the canary re-measures,
 * the advisory register fails the build. The shared part is knowing what the
 * inputs were and noticing they moved.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/**
 * One thing a verdict's truth rests on.
 *
 * @typedef {{ file: string, why?: string }} FileInput
 *   The bytes of a file. Absolute, or relative to the repository root.
 * @typedef {{ absent: string, from: readonly string[], why?: string }} AbsentInput
 *   A symbol that must not appear in the given tracked paths. The digest covers
 *   the sorted list of files that DO reference it, so the verdict survives an
 *   unrelated edit and dies the moment a new call site appears.
 * @typedef {{ literal: string, value: string, why?: string }} LiteralInput
 *   A value the caller already holds — a version string, a corpus definition.
 * @typedef {FileInput | AbsentInput | LiteralInput} Input
 */

/** @param {Input} input @returns {string} */
export function describeInput(input) {
  if ('file' in input) return `file:${input.file}`;
  if ('absent' in input) return `absent:${input.absent} in ${input.from.join(',')}`;
  return `literal:${input.literal}`;
}

/**
 * @param {Input} input
 * @param {string} root
 * @returns {{ digest: string, detail: string }}
 */
function resolveInput(input, root) {
  if ('file' in input) {
    const path = isAbsolute(input.file) ? input.file : join(root, input.file);
    if (!existsSync(path)) {
      // A distinct, stable digest for "absent". Not an exception: a verdict
      // measured against a file that has since been deleted is exactly the case
      // this exists to catch, and throwing would turn a caught change into a
      // broken checker.
      return { digest: sha256(Buffer.from('\0monstera-verdict-absent\0')), detail: 'absent' };
    }
    return { digest: sha256(readFileSync(path)), detail: 'present' };
  }

  if ('absent' in input) {
    /** @type {string[]} */
    const referencing = [];
    for (const glob of input.from) {
      // Tracked files only. A build artefact or a vendored upstream tree under
      // .tools/ is not something this project ships, and matching it would make
      // every verdict fire constantly — which is how a check gets switched off.
      const result = spawnSync(
        'git',
        ['grep', '-l', '--fixed-strings', '-e', input.absent, '--', glob],
        { cwd: root, encoding: 'utf8' },
      );
      // Exit 1 is "no match", the healthy case. Anything else is a real failure
      // and must not be read as "no references found".
      if (result.status === 0) {
        referencing.push(...`${result.stdout}`.split('\n').filter((line) => line.length > 0));
      } else if (result.status !== 1) {
        throw new Error(
          `git grep failed while resolving ${describeInput(input)}: ` +
            `${`${result.stderr ?? ''}`.trim()}. A verdict whose inputs cannot be read is not ` +
            `a verdict that holds.`,
        );
      }
    }
    const sorted = [...new Set(referencing)].sort();
    return {
      digest: sha256(Buffer.from(sorted.join('\n'))),
      detail: sorted.length === 0 ? 'no references' : `referenced by ${sorted.join(', ')}`,
    };
  }

  return { digest: sha256(Buffer.from(input.value)), detail: 'literal' };
}

/** @param {Buffer} bytes @returns {string} */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @typedef {{ digest: string, inputs: Array<{ name: string, digest: string, detail: string }> }} Resolved
 */

/**
 * @param {readonly Input[]} inputs
 * @param {{ root?: string }} [options]
 * @returns {Resolved}
 */
export function digestInputs(inputs, options = {}) {
  if (inputs.length === 0) {
    throw new Error(
      'A verdict must declare at least one input. A verdict that depends on nothing cannot be ' +
        'invalidated, which is the state every instance of this class was in.',
    );
  }

  const root = options.root ?? repoRoot();
  const resolved = inputs.map((input) => {
    const { digest, detail } = resolveInput(input, root);
    return { name: describeInput(input), digest, detail };
  });

  const combined = createHash('sha256');
  // Sorted, so reordering a declaration list is not a change of substance.
  for (const entry of [...resolved].sort((a, b) => a.name.localeCompare(b.name))) {
    combined.update(`${entry.name}\0${entry.digest}\0`);
  }

  return { digest: combined.digest('hex'), inputs: resolved };
}

/**
 * Which declared inputs have moved since the verdict was recorded.
 *
 * Reporting the individual input rather than only the combined digest is the
 * difference between "this verdict is stale" and "this verdict is stale because
 * `pdf_subset_fonts` is now called from packages/kernel/src/export.ts".
 *
 * @param {readonly { name: string, digest: string }[]} recorded
 * @param {readonly Input[]} inputs
 * @param {{ root?: string }} [options]
 * @returns {Array<{ name: string, was: string, now: string, detail: string }>}
 */
export function changedInputs(recorded, inputs, options = {}) {
  const current = digestInputs(inputs, options);
  const before = new Map(recorded.map((entry) => [entry.name, entry.digest]));

  /** @type {Array<{ name: string, was: string, now: string, detail: string }>} */
  const changed = [];
  for (const entry of current.inputs) {
    const was = before.get(entry.name);
    // An input that was never recorded is a change too: the verdict was taken
    // without it, so it cannot have been accounted for.
    if (was !== entry.digest) {
      changed.push({ name: entry.name, was: was ?? '(not recorded)', now: entry.digest, detail: entry.detail });
    }
  }
  for (const entry of recorded) {
    if (!current.inputs.some((input) => input.name === entry.name)) {
      changed.push({ name: entry.name, was: entry.digest, now: '(no longer declared)', detail: 'removed' });
    }
  }
  return changed;
}
