// @ts-check
/**
 * Office import, live: three generated documents through the PRODUCT'S converter, contained
 * ([ADR-0120](../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
 *
 * ## What this runs, and why not the research harness
 *
 * `x2tContained.mjs` measured x2t inside the container with the research surface, which applied the
 * AppContainer alone. ADR-0120 recorded what that left unmeasured: the job object's limits and the Low
 * integrity level, which the product's `containedProgram` applies. This runs the built product code —
 * `createOfficePlatform` and `createOfficeSource` from `apps/desktop/dist` — so every conversion goes
 * through `createContainedHost`, which reads back job membership, integrity and limits and refuses to
 * resume a process that is not contained.
 *
 * ## The inputs are generated here, by no ONLYOFFICE tool
 *
 * A minimal `.docx`, `.xlsx` and `.pptx` written with `fflate` from the parts each format requires, each
 * carrying one known sentence. Document Builder's own output inserted a watermark into a slide it made
 * and wrote a workbook with no sheet (ADR-0120), so it is not the source of anything measured here.
 *
 * ## What is read back
 *
 * - each PDF's text, through the provisioned Poppler, and the sentence must be in it;
 * - the fonts embedded, whose families must be ones the tree bundles (Carlito stands in for the
 *   Calibri the three name). WHICH FILE is not separable here: this machine's `C:\Windows\Fonts` holds a
 *   Carlito byte-identical to the tree's. That the cache names the tree's is `onlyofficeFontCache.proof`'s;
 *   that no cache path names anything else is `bundledOnly`'s, at provisioning;
 * - the job's PEAK process memory, decoded through the product's own registered struct rather than a
 *   layout written here — the figure `OFFICE_BOUNDS` is set against.
 *
 * ## The control
 *
 * The same `.docx` under a 16 MiB process limit must NOT convert: that proves the limit reaches x2t, so
 * the bound the product sets is one the converter actually meets rather than one written beside it.
 *
 * Usage (Windows, after `npm run build` and `npm run provision:onlyoffice`):
 *   node scripts/research/officeLive.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { x2tPath } from '../provision/onlyoffice.mjs';
import { pdftotextPath } from '../provision/poppler.mjs';

const ROOT = repoRoot();

if (process.platform !== 'win32') {
  process.stderr.write('officeLive: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}
if (!existsSync(x2tPath(ROOT)) || !existsSync(pdftotextPath(ROOT))) {
  process.stderr.write('officeLive: run npm run provision:onlyoffice and npm run provision:poppler first.\n');
  process.exit(69);
}

/** @param {string} relative */
const built = async (relative) => import(pathToFileURL(join(ROOT, relative)).href);
const platforms = await built('apps/desktop/dist/engineHostPlatform.js');
const office = await built('apps/desktop/dist/officeConversion.js');
const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
const directorySurface = await built('apps/desktop/dist/win32DirectorySurface.js');

const require = createRequire(join(ROOT, 'packages', 'kernel', 'package.json'));
/** @type {{ zipSync: (files: Record<string, Uint8Array>) => Uint8Array, strToU8: (text: string) => Uint8Array }} */
const { zipSync, strToU8 } = require('fflate');
const koffi = require('koffi');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** @param {Record<string, string>} parts */
function zipOf(parts) {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
}

/** @param {string} overrides @param {string} main */
function packageParts(overrides, main) {
  return {
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${main}"/></Relationships>`,
  };
}

