// @ts-check
/**
 * Which conversion keeps an INLINE image through a PDFium edit, drawn exactly as it was?
 *
 * ## The mechanism this answers
 *
 * `CPDF_PageContentGenerator::ProcessImage` — read 2026-09-30 from PDFium's main branch — begins
 * `if (pImage->IsInline()) { return; }`, so when an edit regenerates a page's content an inline image (`BI … EI`) is
 * simply not written, and the saved page loses it. `pdfiumImageKeep.mjs` measured the loss: only the inline shape was
 * lost of five. PDFium's public API has no inline flag, so a fix has to replace the inline image's content with an
 * image PDFium WILL write, and it must draw the same.
 *
 * ## What is measured
 *
 * Three inline shapes, each over a blue rectangle so that a conversion which paints what the original left
 * transparent is visible: an RGB raster; a STENCIL mask painted in the fill colour (its right half unpainted); and a
 * JPEG (`/DCT`). For each, three candidate conversions of the image object before the edit — `SetBitmap` of its
 * `GetBitmap`, `SetBitmap` of its `GetRenderedBitmap`, and, for the JPEG, `LoadJpegFileInline` of its raw bytes — then
 * a text edit, `FPDFPage_GenerateContent`, a save and a reopen. The render after is compared with the render of the
 * untouched original, pixel for pixel, inside the image's square; the saved size is printed too.
 *
 * CONTROL: no conversion, which must LOSE the picture — otherwise nothing here separates a conversion that works from
 * a page that would have kept it anyway.
 *
 * Usage: node scripts/research/pdfiumInlineConvert.mjs   (after node scripts/provision/pdfium.mjs)
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

import koffi from 'koffi';

import { repoRoot } from '../lib/gitScope.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const require = createRequire(join(ROOT, 'package.json'));
/** @type {any} */
const sharp = require('sharp');

const library = koffi.load(pdfiumLibrary(ROOT));
const writeBlock = koffi.proto('int WriteBlockCallback(void *self, const void *data, unsigned long size)');
koffi.struct('FPDF_FILEWRITE', { version: 'int', WriteBlock: koffi.pointer(writeBlock) });
const getBlock = koffi.proto('int GetBlockCallback(void *param, unsigned long position, uint8_t *buf, unsigned long size)');
koffi.struct('FPDF_FILEACCESS', { m_FileLen: 'unsigned long', m_GetBlock: koffi.pointer(getBlock), m_Param: 'void *' });

const api = {
  init: library.func('void FPDF_InitLibrary()'),
  load: library.func('void *FPDF_LoadMemDocument(const void *data, int size, const char *password)'),
  closeDocument: library.func('void FPDF_CloseDocument(void *document)'),
  loadPage: library.func('void *FPDF_LoadPage(void *document, int index)'),
  closePage: library.func('void FPDF_ClosePage(void *page)'),
  count: library.func('int FPDFPage_CountObjects(void *page)'),
  object: library.func('void *FPDFPage_GetObject(void *page, int index)'),
  type: library.func('int FPDFPageObj_GetType(void *object)'),
  setText: library.func('int FPDFText_SetText(void *object, const void *text)'),
  generate: library.func('int FPDFPage_GenerateContent(void *page)'),
  save: library.func('int FPDF_SaveAsCopy(void *document, FPDF_FILEWRITE *writer, int flags)'),
  getBitmap: library.func('void *FPDFImageObj_GetBitmap(void *image)'),
  renderedBitmap: library.func('void *FPDFImageObj_GetRenderedBitmap(void *document, void *page, void *image)'),
  setBitmap: library.func('int FPDFImageObj_SetBitmap(void **pages, int count, void *image, void *bitmap)'),
  loadJpegInline: library.func('int FPDFImageObj_LoadJpegFileInline(void **pages, int count, void *image, FPDF_FILEACCESS *file)'),
  raw: library.func('unsigned long FPDFImageObj_GetImageDataRaw(void *image, _Out_ uint8_t *buffer, unsigned long length)'),
  createBitmap: library.func('void *FPDFBitmap_Create(int width, int height, int alpha)'),
  fillRect: library.func('void FPDFBitmap_FillRect(void *bitmap, int left, int top, int width, int height, unsigned long colour)'),
  render: library.func('void FPDF_RenderPageBitmap(void *bitmap, void *page, int x, int y, int w, int h, int rotate, int flags)'),
  buffer: library.func('void *FPDFBitmap_GetBuffer(void *bitmap)'),
  stride: library.func('int FPDFBitmap_GetStride(void *bitmap)'),
  destroyBitmap: library.func('void FPDFBitmap_Destroy(void *bitmap)'),
};
api.init();

