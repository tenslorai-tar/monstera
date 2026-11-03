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
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * The build a walk runs on (ADR-0285 Decision 2): the commit, whether the app's sources were exactly that commit's, and
 * the built bytes' digest. `liveWalk.mjs` writes it into every report it makes from this checkout.
 * @param {string} root
 * @param {(args: readonly string[]) => string} git
 */
export function walkBuild(root, git) {
  return {
    commit: git(['rev-parse', 'HEAD']).trim(),
    clean: git(['status', '--porcelain', '--', ...APP_SOURCES]).trim() === '',
    digest: buildDigest(root).digest,
  };
}

/**
 * @typedef {{ name: string, outcome: 'passed' | 'failed', covers?: readonly string[], notWalked?: Readonly<Record<string, string>> }} WalkStep
 * @typedef {{ walk: string, folder: string, build?: { commit: string, clean: boolean, digest: string }, steps: readonly WalkStep[] }} WalkReport
 * @typedef {{ id: string, result: 'passed' | 'failed' | 'not walked', reason?: string, evidence: string[] }} WalkRow
 */

/**
 * One row per command from the reports a walk of THIS build wrote (Decision 4): passed when every step that covers it
 * passed, failed when any failed, *not walked* only where a step said why, and *not walked* with no reason where nothing
 * reached it, which the refusal below refuses.
 * @param {readonly string[]} commands
 * @param {readonly WalkReport[]} reports
 * @returns {WalkRow[]}
 */
export function rowsFrom(commands, reports) {
  return commands.map((id) => {
    /** @type {string[]} */
    const evidence = [];
    let failed = false;
    /** @type {string | undefined} */
    let reason;
    for (const report of reports) {
      for (const step of report.steps) {
        if (step.covers?.includes(id) === true) {
          evidence.push(`${report.walk}/${report.folder}: ${step.name}`);
          if (step.outcome !== 'passed') failed = true;
        }
        const said = step.notWalked?.[id];
        if (said !== undefined && said.trim() !== '') reason ??= said;
      }
    }
    if (failed) return { id, result: 'failed', evidence };
    if (evidence.length > 0) return { id, result: 'passed', evidence };
    return reason === undefined ? { id, result: 'not walked', evidence } : { id, result: 'not walked', reason, evidence };
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
 * Each walk's LATEST report of this build: a walk run again after a fix replaces its earlier run, and a report of another
 * commit, of a dirty tree, or of another digest is not this build's (Decision 2).
 * @param {string} root
 * @param {{ commit: string, digest: string }} build
 * @returns {WalkReport[]}
 */
export function reportsOf(root, build) {
  const walks = join(root, '_review', 'walks');
  if (!existsSync(walks)) return [];
  /** @type {WalkReport[]} */
  const kept = [];
  for (const walk of readdirSync(walks).sort()) {
    const runs = readdirSync(join(walks, walk)).sort().reverse();
    for (const folder of runs) {
      const path = join(walks, walk, folder, 'report.json');
      if (!existsSync(path)) continue;
      /** @type {WalkReport} */
      const report = { ...JSON.parse(readFileSync(path, 'utf8')), folder };
      const of = report.build;
      if (of === undefined || !of.clean || of.commit !== build.commit || of.digest !== build.digest) continue;
      kept.push(report);
      break;
    }
  }
  return kept;
}

/** `git` in the checkout, its standard output. @param {string} root @returns {(args: readonly string[]) => string} */
export const gitIn = (root) => (args) => execFileSync('git', [...args], { cwd: root, encoding: 'utf8' });

/**
 * Writes `HEAD`'s record from its walks' reports, the record's only writer (Decision 1), and answers it. Refuses a tree
 * whose app sources are not the commit's, since its build is no commit's.
 * @param {string} root
 */
export function writeRecord(root) {
  const build = walkBuild(root, gitIn(root));
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

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
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
