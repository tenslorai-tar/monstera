// @ts-check
/**
 * A DOM is available only to tests in `packages/ui`.
 *
 * ## The rule this enforces is already law, and had no mechanism
 *
 * `CLAUDE.md`: *"A test that must fake `DOMMatrix` or a window bridge just to
 * exercise a save is evidence the boundary is wrong — fix the boundary, not the
 * test."* The kernel having no DOM and no Electron is what makes the whole
 * document pipeline unit-testable in milliseconds, and that property is worth
 * exactly as much as the thing preventing its erosion.
 *
 * Until the component-test vehicle landed there was nothing to erode it with:
 * no DOM environment was installed, so a kernel test could not have had one.
 * Installing `happy-dom` created the capability, and a capability with a rule
 * over it and no check is what this project's record says gets spent.
 *
 * ## Why a scan, and why it is not the vitest config
 *
 * The environment is chosen per file, by a `@vitest-environment` docblock. A
 * config cannot forbid one: vitest reads the docblock and honours it whatever
 * the config says, which is the whole point of the feature. Scoping the
 * environment through `test.projects` would not close it either, for the same
 * reason — the docblock still wins — and it would put the alias map at risk,
 * which is the one piece of this config that has already cost 27 green tests
 * over a deleted line of source (see `vitest.config.mjs`).
 *
 * So the config decides the DEFAULT, which is `node` and is the safe one, and
 * this scan decides who may depart from it.
 *
 * ## The rule is stated as "not node", not as a list of DOM names
 *
 * `happy-dom` and `jsdom` are the two that exist today. A deny-list of those
 * two passes `edge-runtime`, and passes whatever vitest ships next — the
 * failure mode being silence, which is the shape this project rejects
 * everywhere else. Requiring the environment to be `node` outside
 * `packages/ui` fails closed instead: a name nobody has heard of is reported.
 *
 * ## What it does not decide
 *
 * Whether a `packages/ui` file *should* have a DOM. Rendering is that package's
 * job, so the answer there is a design question a reviewer reads, not a
 * property text can decide. What the scan guarantees is that no test outside
 * that package can quietly acquire one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { defaultInclude } from 'vitest/config';

import vitestConfig from '../../vitest.config.mjs';
import { repoRoot } from './gitScope.mjs';

/**
 * Directories vitest does not collect from, so neither does this — **read from
 * the config rather than transcribed from it** (finding GGGG-1).
 *
 * ## The two lists had already drifted, which is the whole finding
 *
 * This was a hand-written set said to be *"taken from `vitest.config.mjs`'s own
 * `exclude`, plus `.git` and `.cache`"*. It was not: the config names five
 * globs and the set named seven entries, and nothing could say which two were
 * the declared additions and which were a guess. *Copy only where the reader
 * cannot reach the source* — and this reader can, because the config is an ESM
 * module in this repository that a plain-Node script may import.
 *
 * A drift in this direction is silent and one-way: a directory in the set that
 * vitest actually collects from makes the scan skip files vitest runs, and the
 * scan then reports *no test outside `packages/ui` names a DOM environment*
 * over a smaller tree. That is the reassuring answer, which is why the extent
 * comes from the rule rather than from a copy of it.
 *
 * The two entries that are ours are declared in `ADDED` below, rather than
 * hidden among the derived ones.
 */
const ADDED = new Set([
  // Not source, and not vitest's business either — it excludes neither.
  '.git',
  // Written by `checkLocal.mjs` and gitignored. Named here rather than in the
  // config because vitest has no reason to know about it.
  '.cache',
]);

const SKIPPED = new Set([...leadingSegments(vitestConfig.test?.exclude ?? []), ...ADDED]);

/**
 * The first path segment of each exclude glob — the directory this walk prunes.
 *
 * `**\/node_modules/**` and `.tools/**` both name one directory; the walk
 * matches on `readdirSync` entry names, so that segment is what it can act on.
 * A glob whose first meaningful segment is not a plain name is **dropped and
 * counted**, because a pattern this cannot represent must not be silently
 * treated as covered — the caller refuses when the derived set comes back
 * empty, which is the broken-parse case.
 *
 * @param {readonly string[]} globs
 * @returns {string[]}
 */
function leadingSegments(globs) {
  /** @type {string[]} */
  const names = [];
  for (const glob of globs) {
    for (const segment of glob.split('/')) {
      if (segment === '**' || segment === '') continue;
      if (segment.includes('*') || segment.includes('?')) break;
      names.push(segment);
      break;
    }
  }
  return names;
}

