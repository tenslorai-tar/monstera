// @ts-check
/**
 * Prints `packages/testing/fixtures/text-edit/chromium-type3.pdf`: a page Chromium's PDF writer (Skia) sets in a
 * Type 3 font, our own words in a freely licensed face, so the text-edit defect a person's document showed can be
 * proven without their document.
 *
 * ## What makes Skia write Type 3 — measured, 2026-10-04, Edge 154.0.4258.53 (Skia/PDF m154)
 *
 * One TrueType face (Liberation Sans, SIL OFL 1.1, from `pdfjs-dist`) printed by `msedge --headless --print-to-pdf`,
 * the page's fonts read back by type:
 *
 * | the face as the page asks for it | Skia writes |
 * |---|---|
 * | regular, delivered as `.ttf`, as WOFF, as WOFF2 | Type0 / CIDFontType2 — the container is not it |
 * | asked for at weight 700 with only a 400 face declared (SYNTHETIC bold) | **Type 3** |
 * | the same file DECLARED as the 700 face (the control) | Type0 / CIDFontType2 |
 * | synthetic italic | Type0 / CIDFontType2 |
 * | a variable font (Windows' Bahnschrift, measurement only) | **Type 3** |
 * | a CFF-flavoured OpenType font (a Windows `.otf`, measurement only) | **Type 3** |
 *
 * The person's document is the variable-font case: its Type 3 fonts' descriptors name *Source Serif 4 Variable* and
 * *Source Sans 3 VF*. No variable or CFF face with a free licence is on this machine and fetching one is the owner's
 * decision, so this fixture takes the trigger that IS available — synthetic bold — which gives the same shape: Type 3
 * fonts beside a CIDFontType2 on one page.
 *
 * ## The fixture
 *
 * A heading and a second heading in synthetic bold (Type 3) and a body line in the regular face (CIDFontType2). The
 * page has a title of its own: Chromium writes the document's title into the PDF's Info dictionary, and a page with
 * none would have carried its `file:` URL — a path on this machine — into a committed file. The run refuses to write
 * a fixture whose Info names anything but what this script set, and whose fonts are not one or more Type 3 and one
 * CIDFontType2.
 *
 * Usage: node scripts/research/chromiumType3Fixture.mjs [output.pdf]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';

import { isMain } from '../lib/isMain.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));

/** The page's three lines, in our own words. */
export const CHROMIUM_LINES = {
  heading: 'Monstera fixture heading.',
  second: 'A second heading in the same face.',
  body: 'Body text in the regular face.',
};

export const CHROMIUM_FIXTURE = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf');

const TITLE = 'Monstera text-edit fixture';

/** Where Edge is installed for every user on Windows. */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** @param {string} output */
async function print(output) {
  if (!existsSync(EDGE)) throw new Error(`No Edge at ${EDGE}; this fixture is printed by Chromium's own PDF writer.`);
  const ttf = readFileSync(join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts', 'LiberationSans-Regular.ttf'));
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-chromium-fixture-'));
  try {
    const html = join(scratch, 'page.html');
    writeFileSync(
      html,
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>${TITLE}</title><style>` +
        // ONE FACE, DECLARED AT 400 ONLY: the headings ask for 700, which the browser synthesises — the Type 3 trigger.
        `@font-face{font-family:Fixture;font-weight:400;src:url(data:font/ttf;base64,${ttf.toString('base64')})}` +
        'body{font-family:Fixture;margin:72px}h1{font-size:28px;font-weight:700;margin:0 0 24px}' +
        'h2{font-size:20px;font-weight:700;margin:0 0 24px}p{font-size:14px;font-weight:400;margin:0}</style>' +
        `<h1>${CHROMIUM_LINES.heading}</h1><h2>${CHROMIUM_LINES.second}</h2><p>${CHROMIUM_LINES.body}</p></html>`,
    );
    const pdf = join(scratch, 'page.pdf');
    const run = spawnSync(
      EDGE,
      [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        `--user-data-dir=${join(scratch, 'profile')}`,
        '--no-pdf-header-footer',
        '--virtual-time-budget=5000',
        `--print-to-pdf=${pdf}`,
        pathToFileURL(html).href,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (!existsSync(pdf)) throw new Error(`Edge printed nothing (exit ${String(run.status)}): ${String(run.stderr).slice(0, 300)}`);
    const bytes = readFileSync(pdf);
    await refuseUnlessFixture(bytes);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes);
    return bytes.length;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * The fixture is what it claims, and carries nothing of this machine.
 *
 * @param {Buffer} bytes
 */
async function refuseUnlessFixture(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const kinds = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && String(object.get(PDFName.of('Type'))) === '/Font') kinds.push(String(object.get(PDFName.of('Subtype'))));
  }
  if (!kinds.includes('/Type3') || !kinds.includes('/CIDFontType2')) {
    throw new Error(`the printed page's fonts are ${kinds.join(', ')}, not Type 3 beside a CIDFontType2`);
  }
  const info = [doc.getTitle(), doc.getAuthor(), doc.getSubject(), doc.getKeywords(), doc.getCreator(), doc.getProducer()];
  const raw = bytes.toString('latin1');
  for (const leak of ['file:', 'Users', 'C:\\', 'C:/']) {
    if (info.some((field) => field?.includes(leak)) || raw.includes(leak)) {
      throw new Error(`the printed PDF carries "${leak}", which names this machine; refusing to write it`);
    }
  }
  if (doc.getTitle() !== TITLE) throw new Error(`the PDF's title is ${String(doc.getTitle())}, not the page's own`);
}

if (isMain(import.meta.url)) {
  const output = process.argv[2] ?? CHROMIUM_FIXTURE;
  const length = await print(output);
  process.stdout.write(`${output}: ${String(length)} bytes\n`);
}
