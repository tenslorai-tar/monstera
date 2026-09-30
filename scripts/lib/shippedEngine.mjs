// @ts-check
/**
 * Where the MuPDF engine the APPLICATION loads actually lives.
 *
 * ## Resolved the way the application resolves it, never written down
 *
 * Since [ADR-0124](../../docs/DECISIONS/0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md) the kernel's
 * MuPDF is the native library `mupdfRaw.ts` binds, and the application is told its path by the native-components
 * resolver: the package's `resources/native/mupdf-shim/` when installed, and in development the variable the launcher
 * sets from `shimPath` (`scripts/launch.mjs`). So this answers `shimPath` — the launcher's own call — and a scan
 * pointed here reads the file the application loads rather than one it used to.
 *
 * Until 2026-09-30 this resolved the bare specifier `'mupdf'` to the npm package's `mupdf-wasm.wasm`, which is what
 * the kernel imported then; `import.meta.resolve` was the kernel's own resolution, and the same principle — derive
 * the target the way the application does — is why it is `shimPath` now.
 *
 * ## Why it is a module rather than a function in one proof
 *
 * `proof:activecontent` and `ocrSurface.mjs` ask the same question. Two files each naming the artefact would be a
 * second opinion about which artefact the application runs (B3a).
 *
 * **This is not a claim that the file is the right subject.** A positive control proves an instrument can see the
 * file it was given; nothing proves that file is the subject except deriving it the way the application does.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { shimPath } from './shimBinary.mjs';

/**
 * The native engine the application loads in development.
 *
 * @returns {string} an absolute path, which may not exist where the shim is not built
 */
export function shippedEngine() {
  return shimPath();
}

/**
 * The object model over it — the other half of the surface: a member the object model does not declare is one no
 * caller can name.
 *
 * @returns {string[]} the ones that exist, so a caller reports on what it read
 */
export function shippedEngineSurface() {
  return [join(repoRoot(), 'packages', 'kernel', 'src', 'mupdfRaw.ts')].filter((path) => existsSync(path));
}
