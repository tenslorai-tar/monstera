// @ts-check
/**
 * A dependency alert held open by the owner's decision ends by itself: this check fails the day the hold's reason stops
 * being true. The record of each hold, its reason and the owner's date, is `docs/security/dependency-alerts.md`; this is
 * the expiry that record names.
 *
 * ## What ends a hold, and the two ways it fails
 *
 * A hold waits because the fixed version of a package is a version its dependents do not accept, so taking it would mean
 * forcing it under tools that were not written for it. So the hold ends when **every package in the tree that depends on
 * it has a newest version that accepts a fixed one**: then updating those packages brings the fix, and the check fails
 * naming them. It also fails when the lockfile already resolves a fixed version, because then the hold is a record of a
 * risk that is gone, and the alert and the record should both be closed.
 *
 * ## Who depends on it is read from the lockfile, never listed
 *
 * The failure a hand-kept list would hide is a NEW dependent: a package added later that asks for the old major, whose
 * newest version would never be asked about, so the hold would end while the old copy stayed installed. That failure
 * makes the set bigger, which is the direction a derived set tracks (CLAUDE.md, item 4c). An empty set is a broken read,
 * not a clean tree, and is refused.
 *
 * ## Which versions a range accepts is npm's answer, not this file's
 *
 * `npm view <package>@<range> version` lists the published versions the range admits, by npm's own range rules. A second
 * reading of those rules here is the second opinion B3a forbids. What this file compares is two plain release numbers,
 * through `compareVersions`, which the lockfile check already owns.
 *
 * ## It asks the npm registry, so it can fail to look
 *
 * A lookup that cannot be made is reported as could-not-look through `unverifiable.mjs`, never as a hold still in force,
 * and a positive control runs first: the fixed range itself must list at least one version, or the lookups are blind.
 * `--require-registry` makes could-not-look a failure.
 *
 * Usage: node scripts/security/dependencyHolds.mjs [--require-registry]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareVersions, npmCliPath } from '../hooks/lockfileIntegrity.mjs';
import { isMain } from '../lib/isMain.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The holds in force. Each names the alert, the first fixed version, and the owner's decision; the reason is in
 * `docs/security/dependency-alerts.md`, under the same advisory id.
 * @typedef {{ package: string, advisory: string, fixedFrom: string, decided: string }} Hold
 * @type {readonly Hold[]}
 */
export const HOLDS = [{ package: 'minimatch', advisory: 'GHSA-g3hv-75wg-m249', fixedFrom: '11.0.1', decided: '2026-11-10' }];

/**
 * Asks the registry one question, as `npm view <spec> <field> --json` answers it: a string, an array of strings, or
 * undefined when nothing matched. Throws when npm could not answer.
 * @typedef {(spec: string, field: string) => unknown} View
 */

/** @param {string} version */
const isRelease = (version) => /^\d+\.\d+\.\d+$/u.test(version);

/**
 * The packages in the lockfile that depend on `name`, by name, and the version of `name` the lockfile resolves at the
 * root. Throws when either cannot be read.
 * @param {{ packages?: Record<string, { version?: string, dependencies?: Record<string, string> }> }} lock
 * @param {string} name
 */
export function treeOf(lock, name) {
  const packages = lock.packages ?? {};
  const installed = packages[`node_modules/${name}`]?.version;
  if (installed === undefined) throw new Error(`the lockfile resolves no node_modules/${name}`);
  const dependents = new Set();
  for (const [path, entry] of Object.entries(packages)) {
    if (path === '' || entry.dependencies?.[name] === undefined) continue;
    dependents.add(path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length));
  }
  if (dependents.size === 0) throw new Error(`the lockfile names no package that depends on ${name}, which is a broken read`);
  return { installed, dependents: [...dependents].sort() };
}

/** @param {unknown} answer @returns {string[]} */
const listOf = (answer) => (answer === undefined ? [] : Array.isArray(answer) ? answer.map(String) : [String(answer)]);

/**
 * Whether `range` of `hold.package` admits a fixed version, by npm's own list of the versions it admits.
 * @param {Hold} hold @param {string} range @param {View} view
 */
