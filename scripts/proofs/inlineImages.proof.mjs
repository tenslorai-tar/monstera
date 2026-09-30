// @ts-check
/**
 * An edit through PDFium keeps a page's inline images, drawn as they were
 * ([ADR-0126](../../docs/DECISIONS/0126-a-pdfium-command-is-handed-its-pages-with-inline-images-made-xobjects.md)).
 *
 * ## The failure this closes
 *
 * PDFium's content generator returns early for an inline image (`BI … EI`), so a page an edit regenerates is saved
 * without it. The owner's decision B: never refuse the edit, keep the picture.
 *
 * ## What each case runs
 *
 * A generated page with a line of text and an inline picture over a blue square. The picture is drawn one of five
 * ways: RGB; a stencil painted in the fill colour, whose right half is unpainted; a JPEG; RGB clipped to its left
 * half; and RGB inside a Form XObject. The square is rendered from the original. Then the real steps: the shim's
 * `keepInlineImages` on the page, PDFium's open of what it wrote, the edit, PDFium's save, a reopen and a render.
 * The square after must match the square before — a stencil that went opaque, a clip that was lost, a picture that
 * moved or vanished all change it.
 *
 * The edit is a text replacement, and for the form it is `promoteFormObjects` first — the command that moves a
 * form's content onto the page, where the same generator would drop an inline image the form held.
 *
 * ## Its controls
 *
 * - **Every inline shape without the step must LOSE its picture.** Otherwise the fixture separates nothing: a page
 *   that kept its picture anyway would pass the kept case for the wrong reason.
 * - **The edit must have landed**: the text reads `Edited` after the reopen, so a regeneration really ran.
 * - **An image XObject is `unchanged`**: the step converts nothing and writes nothing where nothing needs keeping.
 * - **The comparator's resolution**: one pixel changed by one level is reported as one pixel.
 *
 * Usage: node scripts/proofs/inlineImages.proof.mjs [--require-engines]
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { keepInlineImages } from '../../packages/kernel/dist/mupdfRaw.js';
import { INLINE_IMAGES, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');

const SHAPES = ['rgb', 'stencil', 'jpeg', 'clipped', 'form'];
const CASES = [
  'the comparator counts a pixel changed past its tolerance of 8 levels, and not one within it',
  ...SHAPES.map((shape) => `CONTROL: ${shape} — without the step, the edit LOSES the picture`),
  ...SHAPES.map((shape) => `${shape} — the step converts it, and after the edit the picture is drawn as it was`),
  'CONTROL: an image XObject is unchanged — the step converts nothing and writes nothing',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 12 });
if (CASES.length !== 12) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 12`);

/** @param {string} name @param {boolean} held @param {string} detail */
function check(name, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// ---- fixtures ----

const PAGE = 300;
const SQUARE = { x: 100, y: 100, size: 100 };
const SIDE = 16;

/** @param {(string | Buffer)[][]} objects */
function pdfOf(objects) {
  /** @type {Buffer[]} */
  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0]?.length ?? 0;
  /** @type {number[]} */
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(length);
    const piece = Buffer.concat([
      Buffer.from(`${String(index + 1)} 0 obj\n`, 'latin1'),
      ...body.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : part)),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(piece);
    length += piece.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(parts);
}

/** @param {Buffer} data @param {string} dictionary */
const stream = (dictionary, data) => [`<< ${dictionary} /Length ${String(data.length)} >>\nstream\n`, data, '\nendstream'];

