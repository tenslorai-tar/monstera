// @ts-check
/**
 * What provisioning a program from conda-forge's win-64 channel means here — the one
 * spelling, taken by `poppler.mjs` (ADR-0071) and `ghostscript.mjs` (ADR-0075).
 *
 * A `.conda` is a zip holding two zstd-compressed tars; Windows' own bsdtar reads both
 * (`extract.mjs`). conda-forge publishes a SHA-256 for each package and no signature, so
 * the digest is the whole verification of the package itself.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { extract } from '../lib/extract.mjs';
import { downloadVerified } from '../lib/fetchVerified.mjs';
import { normaliseEndings } from '../release/generateNotice.mjs';

export const CONDA_HOST = 'conda.anaconda.org';
export const CONDA_CHANNEL = `https://${CONDA_HOST}/conda-forge/win-64`;

/**
 * @typedef {{
 *   name: string,
 *   version: string,
 *   file: string,
 *   sha256: string,
 *   bytes: number,
 *   binaries: string[],
 *   licences: string[],
 * }} CondaPackage
 *   `binaries` are file names under the package's `Library/bin`; `licences` are paths
 *   under its `info/licenses`, compared with the committed copies.
 */

/**
 * The MSVC runtime both programs load, pinned once. `sha256` and `bytes` are the
 * channel's, from `micromamba` 2.9.0's solve on 2026-09-16.
 *
 * @type {CondaPackage}
 */
export const VC14_RUNTIME = {
  name: 'vc14_runtime',
  version: '14.51.36247',
  file: 'vc14_runtime-14.51.36247-habf1de7_41.conda',
  sha256: '4e4cb599cdc41bf2109d1464c127b5bcbddf548ce3e322e612afb691338b48f8',
  bytes: 767955,
  binaries: ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'],
  licences: ['LICENSE.TXT'],
};

/**
 * The file in `directory` whose name matches `name` ignoring case, or null.
 * Windows resolves DLL names without case; the packages spell some upper-case.
 *
 * @param {string} directory
 * @param {string} name
 */
export async function entryIgnoringCase(directory, name) {
  const found = (await readdir(directory)).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return found === undefined ? null : join(directory, found);
}

/**
 * The committed copy's file name for a licence file named `name`.
 *
 * The runtime scan over `scripts/` classifies files by a lower-case extension and
 * refuses any it does not know (`plainNodeScope.mjs`), so `LICENSE` and `COPYING` are
 * committed as `LICENSE.txt` and `COPYING.txt`, and `.TXT` as `.txt`.
 *
 * @param {string} name
 */
export function committedLicenceName(name) {
  if (/\.(txt|md)$/u.test(name)) return name;
  if (/\.txt$/iu.test(name)) return `${name.slice(0, -4)}.txt`;
  return `${name}.txt`;
}

/**
 * Throws unless `actual` holds the committed copy's text, line endings aside.
 *
 * @param {string} licenceRoot the program's committed licence directory
 * @param {string} actual
 * @param {string} into the committed copy's path under `licenceRoot`
 */
export async function sameAsCommitted(licenceRoot, actual, into) {
  const committed = join(licenceRoot, into);
  if (!existsSync(committed)) {
    throw new Error(`the notice has no committed copy of ${into}; it would render a component without its terms`);
  }
  // LINE ENDINGS ARE NOT TERMS. Git normalises a committed text's endings, so the
  // checkout and the package can differ in nothing but CR bytes — the MSVC runtime's
  // text ships CRLF. Compared through the notice's own normaliser, the one rule for
  // what the rendered text is (B3a); every other byte must match.
  const [left, right] = await Promise.all([readFile(actual, 'utf8'), readFile(committed, 'utf8')]);
  if (normaliseEndings(left) !== normaliseEndings(right)) {
    throw new Error(
      `${into} differs from the text the pinned build carries. The committed copy is what NOTICE renders, ` +
        `so it must be the build's own — read the new text before replacing it.`,
    );
  }
}

/**
 * Fetches one pinned package into `unpack`, verified before it is opened, copies its
 * binaries into `bin`, and compares each licence it carries with the committed copy.
 *
 * @param {CondaPackage} pkg
 * @param {{ unpack: string, bin: string, licenceRoot: string }} into
 */
export async function installCondaPackage(pkg, into) {
  await mkdir(into.unpack, { recursive: true });
  await downloadVerified({
    url: `${CONDA_CHANNEL}/${pkg.file}`,
    allowedHosts: [CONDA_HOST],
    sha256: pkg.sha256,
    maxBytes: pkg.bytes + 1024 * 1024,
    destination: join(into.unpack, pkg.file),
  });
  // The zip, then its two tars — each named by file, which is `extract`'s contract.
  extract(into.unpack, pkg.file);
  const stem = pkg.file.replace(/\.conda$/u, '');
  extract(into.unpack, `pkg-${stem}.tar.zst`);
  extract(into.unpack, `info-${stem}.tar.zst`);

  for (const binary of pkg.binaries) {
    const found = await entryIgnoringCase(join(into.unpack, 'Library', 'bin'), binary);
    if (found === null) throw new Error(`${pkg.file} has no Library/bin/${binary}`);
    await copyFile(found, join(into.bin, binary));
  }
  for (const licence of pkg.licences) {
    await sameAsCommitted(
      into.licenceRoot,
      join(into.unpack, 'info', 'licenses', licence),
      `${pkg.name}/${committedLicenceName(licence)}`,
    );
  }
}
