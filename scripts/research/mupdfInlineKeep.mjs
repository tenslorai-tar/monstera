// @ts-check
/**
 * Do MuPDF's own content rewrites keep an inline image? The other half of ADR-0126's "check every command that
 * regenerates a page's content".
 *
 * PDFium's generator drops an inline image (`BI … EI`), and ADR-0126 keeps it for every PDFium command. MuPDF's
 * commands that rewrite a page's content run MuPDF's filter processor, which writes an inline image back as one —
 * which is a reading of the source, and this is the measurement of it through the shipped commands:
 * `markMatchesForRedaction` then `applyRedactions` on the text beside the picture, and `sanitizeDocument` with every
 * part. Each runs through `localMupdfExecution` on a generated page, the document is serialised, and the picture's
 * square is read by PDFium — a second reader, so MuPDF is not grading its own output.
 *
 * CONTROL: the untouched page draws the picture, so a missing picture after is the command's.
 *
 * Usage: node scripts/research/mupdfInlineKeep.mjs   (after npm run build, the shim and PDFium provisioned)
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
if (bindNativeEngine(ROOT) === null) throw new Error('the MuPDF shim is not built here');
/** @param {string} relative */
const built = (relative) => import(pathToFileURL(join(ROOT, relative)).href);
const { mupdfWriter } = await built('packages/kernel/dist/mupdfWriter.js');
const { localMupdfExecution } = await built('packages/kernel/dist/mupdfSpecs.js');
const pdfium = await built('packages/kernel/dist/pdfiumFfi.js');
pdfium.openPdfium(pdfiumLibrary(ROOT));

const SQUARE = { x: 100, y: 100, size: 100 };

/** The page `hostFileAnswersLiveHost.mjs` edits: one text line and a red inline picture. */
function inlinePicturePage() {
  const red = Buffer.alloc(16 * 16 * 3);
  for (let at = 0; at < red.length; at += 3) red[at] = 255;
  const place = `${String(SQUARE.size)} 0 0 ${String(SQUARE.size)} ${String(SQUARE.x)} ${String(SQUARE.y)} cm`;
  const content = Buffer.concat([
    Buffer.from(`BT /F1 18 Tf 40 250 Td (Hello world) Tj ET\nq ${place} BI /W 16 /H 16 /CS /RGB /BPC 8 ID `, 'latin1'),
    red,
    Buffer.from(' EI Q', 'latin1'),
  ]);
  const objects = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [`<< /Length ${String(content.length)} >>\nstream\n`, content, '\nendstream'],
  ];
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
  return new Uint8Array(Buffer.concat(parts));
}

/** @param {Uint8Array} bytes */
async function pictureDrawn(bytes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    const bitmap = await pdfium.renderPageBitmap(session, 0, 300, 300);
    const x = SQUARE.x + SQUARE.size / 2;
    const y = 300 - (SQUARE.y + SQUARE.size / 2);
    const at = (y * bitmap.width + x) * 4;
    return (bitmap.bgra[at + 2] ?? 0) > 200 && (bitmap.bgra[at + 1] ?? 255) < 60 && (bitmap.bgra[at] ?? 255) < 60;
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/** @param {object[]} commands */
async function after(commands) {
  const session = await mupdfWriter.open(inlinePicturePage());
  try {
    for (const command of commands) await localMupdfExecution.apply({ session, command, sources: [], reads: undefined });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

const runs = {
  'untouched (CONTROL)': [],
  'redact the text beside it': [
    { kind: 'markMatchesForRedaction', query: 'Hello', pages: 'all' },
    { kind: 'applyRedactions', pages: 'all', cover: 'solid', images: 'pixels' },
  ],
  'redact, images removed where marked': [
    { kind: 'markMatchesForRedaction', query: 'Hello', pages: 'all' },
    { kind: 'applyRedactions', pages: 'all', cover: 'none', images: 'remove' },
  ],
  'sanitize every part': [{ kind: 'sanitizeDocument', parts: ['javascript', 'embedded-files', 'external-actions', 'flatten'] }],
};

/**
 * The page's text as PDFium reads it — the evidence that a redaction REWROTE the content: a redaction that found
 * nothing rewrites nothing, and keeps the picture for that reason alone.
 *
 * @param {Uint8Array} bytes
 */
async function textOf(bytes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    return (await pdfium.textRuns(session, 0)).runs.map((/** @type {{ text: string }} */ run) => run.text).join(' ');
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

let broken = false;
for (const [name, commands] of Object.entries(runs)) {
  let line;
  try {
    const bytes = await after(commands);
    const text = await textOf(bytes);
    line = `${(await pictureDrawn(bytes)) ? 'KEPT' : 'LOST'}  text now "${text}"`;
    if (name.startsWith('redact') && text.includes('Hello')) {
      line += '  <- the redaction removed nothing, so this row says nothing';
      broken = true;
    }
  } catch (error) {
    line = `REFUSED ${error instanceof Error ? error.message : String(error)}`;
  }
  if (name.startsWith('untouched') && !line.startsWith('KEPT')) broken = true;
  console.log(`${name.padEnd(36)} ${line}`);
}
process.exitCode = broken ? 1 : 0;
