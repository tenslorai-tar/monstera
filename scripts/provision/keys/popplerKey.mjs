// @ts-check
/**
 * The key Poppler's source releases are signed with, and the one place its
 * fingerprint is written (ADR-0071). The provisioner imports it, so a second copy
 * of the fingerprint cannot drift from this one.
 *
 * The fingerprint is the `issuer fpr` subpacket of `poppler-26.09.0.tar.xz.sig`,
 * read 2026-09-16. The block beside this file is the keys.openpgp.org copy for
 * that fingerprint, read the same day: RSA 4096, created 2016-09-05. That server
 * publishes no user ID for it, so none is claimed here. Where the block came
 * from decides nothing — every use computes its fingerprint and requires this
 * one, and the provisioner's signature check is what the key is for.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POPPLER_KEY_FINGERPRINT = 'CA262C6C83DE4D2FB28A332A3A6A4DB839EAA6D7';

export function popplerKeyPath() {
  return join(dirname(fileURLToPath(import.meta.url)), 'poppler-release.asc');
}
