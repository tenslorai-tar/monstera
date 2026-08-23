// @ts-check
/**
 * Parses every staged JavaScript blob, so a syntax break cannot be committed
 * (finding UUU-2).
 *
 * ## Why this exists, in the words the pre-commit hook already used
 *
 * `preCommit.mjs` argues, about the emitted-template scan, that what stopped
 * occurrence four was a hand-run `node --check` — *me remembering, and
 * remembering is the thing a mechanism replaces*. That sentence was written to
 * justify moving one scan into pre-commit and it applies verbatim here.
 *
 * On 2026-08-23 a comment-closing sequence inside a JSDoc block ended the
 * comment early and broke a file; it came from a sed expression quoted in prose.
 * It is the backtick class exactly — prose and code sharing a delimiter,
 * composed while writing about something else — but the backtick scan cannot see
 * it, because the delimiter is a different one. What caught it was a hand-run
 * `node --check`.
 *
 * So the guard that generalises is not a third delimiter-specific scan. It is
 * **asking the parser**, which catches that class and every other way a file
 * stops being parseable. It happened twice more while this module was being
 * written, in this file's own header, which is the argument rather than an
 * embarrassment.
 *
 * ## Scope, stated because an unstated one is the finding this repository keeps
 *
 * `.mjs`, `.cjs` and `.js` ONLY. TypeScript is out and cannot be included: V8
 * parses JavaScript, and a `.ts` file with type annotations is a syntax error to
 * it, so including them would report every one as broken. TypeScript is parsed
 * by `tsc` in `npm run typecheck`, which runs in CI and locally and NOT in
 * pre-commit — so this closes the JavaScript half of the class and leaves the
 * TypeScript half exactly where it already was. Saying so is the point: AA-1's
 * lesson is that a remedy with an unstated scope reads as a mechanism.
 *
 * ## Against the INDEX, never the disk
 *
 * The same reason `emittedTemplates` reads the index: a guard reading the
 * working tree passes a commit whose staged content is broken — stage the
 * violation, fix the file, commit — and fails one whose staged content is fine.
 *
 * ## Two controls, in opposite directions, on every run
 *
 * The reassuring answer is "nothing is broken", which is also what an empty file
 * list, a wrong extension filter and a parser that never ran produce. So every
 * invocation parses a known-BROKEN source and requires it to be reported, and a
 * known-GOOD one and requires it to pass. Either control failing means BLIND
 * rather than a verdict.
 *
 * The second is not symmetry for its own sake. The child needs
 * `--experimental-vm-modules`; if that API is ever withdrawn, every module-goal
 * parse throws and every staged file would be reported broken. The good control
 * turns that into *the parser is not working* instead of thirty false failures,
 * which is the difference between a guard people fix and a guard people delete.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { changedPaths, readStagedBlobs, repoRoot } from './gitScope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = join(HERE, 'parseSources.mjs');

/** What V8 can parse. See the scope note in the header. */
const PARSEABLE = /\.(?:mjs|cjs|js)$/u;

/**
 * A source that is a syntax error in both goals.
 *
 * It is the shape that produced the finding: a comment-closing sequence inside
 * a block comment, from a sed expression quoted in prose. The sequence is built
 * by concatenation rather than written out, because writing it out would end
 * THIS comment and reproduce the defect inside the file that describes it.
 */
const KNOWN_BROKEN = `/** a sed expression: s/=.*${'*/'}=x/ */\nconst a = 1;\n`;

/** A source that must parse, so "everything is broken" cannot read as a verdict. */
const KNOWN_GOOD = 'export const parsed = 1;\n';

/**
 * @typedef {object} SyntaxProblem
 * @property {string} path Repository-relative path, as staged.
 * @property {string} detail The parser's own message.
 */

/**
 * Every staged JavaScript blob that does not parse.
 *
 * @param {{ root?: string }} [options]
 * @returns {{ problems: SyntaxProblem[], checked: number, blind: string | null }}
 */
