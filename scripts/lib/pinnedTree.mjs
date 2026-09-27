// @ts-check
/**
 * Whether a provisioned folder holds EXACTLY the files its script pins, byte for byte.
 *
 * ## The defect this closes, and the two scripts it does not
 *
 * PDFium, Poppler and Ghostscript each pinned the ARCHIVE they download and then, on every later run, returned early
 * the moment their output file existed — so a tree restored from a cache, or changed on disk after extraction, was
 * reported provisioned with no digest checked at all. `electron.mjs` had already paid for this exact shape (*"a
 * restored tree skips downloadVerified and therefore skips the digest check, which turns a hash-pinned artifact into an
 * unpinned one"*) and fixed it for itself; its siblings kept the early return. A pinned archive is not a pinned
 * installed file.
 *
 * Two more scripts return early the same way and are NOT fixed here, each for a stated reason: `mupdf.mjs` extracts a
 * SOURCE tree that is then compiled on this machine, and a build that is not shown to be reproducible has no digest
 * to pin (`shimBinary.mjs` records its source inputs instead); `libreoffice.mjs` provisions a program nothing loads
 * since the owner deferred Office import (ADR-0092).
 *
 * ## Every file the process loads, and NO OTHER
 *
 * The pins name each file in the folder the program runs from, and the folder must hold those and nothing else: an
 * extra DLL beside an executable is one Windows' search order loads, so a folder that held the right files plus one
 * more would be the attack with a green check.
 *
 * ## On a mismatch the folder is REMOVED and the run fails
 *
 * `verifyFileDigest`'s rule and its reason: a corrupted tree and a poisoned one are indistinguishable here, and
 * repairing the first silently would launder the second. The next run provisions from the verified archive.
 */

import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { digestOf } from './fetchVerified.mjs';

/**
 * Every file under `directory`, as forward-slash paths relative to it, sorted.
 *
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function filesUnder(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

/**
 * What differs between a folder and its pins: files missing, files not pinned, and files whose bytes differ.
 * Empty when the folder is exactly what was pinned.
 *
 * @param {string} directory
 * @param {Readonly<Record<string, string>>} pins relative path → lower-case SHA-256
 * @returns {Promise<string[]>}
 */
export async function treeProblems(directory, pins) {
  const pinned = Object.keys(pins).sort();
  // AN EMPTY PIN SET PINS NOTHING, and would pass an empty folder — the reassuring answer from a broken table.
  if (pinned.length === 0) throw new Error('a pinned tree needs at least one pinned file');
  const present = await filesUnder(directory);
  const problems = [
    ...pinned.filter((path) => !present.includes(path)).map((path) => `missing ${path}`),
    ...present.filter((path) => !(path in pins)).map((path) => `not pinned ${path}`),
  ];
  for (const path of pinned) {
    if (!present.includes(path)) continue;
    const actual = await digestOf(join(directory, path));
    if (actual !== pins[path]) problems.push(`different ${path}: expected ${String(pins[path])}, received ${actual}`);
  }
  return problems;
}

/**
 * Throws, after removing the folder, unless it holds exactly the pinned files.
 *
 * @param {{ directory: string, pins: Readonly<Record<string, string>>, context: string }} options
 * @returns {Promise<void>}
 */
export async function verifyPinnedTree({ directory, pins, context }) {
  const problems = await treeProblems(directory, pins);
  if (problems.length === 0) return;
  await rm(directory, { recursive: true, force: true });
  throw new Error(
    `${context} is not the tree its script pins, so it was removed unread:\n  ${problems.join('\n  ')}\n` +
      'Run the provisioning again to extract it from the verified archive.',
  );
}

/**
 * The pins a folder would need — for writing a script's table from a tree this run extracted from a verified archive,
 * never from one found on disk.
 *
 * @param {string} directory
 * @returns {Promise<Record<string, string>>}
 */
export async function pinsOf(directory) {
  /** @type {Record<string, string>} */
  const pins = {};
  for (const path of await filesUnder(directory)) pins[path] = await digestOf(join(directory, path));
  return pins;
}
