// @ts-check
/**
 * Maps every `@monstera/*` specifier onto the package's TypeScript source.
 *
 * Why this exists, mechanically: each package's `exports` map names
 * `./dist/index.js`, so a bare `@monstera/shared` inside a test resolves to the
 * last successful BUILD rather than to the working tree. Excluding `**\/dist/**`
 * from vitest's collection does nothing about that — collection decides which
 * test FILES run, resolution decides which module a specifier loads, and these
 * are different questions. The config used to claim the class was closed.
 *
 * The cost was measured, not assumed: deleting `cause` propagation from
 * `packages/shared/src/result.ts` left 27/27 green, and the identical mutation
 * turned 2 tests red once `dist` had been rebuilt. The coverage was never
 * missing; the tests were reading a different copy of the code.
 *
 * Aliasing rather than building first is deliberate. Building first only
 * sequences around the stale state — it stays representable, and it is one
 * forgotten step away from returning, which is what `ci.yml` running typecheck
 * before test already was. It also puts a full `tsc --build` in front of the
 * most frequent command in the project, and this repository has already learned
 * that a slow check is a check people stop running. Aliasing removes the state
 * instead: under this map `dist` is not on any resolution path a test can take.
 *
 * The seam that keeps this honest: vitest exercises SOURCE, and the build
 * output is exercised by the proofs that call `buildWorkspace()`
 * (`contract.proof.mjs`). Neither is asked to cover the other's ground.
 *
 * Derived from the workspace globs rather than hand-listed. A literal table of
 * six package names is the second wiring place the registry rule forbids, and
 * its failure is silent: a package added later would simply not be aliased and
 * would quietly resolve to `dist` again — the original defect, restored by an
 * omission nobody reviews.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** @param {string} literal @returns {string} */
function escapeForRegExp(literal) {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Expands the root `workspaces` globs into directories.
 *
 * Only the `dir/*` shape is understood. Anything else throws rather than being
 * skipped: a glob this cannot expand is a set of packages that would silently
 * miss their alias, which is precisely the failure being closed here.
 *
 * @param {string} root
 * @returns {string[]} absolute directories
 */
function workspaceDirectories(root) {
  /** @type {{ workspaces?: unknown }} */
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const globs = manifest.workspaces;
  if (!Array.isArray(globs)) {
    throw new Error('workspaceAliases: the root package.json has no `workspaces` array.');
  }

  /** @type {string[]} */
  const directories = [];
  for (const glob of globs) {
    if (typeof glob !== 'string' || !glob.endsWith('/*') || glob.slice(0, -2).includes('*')) {
      throw new Error(
        `workspaceAliases: cannot expand workspace glob ${JSON.stringify(glob)}. Only "dir/*" is ` +
          `understood. Teach this function the new shape — do not leave it unexpanded, because an ` +
          `unaliased package resolves to dist and reintroduces the staleness this map exists to remove.`,
      );
    }

    const parent = join(root, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent)) {
      const directory = join(parent, entry);
      if (statSync(directory).isDirectory() && existsSync(join(directory, 'package.json'))) {
        directories.push(directory);
      }
    }
  }
  return directories;
}

/**
 * @param {string} root
 * @returns {Array<{ name: string, directory: string, entry: string, sourceDir: string }>}
 */
export function workspacePackages(root) {
  return workspaceDirectories(root)
    .map((directory) => {
      /** @type {{ name?: unknown }} */
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      const name = manifest.name;
      if (typeof name !== 'string' || name === '') {
        throw new Error(`workspaceAliases: ${directory} has a package.json with no name.`);
      }

      const sourceDir = join(directory, 'src');
      const entry = join(sourceDir, 'index.ts');
      if (!existsSync(entry)) {
        // Loud rather than skipped, for the same reason as the glob check above.
        throw new Error(
          `workspaceAliases: ${name} has no src/index.ts, so it cannot be aliased to source and ` +
            `would resolve to its dist build instead. Give it one, or take it out of the workspace ` +
            `globs — leaving it unaliased silently restores the staleness this map removes.`,
        );
      }

      return { name, directory, entry, sourceDir };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Vite/Vitest `resolve.alias` entries.
 *
 * Regular expressions rather than plain strings: a string `find` matches by
 * prefix, so `@monstera/ui` would also capture a future `@monstera/ui-kit` and
 * rewrite it to the wrong package.
 *
 * The subpath entry is emitted even though every `exports` map currently
 * publishes only `"."`. It costs nothing now and means the first package to add
 * a subpath export does not quietly resolve that one specifier through `dist`
 * while its bare specifier goes to source — a split no test would announce.
 *
 * @param {string} root
 * @returns {Array<{ find: RegExp, replacement: string }>}
 */
export function workspaceAliases(root) {
  return workspacePackages(root).flatMap(({ name, entry, sourceDir }) => {
    const escaped = escapeForRegExp(name);
    return [
      { find: new RegExp(`^${escaped}$`, 'u'), replacement: entry },
      { find: new RegExp(`^${escaped}/`, 'u'), replacement: `${sourceDir.replaceAll('\\', '/')}/` },
    ];
  });
}
