// @ts-check
/**
 * How much memory do Ghostscript and ONLYOFFICE's x2t actually take on HEAVY inputs, contained, through the product?
 *
 * ## Why this exists
 *
 * `PDFA_BOUNDS` said *"Its memory was not measured"* and `OFFICE_BOUNDS` was set from x2t's floor — a one-sentence
 * document of each format, 330–352 MiB before any content. A job object's memory limit is a ceiling against a hostile
 * conversion, and a ceiling nobody measured an ordinary heavy document against is one that may end a person's export
 * (`CLAUDE.md`: never raise a limit without the measurement — and never trust one that has none).
 *
 * ## What it runs
 *
 * The built product: `createPdfaPlatform`/`createPdfaSource` and `createOfficePlatform`/`createOfficeSource`, so every
 * conversion goes through `createContainedHost` with the product's own limits. The job's `PeakProcessMemoryUsed` is read
 * before the job is closed, decoded through the product's registered struct — `officeLive.mjs`' method.
 *
 * Inputs are generated here: pictures are a patterned RGB raster written as PNG by this file, so their DECODED size —
 * what a converter holds — is large while the file stays small.
 *
 * - Ghostscript: 40 pages each carrying a 2550 x 3300 picture (a scan at 300 dpi), and 1,000 pages of dense text.
 * - x2t: a `.docx` of 12 photographs at 3000 x 2000, and an `.xlsx` of 50,000 rows by 10 columns.
 *
 * ## Its resolution test
 *
 * Each converter also converts a light document, and the heavy peak must exceed the light one. An instrument that read
 * the same figure for both — a peak read off the wrong job, or never updated — would report every document as fitting.
 *
 * Usage (Windows, after `npm run build`, `npm run provision:ghostscript` and `npm run provision:onlyoffice`):
 *   node scripts/research/converterPeaks.mjs
 *   node scripts/research/converterPeaks.mjs --rows N [--limit-mib M] [--timeout-s S] [--keep <pdf path>] [--area FROM:TO]
 *   node scripts/research/converterPeaks.mjs --file <xlsx> [--limit-mib M] [--timeout-s S] [--keep <pdf path>]
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { gswin64cPath } from '../provision/ghostscript.mjs';
import { x2tPath } from '../provision/onlyoffice.mjs';

const ROOT = repoRoot();

if (process.platform !== 'win32') {
  process.stderr.write('converterPeaks: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}
if (!existsSync(gswin64cPath(ROOT)) || !existsSync(x2tPath(ROOT))) {
  process.stderr.write('converterPeaks: run npm run provision:ghostscript and npm run provision:onlyoffice first.\n');
  process.exit(69);
}

/** @param {string} relative */
const built = async (relative) => import(pathToFileURL(join(ROOT, relative)).href);
const platforms = await built('apps/desktop/dist/engineHostPlatform.js');
const pdfa = await built('apps/desktop/dist/pdfaConversion.js');
const office = await built('apps/desktop/dist/officeConversion.js');
const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
const directorySurface = await built('apps/desktop/dist/win32DirectorySurface.js');

const require = createRequire(join(ROOT, 'packages', 'kernel', 'package.json'));
/** @type {{ zipSync: (files: Record<string, Uint8Array>) => Uint8Array, strToU8: (text: string) => Uint8Array }} */
const { zipSync, strToU8 } = require('fflate');
const koffi = require('koffi');

// ---- a PNG, written here ----

/** The CRC-32 table PNG chunks are checked with (ISO 3309). */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Uint8Array} data */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * An RGB picture of `width` x `height`, patterned so it compresses: the decoded raster is what a converter holds.
 *
 * @param {number} width @param {number} height @param {number} seed
 */
