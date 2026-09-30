// @ts-check
/**
 * Binds the native MuPDF engine in a script's own process
 * ([ADR-0124](../../docs/DECISIONS/0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md)).
 *
 * The kernel is told where the library is and never decides. A script that runs the kernel's engine code in-process
 * is the caller that can import the provisioning script, so it binds here, through `shimLibraryPath` — the one
 * resolver — before its first engine call. A script that starts a contained host passes the same path on the host's
 * command line instead, and binds nothing itself.
 */
import { existsSync } from 'node:fs';

import { openMupdfShim } from '../../packages/kernel/dist/mupdfRaw.js';
import { shimLibraryPath } from '../provision/mupdf.mjs';
import { repoRoot } from './gitScope.mjs';

/**
 * @param {string} [root] the repository root; the current one where omitted
 * @returns {string | null} the path bound, or `null` where the library is not built here — which the caller reports
 *   as not verified rather than as a pass
 */
export function bindNativeEngine(root = repoRoot()) {
  const path = shimLibraryPath(root);
  if (!existsSync(path)) return null;
  openMupdfShim(path);
  return path;
}
