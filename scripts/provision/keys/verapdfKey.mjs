// @ts-check
/**
 * The veraPDF consortium's release-signing key: what `provision/verapdf.mjs` verifies the
 * installer against. Fetched 2026-09-17 with the installer's detached signature naming it as
 * issuer; the fingerprint is pinned here and checked against the key file on every use.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERAPDF_KEY_FINGERPRINT = '13DD102B4DD69354D12DE5A83184863278B17FE7';

export function verapdfKeyPath() {
  return join(dirname(fileURLToPath(import.meta.url)), 'verapdf-release.asc');
}
