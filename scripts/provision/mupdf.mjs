// @ts-check
/**
 * Provisions MuPDF from source and builds the native shim (ADR-0010).
 *
 * This script exists because the evidence for the project's most consequential
 * ADR was produced in a scratch directory that no longer exists. A measurement
 * that cannot be repeated is an assertion with a number attached, so the seam
 * ADR-0010 mandates has to be rebuildable from a clean checkout by one command.
 *
 * Four steps, each idempotent:
 *
 *   1. Fetch `mupdf-<version>-source.tar.gz` against a pinned SHA-256, through
 *      the same `downloadVerified` primitive every other provisioned artefact
 *      uses — HTTPS only, host-locked on every redirect hop, byte-counted, and
 *      digest-checked before anything reads the bytes.
 *   2. Extract it, through the one absolute-path extractor in scripts/lib.
 *   3. Build MuPDF's static libraries with its own MSVC solution.
 *   4. Compile and link the shim against them.
 *
 * ## Why source and not a published binary
 *
 * MuPDF's headers carry no `dllexport` annotations, so exporting `fz_*` from a
 * DLL would mean patching thousands of declarations. The shim owns the export
 * surface and links MuPDF statically. `scripts/provision/mutool.mjs` was
 * withdrawn because it fetched a command-line tool, which is not this.
 *
 * ## Why the source tree lives under .tools/
 *
 * It is a provisioned artefact, and .gitignore covers .tools/ entirely. The
 * project file previously defaulted to `native/src/`, which .gitignore does NOT
 * cover: following the documented recipe left roughly 15,000 untracked
 * third-party files in `git status`, in a repository whose whole discipline is
 * about what reaches history.
 *
 * Usage:
 *   node scripts/provision/mupdf.mjs [--force] [--skip-mupdf] [--check]
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { archiveSymlinks, extract } from '../lib/extract.mjs';
import { build, dumpbin } from '../lib/msvc.mjs';
import { recordShimBuild } from '../lib/shimBinary.mjs';

/**
 * Pinned deliberately, and NOT bumped to the newest release.
 *
 * 1.28.1 and 1.28.2 exist. ADR-0010's measurements were taken against 1.28.0,
 * and re-measuring on a different version would confound "the instrument was
 * wrong" with "the engine changed" — which is the whole question the
 * re-verification exists to answer. Upgrading is a separate decision with its
 * own before/after run.
 *
 * The digest is the release asset's own, confirmed against the GitHub API for
 * ArtifexSoftware/mupdf-downloads rather than recalled.
 */
export const MUPDF_VERSION = '1.28.0';
const SOURCE_SHA256 = '21c7f064903154f1c3a7458bee81f130fc36f9b5147ea13328f9980e02d2dea2';
const SOURCE_BYTES = 68_923_736;

/**
 * mupdf.com redirects through casper.mupdf.com to this GitHub release, so
 * addressing the release directly removes two hosts from the trust set and
 * lands on the two the gitleaks provisioner already allows.
 */
const ALLOWED_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/** A generous ceiling on the source tarball, not a precise size assertion. */
const MAX_BYTES = 128 * 1024 * 1024;

/**
 * The repository being built, asked of git rather than derived from this file's
 * location: a git worktree keeps its checkout outside the main clone, so a path
 * computed from import.meta.url would point at the wrong tree.
 *
 * @returns {string}
 */
function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) {
    // Falling back rather than throwing: a source archive of this repository
    // has no .git, and the build should still work from it.
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  }
  return `${result.stdout}`.trim();
}

/** @param {string} root @returns {string} */
export function mupdfSourcePath(root) {
  return toolPath(root, 'mupdf', MUPDF_VERSION, `mupdf-${MUPDF_VERSION}-source`);
}

