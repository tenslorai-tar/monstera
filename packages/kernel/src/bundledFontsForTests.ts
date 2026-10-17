import { existsSync, readdirSync } from 'node:fs';

/**
 * The bundled fonts' folder for a test, as `vitest.config.mjs` passes it in `MONSTERA_FONTS_DIRECTORY`. TEST-ONLY: nothing
 * the application runs imports this.
 *
 * **ABSENT IS A FAILURE THAT SAYS SO, never a skip and never a bare error.** A font test that passed without its font is
 * a could-not-look reading as a pass, so a missing folder fails; and it fails naming the folder and the command that
 * provisions it. Each test read the variable with an empty fallback of its own, and on a machine with no fonts three of
 * `textOperatorEdit.test.ts`' cases threw *no readable font face … ENOENT* from deep in the catalogue, which reads as a
 * defect in the code under test (VVVVVVV-3). One reader, so the next test that needs the fonts cannot spell it again.
 */
export function bundledFontsFolder(): string {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  const faces = folder !== '' && existsSync(folder) ? readdirSync(folder).filter((name) => /\.(?:ttf|otf)$/iu.test(name)) : [];
  if (faces.length === 0) {
    throw new Error(`The bundled fonts are not provisioned at ${folder === '' ? '(no folder given)' : folder}. Run: npm run provision:fonts`);
  }
  return folder;
}