export function scan(options = {}) {
  const root = options.root ?? repoRoot();
  const directory = mkdtempSync(join(tmpdir(), 'monstera-syntax-'));
  try {
    // ADDED, COPIED, MODIFIED and RENAMED — every state in which a blob's
    // CONTENT is in the index. A deletion has no content to parse, and the
    // classifier's three-axis lesson (pattern, root, state) is why the states
    // are named rather than assumed.
    const staged = changedPaths(['--cached'], { cwd: root }).filter(
      (entry) => entry.state !== 'D' && PARSEABLE.test(entry.path),
    );

    /** @type {Array<{ id: string, file: string, goal: 'module' | 'script' | 'either' }>} */
    const manifest = [];
    /** @type {Map<string, string>} */
    const paths = new Map();

    // ONE git invocation for every blob. Reading them one at a time spawns git
    // twice per path, which measured fourteen times the cost of the parse it
    // feeds — see `readStagedBlobs`.
    const blobs = readStagedBlobs(
      staged.map((entry) => entry.path),
      { cwd: root },
    );

    let ordinal = 0;
    for (const entry of staged) {
      const blob = blobs.get(entry.path);
      if (blob === undefined) continue;
      ordinal += 1;
      const id = `staged-${String(ordinal)}`;
      const extension = PARSEABLE.exec(entry.path)?.[0] ?? '.mjs';
      const file = join(directory, `${id}${extension}`);
      writeFileSync(file, blob.toString('utf8'), 'utf8');
      paths.set(id, entry.path);
      manifest.push({
        id,
        file,
        goal: extension === '.mjs' ? 'module' : extension === '.cjs' ? 'script' : 'either',
      });
    }

    /** @type {ReadonlyArray<readonly [string, string]>} */
    const controls = [
      ['control-broken', KNOWN_BROKEN],
      ['control-good', KNOWN_GOOD],
    ];
    for (const [id, source] of controls) {
      const file = join(directory, `${id}.mjs`);
      writeFileSync(file, source, 'utf8');
      manifest.push({ id, file, goal: 'module' });
    }

    const manifestPath = join(directory, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    // ONE SPAWN. `node --check` costs ~330 ms per file, almost all of it
    // startup, and it silently checks only the FIRST of several paths — so
    // passing them all is a green tick for files nobody parsed. See the child's
    // header.
    const run = spawnSync(
      process.execPath,
      ['--experimental-vm-modules', '--no-warnings', CHILD, manifestPath],
      { encoding: 'utf8' },
    );
    if (run.status !== 0) {
      return {
        problems: [],
        checked: staged.length,
        blind: `the parser child exited ${String(run.status)}: ${`${run.stderr ?? ''}`.trim().slice(0, 300)}`,
      };
    }

    /** @type {Array<{ id: string, detail: string | null }>} */
    let results;
    try {
      results = JSON.parse(`${run.stdout ?? ''}`);
    } catch {
      return {
        problems: [],
        checked: staged.length,
        blind: `the parser child printed something unparseable: ${`${run.stdout ?? ''}`.trim().slice(0, 200)}`,
      };
    }

    const byId = new Map(results.map((result) => [result.id, result.detail]));
    if (byId.get('control-broken') === null || !byId.has('control-broken')) {
      return {
        problems: [],
        checked: staged.length,
        blind: 'a source known NOT to parse was accepted as valid',
      };
    }
    const good = byId.get('control-good');
    if (good !== null) {
      return {
        problems: [],
        checked: staged.length,
        blind: `a source known to parse was REFUSED (${String(good)}), so every file would read as broken`,
      };
    }

    /** @type {SyntaxProblem[]} */
    const problems = [];
    for (const [id, path] of paths) {
      const detail = byId.get(id);
      if (detail !== null && detail !== undefined) problems.push({ path, detail });
    }
    return { problems, checked: paths.size, blind: null };
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/**
 * @param {ReturnType<typeof scan>} result
 * @returns {string}
 */
export function report(result) {
  if (result.blind !== null) {
    return (
      `  BLIND — ${result.blind}.\n` +
      '        So "no syntax errors" here means "did not look", and reporting nothing would\n' +
      '        be the reassuring answer produced by a parser that never ran.\n'
    );
  }
  if (result.problems.length === 0) {
    return (
      `  ok  ${String(result.checked)} staged JavaScript blob(s) parse\n` +
      '  ok  and a known-broken source was reported while a known-good one passed\n'
    );
  }
  return (
    result.problems
      .map((problem) => `  FAIL  ${problem.path}\n        ${problem.detail}\n`)
      .join('') +
    `\n${String(result.problems.length)} staged file(s) do not parse.\n`
  );
}
