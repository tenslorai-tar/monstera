// @ts-check
/**
 * The key TDF signs LibreOffice releases with, and the one place its fingerprint
 * is written (ADR-0063). The provisioner and `proof:openpgpverify` both import
 * it, so a second copy of the fingerprint cannot drift from this one.
 *
 * The block beside this file is the keyserver.ubuntu.com copy, read 2026-09-14:
 * uid *LibreOffice Build Team (CODE SIGNING KEY)*, RSA 4096, created 2010-10-11.
 * Where it came from does not decide anything. Every use computes its
 * fingerprint and requires this one.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIBREOFFICE_KEY_FINGERPRINT = 'C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA3';

export function libreOfficeKeyPath() {
  return join(dirname(fileURLToPath(import.meta.url)), 'libreoffice-build-team.asc');
}
