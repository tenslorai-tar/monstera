// @ts-check
/**
 * No built module carries a type-only import or export as a runtime statement.
 *
 * ## The class, and why a lint rule closes only half of it
 *
 * `import { type X } from './y.js'` elides the SPECIFIERS and keeps the
 * STATEMENT, emitting `import {} from './y.js'` — a runtime load of a module the
 * author asked only for types from. `import type { X }` is erased whole. One
 * such statement cost the kernel barrel **41.7 MB of RSS** (ADR-0026), because
 * the module it kept loading bound MuPDF at module scope.
 *
 * `@typescript-eslint/no-import-type-side-effects` closes the import half and is
 * enabled. **Nothing closes the export half.** That rule registers
 * `ImportDeclaration` only — its name is literal — and `consistent-type-exports`
 * pushes an inline `type` specifier into a list its report is not gated on, so
 * `export { type X } from './y.js'` is reported by neither (finding MMMM-1, read
 * from `@typescript-eslint/eslint-plugin` 8.67.0 and then executed with a
 * positive control).
 *
 * So the export half's only protection was a comment in
 * `packages/kernel/src/index.ts`, and this project's record says a comment is
 * not a mechanism: the escape-resolving-write rule was broken seven times and
 * the emitted-template rule seven, each time by an author who had the rule on
 * the page. This is that rule given a caller.
 *
 * ## Why it reads the EMIT rather than the source
 *
 * The source cannot answer it. `export { type X } from './y.js'` and
 * `export type { X } from './y.js'` look equally type-only to a reader and one
 * of them runs — the same reason `kernelLoad.proof.mjs` walks `dist`, the
 * compiler-mitigations check reads the PE image, and the CSP is read off the
 * response.
 *
 * ## The positive control runs inside the SCAN, not only in the proof
 *
 * This is a search, and its reassuring answer is "found nothing" — which is also
 * what a wrong pattern, an empty file list, a missing build and a wrong root all
 * report. So the scan matches its own fixture on every run and refuses to report
 * when it cannot find it. The proof runs in CI; the scan gets run by hand on the
 * day somebody needs an answer, and that is the run whose silence has to be
 * worth something.
 *
 * A control that only proves it can FIND is half of one: a matcher flagging
 * every line passes that just as happily. The fixture therefore carries the two
 * spellings that must be reported and three that must not — including
 * `export {};` with no source, which is the module marker tsc emits for a file
 * whose exports are all types, and which loads nothing.
 *
 * ## What this does NOT do, stated rather than discovered
 *
 * It reads whatever build is on disk. A commit that changes source without
 * rebuilding is scanned against the previous emit, and the pre-commit caller
 * says so by naming the staged files it could not have seen. A disclaimer that
 * could have been printed before the change is furniture, so that one names
 * files this commit staged.
 *
 * Usage: node scripts/lib/emittedSideEffects.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/**
 * A statement that survives type erasure with no bindings left.
 *
 * Anchored at both ends because tsc emits these unindented at module scope, and
 * an unanchored pattern would match the same text quoted inside a string.
 */
const OFFENDING = /^(import|export) \{\} from '([^']+)';?$/u;

/** A fixture carrying both violations and three near-misses. */
export const CONTROL_FIXTURE = [
  "import { readFileSync } from 'node:fs';",
  "import {} from './binds-a-library.js';",
  'export {};',
  "export { thing } from './real-export.js';",
  "export {} from './also-binds.js';",
].join('\n');

/** The fixture's violations sit on these lines, and the scan must find them there. */
export const CONTROL_LINES = [2, 5];

/**
 * Every built JavaScript file under a package's or app's `dist`.
 *
 * @param {string} root
 * @returns {string[]} absolute paths
 */
export function builtFiles(root) {
  /** @type {string[]} */
  const files = [];
  for (const group of ['packages', 'apps']) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const dist = join(groupDir, name, 'dist');
      if (existsSync(dist)) walk(dist, files);
    }
  }
  return files;
}

/** @param {string} directory @param {string[]} into */
function walk(directory, into) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, into);
    else if (path.endsWith('.js')) into.push(path);
  }
}

/** @typedef {{ line: number, kind: string, specifier: string }} Violation */

/**
 * @param {string} source
 * @returns {Violation[]}
 */
export function violationsIn(source) {
  /** @type {Violation[]} */
  const found = [];
  for (const [index, line] of source.split('\n').entries()) {
    const match = OFFENDING.exec(line.trim());
    if (match === null) continue;
    found.push({ line: index + 1, kind: match[1] ?? '', specifier: match[2] ?? '' });
  }
  return found;
}

/**
 * @typedef {{
 *   blind: string | null,
 *   scanned: number,
 *   violations: Array<{ file: string, line: number, kind: string, specifier: string }>,
 * }} ScanResult
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {ScanResult}
 */
export function scan({ root = repoRoot() } = {}) {
  const control = violationsIn(CONTROL_FIXTURE);
  const linesFound = control.map((violation) => violation.line);
  const seesBoth =
    linesFound.length === CONTROL_LINES.length &&
    CONTROL_LINES.every((line, index) => linesFound[index] === line);

  if (!seesBoth) {
    const got = linesFound.length === 0 ? 'none' : linesFound.join(', ');
    return {
      blind: `expected control violations on lines ${CONTROL_LINES.join(', ')}, got ${got}`,
      scanned: 0,
      violations: [],
    };
  }

  const files = builtFiles(root);
  if (files.length === 0) {
    return {
      blind:
        'no built JavaScript under packages/*/dist or apps/*/dist. An empty file set reports ' +
        '"no violations" exactly as a clean build does. Run `npm run build` first.',
      scanned: 0,
      violations: [],
    };
  }

  /** @type {Array<{ file: string, line: number, kind: string, specifier: string }>} */
  const violations = [];
  for (const file of files) {
    for (const violation of violationsIn(readFileSync(file, 'utf8'))) {
      violations.push({
        file: file.slice(root.length + 1).replaceAll('\\', '/'),
        line: violation.line,
        kind: violation.kind,
        specifier: violation.specifier,
      });
    }
  }
  return { blind: null, scanned: files.length, violations };
}

/** @param {ScanResult} result @returns {string} */
export function report(result) {
  if (result.blind !== null) {
    return (
      '  !!  the emitted-side-effect scan could not see, so it reported nothing\n' +
      `      ${result.blind}\n` +
      '      A search that cannot find a known-present violation is worthless, so it refuses ' +
      'to report a result.\n'
    );
  }
  if (result.violations.length === 0) {
    return (
      `  ok  ${result.scanned} built file(s) carry no type-only statement at run time\n` +
      '  ok  and the scan located both control violations, so that result means something\n'
    );
  }
  const lines = result.violations
    .map((v) => `      ${v.file}:${v.line}  ${v.kind} {} from '${v.specifier}'`)
    .join('\n');
  return (
    `  !!  ${result.violations.length} type-only statement(s) survive in the EMIT\n\n` +
    lines +
    '\n\n      Each LOADS its module at run time for no binding. Rewrite the source statement ' +
    'with a top-level type qualifier: the inline marker keeps the statement, the top-level one ' +
    'erases it.\n'
  );
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const outcome = scan();
  process.stdout.write(report(outcome));
  process.exitCode = outcome.blind !== null || outcome.violations.length > 0 ? 1 : 0;
}