/** @param {string} root @returns {string} */
export function shimLibraryPath(root) {
  return join(root, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll');
}

/** @param {string} root @returns {string} */
function mupdfStaticLibrary(root) {
  return join(mupdfSourcePath(root), 'platform', 'win32', 'x64', 'Release', 'libmupdf.lib');
}

/**
 * @param {string} root
 * @param {boolean} force
 * @returns {Promise<string>} Absolute path to the extracted source tree.
 */
async function fetchSource(root, force) {
  const source = mupdfSourcePath(root);

  // The tree is large; presence of the include directory is the cheap proof it
  // extracted, and re-extracting 15,000 files to learn that is not.
  if (!force && existsSync(join(source, 'include', 'mupdf', 'fitz.h'))) {
    process.stderr.write(`  MuPDF ${MUPDF_VERSION} source already present\n`);
    return source;
  }

  const versionDirectory = dirname(source);
  await mkdir(versionDirectory, { recursive: true });

  const archiveName = `mupdf-${MUPDF_VERSION}-source.tar.gz`;
  const archive = join(versionDirectory, archiveName);

  if (force || !(await fileExists(archive))) {
    process.stderr.write(`  downloading ${archiveName} (${(SOURCE_BYTES / 1e6).toFixed(0)} MB)\n`);
    await downloadVerified({
      url: `https://github.com/ArtifexSoftware/mupdf-downloads/releases/download/${MUPDF_VERSION}/${archiveName}`,
      allowedHosts: ALLOWED_HOSTS,
      sha256: SOURCE_SHA256,
      maxBytes: MAX_BYTES,
      destination: archive,
    });
  } else {
    process.stderr.write(`  archive already downloaded and verified\n`);
  }

  // Always clear before extracting: we only reach this line when the tree is
  // absent or invalid, and extracting over a half-written tree from a failed run
  // produces a tree that looks complete and is not.
  await rm(source, { recursive: true, force: true });

  // Windows cannot create a symlink without elevation or Developer Mode, so
  // bsdtar writes every other file, fails on these four, and exits 1 — leaving a
  // tree that looks extracted while the command reports failure.
  //
  // The excluded entries are read out of the archive rather than listed here, so
  // a version bump that moves or adds one does not quietly reintroduce the
  // failure. All four in 1.28.0 are in subtrees libmupdf does not build:
  // freeglut's demo programs, and zxing-cpp's Python and Rust bindings. That
  // they are not build inputs is not taken on trust — the link step below
  // resolves every symbol or this script fails.
  const exclusions =
    process.platform === 'win32'
      ? archiveSymlinks(versionDirectory, archiveName).flatMap((path) => ['--exclude', path])
      : [];

  if (exclusions.length > 0) {
    process.stderr.write(`  extracting (skipping ${exclusions.length / 2} symlinks Windows cannot create)\n`);
  } else {
    process.stderr.write(`  extracting\n`);
  }
  extract(versionDirectory, archiveName, exclusions);

  if (!existsSync(join(source, 'include', 'mupdf', 'fitz.h'))) {
    const entries = await readdir(versionDirectory).catch(() => []);
    throw new Error(
      `Extracted ${archiveName} but ${source} does not look like a MuPDF tree. ` +
        `${versionDirectory} contains: ${entries.join(', ')}`,
    );
  }
  return source;
}

/**
 * @param {string} root
 * @param {boolean} force
 */
async function buildMupdf(root, force) {
  if (!force && (await fileExists(mupdfStaticLibrary(root)))) {
    process.stderr.write(`  libmupdf.lib already built\n`);
    return;
  }

  build({
    project: join(mupdfSourcePath(root), 'platform', 'win32', 'mupdf.sln'),
    target: 'libmupdf',
    properties: [
      'Configuration=Release',
      'Platform=x64',
      // MuPDF's solution pins v142 (VS2019); without this every project fails
      // with MSB8020 under a VS2022-only install.
      'PlatformToolset=v143',
    ],
    label: `MuPDF ${MUPDF_VERSION} static libraries (several minutes)`,
  });

  if (!(await fileExists(mupdfStaticLibrary(root)))) {
    throw new Error(
      `MSBuild reported success but ${mupdfStaticLibrary(root)} does not exist. ` +
        `Treating a missing artefact as a build failure rather than continuing.`,
    );
  }
}

/** @param {string} root */
async function buildShim(root) {
  const project = join(root, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');

  build({
    project,
    properties: [
      'Configuration=Release',
      'Platform=x64',
      `MupdfRoot=${mupdfSourcePath(root)}`,
    ],
    label: 'monstera_mupdf shim',
  });

  const dll = shimLibraryPath(root);
  if (!(await fileExists(dll))) {
    throw new Error(`MSBuild reported success but ${dll} does not exist.`);
  }
  return dll;
}

/**
 * Confirms the built DLL actually exports the surface the shim claims, rather
 * than trusting that a linker exit code means a usable library. A DLL that
 * links but exports nothing is exactly the green check this project bans.
 *
 * Exported so the proof can drive it against a deliberately stale DLL: the
 * failure this is worth having is a build that quietly did not happen, and a
 * check nobody can point at a known-bad input is a check nobody has tested.
 *
 * @param {string} root
 * @param {string} dll
 */
export async function verifyExports(root, dll) {
  const source = join(root, 'native', 'mupdf-shim', 'monstera_mupdf.c');
  const declared = new Set();
  const text = await import('node:fs/promises').then((fs) => fs.readFile(source, 'utf8'));
  for (const match of text.matchAll(/^MZ_EXPORT\s+[\w *]+?\**\s*(mz_\w+)\s*\(/gm)) {
    const name = match[1];
    if (name !== undefined) declared.add(name);
  }

  const tool = dumpbin();
  /** @type {Set<string>} */
  const exported = new Set();
  if (tool !== null) {
    const probe = spawnSync(tool.command, ['/exports', dll], {
      encoding: 'utf8',
      env: tool.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (probe.error === undefined && probe.status === 0) {
      for (const match of `${probe.stdout}`.matchAll(/\b(mz_\w+)\b/g)) {
        const name = match[1];
        if (name !== undefined) exported.add(name);
      }
    }
  }

  const size = (await stat(dll)).size;
  process.stderr.write(
    `\n  ${dll}\n    ${(size / 1e6).toFixed(1)} MB, ${declared.size} MZ_EXPORT symbols in source`,
  );

  if (declared.size === 0) {
    throw new Error(
      `Parsed zero MZ_EXPORT declarations out of ${source}. The check would pass vacuously, ` +
        `so it fails instead — the regex and the source have diverged.`,
    );
  }

  if (exported.size === 0) {
    // Reported, never assumed: a surface nobody inspected must not read as one
    // that was inspected and found correct.
    process.stderr.write(`\n    export table NOT checked (dumpbin unavailable)\n`);
    return { declared: declared.size, verified: false };
  }

  const missing = [...declared].filter((name) => !exported.has(name));
  if (missing.length > 0) {
    throw new Error(
      `The DLL is missing ${missing.length} symbol(s) the source declares MZ_EXPORT: ` +
        `${missing.join(', ')}`,
    );
  }
  process.stderr.write(`\n    all ${declared.size} exports present in the DLL\n`);
  return { declared: declared.size, verified: true };
}

async function main() {
  const force = process.argv.includes('--force');
  const checkOnly = process.argv.includes('--check');
  const root = repoRoot();

  if (process.platform !== 'win32') {
    process.stderr.write(
      `\nmupdf.mjs builds through MuPDF's MSVC solution and is Windows-only today.\n` +
        `Other platforms need MuPDF's Makefile; that is not yet written (ADR-0010).\n`,
    );
    return 0;
  }

  if (checkOnly) {
    const dll = shimLibraryPath(root);
    const present = await fileExists(dll);
    process.stderr.write(`${present ? 'present' : 'MISSING'}  ${dll}\n`);
    return present ? 0 : 1;
  }

  process.stderr.write(`\nProvisioning MuPDF ${MUPDF_VERSION} and the native shim\n`);

  await fetchSource(root, force);
  if (!process.argv.includes('--skip-mupdf')) await buildMupdf(root, force);
  const dll = await buildShim(root);
  await verifyExports(root, dll);

  // Record what this DLL was built from, AFTER it linked and passed its export
  // check. Every script that loads it then asserts the source has not moved
  // since — see scripts/lib/shimBinary.mjs for why a measurement through a
  // stale DLL is worse than no measurement.
  recordShimBuild({ root, version: MUPDF_VERSION });

  process.stderr.write(`\nDone.\n`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().then(
    (status) => process.exit(status),
    (error) => {
      process.stderr.write(`\nProvisioning failed:\n${error instanceof Error ? error.stack : String(error)}\n\n`);
      process.exit(1);
    },
  );
}