if (SKIPPED.size <= ADDED.size) {
  // AN EMPTY INTERMEDIATE RESULT IS A BROKEN PARSE, NOT A CLEAN INPUT. A config
  // whose `exclude` this could not read leaves only our two additions, and the
  // walk would then descend into `node_modules` and report on other people's
  // test files. Throwing is the only honest answer.
  throw new Error(
    `domEnvironment: no directory names could be derived from vitest.config.mjs's exclude ` +
      `(${JSON.stringify(vitestConfig.test?.exclude ?? [])}). The walk's extent comes from ` +
      `that list, so an empty derivation is a scan that would report on the whole disk.`,
  );
}

/**
 * A file vitest collects, by vitest's rule rather than by ours.
 *
 * ## This pattern IS the finding EEEE-1 recorded, and the fix is not a wider list
 *
 * The first version walked `packages/` and `apps/` for `.ts` and `.tsx`. Both
 * halves were a second opinion about where tests live, and both were wrong in
 * the silent direction: `vitest.config.mjs` sets **no `include`**, so vitest
 * uses its default and collects from the whole repository, and that default is
 * `?(c|m)[jt]s?(x)` — `.mjs`, `.cjs`, `.js`, `.jsx` and `.mts` as well.
 *
 * Measured before the fix: a probe at `scripts/auditprobe.test.mjs` naming
 * happy-dom ran under vitest with a working DOM, while this scan reported *"no
 * test outside packages/ui names one"* over 118 files and exited 0. That is
 * W-1's pattern axis and X-1's root axis at once, in an instrument written the
 * same morning.
 *
 * So the extent comes from the rule that governs it. **The set this check is
 * responsible for is the set vitest collects** — a docblock in any other file is
 * inert, because nothing reads it — and narrowing to that set is not a loosening
 * but the correct boundary. Widening the two lists instead would have been the
 * same guess with more entries, and would still be wrong the day someone adds
 * a `.spec.jsx` somewhere neither list names.
 */
const COLLECTED = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/**
 * What {@link COLLECTED} is a hand-compiled form of, PINNED against vitest's own.
 *
 * The exclude half above is derived; this half cannot be, and the difference is
 * worth stating rather than glossing. `defaultInclude` is a glob using extglob
 * syntax, and turning it into a regex here would be a second opinion about glob
 * semantics — the B3a shape, agreeing with the authority right up until an edge
 * case (finding GGGG-1's other half).
 *
 * So the value is pinned instead. A vitest release that widens its default
 * fails this **loudly, naming both strings**, which is the only outcome that
 * matters: the failure this replaces was the two diverging in silence, after
 * which the scan reports on a smaller tree and says nothing about it.
 *
 * A pin is not a derivation and does not pretend to be one. What it buys is
 * that the divergence becomes an event rather than a state.
 */
const PINNED_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];

if (JSON.stringify(defaultInclude) !== JSON.stringify(PINNED_INCLUDE)) {
  throw new Error(
    `domEnvironment: vitest's defaultInclude is ${JSON.stringify(defaultInclude)}, and this ` +
      `scan's matcher was compiled from ${JSON.stringify(PINNED_INCLUDE)}. The two decide which ` +
      `files the scan is responsible for, and a difference makes it silently answer about a ` +
      `smaller set. Update COLLECTED and this pin together.`,
  );
}

/** The one package whose tests may render, and therefore may name a DOM. */
const RENDERING_PACKAGE = 'packages/ui/';

/**
 * The docblock vitest reads to override the environment for one file.
 *
 * Matched anywhere in the file rather than only in a leading comment. Vitest
 * itself looks at the first docblock, so a match further down is inert — and a
 * scan that reports an inert one costs a contributor one deleted line, while a
 * scan that reads only the top is defeated by a file whose docblock moves. The
 * expensive direction is the quiet one.
 */
const ENVIRONMENT_DOCBLOCK = /@vitest-environment\s+([A-Za-z0-9@/._-]+)/gu;

/** The environment every package outside {@link RENDERING_PACKAGE} must run in. */
const REQUIRED_OUTSIDE_UI = 'node';

/**
 * @typedef {{
 *   file: string,
 *   line: number,
 *   environment: string,
 * }} Violation
 */

/**
 * Scans one file's text.
 *
 * Exported so the proof and the positive control can drive it without a tree:
 * the interesting inputs are a violation, a permitted `packages/ui` docblock
 * and an explicit `node` docblock, and writing three files to disk to express
 * those would test the walker instead of the rule.
 *
 * @param {string} shownPath repository-relative, forward slashes
 * @param {string} text
 * @returns {{ violations: Violation[], docblocks: number }}
 */
export function scanFile(shownPath, text) {
  /** @type {Violation[]} */
  const violations = [];
  let docblocks = 0;

  for (const match of text.matchAll(ENVIRONMENT_DOCBLOCK)) {
    docblocks += 1;
    const environment = match[1] ?? '';
    if (shownPath.startsWith(RENDERING_PACKAGE)) continue;
    if (environment === REQUIRED_OUTSIDE_UI) continue;
    violations.push({
      file: shownPath,
      line: text.slice(0, match.index).split('\n').length,
      environment,
    });
  }
  return { violations, docblocks };
}

