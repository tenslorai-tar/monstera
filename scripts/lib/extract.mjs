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
  // bsdtar BY NAME first, then the paths a platform guarantees for `tar`.
  //
  // This list used to be the three `tar` paths alone, under a comment claiming
  // "bsdtar first where both exist". That is true on macOS, where /usr/bin/tar
  // IS bsdtar — and false on Linux, where it is GNU tar, which cannot read a
  // zip. The comment described one platform and the list was used on both, so
  // the first zip this project ever extracted on Linux failed. Electron ships
  // every platform as `.zip`, including Linux, so it was the first caller to
  // find out.
  return [
    '/usr/bin/bsdtar',
    '/usr/local/bin/bsdtar',
    '/usr/bin/tar',
    '/bin/tar',
    '/usr/local/bin/tar',
    // `unzip` reads zip and nothing else, which is why it comes last: it is
    // only ever selected for a zip, and only when no libarchive tar is present.
    // That is the ubuntu runner exactly — GNU tar and no bsdtar — and it is the
    // canonical zip tool on the platform rather than a package someone might
    // have installed, so supporting it is the fix and `apt-get install` in a
    // workflow would be the workaround.
    '/usr/bin/unzip',
    '/bin/unzip',
    '/usr/local/bin/unzip',
  ];
}

/**
 * Whether a candidate is `unzip`, which takes different arguments from tar.
 *
 * @param {string} path
 * @returns {boolean}
 */
function isUnzip(path) {
  return /(^|[\\/])unzip(\.exe)?$/iu.test(path);
}

/**
 * Whether an extractor is libarchive-based, and therefore reads zip.
 *
 * Probed by running it, not inferred from its filename. `/usr/bin/tar` is
 * bsdtar on macOS and GNU tar on Linux — the same path, opposite capabilities —
 * so the name cannot answer this and a table of platforms would be a third
 * opinion about a question the program answers about itself.
 *
 * @param {string} extractor
 * @returns {boolean}
 */
function readsZip(extractor) {
  // `unzip` reads zip by definition and does not answer `--version` the way tar
  // does — `unzip --version` exits non-zero on the common build — so probing it
  // would report "cannot read zip" about the one program that only reads zip.
  if (isUnzip(extractor)) return true;
  const result = spawnSync(extractor, ['--version'], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) return false;
  return /bsdtar|libarchive/iu.test(`${result.stdout}`);
}

/**
 * @returns {string} Absolute path to a tar that exists on this machine.
 * @throws when no candidate exists, naming every path tried.
 */
export function extractorPath(archiveName = '') {
  const tried = candidates();
  const present = tried.filter((path) => existsSync(path));

  // A zip needs libarchive. Picking the first PRESENT tar and letting it fail
  // would surface as `tar: Unrecognized archive format` — an error that names
  // the archive rather than the program, which sends the reader to look at the
  // download. Choose by capability, and if none has it, say which programs were
  // tried and what to install.
  if (archiveName.endsWith('.zip')) {
    const capable = present.find((path) => readsZip(path));
    if (capable !== undefined) return capable;
    if (present.length > 0) {
      throw new Error(
        `No zip-capable extractor for ${archiveName}. Present but not libarchive-based:\n  ` +
          `${present.join('\n  ')}\nGNU tar cannot read zip; bsdtar can. Install it — ` +
          `\`libarchive-tools\` on Debian/Ubuntu, \`bsdtar\` elsewhere. PATH is deliberately ` +
          `not consulted, so installing it somewhere unusual will not be found either.`,
      );
    }
  }

  const found = present[0];
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
  const tar = extractorPath(archiveName);
  if (isUnzip(tar)) {
    // The listing below parses bsdtar's long format. unzip's differs, and this
    // function exists for a Windows-only hazard, so the pairing is refused
    // rather than given a second parser nothing exercises.
    throw new Error(
      `archiveSymlinks cannot read ${archiveName} with ${tar}: it parses bsdtar's -tvf format. ` +
        `The symlink exclusion exists for Windows, where bsdtar is the extractor.`,
    );
  }
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

  const tar = extractorPath(archiveName);

  // `unzip` does not take tar's flags, and it has no `--exclude`. Refusing the
  // combination is better than translating it: the only caller that passes
  // exclusions is the MuPDF provisioner, whose archive is a `.tar.gz`, so this
  // pairing cannot arise today and a silent translation would be untested code
  // waiting for the first caller that needs it to be right.
  if (isUnzip(tar) && extraArgs.length > 0) {
    throw new Error(
      `${tar} cannot honour extra arguments (${extraArgs.join(' ')}). unzip has no --exclude, ` +
        `and dropping them would extract MORE than the caller asked for.`,
    );
  }

  const argv = isUnzip(tar)
    ? // `-o` overwrites without prompting: unzip is interactive by default and
      // would otherwise WAIT for input on a re-extraction, which in CI is a hang
      // rather than an error. `-q` keeps 200 MB of file names out of the log.
      ['-o', '-q', archiveName]
    : ['-xf', archiveName, ...extraArgs];

  const result = spawnSync(tar, argv, {
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
