// @ts-check
/**
 * Reports any staged test file that declares fewer cases than at `HEAD`.
 *
 * The mechanism, the anchor's direction, and the four things it cannot see are
 * in `scripts/lib/testCaseCounts.mjs`. This file gets blobs and prints.
 *
 * It exits **0 whether or not anything shrank** — see that module for why a
 * gate here would need an override and what `CLAUDE.md` says about one. A
 * non-zero exit is reserved for this instrument being unable to look.
 *
 * Usage: node scripts/checks/testAnchors.mjs
 */

import { changedPaths, readStagedBlobs, repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  blobAt,
  countCases,
  findShrunkCases,
  formatShrunkCases,
  presentAt,
} from '../lib/testCaseCounts.mjs';

/** What this instrument considers a test file. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/**
 * A source the counter MUST find cases in, on every run.
 *
 * Checklist 4b: a search has one output for every way it can be broken, and
 * *no file shrank* is the reassuring answer here — it is what a correct run
 * over an ordinary commit prints, what a wrong pattern prints, and what an
 * empty path list prints. So the pattern is made to find something known to be
 * there before any result is believed.
 *
 * Both spellings, because they take different branches of the pattern: a bare
 * `it(` and a modified `it.each(`.
 */
const CONTROL_SOURCE = [
  "describe('x', () => {",
  "  it('one', () => {});",
  '  it.each([1, 2])(%s, () => {});',
  "  test.skip('three', () => {});",
  '});',
].join('\n');

const CONTROL_CASES = 3;

try {
  const root = repoRoot();

  // THE POSITIVE CONTROL FIRST, so a broken counter cannot reach the report.
  const found = countCases(CONTROL_SOURCE);
  if (found !== CONTROL_CASES) {
    process.stderr.write(
      `\nThe case counter found ${String(found)} case(s) in its own control, which declares ` +
        `${String(CONTROL_CASES)}.\n\n  Every result below would be "nothing shrank", which is ` +
        `also what a correct run prints.\n  The instrument is refusing rather than reporting a ` +
        `silence it cannot stand behind.\n`,
    );
    process.exitCode = 1;
  } else {
    const paths = changedPaths(['--cached'], { cwd: root })
      .filter((entry) => entry.state !== 'D')
      .map((entry) => entry.path)
      .filter((path) => TEST_FILE.test(path));

    const head = presentAt('HEAD', paths, { cwd: root });
    // ONE BATCH for the staged side, which `readStagedBlob`'s own header asks
    // for: it spawns git twice per call and on Windows that dominates
    // everything downstream. The `HEAD` side is read one at a time because only
    // the files that exist there are read at all, and a commit touching more
    // than a handful of test files is not the common shape.
    const staged = readStagedBlobs(paths, { cwd: root });
    const { shrunk, compared } = findShrunkCases({
      paths,
      head: (path) => (head.has(path) ? blobAt('HEAD', path, { cwd: root }) : null),
      staged: (path) => staged.get(path)?.toString('utf8') ?? null,
    });

    const report = formatShrunkCases(shrunk);
    if (report === null) {
      // THE NUMBER, not the word. "no test file lost a case" reads identically
      // over a commit that staged none, and those are different results.
      process.stdout.write(
        `  ok  ${String(compared)} staged test file(s) compared against HEAD; none lost a case\n`,
      );
    } else {
      process.stdout.write(report);
    }
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
