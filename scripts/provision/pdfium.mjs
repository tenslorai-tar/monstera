// @ts-check
/**
 * Provisions `pdfium.dll` — Stage 5's substrate, and the second native engine.
 *
 * `docs/ARCHITECTURE.md`:923 names it a **downloaded prebuilt binary**, unlike
 * MuPDF, which this project builds from source because its headers carry no
 * `dllexport` and the shim owns the export surface. PDFium's release builds
 * export the `FPDF_*` C API directly, so there is nothing for a shim to do and
 * nothing to link statically against.
 *
 * ## THE NON-V8 BUILD, and it is a security decision rather than a size one
 *
 * `bblanchon/pdfium-binaries` publishes two Windows x64 archives per release:
 * `pdfium-win-x64.tgz` (3.8 MB) and `pdfium-v8-win-x64.tgz` (12.7 MB). The
 * second links **V8** — a JavaScript engine — into the process that parses
 * documents.
 *
 * Invariant 24 says opening a document runs none of its content, and this
 * project has already paid to establish that for MuPDF: `proof:activecontent`
 * scans the shipped shim and finds MuJS's registration strings **absent**, with
 * two controls. Taking the V8 build would put an interpreter back, in a second
 * engine, and leave invariant 24 resting on a call graph again.
 *
 * Measured 2026-09-08 on the archive this file pins
 * (`scripts/research/pdfiumBinary.mjs`), with the scan pointed at three symbols
 * the DLL certainly exports before its silence meant anything:
 *
 * | marker | occurrences |
 * |---|---|
 * | `FPDF_LoadMemDocument`, `FPDF_RenderPageBitmap`, `FPDFBitmap_Create` | 2, 4, 2 — the scan can see |
 * | `v8::`, `V8_Fatal`, `Torque`, `IsolateData` | **0** |
 * | `CJS_Runtime`, `CJS_Object` | **0** |
 *
 * So no interpreter is linked, and PDFium's own JavaScript layer is absent
 * rather than merely unreachable. `FPDFDoc_GetJavaScriptActionCount` and
 * `FPDF_LoadXFA` appear once each — they are export-table NAMES, and their
 * bodies in a non-V8 build do nothing.
 *
 * ## Pinned, host-locked, size-bounded, digest-checked
 *
 * Through `downloadVerified`, which is the one download primitive (Part C8) and
 * carries all four guarantees. The redirect matters here as much as it does for
 * gitleaks: `github.com` issues the release URL and always redirects to
 * `release-assets.githubusercontent.com`, so a first-hop-only host check would
 * leave the hop that delivers the bytes unchecked.
 *
 * ## Windows x64 is what ships; Linux x64 is pinned for development and tests only
 *
 * Distribution is the Microsoft Store (ADR-0018), and the engine hosts are
 * Windows processes created with an AppContainer SID, so `pdfium-win-x64.tgz` is
 * the shipped engine and the only one packaging reads (`SHIPPED_PLATFORM`).
 *
 * The same release's `pdfium-linux-x64.tgz` is pinned beside it, by the owner's
 * decision of 2026-10-05, because a PDFium measurement taken on Linux from a
 * library nothing pinned is a reading of an unknown binary. Its `VERSION` reads
 * the same 155.0.8044.0 and its fourteen licence texts are byte-for-byte the
 * Windows archive's (compared 2026-10-05), so the notice's committed copies serve
 * both. Packaging takes `pdfiumLibrary(root, SHIPPED_PLATFORM)` and never the
 * running platform's, so a Linux tree cannot reach a package by being the one on
 * the machine.
 *
 * Usage:
 *   node scripts/provision/pdfium.mjs [--force] [--check]
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { treeProblems, verifyPinnedTree } from '../lib/pinnedTree.mjs';
import { formatError } from '../lib/reportError.mjs';
import { committedLicenceName, sameAsCommitted } from './condaForge.mjs';
import { isMain } from '../lib/isMain.mjs';

/**
 * The pinned release.
 *
 * `chromium/8044`, published 2026-09-07, read from
 * `api.github.com/repos/bblanchon/pdfium-binaries/releases/latest` on
 * 2026-09-08 — researched rather than recalled, which this project has lost on
 * before. The archive's `VERSION` reads `MAJOR=155 MINOR=0 BUILD=8044 PATCH=0`.
 */
export const PDFIUM_RELEASE = 'chromium/8044';

/** What the archive's own `VERSION` file says, so a bump that lies is visible. */
export const PDFIUM_VERSION = '155.0.8044.0';

/** The one platform whose library is packaged. */
export const SHIPPED_PLATFORM = 'win32';

/**
 * @typedef {object} PdfiumPlatform
 * @property {string} asset the release asset
 * @property {string} sha256 the archive's digest, read from the download
 * @property {number} maxBytes a ceiling on the download, counted rather than believed
 * @property {string} folder the archive folder that holds the library
 * @property {string} library the library's file name inside `folder`
 * @property {Record<string, string>} pins every file in `folder`, and its digest
 */

