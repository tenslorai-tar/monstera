// @ts-check
/**
 * Adoptium's release-signing key: what `provision/verapdf.mjs` verifies the Temurin JRE against.
 * Fetched 2026-09-17 from keys.openpgp.org by this fingerprint, which Adoptium publishes; the
 * fingerprint is pinned here and checked against the key file on every use.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADOPTIUM_KEY_FINGERPRINT = '3B04D753C9050D9A5D343F39843C48A565F8F04B';

export function adoptiumKeyPath() {
  return join(dirname(fileURLToPath(import.meta.url)), 'adoptium-release.asc');
}