/** @param {Buffer} content @param {string} xobjects @param {(string | Buffer)[][]} extra */
function pageWith(content, xobjects = '', extra = []) {
  return pdfOf([
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE)} ${String(PAGE)}] /Resources << /Font << /F1 4 0 R >> ` +
        `${xobjects === '' ? '' : `/XObject << ${xobjects} >>`} >> /Contents 5 0 R >>`,
    ],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    stream('', content),
    ...extra,
  ]);
}

const TEXT = 'BT /F1 18 Tf 40 250 Td (Hello world) Tj ET';
const UNDER = `q 0 0 1 rg ${String(SQUARE.x)} ${String(SQUARE.y)} ${String(SQUARE.size)} ${String(SQUARE.size)} re f Q`;
const PLACE = `${String(SQUARE.size)} 0 0 ${String(SQUARE.size)} ${String(SQUARE.x)} ${String(SQUARE.y)} cm`;
const RED = Buffer.alloc(SIDE * SIDE * 3);
for (let at = 0; at < RED.length; at += 3) RED[at] = 255;
const HALF = Buffer.alloc((SIDE / 8) * SIDE);
for (let row = 0; row < SIDE; row += 1) HALF[row * 2 + 1] = 0xff;

/** @param {string} before @param {string} dictionary @param {Buffer} data */
function inlinePage(before, dictionary, data) {
  return pageWith(
    Buffer.concat([
      Buffer.from(`${TEXT}\n${UNDER}\nq ${before} ${PLACE} BI ${dictionary} ID `, 'latin1'),
      data,
      Buffer.from(' EI Q', 'latin1'),
    ]),
  );
}

/** @param {any} sharp */
async function fixtures(sharp) {
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .jpeg({ quality: 90 })
    .toBuffer();
  const rgb = `/W ${String(SIDE)} /H ${String(SIDE)} /CS /RGB /BPC 8`;
  const halfClip = `${String(SQUARE.x)} ${String(SQUARE.y)} ${String(SQUARE.size / 2)} ${String(SQUARE.size)} re W n`;
  const formContent = Buffer.concat([
    Buffer.from(`q ${String(SQUARE.size)} 0 0 ${String(SQUARE.size)} 0 0 cm BI ${rgb} ID `, 'latin1'),
    RED,
    Buffer.from(' EI Q', 'latin1'),
  ]);
  return {
    rgb: inlinePage('', rgb, RED),
    stencil: inlinePage('1 0 0 rg', `/W ${String(SIDE)} /H ${String(SIDE)} /IM true /BPC 1`, HALF),
    jpeg: inlinePage('', '/W 64 /H 64 /CS /RGB /BPC 8 /F /DCT', jpeg),
    clipped: inlinePage(halfClip, rgb, RED),
    form: pageWith(
      Buffer.from(`${TEXT}\n${UNDER}\nq 1 0 0 1 ${String(SQUARE.x)} ${String(SQUARE.y)} cm /Fm1 Do Q`, 'latin1'),
      '/Fm1 6 0 R',
      [stream(`/Type /XObject /Subtype /Form /BBox [0 0 ${String(SQUARE.size)} ${String(SQUARE.size)}]`, formContent)],
    ),
    xobject: pageWith(Buffer.from(`${TEXT}\n${UNDER}\nq ${PLACE} /Im1 Do Q`, 'latin1'), '/Im1 6 0 R', [
      stream(`/Type /XObject /Subtype /Image /Width ${String(SIDE)} /Height ${String(SIDE)} /ColorSpace /DeviceRGB /BitsPerComponent 8`, RED),
    ]),
  };
}

// ---- measurement ----

/**
 * The picture's square, rendered through the adapter at 1 px/pt, as `[r, g, b]` per pixel.
 *
 * @param {any} pdfium @param {Uint8Array} bytes
 */
async function square(pdfium, bytes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    const bitmap = await pdfium.renderPageBitmap(session, 0, PAGE, PAGE);
    /** @type {number[][]} */
    const out = [];
    for (let y = PAGE - SQUARE.y - SQUARE.size; y < PAGE - SQUARE.y; y += 1) {
      for (let x = SQUARE.x; x < SQUARE.x + SQUARE.size; x += 1) {
        const at = (y * bitmap.width + x) * 4;
        out.push([bitmap.bgra[at + 2] ?? 0, bitmap.bgra[at + 1] ?? 0, bitmap.bgra[at] ?? 0]);
      }
    }
    return out;
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/** Pixels differing by more than a JPEG's rounding in any channel. */
function differing(/** @type {number[][]} */ one, /** @type {number[][]} */ two) {
  let count = 0;
  one.forEach((pixel, index) => {
    const other = two[index] ?? [0, 0, 0];
    if (pixel.some((value, channel) => Math.abs(value - (other[channel] ?? 0)) > 8)) count += 1;
  });
  return count;
}

/**
 * The edit a PDFium command makes, then PDFium's save: `promoteFormObjects` for the form, then a text replacement.
 *
 * @param {any} pdfium @param {Uint8Array} bytes @param {boolean} promote
 * @returns {Promise<{ saved: Uint8Array, text: string }>}
 */
async function edited(pdfium, bytes, promote) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  /** @type {Uint8Array} */
  let saved;
  try {
    if (promote) await pdfium.promoteFormObjects(session, 0);
    const [first] = await pdfium.textObjectIndices(session, 0);
    if (first === undefined) throw new Error('the fixture has no text object to edit');
    await pdfium.replaceTextObjects(session, 0, [{ index: first, text: 'Edited' }]);
    saved = await pdfium.pdfiumWriter.serialise(session);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const reopened = await pdfium.pdfiumWriter.open(saved);
  try {
    const runs = await pdfium.textRuns(reopened, 0);
    return { saved, text: runs.runs.map((/** @type {{ text: string }} */ run) => run.text).join(' ') };
  } finally {
    await pdfium.pdfiumWriter.close(reopened);
  }
}

/** @param {any} pdfium @param {any} sharp */
async function run(pdfium, sharp) {
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-inline-images-'));
  try {
    const flat = [[10, 10, 10]];
    const nudged = [[11, 10, 10]];
    check(CASES[0] ?? '', differing(flat, flat) === 0 && differing(flat, [[19, 10, 10]]) === 1 && differing(flat, nudged) === 0, 'the comparator does not separate a changed pixel from an unchanged one');

    const pages = await fixtures(sharp);
    for (const [index, shape] of SHAPES.entries()) {
      const original = pages[/** @type {keyof typeof pages} */ (shape)];
      const before = await square(pdfium, original);
      const promote = shape === 'form';

      const lost = await edited(pdfium, original, promote);
      const lostBy = differing(before, await square(pdfium, lost.saved));
      check(
        CASES[1 + index] ?? '',
        lostBy > 0 && lost.text.includes('Edited'),
        `without the step ${String(lostBy)} of ${String(before.length)} pixels changed and the text reads "${lost.text}" — a picture PDFium kept anyway, or an edit that did not regenerate, separates nothing`,
      );

      const input = join(scratch, `${shape}-in.pdf`);
      const output = join(scratch, `${shape}-kept.pdf`);
      writeFileSync(input, original);
      const counted = keepInlineImages(input, output, 0);
      const keptBytes = existsSync(output) ? new Uint8Array(readFileSync(output)) : null;
      const after = keptBytes === null ? null : await edited(pdfium, keptBytes, promote);
      const keptBy = after === null ? -1 : differing(before, await square(pdfium, after.saved));
      check(
        CASES[1 + SHAPES.length + index] ?? '',
        counted.converted >= 1 && counted.left === 0 && after !== null && after.text.includes('Edited') && keptBy === 0,
        `the step converted ${String(counted.converted)} and left ${String(counted.left)}; after the edit ${String(keptBy)} of ${String(before.length)} pixels differ and the text reads "${after?.text ?? '(nothing written)'}"`,
      );
    }

    const input = join(scratch, 'xobject-in.pdf');
    const output = join(scratch, 'xobject-kept.pdf');
    writeFileSync(input, pages.xobject);
    const counted = keepInlineImages(input, output, 0);
    check(
      CASES[CASES.length - 1] ?? '',
      counted.converted === 0 && counted.left === 0 && !existsSync(output),
      `the step converted ${String(counted.converted)}, left ${String(counted.left)}, and ${existsSync(output) ? 'WROTE a file' : 'wrote nothing'}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} inline-image case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('inline-image case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

// THE ENTRY IS LAST, so every constant above is initialised before the first case reads one.
const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'inline images kept through a PDFium edit',
    why:
      `${String(CASES.length)} case(s) need both engines:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (existsSync(library) ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.' : 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'),
    flag: '--require-engines',
  });
} else {
  // BOTH BUILT ENGINES ARE THE SUBJECT: the rewrite is `mupdfRaw.js`' and the edit is `pdfiumFfi.js`'.
  refuseStaleBuild(ROOT, INLINE_IMAGES, 2);
  /** @type {any} */
  const pdfium = await import(pathToFileURL(join(ROOT, 'packages', 'kernel', 'dist', 'pdfiumFfi.js')).href);
  pdfium.openPdfium(library);
  /** @type {any} */
  const sharp = createRequire(join(ROOT, 'package.json'))('sharp');
  await run(pdfium, sharp);
}