/**
 * The pinned archive per platform.
 *
 * Windows: 3,818,370 bytes; the `bin/` pins read 2026-09-27 from a tree this script had just extracted from it
 * (`pinsOf`, after a `force` run), never from one found on disk. Linux: 3,739,655 bytes, digest and `lib/` pin read
 * 2026-10-05 from the archive downloaded from the release and the tree extracted from it. Four megabytes leaves room
 * for a patch release without leaving room for a different artefact — the digest is what decides, so the bound stops a
 * hostile response before it is hashed rather than identifying the file.
 *
 * @type {Readonly<Record<'win32' | 'linux', PdfiumPlatform>>}
 */
export const PDFIUM_PLATFORMS = {
  win32: {
    asset: 'pdfium-win-x64.tgz',
    sha256: '78a17d9a5f14467631c26a3ac8741b27a0471ecc05bd6a119b523598160a0537',
    maxBytes: 4 * 1024 * 1024,
    folder: 'bin',
    library: 'pdfium.dll',
    pins: { 'pdfium.dll': '04100c03e41cac1f979e36e5e26fb860bcb5a7461f53830d3c098716624a27a9' },
  },
  linux: {
    asset: 'pdfium-linux-x64.tgz',
    sha256: 'eb142f416aed3a72fc5a02dbd5884868a16cb99dc0cf53e6bdd64afbf67b05f4',
    maxBytes: 4 * 1024 * 1024,
    folder: 'lib',
    library: 'libpdfium.so',
    pins: { 'libpdfium.so': 'b0361f8ba0bc6ffeb2325949a88f08b09356f46abe257ffdf846202999daa27b' },
  },
};

/** The shipped asset, kept by its old names for the manifest and the notice. */
export const PDFIUM_ASSET = PDFIUM_PLATFORMS[SHIPPED_PLATFORM].asset;

/** Every file the application loads, and its digest: the shipped platform's pins. */
export const PDFIUM_BIN = PDFIUM_PLATFORMS[SHIPPED_PLATFORM].pins;

/**
 * The pinned archive for a platform, or a refusal that names it — never another platform's archive, which would
 * download a library this machine cannot load and report it provisioned.
 *
 * @param {string} platform a `process.platform` value
 * @returns {PdfiumPlatform}
 */
export function pdfiumPlatform(platform) {
  if (platform === 'win32' || platform === 'linux') return PDFIUM_PLATFORMS[platform];
  throw new Error(`PDFium ${PDFIUM_VERSION} is pinned for Windows x64 (shipped) and Linux x64 (development); not for ${platform}`);
}

/**
 * github.com issues the release URL; it always redirects to the signed asset
 * host. Both hops are checked — `gitleaks.mjs`' list and its reason.
 */
const ALLOWED_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/**
 * Where the provisioned tree lives. `.gitignore` covers `.tools/` entirely.
 *
 * @param {string} root the repository root
 * @returns {string}
 */
export function pdfiumRoot(root) {
  return toolPath(root, 'pdfium', PDFIUM_VERSION);
}

/**
 * Where NOTICE's copies of the archive's licence texts are committed.
 *
 * @param {string} root the repository root
 * @returns {string}
 */
export function pdfiumLicenceRoot(root) {
  return join(root, 'scripts', 'release', 'licences', 'pdfium');
}

/**
 * Every licence text the pinned archive carries, by its path in the archive: the
 * binaries' own terms and `licenses/`, one file per library compiled in. Read from
 * the archive 2026-09-17; the provisioner refuses an archive whose `licenses/`
 * holds a file this list does not name, so a library a bump adds cannot reach the
 * application with no terms in the notice.
 */
export const PDFIUM_LICENCE_TEXTS = [
  'LICENSE',
  ...[
    'abseil.txt',
    'agg23.txt',
    'fast_float.txt',
    'freetype.txt',
    'icu.txt',
    'lcms.txt',
    'libjpeg_turbo.ijg',
    'libjpeg_turbo.md',
    'libopenjpeg.txt',
    'libpng.txt',
    'llvm-libc.txt',
    'pdfium.txt',
    'simdutf.txt',
    'zlib.txt',
  ].map((file) => `licenses/${file}`),
];

/**
 * Throws unless the extracted archive's licence texts are exactly the declared set,
 * each equal to its committed copy.
 *
 * @param {string} extracted the directory the archive was extracted into
 * @param {string} root the repository root
 * @param {string} asset the archive it came from, for the message
 */
async function compareLicences(extracted, root, asset) {
  const shipped = (await readdir(join(extracted, 'licenses'))).map((file) => `licenses/${file}`);
  const undeclared = shipped.filter((path) => !PDFIUM_LICENCE_TEXTS.includes(path));
  if (undeclared.length > 0) {
    throw new Error(
      `${asset} carries licence texts NOTICE does not render: ${undeclared.join(', ')}. ` +
        `Read them, commit them under scripts/release/licences/pdfium and declare them.`,
    );
  }
  for (const path of PDFIUM_LICENCE_TEXTS) {
    await sameAsCommitted(pdfiumLicenceRoot(root), join(extracted, path), committedLicenceName(path));
  }
}

