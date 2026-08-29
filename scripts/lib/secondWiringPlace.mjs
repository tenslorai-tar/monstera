// @ts-check
/**
 * ADR-0029 Decision 4's second mechanism: **no surface renders a hand-written
 * list of commands beside the projection.**
 *
 * > *"Exhaustiveness cannot see a surface that renders a hand-written list
 * > beside the projection. The check is that no module under the surfaces
 * > directory contains a literal array of command ids — and per audit item 4b it
 * > needs a positive control, because* found nothing *is its passing answer."*
 *
 * §7's whole claim is that the ribbon, floating toolbar, context menus, command
 * palette, shortcut map and start screen are **projections** of the command
 * registry. A projection is only a projection if nothing else can add to it.
 * Exhaustiveness over `Placement` catches an unhandled variant; it is blind to a
 * surface that projects correctly *and also* renders four commands somebody
 * pasted in.
 *
 * ## THE SCAN EXISTS BEFORE THE SURFACES, AND THAT IS THE POINT
 *
 * B9's argument, one layer up: a rule about how surfaces are WRITTEN cannot be
 * applied to surfaces already written. ADR-0029 rejects *trusting review* by
 * name — *"this project's record on rules without mechanisms is seven
 * occurrences for one of them and seven for another"* — so the mechanism has to
 * be in place on the day the first surface is written, not after the second
 * wiring place has appeared.
 *
 * `borderTokens.mjs` is the precedent: it shipped before any component CSS
 * existed and printed NOTHING TO SCAN until one did.
 *
 * ## The root problem, and why this one refuses instead of guessing
 *
 * A scan whose directory never materialises reports *found nothing* forever and
 * reads as coverage. That is X-1's **root** axis, and this repository has now
 * paid for it twice — the audit-scope report scoped to `scripts/`, and
 * `check:domenvironment` scoped to `packages/` and `apps/` one range ago, in an
 * instrument written the same morning.
 *
 * Naming {@link SURFACES_DIR} and hoping is the same mistake with a comment on
 * it. So the scope is tied to the thing whose existence makes the rule live:
 *
 *   - **no registry yet** → NOTHING TO SCAN, exit 0. Nothing can have a second
 *     wiring place when there is no first one.
 *   - **a registry, and the surfaces directory exists** → scan it.
 *   - **a registry, and no surfaces directory** → **REFUSE.** The projections
 *     exist somewhere this scan is not looking, which is precisely the state
 *     that otherwise passes silently for the rest of the project's life.
 *
 * The third branch is the one worth having. It converts *the root moved* from a
 * permanent silent pass into a red build on the day it happens.
 *
 * ## What a command id looks like, and why the shape is fixed here
 *
 * `<domain>.<name>` — the same grammar as a `MessageKey`, lower-case and
 * dot-separated. A literal array holding two or more of them is the reported
 * shape: one string could be anything, and an array of several is a list.
 *
 * If a future builder picks a different id grammar, this scan goes quiet — so
 * the grammar is stated in ADR-0029's row and named here, and the registry's own
 * `CommandId` minter is where it should be enforced once one exists. Until then
 * this is a **stated coupling**, not a hidden one.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** Where §7's projections live. Named in ADR-0029's row, not invented here. */
export const SURFACES_DIR = 'packages/ui/src/surfaces';

/**
 * The module whose existence makes this rule live.
 *
 * The registry is what a surface would be projecting FROM, so nothing can be a
 * second wiring place before it exists.
 */
export const REGISTRY_MODULE = 'packages/ui/src/registries/commands.ts';

