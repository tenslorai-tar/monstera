// @ts-check
/**
 * The shim's two readers of a document's content open an encrypted one with its password
 * ([ADR-0171](../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)'s addendum).
 *
 * ## The failure this closes
 *
 * `mz_open` opened a document and nothing authenticated it, so the pages of one that opens only with a password were
 * read undecrypted, and in silence. Measured 2026-10-05 on an AES-256 document: the inline-image keeper (ADR-0126)
 * found no inline image and wrote nothing, so a PDFium edit of that page would have dropped the picture with nothing
 * said; and Optimize's image rewriter (ADR-0087) wrote a copy with no page in it.
 *
 * ## What each case runs
 *
 * Generated documents only: one page, one line of text and a picture, inline for the keeper and an image XObject for
 * the rewriter, each encrypted AES-256 by pdf-lib with a user and an owner password. The real shim runs on each, and
 * the result is drawn by MuPDF, with the password, at the picture's centre.
 *
 * ## Its controls
 *
 * - **The fixtures really need a password**: MuPDF opening each with none is refused. Otherwise an unencrypted
 *   fixture would pass every case for the wrong reason.
 * - **The same documents unencrypted, with no password**: the keeper converts and the rewriter keeps the picture, so
 *   the empty attempt `mz_authenticate` makes for a caller with no password opens what needs none.
 * - **No password, and a wrong one, are REFUSED**, never an answer: a silent *nothing to keep* is the defect.
 *
 * Usage: node scripts/proofs/shimPassword.proof.mjs [--require-shim]
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-shim');

/** Made up for this proof; no document a person owns carries them. */
const USER = 'sample-user-0171';
const OWNER = 'sample-owner-0171';

const CASES = [
  'CONTROL: both encrypted fixtures are refused by MuPDF opened with no password',
  'the keeper, given the user password, converts the inline picture and writes a copy that opens only with a password, drawn as it was',
  'the keeper, given the owner password, converts it too',
  'the keeper, given no password, is REFUSED and writes nothing, never a silent nothing-to-keep',
  'the keeper, given a wrong password, is REFUSED and writes nothing',
  'CONTROL: the keeper on the same page unencrypted, with no password, converts it',
  'the rewriter, given the user password, writes a copy that opens only with a password, with its picture drawn as it was',
  'the rewriter, given no password, is REFUSED and writes nothing, never a copy without its page',
  'CONTROL: the rewriter on the same page unencrypted, with no password, keeps its picture',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });
if (CASES.length !== 9) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 9`);

/** @param {string} name @param {boolean} held @param {string} detail */
function check(name, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// ---- fixtures ----

const PAGE = 300;
const SIDE = 16;
const RED = Buffer.alloc(SIDE * SIDE * 3);
for (let at = 0; at < RED.length; at += 3) RED[at] = 255;

/** A PDF of `objects`, numbered from 1, the first the catalogue. @param {(string | Buffer)[][]} objects */
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

/** @param {string} dictionary @param {Buffer} data */
const stream = (dictionary, data) => [`<< ${dictionary} /Length ${String(data.length)} >>\nstream\n`, data, '\nendstream'];

/** A page of one line of text and a red picture covering 50..150 on both axes, drawn by `drawing`. */
function pageOf(/** @type {Buffer} */ drawing, /** @type {string} */ xobjects, /** @type {(string | Buffer)[][]} */ extra) {
  const content = Buffer.concat([Buffer.from('BT /F1 18 Tf 40 250 Td (Hello world) Tj ET\nq 100 0 0 100 50 50 cm ', 'latin1'), drawing, Buffer.from(' Q', 'latin1')]);
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

const INLINE = pageOf(
  Buffer.concat([Buffer.from(`BI /W ${String(SIDE)} /H ${String(SIDE)} /CS /RGB /BPC 8 ID `, 'latin1'), RED, Buffer.from(' EI', 'latin1')]),
  '',
  [],
);
const XOBJECT = pageOf(Buffer.from('/Im1 Do', 'latin1'), '/Im1 6 0 R', [
  stream(`/Type /XObject /Subtype /Image /Width ${String(SIDE)} /Height ${String(SIDE)} /ColorSpace /DeviceRGB /BitsPerComponent 8`, RED),
]);

/** `bytes` encrypted AES-256 with {@link USER} and {@link OWNER}. @param {any} pdfLib @param {Buffer} bytes */
async function encrypted(pdfLib, bytes) {
  const document = await pdfLib.PDFDocument.load(bytes);
  document.encrypt({ userPassword: USER, ownerPassword: OWNER, algorithm: 'AES-256' });
  return Buffer.from(await document.save());
}

// ---- measurement ----

/**
 * The picture's centre as MuPDF draws it, `r,g,b`, or why it could not: (100, 100) in PDF space is pixel (100, 200).
 *
 * @param {any} engine @param {Uint8Array} bytes @param {string | undefined} password
 */
async function centre(engine, bytes, password) {
  let session;
  try {
    session = await engine.mupdfWriter.open(bytes, password);
  } catch (error) {
    return `refused: ${error instanceof Error ? error.name : String(error)}`;
  }
  try {
    return await engine.withDocument(session, (/** @type {any} */ document) => {
      const pixmap = document.loadPage(0).toPixmap([1, 0, 0, 1, 0, 0], engine.ColorSpace.DeviceRGB, false);
      const at = (200 * pixmap.getWidth() + 100) * pixmap.getNumberOfComponents();
      return Array.from(pixmap.getPixels().slice(at, at + 3)).join(',');
    });
  } catch (error) {
    return `could not draw: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await engine.mupdfWriter.close(session);
  }
}

/** What a shim reader did: its answer or the name of what it threw, and whether it wrote. @param {() => unknown} call */
function outcome(call, /** @type {string} */ output) {
  try {
    return { answer: JSON.stringify(call()), threw: null, wrote: existsSync(output) };
  } catch (error) {
    return { answer: null, threw: error instanceof Error ? error.name : String(error), wrote: existsSync(output) };
  }
}