const OBJECT_TEXT = 1;
const OBJECT_IMAGE = 3;
const PAGE = { width: 300, height: 300 };
const SQUARE = { x: 100, y: 100, size: 100 };
const SIDE = 16;

// ---- fixtures, written here ----

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

/** @param {Buffer} content */
function pageWith(content) {
  return pdfOf([
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE.width)} ${String(PAGE.height)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [`<< /Length ${String(content.length)} >>\nstream\n`, content, '\nendstream'],
  ]);
}

const PLACE = `${String(SQUARE.size)} 0 0 ${String(SQUARE.size)} ${String(SQUARE.x)} ${String(SQUARE.y)} cm`;
/** A blue square exactly under the picture, so anything the picture leaves transparent shows blue. */
const UNDER = `q 0 0 1 rg ${String(SQUARE.x)} ${String(SQUARE.y)} ${String(SQUARE.size)} ${String(SQUARE.size)} re f Q`;
const TEXT = 'BT /F1 18 Tf 40 250 Td (Hello world) Tj ET';

/** @param {string} dictionary @param {Buffer} data @param {string} before */
function inline(dictionary, data, before = '') {
  return pageWith(
    Buffer.concat([
      Buffer.from(`${TEXT}\n${UNDER}\nq ${before} ${PLACE} BI ${dictionary} ID `, 'latin1'),
      data,
      Buffer.from(' EI Q', 'latin1'),
    ]),
  );
}

const RED = Buffer.alloc(SIDE * SIDE * 3);
for (let at = 0; at < RED.length; at += 3) RED[at] = 255;
/** A stencil whose LEFT half paints (0) and right half does not (1), eight samples a byte. */
const HALF = Buffer.alloc((SIDE / 8) * SIDE);
for (let row = 0; row < SIDE; row += 1) HALF[row * 2 + 1] = 0xff;
const JPEG = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } } })
  .jpeg({ quality: 90 })
  .toBuffer();

const SHAPES = {
  rgb: inline(`/W ${String(SIDE)} /H ${String(SIDE)} /CS /RGB /BPC 8`, RED),
  stencil: inline(`/W ${String(SIDE)} /H ${String(SIDE)} /IM true /BPC 1`, HALF, '1 0 0 rg'),
  jpeg: inline('/W 64 /H 64 /CS /RGB /BPC 8 /F /DCT', JPEG),
};

// ---- measurement ----

/** @param {unknown} document */
function saved(document) {
  /** @type {Buffer[]} */
  const blocks = [];
  const callback = koffi.register(
    (/** @type {unknown} */ _self, /** @type {unknown} */ data, /** @type {number} */ size) => {
      blocks.push(Buffer.from(koffi.decode(data, 'uint8_t', Number(size))));
      return 1;
    },
    koffi.pointer(writeBlock),
  );
  try {
    if (api.save(document, { version: 1, WriteBlock: callback }, 0) !== 1) throw new Error('FPDF_SaveAsCopy failed');
    return Buffer.concat(blocks);
  } finally {
    koffi.unregister(callback);
  }
}

/**
 * The page rendered at 1 px/pt, as `[r, g, b]` for every pixel of the picture's square.
 *
 * @param {Buffer} bytes
 * @returns {number[][]}
 */
function square(bytes) {
  const document = api.load(bytes, bytes.length, null);
  const page = api.loadPage(document, 0);
  const bitmap = api.createBitmap(PAGE.width, PAGE.height, 1);
  api.fillRect(bitmap, 0, 0, PAGE.width, PAGE.height, 0xffffffff);
  api.render(bitmap, page, 0, 0, PAGE.width, PAGE.height, 0, 0);
  const stride = api.stride(bitmap);
  const pixels = koffi.decode(api.buffer(bitmap), 'uint8_t', stride * PAGE.height);
  /** @type {number[][]} */
  const out = [];
  for (let y = PAGE.height - SQUARE.y - SQUARE.size; y < PAGE.height - SQUARE.y; y += 1) {
    for (let x = SQUARE.x; x < SQUARE.x + SQUARE.size; x += 1) {
      const at = y * stride + x * 4;
      out.push([pixels[at + 2] ?? 0, pixels[at + 1] ?? 0, pixels[at] ?? 0]);
    }
  }
  api.destroyBitmap(bitmap);
  api.closePage(page);
  api.closeDocument(document);
  return out;
}

