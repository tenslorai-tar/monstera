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
 * ## Windows x64 only, and that is the product rather than a shortcut
 *
 * Distribution is the Microsoft Store (ADR-0018), and the engine hosts are
 * Windows processes created with an AppContainer SID. A provisioner offering
 * ten platforms, as gitleaks' does, would be offering them for a tool that runs
 * on the developer's machine; this is the shipped engine.
 *
 * Usage:
 *   node scripts/provision/pdfium.mjs [--force] [--check]
 */

import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { formatError } from '../lib/reportError.mjs';

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

/** The asset, its size and its digest — all three read from the download. */
export const PDFIUM_ASSET = 'pdfium-win-x64.tgz';
export const PDFIUM_SHA256 =
  '78a17d9a5f14467631c26a3ac8741b27a0471ecc05bd6a119b523598160a0537';

/**
 * github.com issues the release URL; it always redirects to the signed asset
 * host. Both hops are checked — `gitleaks.mjs`' list and its reason.
 */
const ALLOWED_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/**
 * A ceiling on the download, counted rather than believed.
 *
 * The pinned asset is 3,818,370 bytes. Four megabytes leaves room for a patch
 * release without leaving room for a different artefact — and the digest is
 * what actually decides, so this bound exists to stop a hostile response
 * before it is hashed rather than to identify the file.
 */
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;

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
 * The library every consumer loads.
 *
 * @param {string} root the repository root
 * @returns {string}
 */
export function pdfiumLibrary(root) {
  return join(pdfiumRoot(root), 'bin', 'pdfium.dll');
}

/**
 * Provisions the library, or reports that it is already there.
 *
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, library: string }>}
 */
export async function provisionPdfium({ root, force = false }) {
  const library = pdfiumLibrary(root);
  if (!force && (await fileExists(library))) return { provisioned: false, library };

  const versionDirectory = pdfiumRoot(root);
  // STAGED AND PUBLISHED BY RENAME, `gitleaks.mjs`' shape and its reason: two
  // processes can provision at once — a CI step, a hook and a proof — and
  // clear-then-extract lets one delete the directory the other is mid-extraction
  // into, leaving a half-populated tree that `fileExists` is happy with.
  const staging = `${versionDirectory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    const archive = join(staging, PDFIUM_ASSET);
    process.stderr.write(`Provisioning PDFium ${PDFIUM_VERSION} (${PDFIUM_RELEASE})…\n`);

    await downloadVerified({
      url: `https://github.com/bblanchon/pdfium-binaries/releases/download/${PDFIUM_RELEASE}/${PDFIUM_ASSET}`,
      allowedHosts: ALLOWED_HOSTS,
      sha256: PDFIUM_SHA256,
      maxBytes: MAX_ARCHIVE_BYTES,
      destination: archive,
    });

    extract(staging, PDFIUM_ASSET);
    await rm(archive, { force: true });

    const staged = join(staging, 'bin', 'pdfium.dll');
    if (!(await fileExists(staged))) {
      throw new Error(`${PDFIUM_ASSET} did not contain bin/pdfium.dll`);
    }

    await rm(versionDirectory, { recursive: true, force: true });
    await mkdir(dirname(versionDirectory), { recursive: true });
    await rename(staging, versionDirectory);
    return { provisioned: true, library };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');

  if (check) {
    const library = pdfiumLibrary(root);
    // A CHECK REPORTS, and never provisions. `--check` exists so a proof or a
    // CI step can say *this machine has it* without a network call, and one
    // that quietly downloaded would make every such report a fact about what it
    // just did.
    process.stdout.write(
      existsSync(library)
        ? `PDFium ${PDFIUM_VERSION} present at ${library}\n`
        : `PDFium ${PDFIUM_VERSION} is NOT provisioned. Run: node scripts/provision/pdfium.mjs\n`,
    );
    process.exit(existsSync(library) ? 0 : 1);
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
