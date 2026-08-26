/**
 * Search this repository's prose the way its own resolver already searches it.
 *
 * ## Why this exists rather than a grep
 *
 * A line is not a unit of meaning. This repository hard-wraps prose, so any
 * phrase long enough to wrap is invisible to a line-scoped search — and the
 * longer the phrase, the likelier it wraps, which is backwards. The reassuring
 * answer for a sweep is *"found nothing"*, so the failure and the success read
 * identically.
 *
 * `withdrawnPhrases.mjs` already answers this question and states the rule its
 * own four false negatives produced: **build the unit, normalise it, match
 * against it.** A hand-run line-by-line grep is a second opinion about a rule
 * that module owns (B3a), and the axis has now recurred five times — most
 * recently as `utility` / `process` split across two lines of
 * `docs/ARCHITECTURE.md`, found by reading rather than by the search that was
 * run to find it.
 *
 * So this module is a **caller**, not a reimplementation: `units` and
 * `normalise` come from there and nothing here re-derives them. The remedy for a
 * rule that keeps being re-derived is never *be careful*; it is to make the rule
 * a named thing with callers.
 *
 * ## What the pattern is matched against
 *
 * The **normalised unit** — a paragraph, or a single table row — lowercased,
 * with tildes dropped and every run of whitespace collapsed to one space. So
 * write patterns in lower case and with single spaces, and never anchor on `^`
 * or `$` expecting a line.
 *
 * ## The reported line is the UNIT's first line, not the phrase's
 *
 * Stated rather than left to be discovered, because it looks like a bug the
 * first time. A unit runs to the next blank line or table row, and a numbered
 * list with no blank lines between its items is **one** unit — measured on
 * `docs/ARCHITECTURE.md`, where invariants 17 through 20 share a single unit
 * beginning at line 695. So a match there is reported at 695 and the phrase may
 * be thirty lines below.
 *
 * That is the price of the unit being the thing a claim is made in, and it is
 * the right trade: a narrower unit is a line, which is what does not work.
 *
 * Usage: node scripts/lib/proseSweep.mjs "<pattern>" [file...]
 *        (files default to the tracked markdown under docs/ plus CLAUDE.md)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { normalise, units } from './withdrawnPhrases.mjs';

/**
 * A phrase that WRAPS in the control text below, so a line-scoped matcher
 * cannot find it and this one must.
 *
 * The control is a violation-shaped input for the reason every search in this
 * repository carries one: the answer this sweep is usually hoping for is
 * "nothing", which is also what a broken unit builder returns.
 */
export const CONTROL_PATTERN = /the engines live in utility processes/u;

/** The control text, with the phrase deliberately broken across a line. */
export const CONTROL_TEXT = ['Both', 'the engines live in utility', 'processes and nothing else.'].join('\n');

/**
 * @param {RegExp} pattern matched against each normalised unit.
 * @param {string} text
 * @returns {Array<{ line: number, unit: string }>} `line` is 1-based, at the
 *   unit's first line.
 */
export function findInUnits(pattern, text) {
  /** @type {Array<{ line: number, unit: string }>} */
  const found = [];
  for (const unit of units(text)) {
    const flat = normalise(unit.lines.join(' '));
    if (pattern.test(flat)) found.push({ line: unit.start + 1, unit: flat });
  }
  return found;
}

/**
 * @param {string} [root]
 * @returns {string[]} repo-relative paths of the prose this sweeps by default.
 */
export function defaultDocuments(root = repoRoot()) {
  const tracked = execFileSync('git', ['ls-files', 'docs/**/*.md', 'CLAUDE.md', '*.md'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (tracked.length === 0) {
    throw new Error(
      'No tracked markdown found. An empty input set is a broken lookup, not a clean sweep — it ' +
        'reports the same "found nothing" a document set with no matches does.',
    );
  }
  return tracked;
}

/**
 * @param {RegExp} pattern
 * @param {{ files?: string[], root?: string }} [options]
 * @returns {{ matches: Array<{ file: string, line: number, unit: string }>, controlFound: boolean, filesScanned: number }}
 */
export function sweep(pattern, { files, root = repoRoot() } = {}) {
  const documents = files ?? defaultDocuments(root);
  /** @type {Array<{ file: string, line: number, unit: string }>} */
  const matches = [];
  for (const file of documents) {
    for (const hit of findInUnits(pattern, readFileSync(join(root, file), 'utf8'))) {
      matches.push({ file, line: hit.line, unit: hit.unit });
    }
  }
  return {
    matches,
    controlFound: findInUnits(CONTROL_PATTERN, CONTROL_TEXT).length === 1,
    filesScanned: documents.length,
  };
}

if (process.argv[1]?.endsWith('proseSweep.mjs')) {
  const [source, ...files] = process.argv.slice(2);
  if (source === undefined) {
    process.stderr.write('Usage: node scripts/lib/proseSweep.mjs "<pattern>" [file...]\n');
    process.exit(2);
  }

  const { matches, controlFound, filesScanned } = sweep(
    new RegExp(source, 'u'),
    files.length > 0 ? { files } : {},
  );

  if (!controlFound) {
    process.stderr.write(
      'The positive control was not found, so this sweep cannot see a phrase that wraps — which ' +
        'is the only reason to use it over a grep. Its silence means nothing until this passes.\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `${String(matches.length)} match(es) in ${String(filesScanned)} document(s); control found\n` +
      matches.map(({ file, line, unit }) => `  ${file}:${String(line)}  ${unit.slice(0, 140)}`).join('\n') +
      (matches.length > 0 ? '\n' : ''),
  );
}
