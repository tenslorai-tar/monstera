// @ts-check
/**
 * The project's typecheck, run against the INDEX rather than the working tree (JJJJJJJ-5, the owner's decision of
 * 2026-10-17, 8a).
 *
 * `tsc --build` reads the files on disk. With other work unstaged beside a commit, the disk is not the commit: an
 * index that never compiled was committed (98712352) because the tree it sat in did, and a sound index was refused
 * twice because the work beside it did not. Setting the other work aside by hand (`git stash --keep-index`) is a
 * discipline, and this project has written down what a discipline is worth at the moment a command is typed.
 *
 * So when the tree holds unstaged changes to files the compiler reads, the index is written to a scratch folder
 * (`git checkout-index`, which writes the staged blobs and nothing else) and `npm run typecheck` runs there. The verb,
 * never `tsc`: the manifest says what typechecking is (B3a, `prePush.mjs`' `decideTypecheck`).
 *
 * ## The scratch folder's modules are linked, and its OWN packages are linked to ITS copies
 *
 * Every entry of the repository's `node_modules` is a junction from the scratch folder's, except `@monstera`: npm
 * links each workspace package by an ABSOLUTE junction into this checkout, so a scratch folder borrowing that entry
 * would compile the working tree's packages and pass for the reason the check exists to rule out. The scratch folder
 * gets its own `@monstera`, each package junctioned to its copy in the scratch folder. {@link scratchReadsItsOwnPackages}
 * asserts that before anything is compiled.
 *
 * ## Removal follows no junction
 *
 * `fs.rmSync({ recursive })` removes a junction as a link and leaves its target, measured 2026-10-17 on Node 24 against
 * a throwaway target holding two files (both kept, the link resolving before the removal). A removal that followed a
 * link would empty the real `node_modules`; {@link removeScratch} checks the repository's own modules are still there
 * afterwards, so that failure could not pass silently.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { git } from './gitScope.mjs';

/** The scope npm links the workspace packages under. */
const WORKSPACE_SCOPE = '@monstera';

/**
 * Paths the compiler reads that differ between the index and the working tree — unstaged edits, and untracked files
 * are not among them (`git diff` without `--cached` compares the tree to the index).
 *
 * @param {readonly string[]} pathspecs the compiler-read set, `prePush.mjs`' `TYPECHECKED_PATHSPECS`
 * @param {string} root
 * @returns {string[]}
 */
export function unstagedCompilerReads(pathspecs, root) {
  return `${git(['diff', '--name-only', '--', ...pathspecs], { cwd: root }).stdout}`
    .split('\n')
    .filter((line) => line.length > 0);
}

/**
 * Paths the compiler reads that this commit stages.
 *
 * @param {readonly string[]} pathspecs
 * @param {string} root
 * @returns {string[]}
 */
export function stagedCompilerReads(pathspecs, root) {
  return `${git(['diff', '--cached', '--name-only', '--diff-filter=d', '--', ...pathspecs], { cwd: root }).stdout}`
    .split('\n')
    .filter((line) => line.length > 0);
}

/**
 * Whether a commit's index must be typechecked apart from the working tree: it stages a file the compiler reads, and
 * the tree holds an unstaged change to one. With no unstaged change the tree IS the index for the compiler, and the
 * pre-push gate's typecheck reads it; with nothing compiler-read staged, the commit cannot change what compiles.
 *
 * @param {readonly string[]} staged {@link stagedCompilerReads}
 * @param {readonly string[]} unstaged {@link unstagedCompilerReads}
 * @returns {{ check: boolean, why: string }}
 */
export function decideIndexTypecheck(staged, unstaged) {
  if (staged.length === 0) return { check: false, why: 'this commit stages nothing the compiler reads' };
  if (unstaged.length === 0) return { check: false, why: 'the working tree holds no unstaged change the compiler reads' };
  return {
    check: true,
    why:
      `this commit stages ${String(staged.length)} file(s) the compiler reads beside ${String(unstaged.length)} ` +
      `unstaged (${unstaged.slice(0, 3).join(', ')}${unstaged.length > 3 ? ', …' : ''})`,
  };
}

/**
 * Writes the index to a new scratch folder and links its modules.
 *
 * @param {string} root
 * @returns {string} the folder
 */
export function checkoutIndex(root) {
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-index-'));
  // THE TRAILING SEPARATOR IS THE PREFIX'S MEANING: `--prefix` is prepended to each path as a string.
  git(['checkout-index', '--all', `--prefix=${scratch.replaceAll('\\', '/')}/`], { cwd: root });
  linkModules(root, scratch);
  warmFrom(root, scratch);
  keepTimes(root, scratch);
  return scratch;
}

/**
 * THE CHECKOUT'S TIMES, on every file whose content the index and the working tree agree on. `tsc --build` decides
 * which projects to build by comparing times — *"out of date because output … is older than input"* — and every file
 * `checkout-index` writes is new, so the copied build state was older than all of them and each project was built
 * again from the start: 316 s warmed against 313 s cold, measured 2026-10-17 (`--verbose --dry` named the reason). A
 * file the two disagree on keeps its new time, so its project is out of date and built — incrementally, from the
 * copied build info — and the compiler's own decision in the scratch folder is the checkout's, plus the differences.
 *
 * @param {string} root
 * @param {string} scratch
 */
