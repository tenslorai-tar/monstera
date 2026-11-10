// @ts-check
/**
 * Proves `dependencyHolds.mjs` ends a hold by itself and cannot pass blind: it reports a hold still in force while one
 * dependent accepts no fixed version, fails naming every dependent once all accept one, fails as stale once the lockfile
 * resolves a fixed version, takes its dependents from the lockfile so a new one is asked about, refuses an empty set, and
 * treats a registry it cannot read, or one whose fixed range lists nothing, as could-not-look rather than as held — and
 * that Guards runs it with --require-registry, so could-not-look there is a failure rather than a green step.
 *
 * Offline: the registry is a table here, answered the way `npm view <spec> <field> --json` answers.
 *
 * Usage: node scripts/proofs/dependencyHolds.proof.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOLDS, decide, treeOf } from '../security/dependencyHolds.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const hold = HOLDS.find((each) => each.package === 'minimatch');
if (hold === undefined) throw new Error('HOLDS carries no minimatch hold for this proof to exercise');

/** Published versions, and which a range admits: the registry's half of `npm view minimatch@<range> version`. */
const PUBLISHED = ['9.0.5', '10.2.4', '10.2.6', '11.0.1', '11.0.5'];
/** @type {Record<string, (version: string) => boolean>} */
const ADMITS = {
  '^10.2.6': (v) => v.startsWith('10.') && v >= '10.2.6',
  '^10.2.2': (v) => v.startsWith('10.'),
  '^11.0.1': (v) => v.startsWith('11.'),
  '^10.2.6 || ^11.0.1': (v) => v.startsWith('10.') || v.startsWith('11.'),
  '>=11.0.1': (v) => v.startsWith('11.'),
};

/**
 * A registry where each dependent's newest version asks `ranges[dependent]`.
 * @param {Record<string, string>} ranges @param {{ blind?: boolean, broken?: boolean }} [options]
 * @returns {import('../security/dependencyHolds.mjs').View}
 */
function registry(ranges, { blind = false, broken = false } = {}) {
  return (spec, field) => {
    if (broken) throw new Error('npm view exited 1: network unreachable');
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at);
    const range = spec.slice(at + 1);
    if (name === 'minimatch' && field === 'version') {
      if (blind) return undefined;
      const admits = ADMITS[range];
      if (admits === undefined) throw new Error(`the table has no range ${range}`);
      const matched = PUBLISHED.filter(admits);
      return matched.length === 0 ? undefined : matched;
    }
    if (range === 'latest' && field === 'version') return '99.0.0';
    if (range === 'latest' && field === 'dependencies.minimatch') return ranges[name];
    throw new Error(`the table has no answer for ${spec} ${field}`);
  };
}

/** @param {string} installed @param {readonly string[]} dependents */
const tree = (installed, dependents) => ({ installed, dependents });

