// @ts-check
/**
 * Which installed face does an edit set an ideograph in, and does PDFium carry it OUTSIDE the contained host?
 *
 * ## Why this exists
 *
 * On 2026-10-06 the Windows job's live PDFium host refused `hostFileAnswersLive`'s second edit, a Helvetica line
 * gaining `中 U+0378`, as text-not-writable naming both characters (CI run 37407876114). The same edit through the
 * kernel's own PDFium writer on Linux, with WenQuanYi's `.ttc` as the installed folder, is saved and boxes only
 * U+0378. Two explanations fit and they want different fixes: the contained host cannot read what the resolver chose
 * (containment, ADR-0172 Decision 2's own question), or PDFium cannot carry the face Windows offers (a face rule). This
 * separates them by running the same edit OUTSIDE the host, once per installed face that carries the ideograph.
 *
 * ## What it prints
 *
 * The installed folder and how many faces it holds; the faces that carry the ideograph, in the resolver's order; and
 * for each of the first few, the edit's outcome with a catalogue of the bundled set plus that face alone. Every face
 * saving the edit here, beside the host refusing it, is a host that cannot read the face; a face refusing here is the
 * face.
 *
 * ## Its controls, on every run
 *
 * A Latin first edit must be saved, and a second edit adding only U+0378 must box exactly it: without both, a refusal
 * below would be the instrument, not the face. An installed folder that holds no face carrying the ideograph throws,
 * since it could not have measured anything.
 *
 * Usage: node scripts/research/installedFaceEdit.mjs [installed-fonts-folder]
 * (default: the folder `main` hands the hosts, `%SystemRoot%\Fonts` on Windows)
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { withNoPassword } from '../lib/pdfiumNoPassword.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const IDEOGRAPH = String.fromCodePoint(0x4e2d);
const UNASSIGNED = String.fromCodePoint(0x378);
const LATIN = 'Edited through the real host';
/** How many installed faces are tried one by one: the resolver's first choices are the ones an edit meets. */
const TRIED = 5;

// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads: none of it may reach Electron.
const { blockEditOf } = await import('../../packages/contract/dist/commands.js');
const { openPdfium, pdfiumWriter, textRuns } = await import('../../packages/kernel/dist/pdfiumFfi.js');
const specs = await import('../../packages/kernel/dist/pdfiumSpecs.js');
const { bindEditFaces } = await import('../../packages/kernel/dist/editFaces.js');
const { faceSourceOf, fontFoldersOf, readCatalogue } = await import('../../packages/kernel/dist/fontCatalogue.js');
const { candidatesFor } = await import('../../packages/kernel/dist/fontResolver.js');
const { groupIntoBlocks, settingOf } = await import('../../packages/kernel/dist/textLines.js');
const { installedFontsFolder } = await import('../../apps/desktop/dist/installedFonts.js');
// MuPDF IN THIS PROCESS, where the shim is built, for the round trip the live case's document makes between its edits.
const { bindNativeEngine } = await import('../lib/nativeEngine.mjs');
const mupdf = bindNativeEngine() === null ? null : await import('../../packages/kernel/dist/mupdfWriter.js');

const library = pdfiumLibrary(root);
if (!existsSync(library)) throw new Error(`${library} is absent: node scripts/provision/pdfium.mjs fetches it.`);
openPdfium(library);
const execution = withNoPassword(specs.localPdfiumExecution);
const bundled = fontsDirectory(root);
/** @type {string | null} */
const installed = process.argv[2] ?? installedFontsFolder();
if (installed === null) throw new Error('No installed fonts folder here; name one as the first argument.');

/** The first block of page 0. @param {Uint8Array} image */
async function blockOf(image) {
  const session = await pdfiumWriter.open(image);
  try {
    const { runs } = await textRuns(session, 0);
    return groupIntoBlocks(runs.map((/** @type {any} */ run) => ({ ...run, setting: settingOf(run.style) })))[0];
  } finally {
    await pdfiumWriter.close(session);
  }
}

/** The edit's outcome: saved with its boxes, or the refusal's name and characters. @param {Uint8Array} image @param {string} text */
async function edit(image, text) {
  const block = await blockOf(image);
  const command = {
    kind: 'editTextBlock',
    page: 0,
    ...blockEditOf([{ lines: block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)), text }]),
    fit: 'reflow',
    version: 1,
  };
  try {
    const drawn = await execution.applyDrawing({ session: image, command, sources: [], reads: undefined });
    return { image: drawn.image, outcome: `saved, boxed ${JSON.stringify(drawn.boxed.map((/** @type {any} */ box) => box.character))}` };
  } catch (error) {
    const named = /** @type {any} */ (error);
    return { image: null, outcome: `refused: ${String(named?.name)} ${JSON.stringify(named?.characters ?? named?.message)}` };
  }
}

const document = await PDFDocument.create();
document.addPage([300, 300]).drawText('Text to edit', { x: 20, y: 250, size: 12, font: await document.embedFont(StandardFonts.Helvetica) });
const oneLine = await document.save();

