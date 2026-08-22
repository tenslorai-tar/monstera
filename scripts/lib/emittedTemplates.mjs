// @ts-check
/**
 * An emitted-source template contains no backtick.
 *
 * ## The class this closes
 *
 * A `String.raw` template holding the body of a program we write to disk and
 * spawn is the one place in this repository where prose and code share a
 * delimiter. **A backtick pair inside it closes the literal and reopens it**,
 * and the parser then reports whatever follows — so the error names a line that
 * is fine and says nothing about the delimiter.
 *
 * Three occurrences, all in the same shape and the third in a file whose own
 * header carried the rule against it:
 *
 * | | what closed it |
 * |---|---|
 * | 1 | a backtick pair in an embedded comment |
 * | 2 | the same, in a different research file |
 * | 3 | a comment naming a variable in backticks, inside emitted source |
 *
 * Each time the remedy was the same and each time it was a remedy applied to the
 * instance: move the prose out, or drop the backticks. **Written down is not a
 * mechanism** — that sentence has now been paid for by the escape guard seven
 * times and by this three, so the rule gets a check.
 *
 * ## Why the rule bans backticks in the emitted CODE too, not only in comments
 *
 * Because it makes the check possible. A parser cannot help here: by the time
 * one runs, the stray pair has already closed the template, so the AST shows a
 * SHORTER template with no backtick in it and the scan reports nothing. The
 * check has to be textual, and a textual check needs a rule with no exceptions
 * to apply — "no backtick in this region" has that property and "no backtick in
 * a comment inside this region" does not.
 *
 * The constraint it imposes is real and small: emitted code concatenates with
 * `+` rather than nesting a template literal. Every emitted body in this
 * repository already does, because nesting one requires escaping and escaping is
 * exactly what goes wrong.
 *
 * ## What counts as an emitted-source template
 *
 * A `String.raw` whose opening backtick is the **last character on its line**,
 * closed by a line that is exactly a backtick and a semicolon. Single-line
 * `String.raw` — the regex fragments in `blockEscapeResolvingWrites.mjs` — are
 * not emitted source and cannot carry a stray pair anyway, since one backtick
 * would end them.
 *
 * An opener with no such terminator is a **finding, not a skip**: the region
 * cannot be determined, so the scan says so rather than guessing a boundary and
 * reporting a clean result from it.
 *
 * ## The positive control runs inside the SCAN, not only in the proof
 *
 * This is a search, and a search has one output for every way it can be broken:
 * *found nothing*. So it carries a fixture with a violation it must locate on
 * every run, and exits non-zero when it cannot — the instrument gets run by hand
 * on the day someone needs an answer, and the proof only runs in CI.
 *
 * The fixture also carries two things the scan must NOT report, because a check
 * that flags everything passes a positive control just as happily: prose
 * backticks outside any template, and a single-line `String.raw`.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { filesInCommit, repoRoot } from './gitScope.mjs';

/** Written numerically, so this file cannot contain the thing it bans. */
const TICK = String.fromCharCode(96);

/**
 * Every emitted-source region in `text`, and every opener whose end could not be
 * found.
 *
 * @param {string} text
 * @returns {{ regions: Array<{ from: number, to: number }>, unterminated: number[] }}
 */
export function emittedRegions(text) {
  const lines = text.split('\n');
  /** @type {Array<{ from: number, to: number }>} */
  const regions = [];
  /** @type {number[]} */
  const unterminated = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    // The opening backtick must be the last character: that is what makes it a
    // multi-line body rather than a one-line raw string.
    if (!line.includes(`String.raw${TICK}`) || !line.trimEnd().endsWith(TICK)) continue;

    let end = -1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if ((lines[scan] ?? '').trimEnd() === `${TICK};`) {
        end = scan;
        break;
      }
    }
    if (end === -1) {
      unterminated.push(index + 1);
      continue;
    }
    regions.push({ from: index + 1, to: end + 1 });
    index = end;
  }

  return { regions, unterminated };
}

/**
 * Backticks inside an emitted-source region, one entry per line that has any.
 *
 * @param {string} text
 * @returns {{ violations: Array<{ line: number, text: string }>, unterminated: number[] }}
 */