/** `'<domain>.<name>'`, single- or double-quoted. */
const COMMAND_ID = /(['"])[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9-]*)+\1/gu;

/** An array literal, non-greedy, on one logical span. */
const ARRAY_LITERAL = /\[[^[\]]*\]/gsu;

/** Two or more ids in one array literal is a list; one is an argument. */
const LIST_THRESHOLD = 2;

/**
 * @typedef {{ file: string, line: number, ids: string[] }} Violation
 */

/**
 * Scans one module's text.
 *
 * Exported so the proof and the shipped positive control can drive it without a
 * tree — the interesting inputs are a pasted list, a single id, and an array of
 * strings that are not ids, and writing three files to disk would test the
 * walker rather than the rule.
 *
 * @param {string} shownPath
 * @param {string} text
 * @returns {Violation[]}
 */
export function scanModule(shownPath, text) {
  /** @type {Violation[]} */
  const violations = [];
  for (const match of text.matchAll(ARRAY_LITERAL)) {
    const ids = [...match[0].matchAll(COMMAND_ID)].map((found) => found[0].slice(1, -1));
    if (ids.length < LIST_THRESHOLD) continue;
    violations.push({
      file: shownPath,
      line: text.slice(0, match.index).split('\n').length,
      ids,
    });
  }
  return violations;
}

/**
 * A module that MUST be reported, run on every invocation.
 *
 * Checklist 4b. A wrong pattern, an empty file list, a wrong root and a
 * genuinely clean tree all print *found nothing*, and for this rule that is also
 * the answer everyone wants. The control is a string rather than a tracked file
 * so tidying cannot delete it.
 */
export const CONTROL_FIXTURE = [
  'const RIBBON_HOME = [',
  "  'document.save',",
  "  'document.print',",
  '];',
].join('\n');

/**
 * Whether a file in the surfaces directory is one this rule governs.
 *
 * **A test file is excluded, and that costs no coverage.** Found by this scan's
 * first real caller: a projection's cases assert its OUTPUT, and a projection's
 * output is a list of command ids — so every honest test of a surface contains
 * the exact shape this rule forbids. Reported, the only ways to a green board
 * would be to weaken the assertions or to move the cases out of the directory,
 * and both are worse than the thing being prevented.
 *
 * The exclusion is safe because of what the rule is FOR. A second wiring place
 * is dangerous because it decides what the application renders; a `.test.ts` is
 * imported by no surface and shipped in no bundle, so a list there cannot make
 * anything appear or fail to appear. The rule loses nothing it was protecting.
 *
 * Written as a named predicate rather than a clause in the walker so the proof
 * can drive it, and so the next person to widen the walker meets the reasoning
 * instead of a condition.
 *
 * @param {string} name a file's base name
 */
export function isScannable(name) {
  if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return false;
  return name.endsWith('.ts') || name.endsWith('.tsx');
}

/** @param {string} dir @returns {string[]} */
function modulesIn(dir) {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    let entry;
    try {
      entry = statSync(full);
    } catch {
      continue;
    }
    if (entry.isDirectory()) found.push(...modulesIn(full));
    else if (isScannable(name)) found.push(full);
  }
  return found;
}

/**
 * @typedef {{
 *   state: 'no-registry' | 'no-surfaces' | 'scanned',
 *   violations: Violation[],
 *   filesScanned: number,
 * }} Result
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {Result}
 */
export function scan({ root = repoRoot() } = {}) {
  if (!existsSync(join(root, REGISTRY_MODULE))) {
    return { state: 'no-registry', violations: [], filesScanned: 0 };
  }
  if (!existsSync(join(root, SURFACES_DIR))) {
    return { state: 'no-surfaces', violations: [], filesScanned: 0 };
  }

  // THE REFUSAL IS KEYED ON THE INPUT SET, NOT ON THE DIRECTORY (finding
  // DDDDD-1). It used to be keyed on the directory existing, which was
  // equivalent while every `.ts` under it was scanned. `isScannable` broke that
  // equivalence: a surfaces directory holding only test files is semantically
  // *no surfaces here* and was being reported as *scanned, none found* — the
  // third branch's own condition wearing the first branch's output.
  //
  // The argument is unchanged from the branch above and is what makes this a
  // refusal rather than a warning: if the projections are not in the files this
  // scan reads, they are somewhere it is not looking, and that state otherwise
  // passes silently for the life of the project.
  const modules = modulesIn(join(root, SURFACES_DIR));
  if (modules.length === 0) {
    return { state: 'no-surfaces', violations: [], filesScanned: 0 };
  }

  /** @type {Violation[]} */
  const violations = [];
  let filesScanned = 0;
  for (const path of modules) {
    const shown = relative(root, path).replaceAll('\\', '/');
    filesScanned += 1;
    violations.push(...scanModule(shown, readFileSync(path, 'utf8')));
  }
  return { state: 'scanned', violations, filesScanned };
}

/**
 * Runs the scan, control first.
 *
 * @param {{ root?: string }} [options]
 * @returns {number} the process exit code
 */
export function run({ root = repoRoot() } = {}) {
  // THE WALKER'S HALF OF THE CONTROL (finding DDDDD-2). The fixture below
  // exercises the MATCHER and never touches `modulesIn`, so a walker that
  // returned the wrong files — or none — left the control passing and the scan
  // reporting *none found* for ever. Checklist 4b asks for a positive control
  // on a search; this search had one for half of itself, and the half without
  // one is the half `isScannable` edits.
  //
  // Both directions, because a predicate that answered `true` to everything
  // would restore the false positives the exclusion exists to remove, and one
  // that answered `false` to everything is the blindness above.
  if (!isScannable('ribbon.tsx') || isScannable('ribbon.test.ts')) {
    process.stdout.write(
      `  FAIL  the file filter does not separate a surface from its own cases.\n` +
        `        isScannable('ribbon.tsx') must be true and isScannable('ribbon.test.ts') false.\n` +
        `        A filter that answers no to everything makes this scan walk an empty list and\n` +
        `        report a clean tree; one that answers yes to everything reports every\n` +
        `        projection's own expectations. Refusing to report.\n`,
    );
    return 1;
  }

  const control = scanModule('control.tsx', CONTROL_FIXTURE);
  if (control.length !== 1) {
    process.stdout.write(
      `  FAIL  the scan could not locate its own known-present violation.\n` +
        `        Expected one report from a pasted two-command list; got ${String(control.length)}.\n` +
        `        THE SILENCE OF A BLIND SEARCH IS INDISTINGUISHABLE FROM A CLEAN TREE, and for\n` +
        `        this rule it is also the answer everybody wants. Refusing to report.\n`,
    );
    return 1;
  }

  const result = scan({ root });

  if (result.state === 'no-registry') {
    process.stdout.write(
      `Second wiring place — NOTHING TO SCAN.\n` +
        `  ${REGISTRY_MODULE} does not exist, so no surface can be projecting from it and\n` +
        `  nothing can be a second wiring place. Printed rather than reported clean: the two\n` +
        `  produce identical output otherwise. proof:secondwiring is what says the scan can see.\n`,
    );
    return 0;
  }

  if (result.state === 'no-surfaces') {
    process.stderr.write(
      `Second wiring place — REFUSING TO REPORT.\n` +
        `  ${REGISTRY_MODULE} exists, so §7's projections are being written — and\n` +
        `  ${SURFACES_DIR}/ does not exist, so they are being written somewhere this scan is\n` +
        `  not looking.\n\n` +
        `  This is the state that otherwise passes silently for the rest of the project's life,\n` +
        `  which is X-1's root axis and has cost this repository twice. Either move the surfaces\n` +
        `  there, or change SURFACES_DIR and ADR-0029's row together.\n`,
    );
    return 1;
  }

  if (result.violations.length === 0) {
    process.stdout.write(
      `Second wiring place — none. ${String(result.filesScanned)} surface module(s) scanned,\n` +
        `  and every one of them takes its commands from the registry.\n`,
    );
    return 0;
  }

  process.stdout.write(
    `Second wiring place — ${String(result.violations.length)} hand-written command list(s):\n\n` +
      result.violations
        .map(
          (violation) =>
            `  ${violation.file}:${String(violation.line)}\n` +
            `      lists ${violation.ids.join(', ')}\n` +
            `      §7 makes every surface a PROJECTION of the command registry, and a projection\n` +
            `      is only a projection if nothing else can add to it. A list here is the second\n` +
            `      wiring place the registry exists to forbid: the day somebody adds a command\n` +
            `      and it does not appear, this is where they will not think to look.\n` +
            `      Filter the registry by placement instead.\n`,
        )
        .join('\n'),
  );
  return 1;
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  process.exit(run());
}
