// @ts-check
/**
 * What a development run of the shell is handed in its environment: where each provisioned native component is.
 *
 * ## ONE PLACE, for every process that starts the shell from a checkout
 *
 * `scripts/launch.mjs` assembled this inline, and the research instruments that drive the real application
 * (`frameTimes.mjs`, `appMemory.mjs`) spawned Electron without it. With no `MONSTERA_MUPDF_SHIM` the composition root
 * gets no engine-host platform, so those runs had NO engine host: every document opened poisoned for engine commands
 * while it still displayed — measured 2026-10-02, the shell's own log reading *"No engine host platform was supplied to
 * the composition root"* and no host process anywhere in the tree. What a development run receives is one answer, so it
 * is one function, and a starter that spreads it cannot hand the shell a different set (B3a).
 *
 * Each component's location is its provisioner's answer, passed down because `apps/desktop` cannot import `scripts/`
 * (it is not part of what ships); an absent component is a decided state the shell reports by name, so each part
 * answers nothing when its artefact is not there.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { fileExists } from './fetchVerified.mjs';
import { shimEnvironment } from './shimBinary.mjs';
import { pdfiumEnvironment } from '../provision/pdfium.mjs';
import { gswin64cPath } from '../provision/ghostscript.mjs';
import { x2tPath } from '../provision/onlyoffice.mjs';
import { pdftotextPath } from '../provision/poppler.mjs';
import { tessdataDirectory, tessdataPath } from '../provision/tessdata.mjs';
import { nativeManifest } from '../release/nativeManifest.mjs';

/**
 * The OCR models' directory. **Keyed on `eng`'s presence rather than on the directory's**: the directory is created by
 * the first download, so an interrupted provision can leave it empty, and an empty directory passed down is a datadir
 * every recognition fails against — the state that reads like a broken feature rather than an unprovisioned one.
 *
 * @param {string} root
 * @returns {Promise<Record<string, string>>}
 */
async function tessdataEnvironment(root) {
  if (!(await fileExists(tessdataPath(root, 'eng')))) return {};
  return { MONSTERA_TESSDATA_DIRECTORY: tessdataDirectory(root) };
}

/**
 * An executable a provisioner placed, under the variable the shell reads it from — or nothing.
 *
 * @param {string} variable @param {string} executable
 * @returns {Promise<Record<string, string>>}
 */
async function executableEnvironment(variable, executable) {
  if (!(await fileExists(executable))) return {};
  return { [variable]: executable };
}

/**
 * THE COMPONENTS' MANIFEST (ADR-0122), generated from the provisioning pins at every launch into `.tools/` — the
 * package carries its own beside the components; a development shell reads this one, so the Components dialog can
 * verify the trees the variables point at.
 *
 * @param {string} root
 */
function nativeManifestEnvironment(root) {
  const path = resolve(root, '.tools', 'native-manifest.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(nativeManifest(root), null, 2)}\n`, 'utf8');
  return { MONSTERA_NATIVE_MANIFEST: path };
}

/**
 * The variables a development shell is started with, beside the parent's environment.
 *
 * - PDFium (`pdfiumEnvironment`, the PDFium host's own spelling): absent, the editing commands are refused by name.
 * - The MuPDF shim (`shimEnvironment`): **only when the DLL was built from the source on disk**, because a host binds
 *   the shim's exports at its start and a DLL older than its source can lack one. Absent, there is no MuPDF host.
 * - The OCR models, Poppler's `pdftotext` (ADR-0071), Ghostscript (ADR-0075), ONLYOFFICE's `x2t` (ADR-0120), and the
 *   components' manifest.
 *
 * @param {string} root
 * @returns {Promise<Record<string, string>>}
 */
export async function developmentEnvironment(root) {
  return {
    ...pdfiumEnvironment(root),
    ...shimEnvironment({ root }),
    ...(await tessdataEnvironment(root)),
    ...(await executableEnvironment('MONSTERA_POPPLER_EXECUTABLE', pdftotextPath(root))),
    ...(await executableEnvironment('MONSTERA_GHOSTSCRIPT_EXECUTABLE', gswin64cPath(root))),
    ...(await executableEnvironment('MONSTERA_ONLYOFFICE_EXECUTABLE', x2tPath(root))),
    ...nativeManifestEnvironment(root),
  };
}