{
  // ONE DEPENDENT STILL REFUSES, the others accept: a check that ended the hold when ANY dependent accepted would end it here.
  const outcome = decide(hold, tree('10.2.6', ['eslint', 'eslint-plugin-import-x', 'typescript-eslint']), registry({ eslint: '^10.2.6', 'eslint-plugin-import-x': '^10.2.6 || ^11.0.1', 'typescript-eslint': '^11.0.1' }));
  check('a hold stays while one dependent accepts no fixed version, though the others do', outcome.verdict === 'held', JSON.stringify(outcome));
}
{
  const outcome = decide(hold, tree('10.2.6', ['eslint', 'typescript-eslint']), registry({ eslint: '^10.2.6 || ^11.0.1', 'typescript-eslint': '^11.0.1' }));
  check(
    'once every dependent accepts a fixed version the hold ends, naming each with its range',
    outcome.verdict === 'ready' && outcome.lines.some((line) => line.startsWith('eslint 99.0.0 asks ^10.2.6 || ^11.0.1')) && outcome.lines.some((line) => line.startsWith('typescript-eslint 99.0.0')),
    JSON.stringify(outcome),
  );
}
{
  // A RANGE ADMITTING ONLY OLD VERSIONS IS NOT A FIX: '^10.2.6' lists 10.2.6, which compares below 11.0.1.
  const outcome = decide(hold, tree('10.2.6', ['eslint']), registry({ eslint: '^10.2.6' }));
  check('CONTROL: a range whose versions are all below the fix accepts none, so one such dependent holds', outcome.verdict === 'held' && outcome.lines.some((line) => line.includes('accepts no fixed version')), JSON.stringify(outcome));
}
{
  const outcome = decide(hold, tree('11.0.5', ['eslint']), registry({ eslint: '^10.2.6' }));
  check('a lockfile already resolving a fixed version ends the hold as stale, whatever the dependents ask', outcome.verdict === 'stale', JSON.stringify(outcome));
}
{
  let threw = '';
  try {
    decide(hold, tree('10.2.6', ['eslint']), registry({ eslint: '^10.2.6' }, { blind: true }));
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check('a registry whose fixed range lists nothing is blind, and is refused rather than read as held', threw.includes('lookups are blind'), threw || 'no refusal');
}
{
  let threw = '';
  try {
    decide(hold, tree('10.2.6', ['eslint']), registry({}, { broken: true }));
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check('a registry that cannot answer is refused rather than read as held', threw.includes('network unreachable'), threw || 'no refusal');
}
{
  // DERIVED FROM THE LOCKFILE: a dependent added later is asked about without anyone listing it, and nested paths are named.
  const lock = {
    packages: {
      '': { dependencies: { eslint: '^10' } },
      'node_modules/minimatch': { version: '10.2.6' },
      'node_modules/eslint': { dependencies: { minimatch: '^10.2.6' } },
      'node_modules/@eslint/config-array': { dependencies: { minimatch: '^10.2.4' } },
      'node_modules/a-later-tool': { dependencies: { minimatch: '^10.0.0' } },
      'node_modules/eslint/node_modules/nested-tool': { dependencies: { minimatch: '^10.0.0' } },
      'node_modules/unrelated': { dependencies: { other: '^1' } },
    },
  };
  const read = treeOf(lock, 'minimatch');
  check(
    'the dependents come from the lockfile, a later one and a nested one included, and the root and unrelated packages not',
    read.installed === '10.2.6' && JSON.stringify(read.dependents) === '["@eslint/config-array","a-later-tool","eslint","nested-tool"]',
    JSON.stringify(read),
  );
}
{
  let threw = '';
  try {
    treeOf({ packages: { 'node_modules/minimatch': { version: '10.2.6' } } }, 'minimatch');
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check('a lockfile naming no dependent is a broken read, refused rather than taken as nothing to ask', threw.includes('broken read'), threw || 'no refusal');
}

{
  // GUARDS RUNS IT WITH --require-registry. Without the flag `exitUnverifiable` exits 0, so a lookup that broke for good
  // would leave the hold green on every run and nothing would say so. Read from the workflow's own command lines: exactly
  // one step runs the check (the proof's path is a different file), and it carries the flag. None found is a broken
  // read, never a pass.
  const workflow = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows', 'guards.yml'), 'utf8');
  const runs = workflow
    .split('\n')
    .filter((line) => /^\s*run:\s/u.test(line) && line.includes('scripts/security/dependencyHolds.mjs'));
  check(
    'the Guards step that runs the check passes --require-registry, so a lookup that fails there is a failure',
    runs.length === 1 && /\s--require-registry(\s|$)/u.test(runs[0] ?? ''),
    `${String(runs.length)} step(s) run the check: ${JSON.stringify(runs.map((line) => line.trim()))}`,
  );
}

process.stdout.write(
  failures.length === 0 ? roster.format('dependency-hold case') : `${String(failures.length)} dependency-hold case(s) FAILED:\n  - ${failures.join('\n  - ')}\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
