// @ts-check
/**
 * Provisions ONNX Runtime Web's three runtime files for the handwriting recogniser, which ship
 * with the application while its model weights download on demand (ADR-0052's 2026-09-17
 * correction).
 *
 * ## What is provisioned
 *
 * `ort.wasm.min.mjs` (the API and the WASM backend), `ort-wasm-simd-threaded.mjs` (the Emscripten
 * factory) and `ort-wasm-simd-threaded.wasm` — the three files `ocrHandwriting.ts` loads, and
 * nothing else from a 137 MB package.
 *
 * ## The guarantees, in the order they apply
 *
 * - The npm registry tarball is fetched and its SHA-256 checked before it is opened. The registry
 *   publishes an SHA-512 integrity for it (`sha512-LuQlpX6M…`), from which the SHA-256 pinned here
 *   was computed over the same bytes on 2026-09-17.
 * - Each extracted file is checked against the SHA-256 the handwriting manifest pinned when the
 *   files were downloaded from a CDN, so the provisioned runtime is byte-for-byte the one measured.
 * - The package ships no licence text. ONNX Runtime's `LICENSE` and `ThirdPartyNotices.txt` are
 *   read from the `v1.29.0` tag, pinned by SHA-256, and compared with the committed copies the
 *   notice renders.
 *
 * Usage:
 *   node scripts/provision/onnxruntime.mjs [--force] [--check]
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { downloadVerified, fileExists, toolPath, verifyFileDigest } from '../lib/fetchVerified.mjs';
import { formatError } from '../lib/reportError.mjs';
import { sameAsCommitted } from './condaForge.mjs';

export const ONNXRUNTIME_VERSION = '1.29.0';

/** The registry tarball. */
export const ONNXRUNTIME_TARBALL = {
  url: `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${ONNXRUNTIME_VERSION}.tgz`,
  sha256: '7a934b7811c3b050ecfb7619722e2b4de771ce6da20520e17a2018a440316ef3',
  bytes: 32364153,
};

/** The three files, their place in the tarball, and the digest each had when it was measured. */
export const ONNXRUNTIME_FILES = [
  {
    file: 'ort.wasm.min.mjs',
    member: 'package/dist/ort.wasm.min.mjs',
    sha256: '14a0a63ad1a0fe8127722929fd16fb26c2e5352ea221bc9034d12daf314d0b92',
    bytes: 50126,
  },
  {
    file: 'ort-wasm-simd-threaded.mjs',
    member: 'package/dist/ort-wasm-simd-threaded.mjs',
    sha256: '5a15f1fd086b3f6c2baf1f35105b8f502653b567e165cef80028870b39748747',
    bytes: 24218,
  },
  {
    file: 'ort-wasm-simd-threaded.wasm',
    member: 'package/dist/ort-wasm-simd-threaded.wasm',
    sha256: 'ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d',
    bytes: 13961845,
  },
];

/** ONNX Runtime's terms at the tag the package was built from (commit `2e2543fb`). */
const LICENCE_TEXTS = [
  {
    url: `https://raw.githubusercontent.com/microsoft/onnxruntime/v${ONNXRUNTIME_VERSION}/LICENSE`,
    sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
    bytes: 1073,
    into: 'LICENSE.txt',
  },
  {
    url: `https://raw.githubusercontent.com/microsoft/onnxruntime/v${ONNXRUNTIME_VERSION}/ThirdPartyNotices.txt`,
    sha256: '53d3fa5821ac016ac24dd35775c996efec86e2ae0841e9a3a5e146c0ae916845',
    bytes: 336906,
    into: 'ThirdPartyNotices.txt',
  },
];

/** @param {string} root */
export function onnxRuntimeDirectory(root) {
  return toolPath(root, 'onnxruntime', ONNXRUNTIME_VERSION);
}

/** @param {string} root */
export function onnxRuntimeLicenceRoot(root) {
  return join(root, 'scripts', 'release', 'licences', 'onnxruntime');
}

/**
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, directory: string }>}
 */
export async function provisionOnnxRuntime({ root, force = false }) {
  const directory = onnxRuntimeDirectory(root);
  const last = ONNXRUNTIME_FILES.at(-1);
  if (!force && last !== undefined && (await fileExists(join(directory, last.file)))) {
    return { provisioned: false, directory };
  }

  const staging = `${directory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const unpack = join(staging, 'unpack');

  try {
    process.stderr.write(`Provisioning ONNX Runtime Web ${ONNXRUNTIME_VERSION} (three files from the registry tarball)…\n`);
    const tarball = `onnxruntime-web-${ONNXRUNTIME_VERSION}.tgz`;
    await downloadVerified({
      url: ONNXRUNTIME_TARBALL.url,
      allowedHosts: ['registry.npmjs.org'],
      sha256: ONNXRUNTIME_TARBALL.sha256,
      maxBytes: ONNXRUNTIME_TARBALL.bytes,
      destination: join(unpack, tarball),
    });
    extract(unpack, tarball, ONNXRUNTIME_FILES.map((entry) => entry.member));
    for (const entry of ONNXRUNTIME_FILES) {
      const extracted = join(unpack, entry.member);
      await verifyFileDigest({ path: extracted, sha256: entry.sha256, context: `onnxruntime-web ${entry.file}` });
      await copyFile(extracted, join(staging, entry.file));
    }

    const licenceRoot = onnxRuntimeLicenceRoot(root);
    for (const text of LICENCE_TEXTS) {
      const fetched = join(unpack, text.into);
      await downloadVerified({
        url: text.url,
        allowedHosts: ['raw.githubusercontent.com'],
        sha256: text.sha256,
        maxBytes: text.bytes,
        destination: fetched,
      });
      await sameAsCommitted(licenceRoot, fetched, text.into);
    }

    await rm(unpack, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
    await mkdir(dirname(directory), { recursive: true });
    await rename(staging, directory);
    return { provisioned: true, directory };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const directory = onnxRuntimeDirectory(root);

  if (process.argv.includes('--check')) {
    const present = ONNXRUNTIME_FILES.every((entry) => existsSync(join(directory, entry.file)));
    process.stdout.write(
      present
        ? `ONNX Runtime Web ${ONNXRUNTIME_VERSION} present at ${directory}\n`
        : `ONNX Runtime Web ${ONNXRUNTIME_VERSION} is NOT provisioned. Run: npm run provision:onnxruntime\n`,
    );
    process.exit(present ? 0 : 1);
  }

  try {
    const result = await provisionOnnxRuntime({ root, force: process.argv.includes('--force') });
    process.stdout.write(
      result.provisioned
        ? `ONNX Runtime Web ${ONNXRUNTIME_VERSION} provisioned at ${result.directory}\n`
        : `ONNX Runtime Web ${ONNXRUNTIME_VERSION} already present at ${result.directory}\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
