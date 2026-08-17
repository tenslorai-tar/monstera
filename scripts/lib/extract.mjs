// @ts-check
/**
 * The one archive extractor for provisioned artefacts.
 *
 * Resolving `tar` through PATH makes the result depend on which shell launched
 * the process, and this repository has already paid for that once: provisioning
 * worked from PowerShell and failed from Git Bash, from identical code.
 *
 * Windows has two programs called `tar` and they are not interchangeable.
 * **bsdtar** in System32 (Windows 10 1803+) reads zip as well as tar.gz. **GNU
 * tar**, shipped with Git for Windows, reads neither zip nor an argument
 * containing a colon — it treats `C:\…` as a remote `host:path` and fails with
 * `Cannot connect to C: resolve failed`. Which one PATH finds is a property of
 * the terminal, not of the code.
 *
 * The earlier fix named the binary explicitly on Windows and left every other
 * platform returning the bare string `'tar'`, so the same class stayed open
 * wherever CI actually runs it. This module resolves an absolute path on
 * **every** platform, so no shell's PATH participates in the decision anywhere.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Absolute locations to try, in order, per platform. Each is a path a platform
 * guarantees rather than a path a package manager might have written.
 *
 * @returns {readonly string[]}
 */
function candidates() {
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? process.env['windir'] ?? 'C:\\Windows';
    return [join(systemRoot, 'System32', 'tar.exe')];
  }
  // bsdtar first where both exist: macOS ships it as /usr/bin/tar, and it reads
  // zip, which GNU tar does not. /bin/tar covers distributions with no /usr
  // split; /usr/local/bin covers a deliberately installed newer tar.
  return ['/usr/bin/tar', '/bin/tar', '/usr/local/bin/tar'];
}

/**
 * @returns {string} Absolute path to a tar that exists on this machine.
 * @throws when no candidate exists, naming every path tried.
 */
export function extractorPath() {
  const tried = candidates();
  const found = tried.find((path) => existsSync(path));
  if (found === undefined) {
    throw new Error(
      `No archive extractor found. Tried:\n  ${tried.join('\n  ')}\n` +
        `PATH is deliberately not consulted — which "tar" it yields depends on the shell, ` +
        `and this project has already shipped a defect that changed with the terminal.` +
        (process.platform === 'win32'
          ? `\nbsdtar ships with Windows 10 1803 and later.`
          : `\nInstall tar through the system package manager.`),
    );
  }
  return found;
}

/**
 * The symlink entries an archive contains, as archive-relative paths.
 *
 * Creating a symlink on Windows needs either elevation or Developer Mode, so an
 * unprivileged extraction fails with `Can't create '…': Invalid argument` and
 * bsdtar exits 1 — after having written every other file, which makes the tree
 * look extracted while the command reports failure.
 *
 * The list is read from the archive rather than hardcoded, so a version bump
 * that moves or adds a symlink does not silently reintroduce the failure.
 *
 * @param {string} directory Absolute path to the directory holding the archive.
 * @param {string} archiveName File name only.
 * @returns {string[]}
 */
export function archiveSymlinks(directory, archiveName) {
  const tar = extractorPath();
  const result = spawnSync(tar, ['-tvf', archiveName], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `Could not list ${archiveName} to find its symlinks: ` +
        `${result.error?.message ?? `exit ${result.status}`}`,
    );
  }

  /** @type {string[]} */
  const links = [];
  for (const line of `${result.stdout}`.split(/\r?\n/)) {
    // bsdtar long format: a leading 'l' in the mode column marks a symlink, and
    // the entry is written `path -> target`.
    if (!line.startsWith('l')) continue;
    const arrow = line.indexOf(' -> ');
    if (arrow === -1) continue;
    // The metadata columns before the path vary in width between tar builds, so
    // take the last whitespace-separated token of the left-hand side rather than
    // counting fields.
    const fields = line.slice(0, arrow).trim().split(/\s+/);
    const path = fields[fields.length - 1] ?? '';
    if (path !== '') links.push(path);
  }
  return links;
}

/**
 * Extracts an archive, given its **file name** and the directory holding it.
 *
 * The archive is named relatively with `cwd` set, never as an absolute path: a
 * colon in an argument is not portable across the two tars (see above).
 *
 * @param {string} directory Absolute path to the directory holding the archive.
 * @param {string} archiveName File name only — never a path.
 * @param {readonly string[]} [extraArgs] Additional tar arguments.
 */
export function extract(directory, archiveName, extraArgs = []) {
  if (archiveName.includes('/') || archiveName.includes('\\')) {
    throw new Error(
      `extract() takes a file name, not a path: received "${archiveName}". ` +
        `A path here reintroduces the colon problem this module exists to avoid.`,
    );
  }

  const tar = extractorPath();
  const result = spawnSync(tar, ['-xf', archiveName, ...extraArgs], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    throw new Error(`Could not run "${tar}" to extract ${archiveName}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`${tar} exited ${result.status} extracting ${archiveName}: ${result.stderr}`);
  }
}
