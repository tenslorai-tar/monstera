// @ts-check
/**
 * Granting ONE path to the AppContainer principal, and deciding from the ACL that comes back.
 *
 * ## Why this is a library and not part of `containerGrants.mjs`
 *
 * Two callers need it and one of them is what takes the grant away. `containerGrants.mjs` owns the
 * SET — which paths a contained host must reach, and why — and it builds that set from every
 * provisioner's own idea of where it put things, so it imports them. The installer that republishes
 * a tree has to re-grant it (ADR-0027: the thing that installs an artefact owns its state), which
 * would make `electron.mjs` import back into the module that imports it.
 *
 * So the primitive moves here, where neither imports the other, and there is still exactly one
 * implementation of *grant and read back* (B3a).
 *
 * ## The read-back is the answer, never the exit code
 *
 * `icacls` reports success on its own exit status, and a grant that did not take looks exactly like
 * one that did if nobody reads the DACL. Every caller here decides from what the ACL says.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * `ALL APPLICATION PACKAGES`, by SID rather than by name.
 *
 * The display name is localised — a German Windows renders it `ALLE ANWENDUNGSPAKETE` — and an
 * `icacls` argument written as a name fails on those machines with a message about an unknown
 * principal. The SID is the same everywhere.
 */
export const ALL_APPLICATION_PACKAGES = 'S-1-15-2-1';

/** The DACL as `icacls` prints it, or `null` where it could not be read. @param {string} path */
export function readAcl(path) {
  const result = spawnSync('icacls', [path], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return `${result.stdout ?? ''}`;
}

/**
 * Whether a DACL names the application-package principal.
 *
 * By SID and by name, because `icacls` prints whichever the machine's locale resolves.
 *
 * @param {string} acl
 */
export function namesApplicationPackages(acl) {
  return acl.includes(ALL_APPLICATION_PACKAGES) || /ALL APPLICATION PACKAGES/iu.test(acl);
}

/** @param {string} path @param {string} rights */
export function grantOne(path, rights) {
  return spawnSync(
    'icacls',
    [path, '/grant', `*${ALL_APPLICATION_PACKAGES}:(OI)(CI)(${rights})`],
    { encoding: 'utf8' },
  );
}

/** @param {string} path */
export function revokeOne(path) {
  return spawnSync('icacls', [path, '/remove:g', `*${ALL_APPLICATION_PACKAGES}`], {
    encoding: 'utf8',
  });
}

/**
 * Grants one path and answers what the ACL says afterwards.
 *
 * @param {{ path: string, rights: string }} entry
 * @returns {{ granted: boolean, detail: string }}
 */
export function grantPath({ path, rights }) {
  if (!existsSync(path)) return { granted: false, detail: `${path} — not provisioned` };
  const result = grantOne(path, rights);
  const acl = readAcl(path);
  if (acl === null) return { granted: false, detail: `${path} — ACL unreadable after grant` };
  if (namesApplicationPackages(acl)) return { granted: true, detail: path };
  return {
    granted: false,
    detail:
      `${path} — icacls exited ${String(result.status)} and the ACL does not name ` +
      `${ALL_APPLICATION_PACKAGES}. The read-back decides, not the exit code.`,
  };
}
