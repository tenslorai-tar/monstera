// @ts-check
/**
 * Proves PDFium is pinned per platform, that packaging takes the shipped platform's library whatever machine runs it,
 * and that a library present on disk but not as pinned is refused rather than used.
 *
 * ## Why the packaging case needs this machine to be Linux to separate anything
 *
 * Packaging used `pdfiumLibrary(root)`, the running platform's library. On Windows that IS the shipped one, so a
 * packager reading the running platform and one reading `SHIPPED_PLATFORM` give the same folder there and no case on
 * Windows can tell them apart. On Linux they differ, so the case is required to separate there and is printed as not
 * separating on Windows, rather than passing for nothing.
 *
 * ## Why the tamper case plants a file that would load
 *
 * The provisioner returns early when the library exists. A planted file at the library's path is what that early
 * return would accept; the case requires the run to throw, name the pins, and remove the tree. The CONTROL copies the
 * genuine library into a fresh root and requires the same call to accept it, so the refusal is about the bytes and not
 * about the fresh root.
 *
 * Needs `node_modules` (packaging imports `rcedit`) and, for the control, a provisioned PDFium. Downloads nothing.
 *
 * Usage: node scripts/provision/pdfium.proof.mjs [--require-pdfium]
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { componentSources } from '../release/packageMsix.mjs';
import { PDFIUM_BIN, PDFIUM_PLATFORMS, SHIPPED_PLATFORM, pdfiumLibrary, pdfiumPlatform, provisionPdfium } from './pdfium.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requirePdfium = process.argv.includes('--require-pdfium');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-pdfium-proof-'));

try {
  const windows = pdfiumLibrary(REPO_ROOT, 'win32');
  const linux = pdfiumLibrary(REPO_ROOT, 'linux');
  check(
    'each platform names its own library, and its pins name exactly that file',
    windows.endsWith(join('bin', 'pdfium.dll')) &&
      linux.endsWith(join('lib', 'libpdfium.so')) &&
      Object.entries(PDFIUM_PLATFORMS).every(([, p]) => Object.keys(p.pins).join() === p.library) &&
      PDFIUM_PLATFORMS.win32.sha256 !== PDFIUM_PLATFORMS.linux.sha256,
    `win32 ${windows}, linux ${linux}, pins ${JSON.stringify(Object.values(PDFIUM_PLATFORMS).map((p) => p.pins))}`,
  );
  check(
    'the shipped pins the manifest reads are the Windows pins',
    SHIPPED_PLATFORM === 'win32' && PDFIUM_BIN === PDFIUM_PLATFORMS.win32.pins,
    `SHIPPED_PLATFORM ${SHIPPED_PLATFORM}, PDFIUM_BIN ${JSON.stringify(PDFIUM_BIN)}`,
  );

  let refusal = '';
  try {
    pdfiumPlatform('darwin');
  } catch (error) {
    refusal = formatError(error);
  }
  check(
    'a platform nothing pins is refused by name, never given another platform’s archive',
    refusal.includes('darwin'),
    `pdfiumPlatform('darwin') answered ${refusal === '' ? 'an archive' : refusal}`,
  );

  const packaged = componentSources(REPO_ROOT)['pdfium'];
  check(
    'packaging takes the shipped library’s folder whatever machine runs it',
    packaged === dirname(windows),
    `componentSources(root).pdfium is ${packaged}; the shipped library is in ${dirname(windows)}`,
  );
  const separates = dirname(pdfiumLibrary(REPO_ROOT)) !== dirname(windows);
  check(
    process.platform === 'win32'
      ? 'CONTROL (does not separate here: the running platform is the shipped one; it separates on the Linux leg)'
      : 'CONTROL: on this machine the running platform’s library is elsewhere, so the case above separates',
    process.platform === 'win32' || separates,
    `running ${pdfiumLibrary(REPO_ROOT)}, shipped ${windows}`,
  );

  const planted = join(scratch, 'planted');
  const plantedLibrary = pdfiumLibrary(planted);
  mkdirSync(dirname(plantedLibrary), { recursive: true });
  writeFileSync(plantedLibrary, 'not the pinned library');
  let plantedAnswer = '';
  try {
    await provisionPdfium({ root: planted });
    plantedAnswer = 'accepted';
  } catch (error) {
    plantedAnswer = formatError(error);
  }
  check(
    'a library present on disk but not as pinned is refused, and the tree removed',
    plantedAnswer !== 'accepted' && !existsSync(plantedLibrary),
    `provisionPdfium answered ${plantedAnswer}; the planted file ${existsSync(plantedLibrary) ? 'is still there' : 'was removed'}`,
  );

  const genuine = pdfiumLibrary(REPO_ROOT);
  if (existsSync(genuine)) {
    const copy = join(scratch, 'genuine');
    const copiedLibrary = pdfiumLibrary(copy);
    mkdirSync(dirname(copiedLibrary), { recursive: true });
    copyFileSync(genuine, copiedLibrary);
    let copiedAnswer = '';
    try {
      const result = await provisionPdfium({ root: copy });
      copiedAnswer = result.provisioned ? 'downloaded' : 'accepted';
    } catch (error) {
      copiedAnswer = formatError(error);
    }
    check(
      'CONTROL: the genuine library at the same place is accepted without a download',
      copiedAnswer === 'accepted',
      `provisionPdfium answered ${copiedAnswer}`,
    );
  } else if (requirePdfium) {
    check('CONTROL: the genuine library is provisioned here', false, `${genuine} is absent and --require-pdfium was given`);
  } else {
    check(
      'CONTROL UNVERIFIABLE: PDFium is not provisioned here, so the genuine library could not be offered',
      true,
      '',
    );
  }
} catch (error) {
  failures.push(`the proof itself failed: ${formatError(error)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} PDFium provisioning failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
    : roster.format('PDFium provisioning case'),
);
process.exitCode = failures.length > 0 ? 1 : 0;
