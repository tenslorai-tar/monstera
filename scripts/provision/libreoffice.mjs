// @ts-check
/**
 * Provisions LibreOffice for D9's *Office import* (ADR-0063).
 *
 * The guarantees, in the order they apply:
 * - a pinned version;
 * - a host-locked download, with its size bounded by received bytes;
 * - SHA-256 checked before anything interprets the bytes;
 * - TDF's detached signature verified against a key pinned by its computed
 *   fingerprint (`openpgpVerify.mjs`, `keys/libreOfficeKey.mjs`), before the
 *   MSI is unpacked.
 *
 * ## What this file does not yet know, and says so
 *
 * ADR-0063 lists five readings owed before any feature is built on this tree.
 * Two of them are guesses in the code below, marked where they are made:
 * - that `msiexec /a` extracts without elevation;
 * - where `soffice.exe` lands under `TARGETDIR`.
 *
 * The first run of this script is the measurement. Its results go into a
 * dated correction to the ADR, not into these comments.
 *
 * ## Mirrors, because TDF serves none of the MSI itself
 *
 * `download.documentfoundation.org` answers with a 302 to a mirror chosen by
 * location, so its redirect cannot be host-locked. Each URL below is requested
 * directly, locked to its own one host, in order.
 * - A transient failure moves on to the next mirror.
 * - A digest mismatch or a bad signature stops the provision. Trying another
 *   mirror after bytes that verified wrong is downloading until something matches.
 *
 * Usage:
 *   node scripts/provision/libreoffice.mjs [--force] [--check]
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DigestMismatch,
  DownloadTooLarge,
  downloadVerified,
  fileExists,
  toolPath,
} from '../lib/fetchVerified.mjs';
import { verifyDetached } from '../lib/openpgpVerify.mjs';
import { formatError } from '../lib/reportError.mjs';
import { LIBREOFFICE_KEY_FINGERPRINT, libreOfficeKeyPath } from './keys/libreOfficeKey.mjs';

/** `26.8.0`, the newest in `download.documentfoundation.org/libreoffice/stable/`, read 2026-09-13. */
export const LIBREOFFICE_VERSION = '26.8.0';
export const LIBREOFFICE_ASSET = `LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`;

/** Read from TDF's mirrorbrain metadata page, 2026-09-13; every mirror below reported this length. */
export const LIBREOFFICE_SHA256 = '4aa6c6e1895f4055104effcb556bd3362d20c6ad707c149543304f395ef9db95';
const LIBREOFFICE_BYTES = 374_906_880;
/** The ceiling is the digest's servant: it stops a hostile response before hashing, and 1 MiB over the pin leaves no room for another artefact. */
const MAX_MSI_BYTES = LIBREOFFICE_BYTES + 1024 * 1024;

const SIGNATURE_URL = `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/win/x86_64/${LIBREOFFICE_ASSET}.asc`;
const SIGNATURE_SHA256 = 'd8d8a96a53a895163e302b40b7628e26fb2838f4871f4c8d61a4ab5c89bae08f';


/** Named by TDF's `.mirrorlist` for this file; each answered 200 with the pinned length and no redirect, 2026-09-14. */
const MIRRORS = [
  'https://ftp.fau.de/tdf/libreoffice/stable',
  'https://ftp.gwdg.de/pub/tdf/libreoffice/stable',
  'https://ftp.osuosl.org/pub/tdf/libreoffice/stable',
  'https://mirror.aarnet.edu.au/pub/tdf/libreoffice/stable',
];

/** @param {string} root */
export function libreOfficeRoot(root) {
  return toolPath(root, 'libreoffice', LIBREOFFICE_VERSION);
}

/** @param {string} root */
/**
 * One of the three launchers in the provisioned tree, by name.
 *
 * **A resolver rather than a path join at the call site**, and the reason is the rule
 * `scripts/lib/electronBinaryCallers.mjs` holds: a host's `executablePath` must NAME a resolver
 * that answers out of the provisioned tree, because the defect that rule exists for is a caller
 * that wrote `process.execPath` and got whatever runtime was running. ADR-0063 Decision 2 says the
 * same thing for this converter — *"resolved from the provisioned tree, never from `PATH` and never
 * from an installed copy"* — and this machine has LibreOffice installed, so the wrong answer is
 * available and plausible.
 *
 * The three differ and the difference is measurable: `soffice.exe` is the GUI front end, which
 * writes no diagnostic and stays alive; `soffice.com` is the console front end; `soffice.bin` is the
 * program. Measured 2026-09-16 — under `CreateProcessW` only the latter two report anything at all.
 *
 * @param {string} root @param {'exe' | 'com' | 'bin'} which
 * @returns {string}
 */
