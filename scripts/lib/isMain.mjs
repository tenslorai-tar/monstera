// @ts-check
/**
 * Whether this module is the entry point the process was started with
 * (finding AAAA-5).
 *
 * ## Why this is a named thing and not an expression
 *
 * The comparison is `import.meta.url` against the argv path AS A URL, and the
 * conversion is the whole content of it. Written by hand as
 * `` `file://${process.argv[1]}` `` it is correct on POSIX and wrong on Windows,
 * where `pathToFileURL` produces `file:///C:/...` and the hand-built string
 * produces `file://C:/...`. They never match, the guard never fires, and the
 * module exits 0 having done nothing.
 *
 * That happened: `electronBinaryCallers.mjs` shipped that way and its first run
 * scanned nothing. Two other scans in this repository already used
 * `pathToFileURL` correctly, so the rule was living in call sites and a third
 * caller re-derived it wrongly — B3a's tell exactly, and the dangerous shape,
 * because a partial reimplementation agrees with the authority on every platform
 * but one.
 *
 * ## What this does NOT do
 *
 * It cannot prove a module WIRED the guard at all. A module that never calls
 * this has no main behaviour and looks identical from outside, which is why
 * every scan also carries a case that spawns it as a process. This removes the
 * class of writing the comparison wrong — the half that has actually bitten.
 *
 * Usage: `if (isMain(import.meta.url)) { ... }`
 */

import { pathToFileURL } from 'node:url';

/**
 * @param {string} moduleUrl the caller's own `import.meta.url`
 * @returns {boolean}
 */
export function isMain(moduleUrl) {
  const entry = process.argv[1];
  // No argv[1] means no entry script — `node --eval`, or an embedder. Nothing
  // is main then, which is the safe answer: a module that decides it IS main
  // there would run its CLI inside someone else's process.
  if (entry === undefined) return false;
  return moduleUrl === pathToFileURL(entry).href;
}