function keepTimes(root, scratch) {
  const differs = new Set(
    `${git(['diff', '--name-only'], { cwd: root }).stdout}`.split('\n').filter((line) => line.length > 0),
  );
  const indexed = `${git(['ls-files', '-z'], { cwd: root }).stdout}`.split('\0').filter((path) => path.length > 0);
  for (const path of indexed) {
    if (differs.has(path)) continue;
    const there = join(root, path);
    if (!existsSync(there)) continue;
    const { atime, mtime } = statSync(there);
    utimesSync(join(scratch, path), atime, mtime);
  }
}

/**
 * THE CHECKOUT'S BUILD STATE, copied: every `*.tsbuildinfo` and the `dist` beside it. Measured 2026-10-17, a cold
 * typecheck in the scratch folder took 313 s against 31 s warm in the checkout, the cost that gets a hook turned off.
 * Copying is sound by the compiler's own design: a build-info file records each input's content hash, so a file that
 * differs in the index is checked again and its project's declarations emitted again, and only those. The copies are
 * never linked: the typecheck writes into them.
 *
 * @param {string} root
 * @param {string} scratch
 */
function warmFrom(root, scratch) {
  const folders = ['.', ...['packages', 'apps'].flatMap((group) =>
    existsSync(join(root, group)) ? readdirSync(join(root, group)).map((name) => join(group, name)) : [],
  )];
  for (const folder of folders) {
    const here = join(root, folder);
    if (!existsSync(here) || !lstatSync(here).isDirectory()) continue;
    const infos = readdirSync(here).filter((name) => name.endsWith('.tsbuildinfo'));
    for (const info of infos) cpSync(join(here, info), join(scratch, folder, info), { preserveTimestamps: true });
    if (infos.length > 0 && folder !== '.' && existsSync(join(here, 'dist'))) {
      // DECLARATIONS ONLY: a referencing project reads its references' `.d.ts`, and `dist` also holds the bundlers'
      // output, which the compiler never reads.
      cpSync(join(here, 'dist'), join(scratch, folder, 'dist'), {
        recursive: true,
        preserveTimestamps: true,
        filter: (source) => !source.endsWith('.js') && !source.endsWith('.map') && !source.endsWith('.css'),
      });
    }
  }
}

/**
 * @param {string} root
 * @param {string} scratch
 */
function linkModules(root, scratch) {
  const modules = join(root, 'node_modules');
  const linked = join(scratch, 'node_modules');
  mkdirSync(linked);
  for (const entry of readdirSync(modules)) {
    if (entry === WORKSPACE_SCOPE) continue;
    symlinkSync(join(modules, entry), join(linked, entry), 'junction');
  }
  const scope = join(modules, WORKSPACE_SCOPE);
  mkdirSync(join(linked, WORKSPACE_SCOPE));
  for (const name of readdirSync(scope)) {
    const into = relative(root, realpathSync(join(scope, name)));
    if (into.startsWith('..')) {
      throw new Error(`${WORKSPACE_SCOPE}/${name} resolves outside the checkout (${into}); it is not a workspace link.`);
    }
    symlinkSync(join(scratch, into), join(linked, WORKSPACE_SCOPE, name), 'junction');
  }
}

/**
 * Whether every workspace link in the scratch folder lands inside it. The check's own premise: answered false, the
 * typecheck would read the working tree's packages.
 *
 * @param {string} scratch
 * @returns {boolean}
 */
export function scratchReadsItsOwnPackages(scratch) {
  const scope = join(scratch, 'node_modules', WORKSPACE_SCOPE);
  const names = readdirSync(scope);
  if (names.length === 0) return false;
  const own = realpathSync(scratch);
  return names.every((name) => {
    const link = join(scope, name);
    return lstatSync(link).isSymbolicLink() && resolve(readlinkSync(link)).startsWith(own);
  });
}

/**
 * Removes the scratch folder, and refuses to report success if the repository's own modules went with it.
 *
 * @param {string} scratch
 * @param {string} root
 */
export function removeScratch(scratch, root) {
  rmSync(scratch, { recursive: true, force: true });
  if (!existsSync(join(root, 'node_modules', 'typescript', 'package.json'))) {
    throw new Error(
      `removing ${scratch} took the checkout's node_modules with it: a junction was followed. Run \`npm ci\`.`,
    );
  }
}

/**
 * Runs the project's typecheck in `scratch`.
 *
 * @param {string} scratch
 * @param {string} npmCli the npm the hooks resolve (`lockfileIntegrity.mjs`' `npmCliPath`)
 * @returns {{ ok: boolean, output: string }}
 */
export function typecheckIn(scratch, npmCli) {
  const result = spawnSync(process.execPath, [npmCli, 'run', 'typecheck'], { cwd: scratch, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
