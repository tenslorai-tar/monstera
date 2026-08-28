// @ts-check
/**
 * No re-export is written with inline `type` markers on every specifier.
 *
 * ## What this catches, and why a lint rule cannot
 *
 * `export { type X } from './y.js'` elides the SPECIFIERS and keeps the
 * STATEMENT, emitting `export {} from './y.js'` — a runtime load of a module the
 * author asked only for types from. `export type { X } from './y.js'` is erased
 * whole. One statement of that shape cost the kernel barrel **41.7 MB of RSS**
 * (ADR-0026).
 *
 * No rule in the pinned `@typescript-eslint/eslint-plugin` 8.67.0 reports it.
 * `no-import-type-side-effects` registers `ImportDeclaration` only — its name is
 * literal — and `consistent-type-exports` pushes an inline `type` specifier into
 * a list its report is not gated on (finding MMMM-1, read from the plugin and
 * then executed with a positive control).
 *
 * ## Why a SOURCE scan, when the emit is where the two spellings differ
 *
 * Because for **this** spelling they do not. `export { type X } from` and
 * `export type { X } from` are different text, and telling them apart needs no
 * build — which is what lets this run against the INDEX and be the fail-closed
 * gate. Its sibling `emittedSideEffects.mjs` reads `dist` and can be blind when
 * nothing has been built; this can never be.
 *
 * That division is finding QQQQ-1's remedy. The emit scan was registered
 * fail-closed, blocked every case in `proof:guards` — whose fixture repository
 * has no `dist` — and was softened to report-and-continue, which left a gate that
 * contributes nothing on a machine where nobody builds. The two now have one job
 * each: this one decides *did you write it*, and the emit scan stays in CI as the
 * completeness control over *did a build emit one*, which is a different
 * question and the reason neither is a copy of the other.
 *
 * **B3a does not push against this.** It forbids a second opinion about an
 * authority's rule; here no rule covers the spelling at all, so there is no
 * authority to disagree with.
 *
 * ## The positive control runs inside the scan
 *
 * Its reassuring answer is "found nothing", which a wrong pattern, an empty file
 * list and a bad parse all produce. The fixture therefore carries the violations
 * it must report **and** the near-misses it must not — a matcher that flagged
 * every export clause would pass a find-only control perfectly.
 *
 * Usage: node scripts/lib/typeOnlyExports.mjs
 */

import { readStagedBlobs, repoRoot } from './gitScope.mjs';
import { filesInCommit } from './gitScope.mjs';

/**
 * An export clause with a module specifier.
 *
 * `[^}]*` spans newlines and cannot cross a closing brace, which is exactly an
 * export clause: it contains no nested braces, and `tsc` wraps long lists. An
 * anchored single-line pattern would silently miss every wrapped block, which is
 * most of them — item 4b's window axis, and the barrel's own occurrence was one.
 */
const RE_EXPORT = /^export\s*\{([^}]*)\}\s*from\s*'([^']+)'/gmu;

/** @typedef {{ line: number, specifier: string, kind: 'all-inline-type' | 'empty' }} Violation */

/**
 * @param {string} source
 * @returns {Violation[]}
 */
export function violationsIn(source) {
  /** @type {Violation[]} */
  const found = [];
  for (const match of source.matchAll(RE_EXPORT)) {
    const clause = match[1] ?? '';
    const specifier = match[2] ?? '';
    const line = source.slice(0, match.index).split('\n').length;

    const names = clause
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');

    // An EMPTY clause is its own finding and gets its own message. Folding it
    // into "every specifier is type-only" would be vacuously true — the claim
    // would be about a set with no members, which is the shape that makes a
    // report read as evidence when it is arithmetic.
    if (names.length === 0) {
      found.push({ line, specifier, kind: 'empty' });
      continue;
    }
    if (names.every((name) => /^type\s/u.test(name))) {
      found.push({ line, specifier, kind: 'all-inline-type' });
    }
  }
  return found;
}