/** The smallest DrawingML theme: twelve colours, one font pair, and three of each format style. */
function theme() {
  const colour = (/** @type {string} */ name, /** @type {string} */ rgb) => `<a:${name}><a:srgbClr val="${rgb}"/></a:${name}>`;
  const colours = [
    ['dk1', '000000'], ['lt1', 'FFFFFF'], ['dk2', '1F2937'], ['lt2', 'F3F4F6'], ['accent1', '2563EB'], ['accent2', '16A34A'],
    ['accent3', 'DC2626'], ['accent4', 'CA8A04'], ['accent5', '9333EA'], ['accent6', '0891B2'], ['hlink', '1D4ED8'], ['folHlink', '7C3AED'],
  ];
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>';
  return (
    `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Live"><a:themeElements>` +
    `<a:clrScheme name="Live">${colours.map(([name, rgb]) => colour(name ?? '', rgb ?? '')).join('')}</a:clrScheme>` +
    '<a:fontScheme name="Live"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    `<a:fmtScheme name="Live"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${effect.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme>` +
    '</a:themeElements></a:theme>'
  );
}

/** The three documents, each carrying one sentence the PDF must read back. */
const DOCUMENTS = {
  docx: {
    sentence: 'MONSTERA OFFICE LIVE DOCX',
    bytes: zipOf({
      ...packageParts(
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        'word/document.xml',
      ),
      'word/document.xml':
        `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        '<w:p><w:r><w:t>MONSTERA OFFICE LIVE DOCX</w:t></w:r></w:p></w:body></w:document>',
    }),
  },
  xlsx: {
    sentence: 'MONSTERA OFFICE LIVE XLSX',
    bytes: zipOf({
      ...packageParts(
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
        'xl/workbook.xml',
      ),
      'xl/workbook.xml':
        `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
        '<sheets><sheet name="Live" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml':
        `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>MONSTERA OFFICE LIVE XLSX</t></is></c></row></sheetData></worksheet>',
    }),
  },
  pptx: {
    sentence: 'MONSTERA OFFICE LIVE PPTX',
    bytes: zipOf({
      ...packageParts(
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
          '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
          '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
          '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
          '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        'ppt/presentation.xml',
      ),
      'ppt/presentation.xml':
        `${XML}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
        '<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        `${XML}<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide1.xml"/></Relationships>`,
      'ppt/slides/slide1.xml':
        `${XML}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800"/><a:t>MONSTERA OFFICE LIVE PPTX</a:t></a:r></a:p></p:txBody></p:sp>' +
        '</p:spTree></p:cSld></p:sld>',
      'ppt/slides/_rels/slide1.xml.rels':
        `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
      'ppt/slideLayouts/slideLayout1.xml':
        `${XML}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels':
        `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
      'ppt/slideMasters/slideMaster1.xml':
        `${XML}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>' +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
      // A THEME IS REQUIRED IN PRACTICE, measured: without one x2t's script stops on an undefined read (exit 80).
      // Every deck an application writes carries one; this is the smallest the schema allows.
      'ppt/slideMasters/_rels/slideMaster1.xml.rels':
        `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`,
      'ppt/theme/theme1.xml': theme(),
    }),
  },
};

const scratch = mkdtempSync(join(tmpdir(), 'monstera-office-live-'));
const sessionRoot = join(scratch, 'sessions');
mkdirSync(sessionRoot);

const user = pipes.currentUserSid();
if (!user.ok) throw new Error(`the user's SID could not be read: ${String(user.error)}`);
/** The base `createOfficePlatform` reads: exactly the three fields its body takes. */
const base = { sessionRoot, directories: directorySurface.createWin32DirectorySurface(), user: user.value };
process.env['MONSTERA_ONLYOFFICE_EXECUTABLE'] = x2tPath(ROOT);
const platform = platforms.createOfficePlatform(base);
if (platform === null) throw new Error('createOfficePlatform answered null with the executable handed down');

/**
 * The platform with the job's peak read before the job is closed.
 *
 * @param {number | undefined} memoryLimit
 * @param {{ peak: number | null }} seen
 */
function measured(memoryLimit, seen) {
  return {
    ...platform,
    bounds: memoryLimit === undefined ? platform.bounds : { ...platform.bounds, processMemoryLimitBytes: memoryLimit },
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
            // THE PRODUCT'S OWN STRUCT, registered by win32HostSurface: decoded by name, never by offsets written here.
            const size = koffi.sizeof('MONSTERA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION');
            const buffer = Buffer.alloc(size);
            if (query(job, 9, buffer, size, [0]) === true) {
              const decoded = koffi.decode(buffer, 'MONSTERA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION');
              seen.peak = Number(decoded.PeakProcessMemoryUsed);
            }
          }
          surface.close(handle);
        },
      };
    },
  };
}

