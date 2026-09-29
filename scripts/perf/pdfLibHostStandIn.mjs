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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { applyPdfLibImage } = await import(`file://${resolve(root, 'packages/kernel/dist/pdfLibWriter.js')}`);

const [input, output, commandJson] = process.argv.slice(2);
if (input === undefined || output === undefined || commandJson === undefined) {
  process.stderr.write('Usage: pdfLibHostStandIn.mjs <image-in> <result-out> <command-json>\n');
  process.exit(2);
}
const image = new Uint8Array(await readFile(input));
const result = await applyPdfLibImage(image, JSON.parse(commandJson), undefined);
await writeFile(output, result);
