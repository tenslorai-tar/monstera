// @ts-check
/**
 * What one read of the font catalogue costs a host, as the host reads it: `faceSourceOf(fontFoldersOf(bundled,
 * installed), readCatalogueApart)`, the binding `mupdfHostServe.ts` makes, timed three times in one process.
 *
 *   node scripts/research/catalogueCost.mjs [--rounds <n>]
 *
 * The bundled folder is the launcher's (`fontsDirectory`) and the installed one is `%SystemRoot%\Fonts`, the two the
 * factory hands a host (`installedFonts.ts`). Each read runs in its own thread that ends after it, as in a host, so the
 * second and third reads show whether anything is kept between them; nothing is printed of any font but counts.
 *
 * Nothing here is a pass or a fail. Its control: the catalogue must hold at least one bundled and one installed face,
 * or the folders were not read and the time is of nothing.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, win32 } from 'node:path';

import { FONT_CATALOGUE_APART, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';

const ROOT = repoRoot();
// THE BUILD THESE FIGURES ARE OF is the sources' own, or nothing is timed.
refuseStaleBuild(ROOT, FONT_CATALOGUE_APART, 4);
// A LITERAL SPECIFIER per module, so the import scans can read what this loads.
const { fontFoldersOf } = await import('../../packages/kernel/dist/fontCatalogue.js');
const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');

const argument = process.argv.indexOf('--rounds');
const ROUNDS = argument > 0 ? Number(process.argv[argument + 1]) : 3;
const root = process.env['SystemRoot'] ?? process.env['windir'];
if (root === undefined) throw new Error('no SystemRoot, so there is no installed fonts folder to read');
// THE LAUNCHER'S OWN RESOLVER of the bundled folder (`launchEnvironment.mjs`), a pinned folder beneath `.tools/fonts`.
const folders = fontFoldersOf(fontsDirectory(ROOT), win32.join(root, 'Fonts'));

for (const folder of folders) {
  const names = readdirSync(folder.path);
  const bytes = names.reduce((sum, name) => {
    try {
      const found = statSync(join(folder.path, name));
      return found.isFile() ? sum + found.size : sum;
    } catch {
      // A FILE THE LISTING NAMED AND STAT COULD NOT READ is counted as nothing here; the catalogue reports its own.
      return sum;
    }
  }, 0);
  process.stdout.write(`${folder.origin}: ${String(names.length)} entries, ${(bytes / 1048576).toFixed(1)} MiB\n`);
}

for (let round = 1; round <= ROUNDS; round += 1) {
  const started = performance.now();
  const { faces, unreadable } = readCatalogueApart(folders);
  const took = performance.now() - started;
  const bundled = faces.filter((face) => face.origin === 'bundled').length;
  const installed = faces.filter((face) => face.origin === 'installed').length;
  if (bundled === 0 || installed === 0) {
    throw new Error(`the catalogue read ${String(bundled)} bundled and ${String(installed)} installed faces, so a folder was not read and the time means nothing`);
  }
  process.stdout.write(
    `read ${String(round)}: ${took.toFixed(0)} ms, ${String(faces.length)} faces (${String(bundled)} bundled, ${String(installed)} installed), ${String(unreadable.length)} unreadable\n`,
  );
}