export function acceptsFix(hold, range, view) {
  return listOf(view(`${hold.package}@${range}`, 'version')).some((version) => isRelease(version) && compareVersions(version, hold.fixedFrom) >= 0);
}

/**
 * The decision for one hold.
 * @param {Hold} hold
 * @param {{ installed: string, dependents: readonly string[] }} tree
 * @param {View} view
 * @returns {{ verdict: 'stale' | 'ready' | 'held', lines: string[] }}
 */
export function decide(hold, tree, view) {
  const title = `${hold.package} ${hold.advisory} (held by the owner's decision of ${hold.decided})`;
  if (isRelease(tree.installed) && compareVersions(tree.installed, hold.fixedFrom) >= 0) {
    return {
      verdict: 'stale',
      lines: [
        `${title}: the lockfile resolves ${tree.installed}, a fixed version. The hold is over: remove it from HOLDS and from docs/security/dependency-alerts.md, and close the alert.`,
      ],
    };
  }
  // THE CONTROL: the fixed range itself must list a version, or every "accepts no fix" below is a lookup that saw nothing.
  if (listOf(view(`${hold.package}@>=${hold.fixedFrom}`, 'version')).filter(isRelease).length === 0) {
    throw new Error(`the registry lists no ${hold.package} version at or above ${hold.fixedFrom}, so its lookups are blind`);
  }
  const answers = tree.dependents.map((dependent) => {
    const latest = listOf(view(`${dependent}@latest`, 'version'))[0];
    const range = listOf(view(`${dependent}@latest`, `dependencies.${hold.package}`))[0];
    if (latest === undefined || range === undefined) {
      throw new Error(`the registry gave no newest version of ${dependent}, or no ${hold.package} range for it`);
    }
    return { dependent, latest, range, accepts: acceptsFix(hold, range, view) };
  });
  const each = answers.map(({ dependent, latest, range, accepts }) => `${dependent} ${latest} asks ${range}: ${accepts ? 'accepts' : 'accepts no'} fixed version`);
  if (answers.every((answer) => answer.accepts)) {
    return {
      verdict: 'ready',
      lines: [
        `${title}: every package that depends on it now has a newest version that accepts ${hold.fixedFrom} or later. Update them, and the fix arrives:`,
        ...each,
      ],
    };
  }
  return { verdict: 'held', lines: [`${title}: still held.`, ...each] };
}

/** @type {View} */
function npmView(spec, field) {
  const done = spawnSync(process.execPath, [npmCliPath(), 'view', spec, field, '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 });
  if (done.status !== 0) throw new Error(`npm view ${spec} ${field} exited ${String(done.status)}: ${(done.stderr ?? '').trim().split('\n')[0] ?? ''}`);
  const text = done.stdout.trim();
  return text === '' ? undefined : JSON.parse(text);
}

/**
 * Runs every hold. Answers the exit code; a lookup that could not be made leaves through `exitUnverifiable`.
 * @param {{ lock?: Parameters<typeof treeOf>[0], view?: View, required?: boolean, write?: (text: string) => void }} [options]
 */
export function run({ lock, view = npmView, required = false, write = (text) => process.stdout.write(text) } = {}) {
  const read = lock ?? JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8'));
  let failed = 0;
  for (const hold of HOLDS) {
    const tree = treeOf(read, hold.package);
    /** @type {ReturnType<typeof decide>} */
    let outcome;
    try {
      outcome = decide(hold, tree, view);
    } catch (error) {
      return exitUnverifiable({
        required,
        subject: `the dependency hold on ${hold.package}`,
        why: error instanceof Error ? error.message : String(error),
        flag: '--require-registry',
      });
    }
    const [first, ...rest] = outcome.lines;
    write(`  ${outcome.verdict === 'held' ? 'held' : 'FAIL'}  ${first ?? ''}\n${rest.map((line) => `        ${line}\n`).join('')}`);
    if (outcome.verdict !== 'held') failed += 1;
  }
  if (failed === 0) write(`  ok  ${String(HOLDS.length)} dependency hold(s) still have their reason, and the registry's fixed range listed versions, so that means something\n`);
  return failed === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = run({ required: process.argv.includes('--require-registry') });
