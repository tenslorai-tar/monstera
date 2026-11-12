// @ts-check
/**
 * What the read on open (`readBlockFaces`, ADR-0271 section 5) costs on a real page, split into what a host pays once
 * and what it pays per ask: the catalogue's first load (`loadEditFaces`, which the MuPDF host's binding defers to the
 * first block read), then the read itself, warm, three times.
 *
 *   node scripts/research/blockFacesCost.mjs --corpus <folder> --file <n> [--page <n>]
 *
 * In this process, through the native engine, with the host's own binding: `bindEditFolders(bundled, installed,
 * readCatalogueApart)` (`mupdfHostServe.ts`), the bundled folder the launcher hands the host and `%SystemRoot%\Fonts`.
 * The runs asked about are every text object the page shows, through `runsOfContent`, the read's own fixture shape; the
 * PDFium host's half of `document.blockFaces` (`pageRunsOf`) is not in this figure. No word or name of the document is
 * printed: counts and milliseconds only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, win32 } from 'node:path';

import { BLOCK_FACES_READ, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';

const ROOT = repoRoot();
// THE BUILD THESE FIGURES ARE OF is the sources' own, or nothing is timed.
refuseStaleBuild(ROOT, BLOCK_FACES_READ, 2);
if (bindNativeEngine(ROOT) === null) throw new Error('the MuPDF shim is not built here');
// A LITERAL SPECIFIER per module, so the import scans can read what this loads.
const { bindEditFolders, loadEditFaces, editFaces } = await import('../../packages/kernel/dist/editFaces.js');
const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');
const { mupdfWriter, withDocument } = await import('../../packages/kernel/dist/mupdfWriter.js');
const { readBlockFaces } = await import('../../packages/kernel/dist/blockFaces.js');
const { blockFaceRunsOf } = await import('../../packages/kernel/dist/blockFaceAnswer.js');
const { runsOfContent } = await import('../../packages/kernel/dist/contentRunsFixture.js');
const { pageContentStreams } = await import('../../packages/kernel/dist/pageContent.js');
const { joinedContent } = await import('../../packages/kernel/dist/textOperators.js');

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const corpus = option('--corpus');
const fileNumber = Number(option('--file'));
const page = Number(option('--page') ?? '0');
if (corpus === undefined || !Number.isInteger(fileNumber)) throw new Error('usage: node scripts/research/blockFacesCost.mjs --corpus <folder> --file <n> [--page <n>]');
const chosen = readdirSync(corpus)
  .filter((name) => name.toLowerCase().endsWith('.pdf'))
  .sort()[fileNumber];
if (chosen === undefined) throw new Error(`--file ${String(fileNumber)} names no PDF in the folder`);

const root = process.env['SystemRoot'] ?? process.env['windir'];
if (root === undefined) throw new Error('no SystemRoot, so there is no installed fonts folder');
bindEditFolders(fontsDirectory(ROOT), win32.join(root, 'Fonts'), readCatalogueApart);

const session = await mupdfWriter.open(new Uint8Array(readFileSync(join(corpus, chosen))));
const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(page))));
const read = runsOfContent(content);
// BY EACH RUN'S OWN INDEX, which `blockFaceRunsOf` keys on, never its place in the list.
const indices = read.runs.map((run) => run.index);
const runs = blockFaceRunsOf(read, indices);
// THE CONTROL: a page with no run asks nothing, and its time would be of nothing.
if (runs.length === 0) {
  throw new Error(
    `page ${String(page)} shows no run to ask about: ${String(content.length)} bytes of content, ${String(read.runs.length)} runs, ${String(read.textObjects.length)} text objects`,
  );
}

let started = performance.now();
await loadEditFaces();
const catalogue = editFaces();
// A CATALOGUE THAT DID NOT LOAD would make every read below one with no faces to choose among.
if (catalogue === null) throw new Error('the catalogue did not load, so the reads below would choose among no faces');
process.stdout.write(`catalogue's first load: ${(performance.now() - started).toFixed(0)} ms (${String(catalogue.faces.length)} faces)\n`);

for (let round = 1; round <= 3; round += 1) {
  started = performance.now();
  const answer = await readBlockFaces(session, { page }, runs);
  process.stdout.write(
    `read ${String(round)}, warm: ${(performance.now() - started).toFixed(0)} ms for ${String(runs.length)} runs in ${String(answer.fonts.length)} font(s)\n`,
  );
}
