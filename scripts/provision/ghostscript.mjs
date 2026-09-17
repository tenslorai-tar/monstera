// @ts-check
/**
 * Provisions Ghostscript's `gswin64c.exe` for D10's PDF/A-2b export (ADR-0075).
 *
 * ## What is provisioned
 *
 * The five files `gswin64c.exe` loads — itself, `gsdll64.dll` and the MSVC runtime —
 * read with `dumpbin /dependents` on 2026-09-17. Ghostscript's initialisation files,
 * fonts and ICC profiles are compiled into the DLL's ROM, so nothing else is needed and
 * nothing else ships.
 *
 * ## The guarantees, in the order they apply
 *
 * - The two packages are pinned conda-forge builds, fetched through
 *   `condaForge.mjs` with their SHA-256 checked before anything opens them.
 *   conda-forge publishes no signature for a package.
 * - Ghostscript statically links thirteen libraries whose terms the package does not
 *   carry. They are read from Artifex's source release — the tarball the feedstock
 *   builds from, pinned by the SHA-256 the recipe itself pins — and compared with the
 *   committed copies under `scripts/release/licences/ghostscript/`. Artifex publishes
 *   `SHA512SUMS` for the release and no signature, so the pinned digest is its whole
 *   verification.
 * - IJS has no licence file: its MIT terms are the banner opening `ijs/ijs.h`, which is
 *   compared up to the line that closes it.
 *
 * Usage:
 *   node scripts/provision/ghostscript.mjs [--force] [--check]
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { formatError } from '../lib/reportError.mjs';
import { VC14_RUNTIME, installCondaPackage, sameAsCommitted } from './condaForge.mjs';

/** The conda-forge build ADR-0075 names; the newest Ghostscript on the channel, read 2026-09-17. */
export const GHOSTSCRIPT_VERSION = '10.08.0';

/** @type {readonly import('./condaForge.mjs').CondaPackage[]} */
export const GHOSTSCRIPT_PACKAGES = [
  {
    name: 'ghostscript',
    version: '10.08.0',
    file: 'ghostscript-10.08.0-hac47afa_0.conda',
    sha256: '512be9413c58b0ad3a2cd95a63eaea73cbe32d9a6b9170c848bf825694a4adb0',
    bytes: 19295904,
    binaries: ['gswin64c.exe', 'gsdll64.dll'],
    licences: ['LICENSE'],
  },
  VC14_RUNTIME,
];

/** The source release: where the bundled libraries' terms are read, and what the notice's offer of source names. */
export const GHOSTSCRIPT_SOURCE = {
  url: `https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10080/ghostscript-${GHOSTSCRIPT_VERSION}.tar.gz`,
  sha256: 'caf199e3f233f1290b27d0972d636f66c303355f2353309b7bfddf1edda06b3d',
  bytes: 90851112,
};

/** Each licence text read from the source release: the member, and the committed copy it must equal. */
const SOURCE_TEXTS = [
  { member: 'doc/COPYING', into: 'ghostscript/COPYING.txt' },
  { member: 'freetype/LICENSE.TXT', into: 'freetype/LICENSE.txt' },
  { member: 'freetype/docs/FTL.TXT', into: 'freetype/FTL.txt' },
  { member: 'zlib/LICENSE', into: 'zlib/LICENSE.txt' },
  { member: 'jpeg/README', into: 'jpeg/README.txt' },
  { member: 'libpng/LICENSE', into: 'libpng/LICENSE.txt' },
  { member: 'openjpeg/LICENSE', into: 'openjpeg/LICENSE.txt' },
  { member: 'lcms2mt/COPYING', into: 'lcms2mt/COPYING.txt' },
  { member: 'jbig2dec/LICENSE', into: 'jbig2dec/LICENSE.txt' },
  { member: 'jbig2dec/COPYING', into: 'jbig2dec/COPYING.txt' },
  { member: 'tiff/LICENSE.md', into: 'tiff/LICENSE.md' },
  { member: 'tesseract/LICENSE', into: 'tesseract/LICENSE.txt' },
  { member: 'leptonica/leptonica-license.txt', into: 'leptonica/leptonica-license.txt' },
  { member: 'extract/COPYING', into: 'extract/COPYING.txt' },
  { member: 'brotli/LICENSE', into: 'brotli/LICENSE.txt' },
];

