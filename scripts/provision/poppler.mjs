// @ts-check
/**
 * Provisions Poppler's `pdftotext` for D10's layout-preserving text (ADR-0071).
 *
 * ## What is provisioned, and what is not
 *
 * The twenty-two files `pdftotext.exe` loads, and nothing else: the executable,
 * `poppler.dll`, and the DLLs of the conda-forge packages its imports reach —
 * read with `dumpbin /dependents`, transitively, on 2026-09-16. The packages
 * carry more (GLib, cairo, other Poppler tools); none of it is loaded, so none
 * of it ships, and the licence set in the notice is exactly the set that runs.
 *
 * ## The guarantees, in the order they apply
 *
 * - Every package is a pinned conda-forge build, fetched from one host with its
 *   size bounded, and its SHA-256 checked against the channel's own digest
 *   before anything interprets the bytes. **conda-forge publishes no signature
 *   for a package**, so the digest is the whole verification here, and ADR-0071
 *   says so rather than letting a reader assume more.
 * - Every licence text the notice renders is COMPARED, line endings aside, with the
 *   text inside the package it came from (`info/licenses`) — so the committed
 *   copies under `scripts/release/licences/poppler/` cannot drift from what the
 *   pinned build says in silence. A mismatch stops the provision.
 * - FreeType's package ships no licence text, so its `LICENSE.TXT` and `FTL.TXT`
 *   are fetched from the `VER-2-14-3` tag, each pinned by SHA-256, and compared
 *   the same way.
 * - Poppler's package carries `COPYING` (GPLv2) only, and Poppler is taken under
 *   GPL-3.0. `COPYING3` comes from the source release, whose detached signature
 *   is verified against the pinned key before the tarball is opened.
 *
 * ## The extractor is Windows' own bsdtar
 *
 * A `.conda` is a zip holding two zstd-compressed tars. `extract.mjs` resolves
 * `System32\tar.exe`, which is libarchive and reads both (measured 2026-09-16,
 * `bsdtar 3.8.8 … libzstd/1.5.7`). Poppler is a Windows-only provision, like
 * LibreOffice: the contained launcher that runs it is Win32.
 *
 * Usage:
 *   node scripts/provision/poppler.mjs [--force] [--check]
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { verifyDetached } from '../lib/openpgpVerify.mjs';
import { formatError } from '../lib/reportError.mjs';
import { VC14_RUNTIME, committedLicenceName, installCondaPackage, sameAsCommitted } from './condaForge.mjs';
import { POPPLER_KEY_FINGERPRINT, popplerKeyPath } from './keys/popplerKey.mjs';

/** The conda-forge build ADR-0071 names; the newest Poppler on the channel, read 2026-09-16. */
export const POPPLER_VERSION = '26.09.0';

/**
 * `sha256` and `bytes` are the channel's, from `micromamba` 2.9.0's solve for
 * `poppler=26.09.0=h924501e_0` on win-64, 2026-09-16.
 *
 * @type {readonly import('./condaForge.mjs').CondaPackage[]}
 */