/** Two violations and four near-misses. The near-misses are the load-bearing half. */
export const CONTROL_FIXTURE = [
  "export { type Alpha } from './a.js';", // 1 — violation
  "export { Beta, type Gamma } from './b.js';", // 2 — mixed, keeps the statement alive
  "export type { Delta } from './c.js';", // 3 — erased whole
  "export { Epsilon } from './d.js';", // 4 — ordinary
  "export { Zeta, type Eta };", // 5 — no `from`, loads nothing
  'export {', // 6 — violation, wrapped
  '  type Theta,',
  '  type Iota,',
  "} from './e.js';",
].join('\n');

/** The fixture's violations sit on these lines. */
export const CONTROL_LINES = [1, 6];

/**
 * @typedef {{
 *   blind: string | null,
 *   scanned: number,
 *   violations: Array<{ file: string, line: number, specifier: string, kind: string }>,
 * }} ScanResult
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {ScanResult}
 */
export function scan({ root = repoRoot() } = {}) {
  const control = violationsIn(CONTROL_FIXTURE);
  const lines = control.map((violation) => violation.line);
  const findsBoth =
    lines.length === CONTROL_LINES.length &&
    CONTROL_LINES.every((line, index) => lines[index] === line);
  if (!findsBoth) {
    const got = lines.length === 0 ? 'none' : lines.join(', ');
    return {
      blind: `expected control violations on lines ${CONTROL_LINES.join(', ')}, got ${got}`,
      scanned: 0,
      violations: [],
    };
  }

  // THE TREE THIS COMMIT WILL LEAVE, read from the index — the same resolver
  // `emittedTemplates.mjs` uses, for the reason its own comment gives:
  // `ls-files` answers about the previous commit, so a check built on it can
  // only catch a mistake after the commit that made it.
  const files = filesInCommit({ cwd: root }).filter((path) => /\.tsx?$/u.test(path));

  /** @type {Array<{ file: string, line: number, specifier: string, kind: string }>} */
  const violations = [];
  let scanned = 0;

  // ONE `git cat-file --batch` FOR THE WHOLE SET. `readStagedBlob` spawns twice
  // per path, and on Windows the spawn dominates everything downstream — this
  // loop measured **25.2 s** of a 97 s pre-commit hook on 2026-08-28, doing
  // nothing but reading. Its own helper's header has recommended the batch since
  // 2026-08-23; see `emittedTemplates.mjs` for why the recommendation not being
  // taken is the finding rather than the slowness.
  const staged = readStagedBlobs(files, { cwd: root });

  for (const file of files) {
    const blob = staged.get(file);
    if (blob === undefined) continue;
    scanned += 1;
    for (const violation of violationsIn(`${blob}`)) {
      violations.push({ file, ...violation });
    }
  }
  return { blind: null, scanned, violations };
}

/** @param {ScanResult} result @returns {string} */
export function report(result) {
  if (result.blind !== null) {
    return (
      '  !!  the type-only export scan could not see, so it reported nothing\n' +
      `      ${result.blind}\n`
    );
  }
  if (result.violations.length === 0) {
    return (
      `  ok  ${result.scanned} TypeScript file(s) carry no all-inline-type re-export\n` +
      '  ok  and the scan located both control violations, so that result means something\n'
    );
  }
  const lines = result.violations
    .map(
      (violation) =>
        `      ${violation.file}:${violation.line}  ` +
        (violation.kind === 'empty'
          ? `export {} from '${violation.specifier}' — an empty clause loads the module and binds nothing`
          : `every specifier is inline \`type\`, from '${violation.specifier}'`),
    )
    .join('\n');
  return (
    `  !!  ${result.violations.length} type-only re-export(s) that will EMIT a runtime load\n\n` +
    lines +
    '\n\n      Move the marker to the front of the clause: a top-level type qualifier erases the ' +
    'whole statement, an inline one keeps it and drops only the names.\n'
  );
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const outcome = scan();
  process.stdout.write(report(outcome));
  process.exitCode = outcome.blind !== null || outcome.violations.length > 0 ? 1 : 0;
}