/** @param {any} engine @param {any} pdfLib */
async function run(engine, pdfLib) {
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-shim-password-'));
  let named = 0;
  const path = () => join(scratch, `${String((named += 1))}.pdf`);
  /** @param {Buffer} bytes */
  const placed = (bytes) => {
    const at = path();
    writeFileSync(at, bytes);
    return at;
  };
  try {
    const inlineLocked = await encrypted(pdfLib, INLINE);
    const xobjectLocked = await encrypted(pdfLib, XOBJECT);
    const red = await centre(engine, INLINE, undefined);
    const lockedOpens = [await centre(engine, inlineLocked, undefined), await centre(engine, xobjectLocked, undefined)];
    check(CASES[0] ?? '', red === '255,0,0' && lockedOpens.every((answer) => answer.startsWith('refused')), `unencrypted centre ${red}; the encrypted ones opened with none: ${lockedOpens.join(' | ')}`);

    for (const [index, password] of [[1, USER], [2, OWNER]]) {
      const output = path();
      const kept = outcome(() => engine.keepInlineImages(placed(inlineLocked), output, 0, password), output);
      const copy = kept.wrote ? new Uint8Array(readFileSync(output)) : null;
      const opensWithNone = copy === null ? 'no copy' : await centre(engine, copy, undefined);
      const drawn = copy === null ? 'no copy' : await centre(engine, copy, USER);
      check(
        CASES[/** @type {number} */ (index)] ?? '',
        kept.answer === JSON.stringify({ converted: 1, left: 0 }) && opensWithNone.startsWith('refused') && drawn === '255,0,0',
        `answered ${kept.answer ?? `a throw (${String(kept.threw)})`}; the copy with no password: ${opensWithNone}; with the user password its centre is ${drawn}`,
      );
    }

    for (const [index, password] of [[3, undefined], [4, 'not-the-password']]) {
      const output = path();
      const kept = outcome(() => engine.keepInlineImages(placed(inlineLocked), output, 0, password), output);
      check(CASES[/** @type {number} */ (index)] ?? '', kept.threw === 'MupdfOpenRefused' && !kept.wrote, `answered ${kept.answer ?? `a throw (${String(kept.threw)})`}, and ${kept.wrote ? 'WROTE a file' : 'wrote nothing'}`);
    }

    const plainOutput = path();
    const plainKept = outcome(() => engine.keepInlineImages(placed(INLINE), plainOutput, 0), plainOutput);
    check(CASES[5] ?? '', plainKept.answer === JSON.stringify({ converted: 1, left: 0 }) && plainKept.wrote, `answered ${plainKept.answer ?? `a throw (${String(plainKept.threw)})`}`);

    const setting = { quality: 50, over: 0, to: 0 };
    const rewrittenOutput = path();
    const rewritten = outcome(() => engine.rewriteImages(placed(xobjectLocked), rewrittenOutput, setting, USER), rewrittenOutput);
    const rewrittenCopy = rewritten.wrote ? new Uint8Array(readFileSync(rewrittenOutput)) : null;
    const rewrittenWithNone = rewrittenCopy === null ? 'no copy' : await centre(engine, rewrittenCopy, undefined);
    const rewrittenDrawn = rewrittenCopy === null ? 'no copy' : await centre(engine, rewrittenCopy, USER);
    check(
      CASES[6] ?? '',
      rewritten.threw === null && rewrittenWithNone.startsWith('refused') && rewrittenDrawn === '255,0,0',
      `${rewritten.threw === null ? 'wrote' : `threw ${rewritten.threw}`}; the copy with no password: ${rewrittenWithNone}; with the user password its centre is ${rewrittenDrawn}`,
    );

    const refusedOutput = path();
    const refused = outcome(() => engine.rewriteImages(placed(xobjectLocked), refusedOutput, setting), refusedOutput);
    check(CASES[7] ?? '', refused.threw === 'MupdfOpenRefused' && !refused.wrote, `${refused.threw === null ? 'answered' : `threw ${refused.threw}`}, and ${refused.wrote ? 'WROTE a file' : 'wrote nothing'}`);

    const plainRewrittenOutput = path();
    const plainRewritten = outcome(() => engine.rewriteImages(placed(XOBJECT), plainRewrittenOutput, setting), plainRewrittenOutput);
    const plainDrawn = plainRewritten.wrote ? await centre(engine, new Uint8Array(readFileSync(plainRewrittenOutput)), undefined) : 'no copy';
    check(CASES[8] ?? '', plainRewritten.threw === null && plainDrawn === '255,0,0', `${plainRewritten.threw === null ? 'wrote' : `threw ${plainRewritten.threw}`}; its centre is ${plainDrawn}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} shim password case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('shim password case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

// THE ENTRY IS LAST, so every constant above is initialised before the first case reads one.
const shim = bindNativeEngine(ROOT);
if (shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'the shim opening an encrypted document with its password',
    why:
      `${String(CASES.length)} case(s) need the MuPDF shim:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      'The MuPDF shim is not built. Run `npm run provision:mupdf`.',
    flag: '--require-shim',
  });
} else {
  const require = createRequire(join(ROOT, 'packages/kernel/package.json'));
  const pdfLib = require('@cantoo/pdf-lib');
  const raw = await import('../../packages/kernel/dist/mupdfRaw.js');
  const writer = await import('../../packages/kernel/dist/mupdfWriter.js');
  await run(
    {
      keepInlineImages: raw.keepInlineImages,
      rewriteImages: raw.rewriteImages,
      ColorSpace: raw.ColorSpace,
      mupdfWriter: writer.mupdfWriter,
      withDocument: writer.withDocument,
    },
    pdfLib,
  );
}
