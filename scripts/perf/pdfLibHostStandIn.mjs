/**
 * The MuPDF host's half of a hosted pdf-lib apply, as a PROCESS of its own — `roleMainByteImage.mjs`' stand-in
 * ([ADR-0121](../../docs/DECISIONS/0121-main-never-holds-two-images.md) Decision 3).
 *
 * A separate process on purpose: the role measures `main`, and a stand-in running pdf-lib inside the measured process
 * would charge `main` for the host's parse — the exact cost the decision moved out. It reads the session's image
 * from a file, runs the command's spec through the one dispatch the host uses (`applyPdfLibImage`), and writes the
 * result to a file, as the host writes into its output directory.
 *
 * Usage: node pdfLibHostStandIn.mjs <image-in> <result-out> <command-json>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refuseStaleBuild } from '../lib/buildFreshness.mjs';

// ITS OWN FRESHNESS CHECK, before the import: the parent role guards the modules IT measures (`ROLE_MAIN_SERVICE`),
// which do not include pdf-lib's writer, so a stale `pdfLibWriter.js` would run here under this build's name.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
refuseStaleBuild(root, [['packages/kernel/src/pdfLibWriter.ts', 'packages/kernel/dist/pdfLibWriter.js', 'tsc']], 1);
// A LITERAL SPECIFIER, dynamic only so it runs after the check: `proof:electronimports` reads it.
const { applyPdfLibImage } = await import('../../packages/kernel/dist/pdfLibWriter.js');

const [input, output, commandJson] = process.argv.slice(2);
if (input === undefined || output === undefined || commandJson === undefined) {
  process.stderr.write('Usage: pdfLibHostStandIn.mjs <image-in> <result-out> <command-json>\n');
  process.exit(2);
}
const image = new Uint8Array(await readFile(input));
const result = await applyPdfLibImage(image, JSON.parse(commandJson), undefined);
await writeFile(output, result);
