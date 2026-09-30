import { existsSync } from 'node:fs';

import { openMupdfShim } from './mupdfRaw.js';

/**
 * Binds the native MuPDF engine for a test process (ADR-0124).
 *
 * The kernel is told where the library is and never decides: `vitest.config.mjs` resolves it through
 * `scripts/provision/mupdf.mjs`' `shimLibraryPath` and passes it in `MONSTERA_MUPDF_SHIM`, the variable the
 * development launcher sets for the application. Where the library is not built, nothing is bound, and every engine
 * call throws *"the MuPDF shim is not bound in this process"* — which names the missing step rather than failing on
 * the first document for a reason that looks like the document's.
 *
 * `.setup.` keeps it out of the shipped `dist` (`packageMsix.mjs`' `shippedFromDist`) and out of vitest's collection.
 */
const path = process.env['MONSTERA_MUPDF_SHIM'];
if (path !== undefined && path.length > 0 && existsSync(path)) openMupdfShim(path);
