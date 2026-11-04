// @ts-check
/**
 * The full walk's record, and the pack's refusal of a build no full walk passed
 * ([ADR-0285](../../docs/DECISIONS/0285-an-msix-is-packed-only-from-a-build-a-full-walk-passed.md)).
 *
 * The owner, 2026-11-02: *"anytime the agent is running to build an msix, a FULL APP WALK must be done to ensure
 * everything still works."* A rule recalled at packing time is the one this project has paid for most often, so the
 * pack asks this module, and this module answers from a record the walk wrote, bound to the build's own bytes.
 *
 *   node scripts/release/walkRecord.mjs --write         writes HEAD's record from its walks' reports, and says if it packs
 *   node scripts/release/walkRecord.mjs --digest        prints this checkout's build digest
 *   node scripts/release/walkRecord.mjs --list          prints each built file's own hash
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMain } from '../lib/isMain.mjs';

/** Every built folder whose files the pack stages: the shell's, and each workspace package's. @param {string} root */
export function builtFolders(root) {
  const packages = join(root, 'packages');
  const folders = [join(root, 'apps', 'desktop', 'dist')];
  for (const name of readdirSync(packages).sort()) {
    const dist = join(packages, name, 'dist');
    if (existsSync(dist)) folders.push(dist);
  }
  return folders;
}

/** Every file under `folder`, depth first, by path. @param {string} folder @returns {string[]} */
function filesUnder(folder) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/**
 * The build's digest: SHA-256 over each built file's path from the checkout, with `/` between its parts, and its own
 * SHA-256, in path order. Two builds of one commit agree only where the build is reproducible, which is measured, not
 * assumed (ADR-0285's evidence).
 * @param {string} root
 */
export function buildDigest(root) {
  const hash = createHash('sha256');
  let files = 0;
  for (const folder of builtFolders(root)) {
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`${relative(root, folder)} is not built`);
    for (const file of filesUnder(folder)) {
      const name = relative(root, file).split(sep).join('/');
      hash.update(`${name}\0${createHash('sha256').update(readFileSync(file)).digest('hex')}\n`);
      files += 1;
    }
  }
  // AN EMPTY BUILD IS A BROKEN READ, never a digest: every walk of no files would agree with every other.
  if (files === 0) throw new Error('the build digest read no file');
  return { digest: hash.digest('hex'), files };
}

/**
 * Every command id the registry generates into `docs/manual-test-checklist.md` (`App.test.tsx` holds that file equal
 * to the registry), one row each. Refuses a read that could not see: the list must hold `document.save`.
 * @param {string} checklist the file's text
 */
export function commandIds(checklist) {
  const ids = [...new Set([...checklist.matchAll(/ · `([a-z0-9][a-z0-9.-]*)` · /gu)].map((match) => match[1] ?? ''))].sort();
  if (!ids.includes('document.save')) throw new Error('the checklist read found no document.save: it cannot see, so it lists nothing');
  return ids;
}

/** The app's own sources and manifests, whose state decides which build a walk ran. */
const APP_SOURCES = ['apps', 'packages', 'package.json', 'package-lock.json'];

/** A relative module a script takes: a static `from '...'` or a literal `import('...')` that starts with a dot. */
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)'(\.\.?\/[^']+)'/gu;

/**
 * A walk PROGRAM's digest (the correction of 2026-11-03): SHA-256 over its script and every script it takes by a
 * relative import, followed through those imports, each by its path from the checkout and its bytes. A change to any of
 * them is a change to what the walk does, so the walk's rows are walked again. Modules under a package's `dist/` are the
 * build's, which the build digest binds, and are not followed.
 * @param {string} root
 * @param {string} script the walk's entry, from the checkout
 */