/** @param {string} root */
export function ghostscriptRoot(root) {
  return toolPath(root, 'ghostscript', GHOSTSCRIPT_VERSION);
}

/** @param {string} root */
export function gswin64cPath(root) {
  return join(ghostscriptRoot(root), 'bin', 'gswin64c.exe');
}

/** @param {string} root */
export function ghostscriptLicenceRoot(root) {
  return join(root, 'scripts', 'release', 'licences', 'ghostscript');
}

/**
 * `ijs/ijs.h`'s opening comment, through the line that closes it — IJS's terms.
 *
 * @param {string} header
 */
export function ijsBanner(header) {
  const lines = header.replaceAll('\r', '').split('\n');
  const end = lines.findIndex((line) => line === '**/');
  if (end < 0) throw new Error('ijs/ijs.h no longer opens with the banner that carries its terms');
  return `${lines.slice(0, end + 1).join('\n')}\n`;
}

/**
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, executable: string }>}
 */
export async function provisionGhostscript({ root, force = false }) {
  const executable = gswin64cPath(root);
  if (!force && (await fileExists(executable))) return { provisioned: false, executable };

  const versionDirectory = ghostscriptRoot(root);
  const staging = `${versionDirectory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  const bin = join(staging, 'bin');
  await mkdir(bin, { recursive: true });
  const licenceRoot = ghostscriptLicenceRoot(root);

  try {
    process.stderr.write(`Provisioning Ghostscript ${GHOSTSCRIPT_VERSION} (conda-forge, ${String(GHOSTSCRIPT_PACKAGES.length)} packages)…\n`);
    for (const pkg of GHOSTSCRIPT_PACKAGES) {
      await installCondaPackage(pkg, { unpack: join(staging, 'unpack', pkg.name), bin, licenceRoot });
    }

    const sourceDirectory = join(staging, 'source');
    const tarball = `ghostscript-${GHOSTSCRIPT_VERSION}.tar.gz`;
    await downloadVerified({
      url: GHOSTSCRIPT_SOURCE.url,
      allowedHosts: ['github.com', 'release-assets.githubusercontent.com'],
      sha256: GHOSTSCRIPT_SOURCE.sha256,
      maxBytes: GHOSTSCRIPT_SOURCE.bytes + 1024 * 1024,
      destination: join(sourceDirectory, tarball),
    });
    const prefix = `ghostscript-${GHOSTSCRIPT_VERSION}`;
    extract(sourceDirectory, tarball, [...SOURCE_TEXTS.map((text) => `${prefix}/${text.member}`), `${prefix}/ijs/ijs.h`]);
    for (const text of SOURCE_TEXTS) {
      await sameAsCommitted(licenceRoot, join(sourceDirectory, prefix, text.member), text.into);
    }
    const banner = join(sourceDirectory, 'ijs-banner.txt');
    await writeFile(banner, ijsBanner(await readFile(join(sourceDirectory, prefix, 'ijs', 'ijs.h'), 'utf8')));
    await sameAsCommitted(licenceRoot, banner, 'ijs/ijs-banner.txt');

    await rm(join(staging, 'unpack'), { recursive: true, force: true });
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(versionDirectory, { recursive: true, force: true });
    await mkdir(dirname(versionDirectory), { recursive: true });
    await rename(staging, versionDirectory);
    return { provisioned: true, executable };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  if (process.argv.includes('--check')) {
    const executable = gswin64cPath(root);
    process.stdout.write(
      existsSync(executable)
        ? `Ghostscript ${GHOSTSCRIPT_VERSION} present at ${executable}\n`
        : `Ghostscript ${GHOSTSCRIPT_VERSION} is NOT provisioned. Run: npm run provision:ghostscript\n`,
    );
    process.exit(existsSync(executable) ? 0 : 1);
  }

  try {
    const result = await provisionGhostscript({ root, force: process.argv.includes('--force') });
    process.stdout.write(
      result.provisioned
        ? `Ghostscript ${GHOSTSCRIPT_VERSION} provisioned at ${result.executable}\n`
        : `Ghostscript ${GHOSTSCRIPT_VERSION} already present at ${result.executable}\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