export const POPPLER_PACKAGES = [
  { name: 'poppler', version: '26.09.0', file: 'poppler-26.09.0-h924501e_0.conda', sha256: 'bb319f6881d91e175f90a9d33a25313e4cfddc15dd234521519985baf92fefcd', bytes: 2803695, binaries: ['pdftotext.exe', 'poppler.dll'], licences: ['COPYING'] },
  { name: 'libfreetype6', version: '2.14.3', file: 'libfreetype6-2.14.3-hdbac1cb_2.conda', sha256: 'cbc650854003e434d4ff6c7b1a2667e38a4242ad8a391a1c5ff89721624065ce', bytes: 340385, binaries: ['freetype.dll'], licences: [] },
  { name: 'lcms2', version: '2.19.1', file: 'lcms2-2.19.1-hf2c6c5f_3.conda', sha256: '7c5f96b473b721a4279708b448591dc3d89ed274280ff480dea1b4f9b13e1fcd', bytes: 525499, binaries: ['lcms2.dll'], licences: ['LICENSE'] },
  { name: 'lerc', version: '4.2.0', file: 'lerc-4.2.0-hd936e49_0.conda', sha256: '93d666f63f284ef77b87b0b1f77b70f7d36d315a132f9afa64bc0012d937ba39', bytes: 175297, binaries: ['Lerc.dll'], licences: ['LICENSE'] },
  { name: 'libcurl', version: '8.22.0', file: 'libcurl-8.22.0-hdb0ef4a_0.conda', sha256: '5fe063cffa90ad3ef04e25c76b1a79cdbc4f6c43747164a7dcdd89c4faebb84e', bytes: 413226, binaries: ['libcurl.dll'], licences: ['COPYING'] },
  { name: 'libdeflate', version: '1.25', file: 'libdeflate-1.25-h1a1d4e4_1.conda', sha256: 'af1cda21d4653f594fbef20aa4e1ff158a546902b3307ef8af9a9b44b43862d2', bytes: 157828, binaries: ['deflate.dll'], licences: ['COPYING'] },
  { name: 'libjpeg-turbo', version: '3.2.0', file: 'libjpeg-turbo-3.2.0-hfd05255_1.conda', sha256: 'df78ab4c0eecb3dd9331898f96baeed8e5ca1c363346332517abeb0b614b9a53', bytes: 990125, binaries: ['jpeg8.dll'], licences: ['LICENSE.md'] },
  { name: 'liblzma', version: '5.8.3', file: 'liblzma-5.8.3-hfd05255_1.conda', sha256: 'd36c4a1e1f80fd08e18a407e03622ff2f34dfdd022da6488ad19603dea19e6d5', bytes: 105809, binaries: ['liblzma.dll'], licences: ['COPYING', 'COPYING.0BSD'] },
  { name: 'libpng', version: '1.6.58', file: 'libpng-1.6.58-hdc8cecf_1.conda', sha256: '8c49c32adf3ba2c59783630b82377f54ab72204ea99e2bafc90a47a8e25c1032', bytes: 385462, binaries: ['libpng16.dll'], licences: ['LICENSE'] },
  { name: 'libpsl', version: '0.23.1', file: 'libpsl-0.23.1-h9b16d47_1.conda', sha256: 'e53fe3b09f82b59b644264133d6d148ac31bb5451b7583cff55690bf038f2f62', bytes: 73511, binaries: ['psl-5.dll'], licences: ['LICENSE'] },
  { name: 'libssh2', version: '1.11.1', file: 'libssh2-1.11.1-h734d217_1.conda', sha256: '1097b08429b4f53f5751a32c6d99a083d227ca7f7812c0b239eea124cec073a0', bytes: 295149, binaries: ['libssh2.dll'], licences: ['COPYING'] },
  { name: 'libtiff', version: '4.7.2', file: 'libtiff-4.7.2-h8f73337_1.conda', sha256: '3575a092e3e52625a1767804a4ebd321becaadf61b63dcd6735ebb88c0b3c359', bytes: 1014211, binaries: ['tiff.dll'], licences: ['LICENSE.md'] },
  { name: 'libzlib', version: '1.3.2', file: 'libzlib-1.3.2-hfd05255_3.conda', sha256: '0629c2cc0404d3bb29d6baa7b4ba62da80797015e86de050db81ea5a07050527', bytes: 58529, binaries: ['zlib.dll'], licences: ['LICENSE'] },
  { name: 'openjpeg', version: '2.5.4', file: 'openjpeg-2.5.4-h90fa87c_2.conda', sha256: 'd1c630ccd9ae0898b48d84e986f4c330f66a25e535f99efe8cbf03f042b33da5', bytes: 274994, binaries: ['openjp2.dll'], licences: ['LICENSE'] },
  { name: 'openssl', version: '3.6.4', file: 'openssl-3.6.4-hf411b9b_0.conda', sha256: '9dddb559ba49744d5d94092d8d13cb0567f5c3b3f439f3acf28433d1f4256acc', bytes: 9474879, binaries: ['libcrypto-3-x64.dll'], licences: ['LICENSE.txt'] },
  { name: 'icu', version: '78.3', file: 'icu-78.3-h5112557_2.conda', sha256: '75c549b55b673e15de8785a8e5dd85bca7eb612eee0ff4dc8d7bdaa15eacbdbb', bytes: 16835644, binaries: ['icuuc78.dll', 'icudt78.dll'], licences: ['LICENSE'] },
  { name: 'zstd', version: '1.5.7', file: 'zstd-1.5.7-h534d264_7.conda', sha256: 'ca7daae4f218a11fab82cc2857f0ea518ec3f46acec60490485347a4c22c6b3e', bytes: 387535, binaries: ['zstd.dll'], licences: ['LICENSE'] },
  VC14_RUNTIME,
];

/**
 * Licence texts that do not come from a package's `info/licenses`, each pinned.
 * `into` is the committed copy's path under {@link popplerLicenceRoot}.
 */
const FREETYPE_TEXTS = [
  { url: 'https://gitlab.freedesktop.org/freetype/freetype/-/raw/VER-2-14-3/LICENSE.TXT', sha256: 'bd36c8b474855fa294c2ec5c184544478ef3720aad37d65a6296a4f264fd2d3b', into: 'libfreetype6/LICENSE.txt' },
  { url: 'https://gitlab.freedesktop.org/freetype/freetype/-/raw/VER-2-14-3/docs/FTL.TXT', sha256: '5a5ee54c5001bbad1cdc1a57cc3dd4c42199b2da09d39c7ee41fab002d02967f', into: 'libfreetype6/FTL.txt' },
];