/** @param {string} dir @returns {string[]} */
function collectedFilesIn(dir) {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // Absent directory. Returned as nothing found, and turned into a refusal by
    // the caller's scope check rather than swallowed here: "the root does not
    // exist" and "the root holds no test" must not reach the verdict as the
    // same thing.
    return found;
  }
  for (const name of entries) {
    if (SKIPPED.has(name)) continue;
    const full = join(dir, name);
    let entry;
    try {
      entry = statSync(full);
    } catch {
      continue;
    }
    if (entry.isDirectory()) found.push(...collectedFilesIn(full));
    else if (COLLECTED.test(name)) found.push(full);
  }
  return found;
}

/**
 * A file that MUST be reported, run through {@link scanFile} on every run.
 *
 * Checklist 4b: this is a search, and *found nothing* is what a wrong pattern,
 * an empty file list, a wrong root and a genuinely clean tree all print. The
 * control is a string rather than a tracked file so it cannot be deleted by
 * someone tidying up, and it is checked on every run rather than only in the
 * proof, because the proof runs in CI and this scan gets run by hand on the day
 * someone needs an answer.
 *
 * The path is one outside `packages/ui` and the environment is a DOM, so the
 * only way it goes unreported is that the instrument is blind.
 */
export const CONTROL_FIXTURE = {
  path: 'packages/kernel/src/control.test.ts',
  text: ['// @vitest-environment happy-dom', 'export {};'].join('\n'),
};

/**
 * @typedef {{
 *   violations: Violation[],
 *   filesScanned: number,
 *   docblocksExamined: number,
 * }} Result
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {Result}
 */
export function scan({ root = repoRoot() } = {}) {
  /** @type {Violation[]} */
  const violations = [];
  let filesScanned = 0;
  let docblocksExamined = 0;

  // The repository root, because that is where vitest collects from. Anything
  // narrower is the guess EEEE-1 recorded.
  for (const path of collectedFilesIn(root)) {
    const shown = relative(root, path).replaceAll('\\', '/');
    filesScanned += 1;
    const result = scanFile(shown, readFileSync(path, 'utf8'));
    violations.push(...result.violations);
    docblocksExamined += result.docblocks;
  }
  return { violations, filesScanned, docblocksExamined };
}

/** @param {Result} result @returns {string} */
export function report(result) {
  if (result.violations.length === 0) {
    return (
      `DOM environment — no test outside packages/ui names one.\n` +
      `  ${String(result.filesScanned)} collected test file(s), ` +
      `${String(result.docblocksExamined)} @vitest-environment docblock(s).\n`
    );
  }
  return (
    `DOM environment — ${String(result.violations.length)} file(s) outside packages/ui ` +
    `name an environment other than ${REQUIRED_OUTSIDE_UI}:\n\n` +
    result.violations
      .map(
        (violation) =>
          `  ${violation.file}:${String(violation.line)}\n` +
          `      names the "${violation.environment}" environment.\n` +
          `      packages/kernel has no DOM and no Electron by design, and that is what makes\n` +
          `      the document pipeline unit-testable in milliseconds. A test that needs a\n` +
          `      window to exercise its subject is evidence the boundary is wrong: move the\n` +
          `      subject, or move the test to packages/ui.\n`,
      )
      .join('\n')
  );
}

/**
 * Runs the scan, control first.
 *
 * Returns an exit code rather than calling `process.exit`, so the proof can
 * execute the refusal branches instead of asserting that they are written.
 *
 * @param {{ root?: string }} [options]
 * @returns {number} the process exit code
 */
export function run({ root = repoRoot() } = {}) {
  const control = scanFile(CONTROL_FIXTURE.path, CONTROL_FIXTURE.text);
  if (control.violations.length !== 1) {
    process.stdout.write(
      `  FAIL  the scan could not locate its own known-present violation.\n` +
        `        The control is a ${CONTROL_FIXTURE.path} naming a DOM environment;\n` +
        `        expected exactly one report, got ${String(control.violations.length)}.\n` +
        `        THE SILENCE OF A BLIND SEARCH IS INDISTINGUISHABLE FROM A CLEAN TREE, so this\n` +
        `        refuses to report a result.\n`,
    );
    return 1;
  }

  const result = scan({ root });
  if (result.filesScanned === 0) {
    process.stdout.write(
      `  FAIL  no test file was found in the repository at all.\n` +
        `        This scan collects what vitest collects — ${String(COLLECTED)} — and a tree\n` +
        `        with no test in it is a broken walk, not a clean result, so this refuses to\n` +
        `        report one.\n`,
    );
    return 1;
  }

  process.stdout.write(report(result));
  return result.violations.length > 0 ? 1 : 0;
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  process.exit(run());
}
