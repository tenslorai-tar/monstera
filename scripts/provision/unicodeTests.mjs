// @ts-check

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadVerified, fileExists, toolPath, verifyFileDigest } from '../lib/fetchVerified.mjs';
import { isMain } from '../lib/isMain.mjs';
import { formatError } from '../lib/reportError.mjs';

/**
 * Unicode's own conformance data, provisioned for tests and never shipped or committed
 * ([ADR-0172](../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)).
 *
 * ## What it is for
 *
 * `bidiOrder.ts` is the one module that orders mixed-direction text, and the authority it answers to publishes the
 * cases: `BidiCharacterTest.txt` states, for 91,707 strings, every character's resolved level and the visual order of
 * the line. `bidiOrder.test.ts` runs every one of them, so the claim *we follow UAX #9* is executed rather than
 * asserted.
 *
 * ## Where it comes from, and why there
 *
 * `www.unicode.org` is not reachable from every machine this project builds on (refused by the cloud sessions' proxy,
 * measured 2026-10-05), and a file fetched by version name could change under the same name. So the file is read from
 * Unicode's own `unicode-org/unicodetools` repository at one commit, which carries the published 17.0.0 data, and is
 * checked by SHA-256 before anything reads it — the same pin the bundled fonts take.
 *
 * ## Not committed
 *
 * It is 6,880,771 bytes of test data, and a file of that size in the history is permanent (B10).
 */

/** The `unicode-org/unicodetools` commit the data is read from. */
export const UNICODE_TOOLS_COMMIT = '6661370193d31b1cfb28a5b854ee8a894a95edbf';

/** The Unicode version the data states, which is also the folder it is kept in. */
export const UNICODE_VERSION = '17.0.0';

/** `BidiCharacterTest.txt` for {@link UNICODE_VERSION}: its fingerprint and size, read 2026-10-05. */
export const BIDI_CHARACTER_TEST = {
  file: 'BidiCharacterTest.txt',
  sha256: 'a3e6e905ab5afbe318a96df5401d0372a04cd73ef139ab5e3cf0ae241c255488',
  bytes: 6_880_771,
};

const ALLOWED_HOSTS = ['raw.githubusercontent.com'];

/** @param {string} root the repository root */
export function unicodeTestsDirectory(root) {
  return toolPath(root, 'unicode', UNICODE_VERSION);
}

/** @param {string} root the repository root */
export function bidiCharacterTestPath(root) {
  return join(unicodeTestsDirectory(root), BIDI_CHARACTER_TEST.file);
}

/**
 * Provisions the conformance data, or verifies the copy already there.
 *
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, path: string }>}
 */
export async function provisionUnicodeTests({ root, force = false }) {
  const path = bidiCharacterTestPath(root);
  const context = `Unicode ${UNICODE_VERSION}'s ${BIDI_CHARACTER_TEST.file} (unicode-org/unicodetools ${UNICODE_TOOLS_COMMIT.slice(0, 12)})`;
  if (!force && (await fileExists(path))) {
    await verifyFileDigest({ path, sha256: BIDI_CHARACTER_TEST.sha256, context });
    return { provisioned: false, path };
  }
  await downloadVerified({
    url: `https://raw.githubusercontent.com/unicode-org/unicodetools/${UNICODE_TOOLS_COMMIT}/unicodetools/data/ucd/${UNICODE_VERSION}/${BIDI_CHARACTER_TEST.file}`,
    allowedHosts: ALLOWED_HOSTS,
    sha256: BIDI_CHARACTER_TEST.sha256,
    maxBytes: BIDI_CHARACTER_TEST.bytes,
    destination: path,
  });
  return { provisioned: true, path };
}

if (isMain(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    const result = await provisionUnicodeTests({ root, force: process.argv.includes('--force') });
    process.stdout.write(
      `${result.provisioned ? 'Unicode conformance data provisioned' : 'Unicode conformance data already present and verified'} at ${result.path}\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
