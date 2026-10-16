// @ts-check
/**
 * The one way a provisioner puts a verified tree in place: rename it there, then grant the contained processes what
 * they reach inside it.
 *
 * ## Why the grant belongs to the publish
 *
 * A rename keeps the DACL the folder already had, and a staging folder's is `.tools`' inherited one, which names no
 * application package. So publishing a tree took away the grant a contained host or converter needs to read it, and
 * nothing said so until a person's conversion failed in Windows' loader with 0xC0000135 (measured 2026-10-16: x2t
 * could not read its own DLLs after `provision:onlyoffice` re-extracted it). Granting at the publish makes a
 * provisioned tree and a reachable tree the same event (ADR-0027: the thing that installs an artefact owns its state).
 *
 * WHICH trees and with which rights is `containerGrants.mjs`' `grantSet`, never the caller's: that module imports every
 * provisioner for its paths, so it is loaded here when the grant is taken rather than at import, which would be a
 * cycle.
 *
 * Windows only, and not fatal, for `electron.mjs`' stated reason: a machine where `icacls` cannot write still ends
 * with a provisioned tree. It is never silent: a grant the read-back does not show is printed with its repair.
 */

import { rename } from 'node:fs/promises';

/**
 * @param {{ from: string, to: string, root: string }} tree `to` must not exist; `root` is the checkout
 * @returns {Promise<ReadonlyArray<{ path: string, granted: boolean, detail: string }>>}
 */
export async function publishTree({ from, to, root }) {
  await rename(from, to);
  return grantPublished({ to, root });
}

/**
 * The grant half alone, for a provisioner that writes into its folder rather than renaming one there (the OCR models,
 * and the runtime `electron.mjs` re-extracts in place): any file written into a folder that was itself just created
 * inherits nothing a contained process can read.
 *
 * @param {{ to: string, root: string }} tree
 * @returns {Promise<ReadonlyArray<{ path: string, granted: boolean, detail: string }>>}
 */
export async function grantPublished({ to, root }) {
  if (process.platform !== 'win32') return [];
  const { regrantPublished } = await import('../provision/containerGrants.mjs');
  const outcomes = regrantPublished(to, root);
  for (const outcome of outcomes) {
    process.stderr.write(
      outcome.granted
        ? `  ok  a contained process may read ${outcome.path} (ALL APPLICATION PACKAGES)\n`
        : `  !!  a contained process can NOT read ${outcome.detail}\n      Run \`npm run provision:grants\`.\n`,
    );
  }
  return outcomes;
}