export function sofficeLauncher(root, which) {
  return join(dirname(sofficePath(root)), `soffice.${which}`);
}

/** @param {string} root @returns {string} */
export function sofficePath(root) {
  // MEASURED 2026-09-14 on the first run: an administrative install of this MSI puts
  // `program\soffice.exe` directly under TARGETDIR. The guess it replaced,
  // `LibreOffice\program\`, is the path a normal install uses.
  return join(libreOfficeRoot(root), 'program', 'soffice.exe');
}

/**
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, soffice: string }>}
 */
export async function provisionLibreOffice({ root, force = false }) {
  const soffice = sofficePath(root);
  if (!force && (await fileExists(soffice))) return { provisioned: false, soffice };

  const versionDirectory = libreOfficeRoot(root);
  const staging = `${versionDirectory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    const msi = join(staging, LIBREOFFICE_ASSET);
    const asc = `${msi}.asc`;
    process.stderr.write(`Provisioning LibreOffice ${LIBREOFFICE_VERSION}…\n`);

    await downloadVerified({
      url: SIGNATURE_URL,
      allowedHosts: ['download.documentfoundation.org'],
      sha256: SIGNATURE_SHA256,
      maxBytes: 4096,
      destination: asc,
    });

    await downloadFromMirrors(msi);

    await verifyDetached({
      file: msi,
      signature: await readFile(asc, 'utf8'),
      publicKey: await readFile(libreOfficeKeyPath(), 'utf8'),
      fingerprint: LIBREOFFICE_KEY_FINGERPRINT,
    });

    const target = join(staging, 'tree');
    // UNMEASURED (ADR-0063 item 1): an administrative install is expected to
    // extract the tree without installing or elevating; this run is the reading.
    // No shell: the arguments are a list, and every path is one this script built.
    const run = spawnSync('msiexec.exe', ['/a', msi, '/qn', `TARGETDIR=${target}`], {
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    });
    if (run.status !== 0) throw new Error(`msiexec /a exited ${String(run.status)}`);
    await rm(msi, { force: true });

    // CONFIRMED IN STAGING, THEN PUBLISHED. The first run renamed the tree into
    // place and only then looked for soffice.exe, so a failed look left a complete-
    // looking version directory behind. The rename is the publish (pdfium.mjs'
    // shape), and nothing is published that has not been confirmed.
    const staged = join(target, 'program', 'soffice.exe');
    if (!(await fileExists(staged))) throw new Error(`the unpacked tree has no ${staged}`);

    await rm(versionDirectory, { recursive: true, force: true });
    await mkdir(dirname(versionDirectory), { recursive: true });
    await rename(target, versionDirectory);
    return { provisioned: true, soffice };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** @param {string} destination */
async function downloadFromMirrors(destination) {
  /** @type {unknown[]} */
  const unanswered = [];
  for (const base of MIRRORS) {
    const url = `${base}/${LIBREOFFICE_VERSION}/win/x86_64/${LIBREOFFICE_ASSET}`;
    try {
      await downloadVerified({
        url,
        allowedHosts: [new URL(url).hostname],
        sha256: LIBREOFFICE_SHA256,
        maxBytes: MAX_MSI_BYTES,
        destination,
      });
      return;
    } catch (error) {
      // BYTES THAT ARRIVED AND VERIFIED WRONG STOP EVERYTHING. Moving on after a
      // mismatch or a ceiling breach is downloading until something matches. A
      // mirror that did not answer, or answered 404 because it has not synced
      // this file, delivered nothing, and the next mirror is asked.
      if (error instanceof DigestMismatch || error instanceof DownloadTooLarge) throw error;
      unanswered.push(error);
    }
  }
  throw new AggregateError(unanswered, `no mirror answered for ${LIBREOFFICE_ASSET}`);
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (process.argv.includes('--check')) {
    const soffice = sofficePath(root);
    process.stdout.write(
      existsSync(soffice)
        ? `LibreOffice ${LIBREOFFICE_VERSION} present at ${soffice}\n`
        : `LibreOffice ${LIBREOFFICE_VERSION} is NOT provisioned. Run: node scripts/provision/libreoffice.mjs\n`,
    );
    process.exit(existsSync(soffice) ? 0 : 1);
  }
  try {
    const result = await provisionLibreOffice({ root, force: process.argv.includes('--force') });
    process.stdout.write(`LibreOffice ${LIBREOFFICE_VERSION} ${result.provisioned ? 'provisioned' : 'already present'} at ${result.soffice}\n`);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