export function programDigest(root, script) {
  /** @type {Set<string>} */
  const seen = new Set();
  const pending = [join(root, script)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const target = join(dirname(file), match[1] ?? '');
      if (!target.split(sep).includes('dist') && /\.m?js$/u.test(target) && existsSync(target)) pending.push(target);
    }
  }
  // A PROGRAM OF ONE FILE THAT TAKES NOTHING is possible; a walk taking no `liveWalk.mjs` is not, and is a broken read.
  if (![...seen].some((file) => file.endsWith(`${sep}liveWalk.mjs`))) throw new Error(`${script} takes no liveWalk.mjs through its imports, so this read cannot see them`);
  const hash = createHash('sha256');
  for (const file of [...seen].sort()) hash.update(`${relative(root, file).split(sep).join('/')}\0${createHash('sha256').update(readFileSync(file)).digest('hex')}\n`);
  return hash.digest('hex');
}

/**
 * The build a walk runs on (ADR-0285 Decision 2): the commit, whether the app's sources were exactly that commit's, the
 * built bytes' digest, and the walk program's own (the correction of 2026-11-03). `liveWalk.mjs` writes it into every
 * report it makes from this checkout.
 * @param {string} root
 * @param {(args: readonly string[]) => string} git
 * @param {string} script the walk's entry, from the checkout
 */
export function walkBuild(root, git, script) {
  return { ...builtAt(root, git), walker: { script, digest: programDigest(root, script) } };
}

/**
 * The checkout's build: its commit, whether the app's sources are exactly that commit's, and the built bytes' digest.
 * @param {string} root
 * @param {(args: readonly string[]) => string} git
 */
export function builtAt(root, git) {
  return {
    commit: git(['rev-parse', 'HEAD']).trim(),
    clean: git(['status', '--porcelain', '--', ...APP_SOURCES]).trim() === '',
    digest: buildDigest(root).digest,
  };
}

/**
 * @typedef {{ name: string, outcome: 'passed' | 'failed', covers?: readonly string[], notWalked?: Readonly<Record<string, string>> }} WalkStep
 * @typedef {{ commit: string, clean: boolean, digest: string, walker?: { script: string, digest: string } }} WalkedBuild
 * @typedef {{ walk: string, folder: string, build?: WalkedBuild, steps: readonly WalkStep[] }} WalkReport
 * @typedef {{ commit: string, digest: string, report: string }} WalkedOn
 * @typedef {{ id: string, result: 'passed' | 'failed' | 'not walked', reason?: string, evidence: string[], walkedOn?: WalkedOn }} WalkRow
 */

/**
 * One row per command from the reports of THIS build (Decision 4), each from the NEWEST report that walked it (the
 * correction of 2026-11-03): passed when every step of that report that covers it passed, failed when any failed, *not
 * walked* only where a step said why, and *not walked* with no reason where nothing reached it, which the refusal below
 * refuses. A row names the commit and the digest it was walked on.
 * @param {readonly string[]} commands
 * @param {readonly WalkReport[]} reports newest first
 * @returns {WalkRow[]}
 */
export function rowsFrom(commands, reports) {
  return commands.map((id) => {
    const report = reports.find((each) => each.steps.some((step) => step.covers?.includes(id) === true || (step.notWalked?.[id] ?? '').trim() !== ''));
    if (report === undefined) return { id, result: 'not walked', evidence: [] };
    /** @type {WalkedOn} */
    const walkedOn = { commit: report.build?.commit ?? '', digest: report.build?.digest ?? '', report: `${report.walk}/${report.folder}` };
    const covering = report.steps.filter((step) => step.covers?.includes(id) === true);
    const evidence = covering.map((step) => `${report.walk}/${report.folder}: ${step.name}`);
    if (covering.some((step) => step.outcome !== 'passed')) return { id, result: 'failed', evidence, walkedOn };
    if (covering.length > 0) return { id, result: 'passed', evidence, walkedOn };
    const reason = report.steps.map((step) => step.notWalked?.[id]).find((said) => (said ?? '').trim() !== '');
    return reason === undefined ? { id, result: 'not walked', evidence, walkedOn } : { id, result: 'not walked', reason, evidence, walkedOn };
  });
}