/**
 * The library a consumer on `platform` loads: this machine's by default, and the shipped one when packaging asks for
 * `SHIPPED_PLATFORM`.
 *
 * @param {string} root the repository root
 * @param {string} [platform] a `process.platform` value
 * @returns {string}
 */
export function pdfiumLibrary(root, platform = process.platform) {
  const pinned = pdfiumPlatform(platform);
  return join(pdfiumRoot(root), pinned.folder, pinned.library);
}

/**
 * The variable that tells a process running `apps/desktop`'s code where PDFium is (ADR-0122's
 * `MONSTERA_PDFIUM_LIBRARY`), or nothing where it is not provisioned — ONE spelling for every process that starts the
 * shell or its PDFium host, as `shimEnvironment` is for the MuPDF shim.
 *
 * @param {string} root the repository root
 * @returns {Record<string, string>}
 */
export function pdfiumEnvironment(root) {
  const library = pdfiumLibrary(root);
  return existsSync(library) ? { MONSTERA_PDFIUM_LIBRARY: library } : {};
}

/**
 * Provisions the library, or reports that it is already there.
 *
 * @param {{ root: string, force?: boolean, platform?: string }} options
 * @returns {Promise<{ provisioned: boolean, library: string }>}
 */
export async function provisionPdfium({ root, force = false, platform = process.platform }) {
  const pinned = pdfiumPlatform(platform);
  const library = pdfiumLibrary(root, platform);
  if (!force && (await fileExists(library))) {
    // PRESENT IS NOT PINNED: the tree is checked against the file pins on every run, cache hit or not
    // (`pinnedTree.mjs`), and a tree that is not exactly the pinned one is removed and the run fails.
    await verifyPinnedTree({
      directory: join(pdfiumRoot(root), pinned.folder),
      pins: pinned.pins,
      context: `PDFium ${PDFIUM_VERSION} (${pinned.asset})`,
    });
    return { provisioned: false, library };
  }

  const versionDirectory = pdfiumRoot(root);
  // STAGED AND PUBLISHED BY RENAME, `gitleaks.mjs`' shape and its reason: two
  // processes can provision at once — a CI step, a hook and a proof — and
  // clear-then-extract lets one delete the directory the other is mid-extraction
  // into, leaving a half-populated tree that `fileExists` is happy with.
  const staging = `${versionDirectory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    const archive = join(staging, pinned.asset);
    process.stderr.write(`Provisioning PDFium ${PDFIUM_VERSION} (${PDFIUM_RELEASE}, ${pinned.asset})…\n`);

    await downloadVerified({
      url: `https://github.com/bblanchon/pdfium-binaries/releases/download/${PDFIUM_RELEASE}/${pinned.asset}`,
      allowedHosts: ALLOWED_HOSTS,
      sha256: pinned.sha256,
      maxBytes: pinned.maxBytes,
      destination: archive,
    });

    extract(staging, pinned.asset);
    await rm(archive, { force: true });
    await compareLicences(staging, root, pinned.asset);

    const staged = join(staging, pinned.folder, pinned.library);
    if (!(await fileExists(staged))) {
      throw new Error(`${pinned.asset} did not contain ${pinned.folder}/${pinned.library}`);
    }
    // THE FRESH TREE MEETS THE SAME PINS, so a release bump that changes the library fails here, loudly, until the
    // table is rewritten from a verified extraction — never by copying whatever a found tree holds.
    await verifyPinnedTree({
      directory: join(staging, pinned.folder),
      pins: pinned.pins,
      context: `the extracted ${pinned.asset}`,
    });

    await rm(versionDirectory, { recursive: true, force: true });
    await mkdir(dirname(versionDirectory), { recursive: true });
    await rename(staging, versionDirectory);
    return { provisioned: true, library };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');

  if (check) {
    const library = pdfiumLibrary(root);
    // A CHECK REPORTS, and never provisions. `--check` exists so a proof or a
    // CI step can say *this machine has it* without a network call, and one
    // that quietly downloaded would make every such report a fact about what it
    // just did. And it never REPAIRS either: present-but-not-as-pinned is reported, and the tree is left for a
    // provisioning run to remove.
    const pinned = pdfiumPlatform(process.platform);
    const problems = existsSync(library) ? await treeProblems(join(pdfiumRoot(root), pinned.folder), pinned.pins) : ['missing'];
    process.stdout.write(
      problems.length === 0
        ? `PDFium ${PDFIUM_VERSION} present at ${library}, as pinned\n`
        : existsSync(library)
          ? `PDFium ${PDFIUM_VERSION} is present but NOT as pinned:\n  ${problems.join('\n  ')}\nRun: node scripts/provision/pdfium.mjs\n`
          : `PDFium ${PDFIUM_VERSION} is NOT provisioned. Run: node scripts/provision/pdfium.mjs\n`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
  }

  try {
    const result = await provisionPdfium({ root, force });
    process.stdout.write(
      result.provisioned
        ? `PDFium ${PDFIUM_VERSION} provisioned at ${result.library}\n`
        : `PDFium ${PDFIUM_VERSION} already present at ${result.library}\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