/** The source release: where `COPYING3` is read, and what the notice's offer of source names. */
export const POPPLER_SOURCE = {
  url: `https://poppler.freedesktop.org/poppler-${POPPLER_VERSION}.tar.xz`,
  sha256: '8059eadb6805340768f138c465b57f8164c92b4a0773c37ef031ea6c0d987b2e',
  bytes: 2041828,
  /** The detached signature's own digest, read 2026-09-16, so a swapped one never reaches the verifier. */
  signatureSha256: 'eb030aa6dc372a5e30685ae18519f29c85b39c85827cd6ed959f757e82ce2230',
};

/** @param {string} root */
export function popplerRoot(root) {
  return toolPath(root, 'poppler', POPPLER_VERSION);
}

/** @param {string} root */
export function pdftotextPath(root) {
  return join(popplerRoot(root), 'bin', 'pdftotext.exe');
}

/** @param {string} root */
export function popplerLicenceRoot(root) {
  return join(root, 'scripts', 'release', 'licences', 'poppler');
}

/**
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, executable: string }>}
 */
export async function provisionPoppler({ root, force = false }) {
  const executable = pdftotextPath(root);
  if (!force && (await fileExists(executable))) return { provisioned: false, executable };

  const versionDirectory = popplerRoot(root);
  const staging = `${versionDirectory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  const bin = join(staging, 'bin');
  await mkdir(bin, { recursive: true });

  try {
    process.stderr.write(`Provisioning Poppler ${POPPLER_VERSION} (conda-forge, ${String(POPPLER_PACKAGES.length)} packages)…\n`);
    for (const pkg of POPPLER_PACKAGES) {
      await installCondaPackage(pkg, {
        unpack: join(staging, 'unpack', pkg.name),
        bin,
        licenceRoot: popplerLicenceRoot(root),
      });
    }

    for (const text of FREETYPE_TEXTS) {
      const destination = join(staging, 'texts', text.into);
      await downloadVerified({
        url: text.url,
        allowedHosts: ['gitlab.freedesktop.org'],
        sha256: text.sha256,
        maxBytes: 64 * 1024,
        destination,
      });
      await sameAsCommitted(popplerLicenceRoot(root), destination, text.into);
    }

    const sourceDirectory = join(staging, 'source');
    const tarball = join(sourceDirectory, `poppler-${POPPLER_VERSION}.tar.xz`);
    await downloadVerified({
      url: POPPLER_SOURCE.url,
      allowedHosts: ['poppler.freedesktop.org'],
      sha256: POPPLER_SOURCE.sha256,
      maxBytes: POPPLER_SOURCE.bytes + 1024 * 1024,
      destination: tarball,
    });
    const signature = join(sourceDirectory, `poppler-${POPPLER_VERSION}.tar.xz.sig`);
    await downloadVerified({
      url: `${POPPLER_SOURCE.url}.sig`,
      allowedHosts: ['poppler.freedesktop.org'],
      sha256: POPPLER_SOURCE.signatureSha256,
      maxBytes: 16 * 1024,
      destination: signature,
    });
    await verifyDetached({
      file: tarball,
      signature: await readFile(signature, 'utf8'),
      publicKey: await readFile(popplerKeyPath(), 'utf8'),
      fingerprint: POPPLER_KEY_FINGERPRINT,
    });
    const member = `poppler-${POPPLER_VERSION}/COPYING3`;
    extract(sourceDirectory, `poppler-${POPPLER_VERSION}.tar.xz`, [member]);
    await sameAsCommitted(popplerLicenceRoot(root), join(sourceDirectory, member), `poppler/${committedLicenceName('COPYING3')}`);

    await rm(join(staging, 'unpack'), { recursive: true, force: true });
    await rm(join(staging, 'texts'), { recursive: true, force: true });
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
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');

  if (check) {
    const executable = pdftotextPath(root);
    process.stdout.write(
      existsSync(executable)
        ? `Poppler ${POPPLER_VERSION} present at ${executable}\n`
        : `Poppler ${POPPLER_VERSION} is NOT provisioned. Run: npm run provision:poppler\n`,
    );
    process.exit(existsSync(executable) ? 0 : 1);
  }

  try {
    const result = await provisionPoppler({ root, force });
    process.stdout.write(
      result.provisioned
        ? `Poppler ${POPPLER_VERSION} provisioned at ${result.executable}\n`
        : `Poppler ${POPPLER_VERSION} already present at ${result.executable}\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