/** How many of the square's pixels differ by more than `tolerance` in any channel, and the largest difference. */
function difference(/** @type {number[][]} */ one, /** @type {number[][]} */ two, tolerance = 24) {
  let differing = 0;
  let worst = 0;
  one.forEach((pixel, index) => {
    const other = two[index] ?? [0, 0, 0];
    const delta = Math.max(...pixel.map((value, channel) => Math.abs(value - (other[channel] ?? 0))));
    if (delta > tolerance) differing += 1;
    worst = Math.max(worst, delta);
  });
  return { differing, worst };
}

/** @param {unknown} page @param {number} kind */
function firstOf(page, kind) {
  for (let index = 0; index < api.count(page); index += 1) {
    const object = api.object(page, index);
    if (api.type(object) === kind) return object;
  }
  throw new Error(`no object of type ${String(kind)}`);
}

/**
 * @param {Buffer} original
 * @param {'none' | 'bitmap' | 'rendered' | 'jpeg-raw'} conversion
 */
function editWith(original, conversion) {
  const document = api.load(original, original.length, null);
  const page = api.loadPage(document, 0);
  const image = firstOf(page, OBJECT_IMAGE);
  const pages = [page];
  if (conversion === 'bitmap' || conversion === 'rendered') {
    const bitmap = conversion === 'bitmap' ? api.getBitmap(image) : api.renderedBitmap(document, page, image);
    if (bitmap === null) throw new Error(`${conversion}: PDFium answered no bitmap`);
    if (api.setBitmap(pages, 1, image, bitmap) !== 1) throw new Error(`${conversion}: FPDFImageObj_SetBitmap refused`);
    api.destroyBitmap(bitmap);
  } else if (conversion === 'jpeg-raw') {
    const length = api.raw(image, null, 0);
    const rawBytes = Buffer.alloc(Number(length));
    api.raw(image, rawBytes, length);
    const reader = koffi.register(
      (/** @type {unknown} */ _param, /** @type {number} */ position, /** @type {unknown} */ out, /** @type {number} */ size) => {
        koffi.encode(out, 'uint8_t', [...rawBytes.subarray(Number(position), Number(position) + Number(size))], Number(size));
        return 1;
      },
      koffi.pointer(getBlock),
    );
    try {
      if (api.loadJpegInline(pages, 1, image, { m_FileLen: rawBytes.length, m_GetBlock: reader, m_Param: null }) !== 1) {
        throw new Error('FPDFImageObj_LoadJpegFileInline refused');
      }
    } finally {
      koffi.unregister(reader);
    }
  }
  const text = firstOf(page, OBJECT_TEXT);
  const wide = Buffer.alloc(('Edited'.length + 1) * 2);
  wide.write('Edited', 'utf16le');
  if (api.setText(text, wide) !== 1) throw new Error('FPDFText_SetText refused');
  if (api.generate(page) !== 1) throw new Error('FPDFPage_GenerateContent refused');
  const bytes = saved(document);
  api.closePage(page);
  api.closeDocument(document);
  return bytes;
}

let broken = false;
for (const [shape, original] of Object.entries(SHAPES)) {
  const before = square(original);
  /** @type {('none' | 'bitmap' | 'rendered' | 'jpeg-raw')[]} */
  const conversions = ['none', 'bitmap', 'rendered', ...(shape === 'jpeg' ? /** @type {const} */ (['jpeg-raw']) : [])];
  for (const conversion of conversions) {
    let line;
    try {
      const bytes = editWith(original, conversion);
      const { differing, worst } = difference(before, square(bytes));
      line = `${differing === 0 ? 'SAME   ' : 'CHANGED'} ${String(differing).padStart(5)} of ${String(before.length)} px differ (worst ${String(worst)}), saved ${String(bytes.length)} B`;
      if (conversion === 'none' && differing === 0) {
        line += '  <- CONTROL FAILED: the unconverted picture survived, so this fixture separates nothing';
        broken = true;
      }
    } catch (error) {
      line = `REFUSED ${error instanceof Error ? error.message : String(error)}`;
    }
    console.log(`${shape.padEnd(8)} ${conversion.padEnd(9)} ${line}`);
  }
}
process.exitCode = broken ? 1 : 0;