/**
 * @typedef {{ commit: string, build: string, commands: number, rows: readonly WalkRow[], written: string, reports: readonly string[] }} WalkRecord
 */

/**
 * Why `record` does not let `commit`'s build of `digest` be packed (Decision 3), or nothing. Every reason, not the first,
 * so one reading of the refusal says everything that is owed.
 * @param {WalkRecord | undefined} record
 * @param {string} commit
 * @param {string} digest
 * @param {readonly string[]} commands the registry's commands now
 * @returns {string[]}
 */
export function refusals(record, commit, digest, commands) {
  if (record === undefined) return [`no full walk is recorded for ${commit}`];
  /** @type {string[]} */
  const said = [];
  if (record.commit !== commit) said.push(`the record is for ${record.commit}, not ${commit}`);
  if (record.build !== digest) said.push(`the walked build's digest is ${record.build}, and the build about to be packed is ${digest}`);
  const rows = new Set(record.rows.map((row) => row.id));
  const missing = commands.filter((id) => !rows.has(id));
  if (missing.length > 0) said.push(`${String(missing.length)} command(s) have no row: ${missing.join(', ')}`);
  if (record.commands !== commands.length || record.rows.length !== commands.length) {
    said.push(`the record counts ${String(record.commands)} commands and ${String(record.rows.length)} rows; the registry has ${String(commands.length)}`);
  }
  const failed = record.rows.filter((row) => row.result === 'failed').map((row) => row.id);
  if (failed.length > 0) said.push(`${String(failed.length)} row(s) failed: ${failed.join(', ')}`);
  const unreached = record.rows.filter((row) => row.result === 'not walked' && (row.reason ?? '').trim() === '').map((row) => row.id);
  if (unreached.length > 0) said.push(`${String(unreached.length)} row(s) were reached by no step and say no reason: ${unreached.join(', ')}`);
  // EACH ROW'S OWN BUILD, not only the record's: a row walked on other bytes is not a walk of these (the correction of
  // 2026-11-03), whatever commit it was walked at.
  const elsewhere = record.rows.filter((row) => row.walkedOn !== undefined && row.walkedOn.digest !== digest).map((row) => row.id);
  if (elsewhere.length > 0) said.push(`${String(elsewhere.length)} row(s) were walked on another build: ${elsewhere.join(', ')}`);
  return said;
}

/** Where a commit's record is kept (Decision 5). @param {string} root @param {string} commit */
export function recordPath(root, commit) {
  return join(root, '.cache', 'walk-records', `${commit}.json`);
}

/**
 * Refuses to let `commit`'s build be packed unless a full walk of it passed; the pack calls this after its own clean
 * build, so the digest is the bytes it is about to stage.
 * @param {string} root
 * @param {string} commit
 */
export function refuseUnwalked(root, commit) {
  const path = recordPath(root, commit);
  /** @type {WalkRecord | undefined} */
  const record = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  const commands = commandIds(readFileSync(join(root, 'docs', 'manual-test-checklist.md'), 'utf8'));
  const said = refusals(record, commit, buildDigest(root).digest, commands);
  if (said.length > 0) {
    throw new Error(
      `No MSIX is packed from a build no full walk passed (the owner's rule of 2026-11-02, ADR-0285):\n  - ${said.join('\n  - ')}\nWalk this commit's build in full, then write its record: node scripts/release/walkRecord.mjs --write`,
    );
  }
  return record;
}

/**
 * Whether a report is of `digest`'s build and of its walk's program as it is now (the correction of 2026-11-03): clean,
 * the same built bytes at whatever commit, and a walk program whose digest is unchanged. A report written before reports
 * carried their program is not counted, since nothing says which program walked it.
 * @param {string} root
 * @param {WalkedBuild | undefined} of
 * @param {string} digest
 */