function picture(width, height, seed) {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y += 1) {
    const at = y * row;
    raw[at] = 0;
    for (let x = 0; x < width; x += 1) {
      const p = at + 1 + x * 3;
      raw[p] = (x + seed * 40) & 0xff;
      raw[p + 1] = (y + seed * 70) & 0xff;
      raw[p + 2] = ((x ^ y) + seed) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---- the inputs ----

/** @returns {Promise<Uint8Array>} one page, one line */
async function lightPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('A light page.', { x: 72, y: 700, size: 12, font });
  return document.save();
}

/** @returns {Promise<Uint8Array>} forty pages, each a 300 dpi scan-sized picture */
async function scannedPdf() {
  const document = await PDFDocument.create();
  const images = await Promise.all([0, 1, 2].map((seed) => document.embedPng(picture(2550, 3300, seed))));
  for (let page = 0; page < 40; page += 1) {
    const image = images[page % images.length];
    if (image === undefined) throw new Error('unreachable');
    document.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }
  return document.save();
}

/** @returns {Promise<Uint8Array>} a thousand pages of dense text */
async function textPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const line = 'The quick brown fox jumps over the lazy dog, and the lazy dog does not mind at all. '.repeat(2);
  for (let page = 0; page < 1000; page += 1) {
    const drawn = document.addPage([612, 792]);
    for (let row = 0; row < 60; row += 1) drawn.drawText(line.slice(0, 110), { x: 36, y: 760 - row * 12, size: 8, font });
  }
  return document.save();
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** @param {string} overrides @param {string} main @param {string} [defaults] */
function packageParts(overrides, main, defaults = '') {
  return {
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>${defaults}${overrides}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${main}"/></Relationships>`,
    ),
  };
}

const DOCX_MAIN =
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>';

/** @param {string} body @param {Record<string, Uint8Array>} [media] @param {string} [rels] */
function docx(body, media = {}, rels = '') {
  return zipSync({
    ...packageParts(DOCX_MAIN, 'word/document.xml', '<Default Extension="png" ContentType="image/png"/>'),
    'word/document.xml': strToU8(
      `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`,
    ),
    'word/_rels/document.xml.rels': strToU8(`${XML}<Relationships xmlns="${PKG_REL}">${rels}</Relationships>`),
    ...media,
  });
}

/** @returns {Uint8Array} a document of one sentence */
function lightDocx() {
  return docx('<w:p><w:r><w:t>A light document.</w:t></w:r></w:p>');
}

/** @returns {Uint8Array} twelve photographs at 3000 x 2000, each on its own line at six inches wide */
function photoDocx() {
  const EMU_WIDTH = 5486400;
  const EMU_HEIGHT = 3657600;
  /** @type {Record<string, Uint8Array>} */
  const media = {};
  let body = '';
  let rels = '';
  for (let index = 1; index <= 12; index += 1) {
    media[`word/media/photo${String(index)}.png`] = picture(3000, 2000, index);
    rels += `<Relationship Id="rIdP${String(index)}" Type="${REL}/image" Target="media/photo${String(index)}.png"/>`;
    body +=
      '<w:p><w:r><w:drawing><wp:inline>' +
      `<wp:extent cx="${String(EMU_WIDTH)}" cy="${String(EMU_HEIGHT)}"/><wp:docPr id="${String(index)}" name="Photo ${String(index)}"/>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      `<pic:nvPicPr><pic:cNvPr id="${String(index)}" name="photo${String(index)}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdP${String(index)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(EMU_WIDTH)}" cy="${String(EMU_HEIGHT)}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p>';
  }
  return docx(body, media, rels);
}

/**
 * A workbook of `count` rows by 10 columns, numbers and short text — with `printArea`, the sheet's own print area
 * (`_xlnm.Print_Area`, ECMA-376 §18.2.6) set to that range of rows, which is what a person's print area is.
 *
 * @param {number} count
 * @param {{ from: number, to: number }} [printArea]
 * @returns {Uint8Array}
 */
function largeXlsx(count, printArea) {
  const rows = [];
  const columns = 'ABCDEFGHIJ';
  for (let r = 1; r <= count; r += 1) {
    let cells = '';
    for (let c = 0; c < 10; c += 1) {
      const reference = `${columns[c] ?? 'A'}${String(r)}`;
      cells +=
        c % 2 === 0
          ? `<c r="${reference}"><v>${String(r * 10 + c)}</v></c>`
          : `<c r="${reference}" t="inlineStr"><is><t>row ${String(r)} col ${String(c)}</t></is></c>`;
    }
    rows.push(`<row r="${String(r)}">${cells}</row>`);
  }
  return zipSync({
    ...packageParts(
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      'xl/workbook.xml',
    ),
    'xl/workbook.xml': strToU8(
      `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
        '<sheets><sheet name="Large" sheetId="1" r:id="rId1"/></sheets>' +
        (printArea === undefined
          ? ''
          : `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Large!$A$${String(printArea.from)}:$J$${String(printArea.to)}</definedName></definedNames>`) +
        '</workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`,
    ),
  });
}

// ---- the platforms, with the job's peak read before it is closed ----

