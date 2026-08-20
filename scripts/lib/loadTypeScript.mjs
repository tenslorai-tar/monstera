// @ts-check
/**
 * Loads the TypeScript compiler, in one place.
 *
 * ## Why this is a module and not four lines in each caller
 *
 * Two instruments now parse source with it — the Electron surface derivation and
 * the preload surface derivation — and a second copy of "where does the compiler
 * live and how is it imported" is **B3a**: many readers are fine, many opinions
 * about one resolution are not. The two halves would agree right up until one of
 * them was fixed.
 *
 * The `file://` URL and the backslash replacement are the interesting part and
 * the reason a copy would eventually differ: `import()` of an absolute Windows
 * path fails without them, and the CI job that would catch it is the only one
 * that runs on Windows. A caller writing this from memory writes the POSIX half.
 *
 * ## Absence THROWS, and the message says what it costs
 *
 * A missing compiler is not "parse nothing and report nothing found" — that is
 * item 4b's reassuring answer, and for these two instruments the reassuring
 * answer is what a security verdict rests on. Every caller passes what falling
 * back would mean, so the refusal names the consequence rather than the file.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {string} whyItMatters What is lost if this falls back to a text scan.
 *   Printed in the refusal, because "typescript is missing" tells a reader what
 *   happened and not what it would have cost.
 * @returns {Promise<typeof import('typescript')>}
 */
export async function loadTypeScript(whyItMatters) {
  const entry = join(REPO_ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js');
  if (!existsSync(entry)) {
    throw new Error(`TypeScript is not installed at ${entry}, so ${whyItMatters}`);
  }
  // `file://` and forward slashes: `import()` of a bare Windows path throws
  // ERR_UNSUPPORTED_ESM_URL_SCHEME, and this is the only line in either caller
  // that is platform-specific.
  return /** @type {typeof import('typescript')} */ (
    (await import(`file://${entry.replaceAll('\\', '/')}`)).default
  );
}