export function backtickViolations(text) {
  const lines = text.split('\n');
  const { regions, unterminated } = emittedRegions(text);
  /** @type {Array<{ line: number, text: string }>} */
  const violations = [];

  for (const region of regions) {
    // The boundary lines hold the delimiters themselves and are not content.
    for (let line = region.from + 1; line < region.to; line += 1) {
      const content = lines[line - 1] ?? '';
      if (content.includes(TICK)) violations.push({ line, text: content.trim().slice(0, 120) });
    }
  }

  return { violations, unterminated };
}

/**
 * A file with one violation, one non-violation of each kind, and nothing else.
 *
 * Assembled from {@link TICK} rather than written literally, because a fixture
 * containing a real stray pair would break this module in exactly the way the
 * module exists to prevent — which would be a satisfying kind of failure and a
 * useless one.
 */
export const CONTROL_FIXTURE = [
  `/** Prose with a ${TICK}backticked${TICK} word, OUTSIDE any template. Must not be reported. */`,
  `const SINGLE = String.raw${TICK}[^\\n]*${TICK};`,
  ``,
  `const BODY = String.raw${TICK}`,
  `const ok = 'plain';`,
  `// A comment naming a ${TICK}variable${TICK} — THIS is the violation.`,
  `${TICK};`,
].join('\n');

/** The fixture's violation sits on this line, and the scan must find it there. */
export const CONTROL_LINE = 6;

/**
 * Every source file the rule applies to, in the tree THIS COMMIT WILL LEAVE.
 *
 * `filesInCommit` rather than `git ls-files`, for the reason its own comment
 * gives: `ls-files` answers about the previous commit, so a check built on it
 * can only catch a mistake after the commit that made it. One resolver for
 * "what is in the tree" (B3a).
 *
 * `dist` is excluded because it is generated: a violation there is a copy of one
 * in `src`, and reporting both would make the count lie about how many defects
 * exist.
 *
 * @returns {string[]}
 */
export function scannedFiles() {
  return filesInCommit()
    .filter((entry) => /\.(?:mjs|js|ts|tsx)$/u.test(entry))
    .filter((entry) => !entry.includes('/dist/') && !entry.startsWith('dist/'));
}

/**
 * Runs the scan over the repository, control first.
 *
 * @returns {number} the process exit code
 */
export function scan() {
  const control = backtickViolations(CONTROL_FIXTURE);
  const found = control.violations.length === 1 && control.violations[0]?.line === CONTROL_LINE;
  if (!found) {
    process.stdout.write(
      `  FAIL  the scan could not locate its own known-present violation.\n` +
        `        Expected exactly one, on line ${CONTROL_LINE} of the control fixture; got ` +
        `${control.violations.length}.\n` +
        `        THE SILENCE OF A BLIND SEARCH IS INDISTINGUISHABLE FROM A CLEAN TREE, so this\n` +
        `        refuses to report a result.\n`,
    );
    return 1;
  }

  const root = repoRoot();
  let offending = 0;
  let regionCount = 0;

  for (const relative of scannedFiles()) {
    const text = readFileSync(`${root}/${relative}`, 'utf8');
    if (!text.includes(`String.raw${TICK}`)) continue;
    const { violations, unterminated } = backtickViolations(text);
    regionCount += emittedRegions(text).regions.length;

    for (const line of unterminated) {
      offending += 1;
      process.stdout.write(
        `  FAIL  ${relative}:${line} — an emitted-source template with no terminating line.\n` +
          `        Its region cannot be determined, so no clean result may be reported from it.\n`,
      );
    }
    for (const violation of violations) {
      offending += 1;
      process.stdout.write(
        `  FAIL  ${relative}:${violation.line} — a backtick inside emitted source.\n` +
          `        ${violation.text}\n` +
          `        It closes the template and the parser then blames whatever follows.\n`,
      );
    }
  }

  if (offending > 0) {
    process.stdout.write(`\n${offending} emitted-source backtick problem(s).\n`);
    return 1;
  }

  process.stdout.write(
    `  ok  ${regionCount} emitted-source template(s) carry no backtick\n` +
      `  ok  and the scan located its positive control, so that result means something\n`,
  );
  return 0;
}

// pathToFileURL, not a hand-built `file://` prefix. The hand-built one is wrong
// on Windows — an absolute path there starts with a drive letter, not a slash,
// so the comparison never matched and this module ran NOTHING and exited 0. A
// scan that does not run and a scan that finds nothing print the same thing,
// which is the class this file exists to close, arriving in its own entry point.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(scan());
}