const scratch = mkdtempSync(join(tmpdir(), 'monstera-converter-peaks-'));
const sessionRoot = join(scratch, 'sessions');
mkdirSync(sessionRoot);

const user = pipes.currentUserSid();
if (!user.ok) throw new Error(`the user's SID could not be read: ${String(user.error)}`);
const base = { sessionRoot, directories: directorySurface.createWin32DirectorySurface(), user: user.value };
process.env['MONSTERA_GHOSTSCRIPT_EXECUTABLE'] = gswin64cPath(ROOT);
process.env['MONSTERA_ONLYOFFICE_EXECUTABLE'] = x2tPath(ROOT);
const pdfaPlatform = platforms.createPdfaPlatform(base);
const officePlatform = platforms.createOfficePlatform(base);
if (pdfaPlatform === null || officePlatform === null) throw new Error('a converter platform answered null with its executable handed down');

/**
 * `--rows N` measures ONE workbook of N rows instead of the set, and `--limit-mib M` and `--timeout-s S` lift the Office
 * bounds for that run only — so a document past the product's limit can be MEASURED rather than refused. The product's
 * bounds are read from the built module and printed; nothing here changes them.
 *
 * @param {string} flag
 */
function numberFlag(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : Number(process.argv[at + 1]);
}
const ROWS = numberFlag('--rows');
/** `--file <xlsx>` converts that workbook instead of a generated one — for variants a research script wrote. */
const fileAt = process.argv.indexOf('--file');
const FILE = fileAt === -1 ? undefined : process.argv[fileAt + 1];
/** `--area FROM:TO` sets the one workbook's print area to those rows. */
const areaAt = process.argv.indexOf('--area');
const AREA_ROWS = areaAt === -1 ? undefined : (process.argv[areaAt + 1] ?? '').split(':').map(Number);
const PRINT_AREA = AREA_ROWS === undefined ? undefined : { from: AREA_ROWS[0] ?? 1, to: AREA_ROWS[1] ?? 1 };
/** `--keep <path>` writes the one workbook's PDF there, so what x2t produced can be read rather than only sized. */
const keepAt = process.argv.indexOf('--keep');
const KEEP = keepAt === -1 ? undefined : process.argv[keepAt + 1];
const LIMIT_MIB = numberFlag('--limit-mib');
const TIMEOUT_S = numberFlag('--timeout-s');

/**
 * `officeLive.mjs`' wrapper: the platform, with the job's peak read before the job is closed.
 *
 * @param {any} platform @param {{ peak: number | null }} seen
 */
function measured(platform, seen) {
  return {
    ...platform,
    bounds: {
      processMemoryLimitBytes:
        LIMIT_MIB === undefined ? platform.bounds.processMemoryLimitBytes : LIMIT_MIB * 1024 * 1024,
      timeoutMs: TIMEOUT_S === undefined ? platform.bounds.timeoutMs : TIMEOUT_S * 1000,
    },
    surfaceFor: (/** @type {unknown} */ config) => {
      const surface = platform.surfaceFor(config);
      /** @type {unknown} */
      let job = null;
      const kernel = koffi.load('kernel32.dll');
      const query = kernel.func('bool QueryInformationJobObject(void *job, int cls, _Out_ void *info, uint32 len, _Out_ uint32 *ret)');
      return {
        ...surface,
        createJob: () => {
          job = surface.createJob();
          return job;
        },
        close: (/** @type {unknown} */ handle) => {
          if (handle === job && job !== null) {
            const size = koffi.sizeof('MONSTERA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION');
            const buffer = Buffer.alloc(size);
            if (query(job, 9, buffer, size, [0]) === true) {
              seen.peak = Number(koffi.decode(buffer, 'MONSTERA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION').PeakProcessMemoryUsed);
            }
          }
          surface.close(handle);
        },
      };
    },
  };
}

/**
 * @param {'pdfa' | 'office'} converter
 * @param {string} name
 * @param {Uint8Array} input
 * @param {'docx' | 'xlsx'} [format]
 */
