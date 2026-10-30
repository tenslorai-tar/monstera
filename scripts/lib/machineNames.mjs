// @ts-check
/**
 * No commit carries the committer's own machine names: the user name and the computer name, as the operating system
 * gives them at commit time. The owner's decision of 2026-10-29, when both were found in five tracked files (a UNC path,
 * a profile path, an ACL listing) that had been pasted from real measurements.
 *
 * ## The names are not here
 *
 * They are read from the operating system when the scan runs, so no list of them exists to be committed, and the
 * report names the KIND of identifier and the line, never its value: a refusal that printed the name would put it in
 * every log that captured the hook.
 *
 * ## What is not checked, and why
 *
 * A name shorter than {@link MIN_LENGTH}, or one of {@link GENERIC}, is not looked for. A short name is usually a word of
 * the language or a common fragment (`mark`, `test`), and a generic one is every runner's and every container's (`runner`,
 * `root`), so looking for them would refuse ordinary prose and train people to bypass the gate. Which identifiers were
 * skipped, and why, is printed on every run that skipped one: a scan that quietly checked nothing reads as clean.
 *
 * Matched case-insensitively and as a whole token — no letter, digit or underscore either side — so a user name inside
 * a longer word is not a hit, while the same name inside a path (`\\NAME-PC\C$`, `C:\Users\name\`) is.
 *
 * ## It refuses to answer blind
 *
 * It first finds a control identifier in a control text built here, and refuses to report when it does not.
 */

import { readFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { basename } from 'node:path';

import { changedPaths, filesInCommit, readStagedBlobs, repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/** Names shorter than this are not looked for: see the header. */
export const MIN_LENGTH = 5;

/** Account and host names shared by every runner, container and default install, lower case: see the header. */
export const GENERIC = new Set([
  'admin',
  'administrator',
  'azureuser',
  'builder',
  'codespace',
  'codespaces',
  'computer',
  'default',
  'desktop',
  'developer',
  'docker',
  'ec2-user',
  'github',
  'gitpod',
  'guest',
  'jenkins',
  'laptop',
  'localhost',
  'owner',
  'public',
  'runner',
  'runneradmin',
  'student',
  'system',
  'tester',
  'ubuntu',
  'vagrant',
  'vscode',
  'workstation',
]);

/** @typedef {'user name' | 'computer name'} Kind */
/** @typedef {{ kind: Kind, value: string }} Identifier */
/** @typedef {{ kind: Kind, why: string }} Skipped */

/**
 * The identifiers to look for, from what the operating system answered, and the ones skipped with the reason: the
 * account's name and its profile folder's name (which differ when an account is renamed, and the folder is what a path
 * carries), the host name and its first label (a fully qualified name's short form), and Windows' computer name.
 * @param {{ users: readonly (string | undefined)[], hosts: readonly (string | undefined)[] }} answered
 * @returns {{ checked: Identifier[], skipped: Skipped[] }}
 */
export function identifiersFrom(answered) {
  /** @type {Identifier[]} */
  const checked = [];
  /** @type {Skipped[]} */
  const skipped = [];
  const seen = new Set();
  /** @param {Kind} kind @param {readonly (string | undefined)[]} values */
  const take = (kind, values) => {
    for (const raw of values) {
      const value = (raw ?? '').trim();
      if (value === '' || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      if (value.length < MIN_LENGTH) skipped.push({ kind, why: `shorter than ${String(MIN_LENGTH)} characters` });
      else if (GENERIC.has(value.toLowerCase())) skipped.push({ kind, why: 'a generic name every such machine shares' });
      else checked.push({ kind, value });
    }
  };
  take('user name', answered.users);
  take('computer name', answered.hosts.flatMap((host) => [host, host?.split('.')[0]]));
  return { checked, skipped };
}

/** What this machine's operating system answers, read now. A question it cannot answer is left out, never guessed. */
export function machineIdentifiers() {
  /** @type {(string | undefined)[]} */
  const users = [];
  try {
    users.push(userInfo().username);
  } catch {
    // NO ACCOUNT ENTRY (a container running as an unlisted uid): the profile folder below is still asked.
  }
  users.push(basename(homedir()));
  return identifiersFrom({ users, hosts: [hostname(), process.env['COMPUTERNAME']] });
}

/** @param {string} text */
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Every line of `text` holding one of `identifiers` as a whole token, with which kind it is — never the value.
 * @param {string} text @param {readonly Identifier[]} identifiers
 * @returns {{ line: number, kind: Kind }[]}
 */
export function foundLines(text, identifiers) {
  /** @type {{ line: number, kind: Kind }[]} */
  const found = [];
  const lines = text.split('\n');
  for (const { kind, value } of identifiers) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(value)}(?![\\p{L}\\p{N}_])`, 'iu');
    lines.forEach((line, at) => {
      if (pattern.test(line)) found.push({ line: at + 1, kind });
    });
  }
  return found.sort((a, b) => a.line - b.line);
}

/** The control: an identifier found inside a UNC path on line 2, and not inside a longer word on line 3. */
const CONTROL_IDENTIFIER = /** @type {Identifier} */ ({ kind: 'computer name', value: 'CONTROLHOST-PC' });
const CONTROL_TEXT = 'nothing on this line\nmeasured through \\\\controlhost-pc\\C$\\f.txt\nnor in controlhost-pcs\n';

/**
 * The files the scan reads: every tracked file for the tree, and for the index the files this commit stages.
 * @param {'tree' | 'staged'} source @returns {string[]}
 */
function scannedFiles(source) {
  return source === 'staged'
    ? changedPaths(['--cached'])
        .filter((entry) => entry.state !== 'D')
        .map((entry) => entry.path)
    : filesInCommit();
}

/** @param {string} path @returns {Buffer | null} */
function readTracked(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/**
 * Runs the scan, control first.
 * @param {{ source?: 'tree' | 'staged', identifiers?: { checked: Identifier[], skipped: Skipped[] } }} [options]
 *   the working copy or the index, and the identifiers, read from this machine unless a caller supplies them
 * @returns {number} the process exit code
 */
export function scan({ source = 'tree', identifiers = machineIdentifiers() } = {}) {
  const control = foundLines(CONTROL_TEXT, [CONTROL_IDENTIFIER]);
  if (control.length !== 1 || control[0]?.line !== 2) {
    process.stdout.write(
      `  FAIL  the machine-name scan could not find its own control (found on ${JSON.stringify(control)}).\n` +
        `        A blind search reports a clean tree, so this refuses to report a result.\n`,
    );
    return 1;
  }
  for (const { kind, why } of identifiers.skipped) process.stdout.write(`  note  this machine's ${kind} is not looked for: ${why}\n`);
  if (identifiers.checked.length === 0) {
    process.stdout.write('  ok  no machine name here is specific enough to look for\n');
    return 0;
  }
  const root = repoRoot();
  const files = scannedFiles(source);
  const staged = source === 'staged' ? readStagedBlobs(files) : undefined;
  let read = 0;
  let offending = 0;
  for (const file of files) {
    const bytes = staged === undefined ? readTracked(`${root}/${file}`) : (staged.get(file) ?? null);
    if (bytes === null) {
      // OWED AND NOT HAD: a staged file whose bytes could not be read is a blind spot, not a clean file.
      if (source === 'staged') {
        process.stdout.write(`  FAIL  ${file} is staged and could not be read, so the machine-name scan refuses to report a result.\n`);
        return 1;
      }
      continue;
    }
    if (bytes.subarray(0, 8000).includes(0)) continue;
    read += 1;
    for (const { line, kind } of foundLines(bytes.toString('utf8'), identifiers.checked)) {
      offending += 1;
      process.stdout.write(`  FAIL  ${file}:${String(line)} holds this machine's ${kind}\n`);
    }
  }
  if (offending > 0) {
    process.stdout.write(
      `\n${String(offending)} line(s) hold this machine's own names (the owner's decision of 2026-10-29).\n` +
        `Use a placeholder that keeps the evidence's meaning: \\\\HOST\\C$\\…, C:\\Users\\<user>\\…, HOST\\<user>.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `  ok  ${String(read)} ${source === 'staged' ? 'staged' : 'tracked'} text file(s) hold none of this machine's ${String(identifiers.checked.length)} name(s)\n` +
      `  ok  and the scan found its control inside a UNC path and not inside a longer word, so that result means something\n`,
  );
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = scan({ source: process.argv.includes('--staged') ? 'staged' : 'tree' });
