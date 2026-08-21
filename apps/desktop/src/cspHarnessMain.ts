import { reportDeliveredPolicy } from './cspHarness.js';

/**
 * Electron entry point for `proof:rendererpolicy`, and nothing else.
 *
 * ## Why a `.ts` in `src/` rather than a `.mjs` beside the app
 *
 * A `.mjs` under `apps/desktop/` would match **no lint configuration at all** —
 * the package globs end `.ts,.tsx` and the plain-Node globs stop at `scripts/`.
 * That is precisely the hole invariant 26 names, and putting a file into it,
 * even a harmless one, is how the hole acquires residents. Compiled from `src/`,
 * it is covered by the same rules as the rest of the shell.
 *
 * ## Why Electron is handed this file directly
 *
 * A directory with its own `package.json` would be a second package inside
 * `apps/desktop`, which `npm ci` and the workspace globs would then have an
 * opinion about. Electron accepts a path to a script, so the proof spawns
 * `electron <path-to-this>` and nothing needs to be declared anywhere.
 *
 * This file is built into `dist/` and is not reachable from the package's
 * exports — `index.ts` does not re-export it, so nothing can import it by
 * accident and it is not part of the app.
 */
void reportDeliveredPolicy();
