// @ts-check
/**
 * Provisions the Microsoft Visual C++ runtime for the shipped programs that load it and do not carry it: the MuPDF
 * shim (built `/MD`, `native/mupdf-shim/monstera_mupdf.vcxproj`) and ONLYOFFICE's `x2t.exe` with every DLL beside it.
 *
 * ## Why it ships, measured
 *
 * Read with `peImports` on 2026-10-14 from Document Builder 9.4.0's own archive: `x2t.exe` and all twenty of its
 * DLLs import `MSVCP140.dll`, `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll`, and the archive carries none of them.
 * On a PC whose `System32` has no runtime, Windows' loader fails x2t with `STATUS_DLL_NOT_FOUND` (0xC0000135) and the
 * MuPDF host's `koffi.load` with `ERROR_MOD_NOT_FOUND` — no document opens. A PC with a runtime older than 14.40 is the
 * worse case: the loader finds `System32`'s copy and a 14.44 build can crash in it (Microsoft's 17.10 `std::mutex`
 * change). Shipping the pinned copy beside each program makes the program's own folder answer first.
 *
 * ## ONE source for every program
 *
 * The package is the one Poppler and Ghostscript already take — {@link VC14_RUNTIME}, verified by its SHA-256 through
 * `condaForge.mjs` — and the bytes are the one pin, {@link VC14_RUNTIME_BIN}. This module provisions that package into
 * its own folder; packaging places a copy beside each program that imports it (`scripts/release/dllClosure.mjs`).
 *
 * Usage:
 *   node scripts/provision/vcRuntime.mjs [--force] [--check]
 */

import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { isMain } from '../lib/isMain.mjs';
import { treeProblems, verifyPinnedTree } from '../lib/pinnedTree.mjs';
import { formatError } from '../lib/reportError.mjs';
import { VC14_RUNTIME, VC14_RUNTIME_BIN, installCondaPackage } from './condaForge.mjs';

/** The command that provisions it — what a packaging refusal names. */
export const VC_RUNTIME_COMMAND = 'npm run provision:vcruntime';

/** @param {string} root */
export function vcRuntimeDirectory(root) {
  return toolPath(root, 'vc14_runtime', VC14_RUNTIME.version, 'bin');
}

/**
 * The committed copy of the runtime's terms that the package's own is compared with: ONLYOFFICE's, since NOTICE
 * renders the runtime under x2t (`nativeComponents.json`).
 *
 * @param {string} root
 */
export function vcRuntimeLicenceRoot(root) {
  return join(root, 'scripts', 'release', 'licences', 'onlyoffice');
}

/**
 * The runtime's folder, provisioned and every file as pinned.
 *
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, directory: string }>}
 */
export async function provisionVcRuntime({ root, force = false }) {
  const directory = vcRuntimeDirectory(root);
  const context = `the Visual C++ runtime ${VC14_RUNTIME.version}`;
  if (!force && (await fileExists(join(directory, 'vcruntime140.dll')))) {
    // PRESENT IS NOT PINNED (`pinnedTree.mjs`): every file is checked, and no other may be there.
    await verifyPinnedTree({ directory, pins: VC14_RUNTIME_BIN, context });
    return { provisioned: false, directory };
  }
  const staging = `${directory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  const bin = join(staging, 'bin');
  await mkdir(bin, { recursive: true });
  try {
    process.stderr.write(`Provisioning ${context} (conda-forge)…\n`);
    await installCondaPackage(VC14_RUNTIME, { unpack: join(staging, 'unpack'), bin, licenceRoot: vcRuntimeLicenceRoot(root) });
    await verifyPinnedTree({ directory: bin, pins: VC14_RUNTIME_BIN, context: `the extracted ${context}` });
    await rm(directory, { recursive: true, force: true });
    await mkdir(dirname(directory), { recursive: true });
    await rename(bin, directory);
    return { provisioned: true, directory };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (process.argv.includes('--check')) {
    const directory = vcRuntimeDirectory(root);
    // PRESENT AND PINNED, reported and never repaired.
    const problems = existsSync(directory) ? await treeProblems(directory, VC14_RUNTIME_BIN) : ['missing'];
    process.stdout.write(
      problems.length === 0
        ? `The Visual C++ runtime ${VC14_RUNTIME.version} is present at ${directory}, every file as pinned\n`
        : `The Visual C++ runtime ${VC14_RUNTIME.version} is not as pinned:\n  ${problems.join('\n  ')}\nRun: ${VC_RUNTIME_COMMAND}\n`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
  }
  try {
    const result = await provisionVcRuntime({ root, force: process.argv.includes('--force') });
    process.stdout.write(`The Visual C++ runtime ${VC14_RUNTIME.version} ${result.provisioned ? 'provisioned' : 'already present'} at ${result.directory}\n`);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