/** @type {string[]} */
const failures = [];
const reports = [];

/**
 * @param {'docx' | 'xlsx' | 'pptx'} format
 * @param {number | undefined} memoryLimit
 */
async function convert(format, memoryLimit) {
  const seen = { peak: /** @type {number | null} */ (null) };
  const sink = /** @type {string[]} */ ([]);
  const source = office.createOfficeSource(measured(memoryLimit, seen), (/** @type {{ detail: string }} */ event) => {
    sink.push(event.detail);
  });
  const started = Date.now();
  try {
    const converted = await source(format, DOCUMENTS[format].bytes);
    const chunks = [];
    for await (const chunk of converted.output) chunks.push(chunk);
    return { ok: true, pdf: Buffer.concat(chunks), ms: Date.now() - started, peak: seen.peak, said: sink };
  } catch (error) {
    return { ok: false, pdf: null, ms: Date.now() - started, peak: seen.peak, said: [...sink, formatError(error)] };
  }
}

try {
  for (const format of /** @type {const} */ (['docx', 'xlsx', 'pptx'])) {
    const result = await convert(format, undefined);
    if (!result.ok || result.pdf === null) {
      failures.push(`${format}: no PDF — ${result.said.join(' | ')}`);
      continue;
    }
    const file = join(scratch, `${format}.pdf`);
    writeFileSync(file, result.pdf);
    const text = spawnSync(pdftotextPath(ROOT), [file, '-'], { encoding: 'utf8' }).stdout.replace(/\s+/gu, ' ').trim();
    const fonts = [...new Set(result.pdf.toString('latin1').match(/\/BaseFont *\/[A-Za-z+-]+/gu) ?? [])];
    const read = text.includes(DOCUMENTS[format].sentence);
    const ownFonts = fonts.length > 0 && fonts.every((font) => /Carlito|Caladea|Asana|OpenSymbol|ASC/u.test(font));
    reports.push(
      `${format}: ${String(result.pdf.length)} B in ${String(result.ms)} ms, job peak ` +
        `${result.peak === null ? 'UNREAD' : `${(result.peak / 1048576).toFixed(1)} MiB`}, fonts ${fonts.join(' ')}, ` +
        `sentence ${read ? 'read back' : 'MISSING'}`,
    );
    if (!result.pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) failures.push(`${format}: the output is not a PDF`);
    if (!read) failures.push(`${format}: the sentence is not in the PDF's text: "${text.slice(0, 120)}"`);
    if (!ownFonts) failures.push(`${format}: a font outside the tree was embedded: ${fonts.join(' ')}`);
    if (result.peak === null || result.peak <= 0) failures.push(`${format}: the job's peak could not be read`);
  }

  // ---- CONTROL: the job's limit reaches x2t ----
  const starved = await convert('docx', 16 * 1024 * 1024);
  reports.push(`control, docx under a 16 MiB process limit: ${starved.ok ? 'CONVERTED' : `refused — ${starved.said.join(' | ').slice(0, 200)}`}`);
  if (starved.ok) failures.push('control: x2t converted under a 16 MiB limit, so the job limit does not reach it');

  process.stdout.write(`${reports.join('\n')}\n`);
  if (failures.length > 0) {
    process.stderr.write(`\nofficeLive — ${String(failures.length)} failure(s):\n  ${failures.join('\n  ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('\nAll three converted contained through the product code, and the control refused.\n');
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