export function countsFor(root, of, digest) {
  if (of === undefined || !of.clean || of.digest !== digest || of.walker === undefined) return false;
  if (!existsSync(join(root, of.walker.script))) return false;
  return programDigest(root, of.walker.script) === of.walker.digest;
}

/**
 * Every report of this build and of its walk program now, NEWEST FIRST across every walk, so each row takes the newest
 * run that walked it (the correction of 2026-11-03).
 * @param {string} root
 * @param {{ digest: string }} build
 * @returns {WalkReport[]}
 */
export function reportsOf(root, build) {
  const walks = join(root, '_review', 'walks');
  if (!existsSync(walks)) return [];
  /** @type {WalkReport[]} */
  const kept = [];
  for (const walk of readdirSync(walks)) {
    for (const folder of readdirSync(join(walks, walk))) {
      const path = join(walks, walk, folder, 'report.json');
      if (!existsSync(path)) continue;
      /** @type {WalkReport} */
      const report = { ...JSON.parse(readFileSync(path, 'utf8')), folder };
      if (countsFor(root, report.build, build.digest)) kept.push(report);
    }
  }
  // THE FOLDER IS THE RUN'S START, an ISO time (`liveWalk.mjs`), so its order is the runs' order.
  return kept.sort((a, b) => (a.folder < b.folder ? 1 : a.folder > b.folder ? -1 : 0));
}

/** `git` in the checkout, its standard output. @param {string} root @returns {(args: readonly string[]) => string} */
export const gitIn = (root) => (args) => execFileSync('git', [...args], { cwd: root, encoding: 'utf8' });

/**
 * Writes `HEAD`'s record from its walks' reports, the record's only writer (Decision 1), and answers it. Refuses a tree
 * whose app sources are not the commit's, since its build is no commit's.
 * @param {string} root
 */
export function writeRecord(root) {
  const build = builtAt(root, gitIn(root));
  if (!build.clean) throw new Error(`the app's sources differ from ${build.commit}: commit them, build, and walk again`);
  const commands = commandIds(readFileSync(join(root, 'docs', 'manual-test-checklist.md'), 'utf8'));
  const reports = reportsOf(root, build);
  /** @type {WalkRecord} */
  const record = {
    commit: build.commit,
    build: build.digest,
    commands: commands.length,
    rows: rowsFrom(commands, reports),
    written: new Date().toISOString(),
    reports: reports.map((report) => `${report.walk}/${report.folder}`),
  };
  mkdirSync(join(root, '.cache', 'walk-records'), { recursive: true });
  writeFileSync(recordPath(root, build.commit), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

if (isMain(import.meta.url)) {
  if (process.argv.includes('--digest')) {
    const { digest, files } = buildDigest(ROOT);
    process.stdout.write(`${digest} over ${String(files)} files\n`);
  }
  if (process.argv.includes('--write')) {
    const record = writeRecord(ROOT);
    const count = (/** @type {WalkRow['result']} */ result) => record.rows.filter((row) => row.result === result).length;
    process.stdout.write(`${recordPath(ROOT, record.commit)}\n${String(record.commands)} commands from ${String(record.reports.length)} walk report(s): `);
    process.stdout.write(`${String(count('passed'))} passed, ${String(count('failed'))} failed, ${String(count('not walked'))} not walked\n`);
    const said = refusals(record, record.commit, record.build, commandIds(readFileSync(join(ROOT, 'docs', 'manual-test-checklist.md'), 'utf8')));
    process.stdout.write(said.length === 0 ? 'PACKABLE: every row passed or says why it was not walked\n' : `NOT PACKABLE:\n  - ${said.join('\n  - ')}\n`);
  }
  // EACH FILE'S OWN HASH, for comparing two builds of one commit file by file.
  if (process.argv.includes('--list')) {
    for (const folder of builtFolders(ROOT)) {
      for (const file of filesUnder(folder)) {
        process.stdout.write(`${createHash('sha256').update(readFileSync(file)).digest('hex')} ${relative(ROOT, file).split(sep).join('/')}\n`);
      }
    }
  }
}
