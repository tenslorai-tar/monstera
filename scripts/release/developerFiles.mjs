// @ts-check
/**
 * Which files in a staged package are a library developer's and never run — the owner's review of 0.1.16.0, R2.
 *
 * ## Why one rule, and why it is also a check
 *
 * The packager copied each production dependency's folder whole, nested `node_modules` aside, so the 0.1.16.0 MSIX
 * carried TypeScript sources, a test file, source maps and READMEs from bundled dependencies (the Windows App
 * Certification Kit listed them). The application's own `dist/` had a filter of its own, a second opinion about the
 * same question (B3a). This module is the one answer: the copy of our `dist/`, the copy of each dependency, and the
 * check over the finished stage all ask it. The check is what makes it hold: a copy step that forgot to ask would
 * otherwise ship the files again in silence.
 *
 * ## The rule
 *
 * - source maps (`.map`);
 * - TypeScript, including declarations (`.ts`, `.mts`, `.cts`, `.d.ts`): Node runs JavaScript here, and nothing at run
 *   time reads a declaration — measured by the package's own start check and resolution check, which run on the stage
 *   this leaves;
 * - tests and their harnesses (`.test.`, `.spec.`, `.proof.`, `.setup.` scripts);
 * - prose for the library's developers: Markdown, except the licence texts a licence requires to travel with the code
 *   (`LICENSE`, `LICENCE`, `NOTICE`, `COPYING`, `AUTHORS`, `PATENTS`, in any case and with any extension);
 * - folders of documentation, examples and tests (`docs`, `doc`, `example`, `examples`, `test`, `tests`,
 *   `__tests__`), inside a dependency only — a folder of our own is named by our build, never by this list.
 *
 * `package.json` stays: Node reads it to resolve every package.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** File names a licence requires to travel with the code it covers. */
const LICENCE_NAME = /^(?:licen[cs]e|notice|copying|authors|patents)(?:[-_.].*)?$/iu;

/** Folders inside a dependency that hold its developers' material, not code it runs. */
const DEVELOPER_FOLDERS = new Set(['docs', 'doc', 'example', 'examples', 'test', 'tests', '__tests__']);

/**
 * Why a file is a developer's, or `null` for one that ships.
 *
 * @param {string} path the file, relative to the folder being judged
 * @param {{ readonly dependency: boolean }} where whether that folder is a dependency's own (its folders are judged too)
 * @returns {string | null}
 */
export function developerFile(path, where) {
  const parts = path.split(/[\\/]/u);
  const name = parts[parts.length - 1] ?? '';
  if (/\.map$/iu.test(name)) return 'a source map';
  if (/\.(?:d\.)?[cm]?ts$/iu.test(name)) return 'TypeScript';
  if (/\.(?:test|spec|proof|setup)\.[cm]?[jt]sx?$/iu.test(name)) return 'a test';
  if (/\.(?:md|markdown)$/iu.test(name) && !LICENCE_NAME.test(name)) return "its developers' prose";
  if (where.dependency && parts.slice(0, -1).some((part) => DEVELOPER_FOLDERS.has(part.toLowerCase()))) {
    return 'a documentation, example or test folder';
  }
  return null;
}

/**
 * Every developer's file under a staged application's `node_modules` and `dist`, with why — empty for a clean stage.
 * Each package folder under `node_modules` is judged as a dependency from its own root, so a `test` folder of the
 * package is found and a package NAMED `test` is not mistaken for one.
 *
 * @param {string} app the staged `resources/app`
 * @returns {string[]}
 */
export function developerFilesIn(app) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} folder @param {boolean} dependency */
  const judge = (folder, dependency) => {
    for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(entry.parentPath, entry.name);
      const inside = relative(folder, file);
      // A NESTED PACKAGE is judged from its own root (`packageRoots`), never as a folder of this one.
      if (inside.split(sep).includes('node_modules')) continue;
      const why = developerFile(inside, { dependency });
      if (why !== null) found.push(`${relative(app, file).split(sep).join('/')} (${why})`);
    }
  };
  judge(join(app, 'dist'), false);
  for (const root of packageRoots(join(app, 'node_modules'))) judge(root, true);
  return found.sort();
}

/**
 * The package folders under a `node_modules`, scoped ones included, each without the nested `node_modules` beneath it
 * (judged as packages of their own).
 *
 * @param {string} modules
 * @returns {string[]}
 */
function packageRoots(modules) {
  /** @type {string[]} */
  const roots = [];
  /** @param {string} folder */
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(folder, entry.name);
      if (entry.name.startsWith('@')) visit(path);
      else {
        roots.push(path);
        if (existsSync(join(path, 'node_modules'))) visit(join(path, 'node_modules'));
      }
    }
  };
  visit(modules);
  return roots;
}