async function run(converter, name, input, format) {
  const seen = { peak: /** @type {number | null} */ (null) };
  /** @type {string[]} */
  const said = [];
  const report = (/** @type {{ detail: string }} */ event) => {
    said.push(event.detail);
  };
  const started = Date.now();
  try {
    const converted =
      converter === 'pdfa'
        ? await pdfa.createPdfaSource(measured(pdfaPlatform, seen), report)(input)
        : await office.createOfficeSource(measured(officePlatform, seen), report)(format, input);
    /** @type {Buffer[]} */
    const pieces = [];
    for await (const piece of converted.output) pieces.push(Buffer.from(piece));
    const output = Buffer.concat(pieces);
    if (KEEP !== undefined && (ROWS !== undefined || FILE !== undefined)) writeFileSync(KEEP, output);
    return { name, ok: true, inputBytes: input.length, outputBytes: output.length, ms: Date.now() - started, peak: seen.peak, said };
  } catch (error) {
    return { name, ok: false, inputBytes: input.length, outputBytes: 0, ms: Date.now() - started, peak: seen.peak, said: [...said, formatError(error)] };
  }
}

/** @param {number | null} bytes */
const mib = (bytes) => (bytes === null ? 'UNREAD' : `${(bytes / 1048576).toFixed(1)} MiB`);

/** @type {string[]} */
const failures = [];
try {
  if (ROWS !== undefined || FILE !== undefined) {
    const one =
      FILE !== undefined
        ? await run('office', `x2t ${FILE}`, new Uint8Array(readFileSync(FILE)), 'xlsx')
        : await run('office', `x2t xlsx (${String(ROWS)} x 10)`, largeXlsx(ROWS ?? 0, PRINT_AREA), 'xlsx');
    process.stdout.write(
      `${one.name}: ${one.ok ? 'ok' : 'FAILED'} in ${String(one.inputBytes)} B, out ${String(one.outputBytes)} B, ` +
        `${String(one.ms)} ms, job peak ${mib(one.peak)} (limit this run ${String(LIMIT_MIB ?? 'product')} MiB, ` +
        `timeout ${String(TIMEOUT_S ?? 'product')} s)\n`,
    );
    if (!one.ok) process.stdout.write(`    ${one.said.join(' | ').slice(0, 400)}\n`);
    process.exitCode = one.ok ? 0 : 1;
  } else {
    await measureTheSet();
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/** The six conversions and the resolution test. */
async function measureTheSet() {
  const readings = [
    await run('pdfa', 'ghostscript light (1 page)', await lightPdf()),
    await run('pdfa', 'ghostscript scanned (40 pages at 2550x3300)', await scannedPdf()),
    await run('pdfa', 'ghostscript text (1,000 dense pages)', await textPdf()),
    await run('office', 'x2t light docx (one sentence)', lightDocx(), 'docx'),
    await run('office', 'x2t photo docx (12 at 3000x2000)', photoDocx(), 'docx'),
    await run('office', 'x2t large xlsx (50,000 x 10)', largeXlsx(50_000), 'xlsx'),
  ];
  for (const reading of readings) {
    process.stdout.write(
      `${reading.name.padEnd(46)} ${reading.ok ? 'ok    ' : 'FAILED'} in ${String(reading.inputBytes).padStart(10)} B  ` +
        `out ${String(reading.outputBytes).padStart(10)} B  ${String(reading.ms).padStart(7)} ms  job peak ${mib(reading.peak)}\n`,
    );
    if (!reading.ok) process.stdout.write(`    ${reading.said.join(' | ').slice(0, 400)}\n`);
    if (reading.peak === null || reading.peak <= 0) failures.push(`${reading.name}: the job's peak could not be read`);
  }

  // THE RESOLUTION TEST: the heavy peak must exceed the light one for each converter.
  const [gsLight, gsScan, gsText, xLight, xPhoto, xSheet] = readings;
  for (const [light, heavy] of [
    [gsLight, gsScan],
    [gsLight, gsText],
    [xLight, xPhoto],
    [xLight, xSheet],
  ]) {
    if (light?.peak == null || heavy?.peak == null || !(heavy.peak > light.peak)) {
      failures.push(`resolution: ${String(heavy?.name)} read ${mib(heavy?.peak ?? null)} against ${String(light?.name)}'s ${mib(light?.peak ?? null)}`);
    }
  }
  process.stdout.write(
    `\nlimits: PDF/A ${mib(pdfa.PDFA_BOUNDS.processMemoryLimitBytes)}, Office ${mib(office.OFFICE_BOUNDS.processMemoryLimitBytes)}\n`,
  );
  if (failures.length > 0) {
    process.stderr.write(`\nconverterPeaks — ${String(failures.length)} failure(s):\n  ${failures.join('\n  ')}\n`);
    process.exitCode = 1;
  }
}