/**
 * `hostFileAnswersLiveHost.mjs`' page, which the live case edits: 1,600 glyphs, each its own text object, alternating
 * two colours so the host's join keeps each its own run. The live case's first edit replaces the page's first block
 * with one line, and the second edit lands on what that wrote.
 */
async function onePerGlyphPage() {
  const made = await PDFDocument.create();
  const font = await made.embedFont(StandardFonts.Helvetica);
  const page = made.addPage([595, 842]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < 1600; index += 1) {
    const column = index % 80;
    const row = Math.floor(index / 80);
    page.drawText(alphabet[index % alphabet.length] ?? 'a', {
      x: 20 + column * 7,
      y: 820 - row * 30,
      size: 9,
      font,
      color: index % 2 === 0 ? rgb(0, 0, 0) : rgb(0.2, 0, 0),
    });
  }
  return made.save();
}
const perGlyph = await onePerGlyphPage();
let original = oneLine;

/**
 * Through MuPDF and back, as the live case's document goes between its two edits: the first edit's image is adopted
 * into the MuPDF session, saved, reopened and flushed before PDFium sees it again. `null` where this checkout has no
 * native shim, and the variant is then not measured.
 * @param {Uint8Array} image
 */
async function throughMupdf(image) {
  if (mupdf === null) return null;
  const session = await mupdf.mupdfWriter.open(image);
  try {
    return await mupdf.mupdfWriter.serialise(session);
  } finally {
    await mupdf.mupdfWriter.close(session);
  }
}

/**
 * The Latin edit, then `addition` after it, with the faces `source` holds, the document going through MuPDF between the
 * two where `viaMupdf`. @param {any} source @param {string} addition @param {boolean} [viaMupdf]
 */
async function twoEdits(source, addition, viaMupdf = false) {
  bindEditFaces(() => source);
  try {
    const first = await edit(original, LATIN);
    if (first.image === null) return `first edit ${first.outcome}`;
    const between = viaMupdf ? await throughMupdf(first.image) : first.image;
    if (between === null) return 'not measured: no native MuPDF shim in this checkout';
    return (await edit(between, `${LATIN} ${addition}`)).outcome;
  } finally {
    bindEditFaces(null);
  }
}

// CONTROLS: the bundled set alone saves the Latin edit and boxes exactly the unassigned code point.
const bundledSource = faceSourceOf(fontFoldersOf(bundled, null));
const control = await twoEdits(bundledSource, UNASSIGNED);
if (control !== `saved, boxed ${JSON.stringify([UNASSIGNED])}`) {
  throw new Error(`The instrument's control failed, so nothing below would be the face: ${control}`);
}

const catalogue = readCatalogue([{ path: installed, origin: 'installed' }]);
const carrying = candidatesFor({ family: 'Helvetica', bold: false, italic: false, own: [] }, catalogue.faces).filter(
  (/** @type {any} */ face) => face.origin === 'installed' && face.unicodes.has(0x4e2d),
);
process.stdout.write(
  `installed folder ${installed}: ${String(catalogue.faces.length)} faces, ${String(catalogue.unreadable.length)} unreadable; ` +
    `${String(carrying.length)} carry ${IDEOGRAPH}\n`,
);
if (carrying.length === 0) throw new Error(`No installed face carries ${IDEOGRAPH}, so this run measured nothing.`);

const everything = faceSourceOf(fontFoldersOf(bundled, installed));
process.stdout.write(`all installed faces, as the hosts read them: ${await twoEdits(everything, `${IDEOGRAPH} ${UNASSIGNED}`)}\n`);
// THE LIVE CASE'S OWN PAGE, which differs from the line above in every way but the edit: a page of glyph objects. Then
// each character alone, so a refusal names which of the two it is.
original = perGlyph;
process.stdout.write(`the live case's page, all installed faces: ${await twoEdits(everything, `${IDEOGRAPH} ${UNASSIGNED}`)}\n`);
process.stdout.write(`  ${IDEOGRAPH} alone: ${await twoEdits(everything, IDEOGRAPH)}\n`);
process.stdout.write(`  U+0378 alone: ${await twoEdits(everything, UNASSIGNED)}\n`);
process.stdout.write(`  the bundled set alone, both: ${await twoEdits(bundledSource, `${IDEOGRAPH} ${UNASSIGNED}`)}\n`);
process.stdout.write(`  through MuPDF between the edits, both: ${await twoEdits(everything, `${IDEOGRAPH} ${UNASSIGNED}`, true)}\n`);
process.stdout.write(`  through MuPDF between the edits, Latin only (control): ${await twoEdits(everything, 'again', true)}\n`);
original = oneLine;
for (const face of carrying.slice(0, TRIED)) {
  // THE BUNDLED SET AND THIS ONE FACE, read the way the host's catalogue reads them.
  const alone = { faces: [...bundledSource.faces, face], read: everything.read };
  const outcome = await twoEdits(alone, `${IDEOGRAPH} ${UNASSIGNED}`);
  process.stdout.write(
    `  ${face.family} (${face.path} #${String(face.faceIndex)}, weight ${String(face.weight)}, ${String(face.embedding)}): ${outcome}\n`,
  );
}
