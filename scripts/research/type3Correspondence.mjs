// @ts-check
/**
 * Does PDFium's text-object index name the same thing as the page's n-th text-showing operator?
 *
 * ## Why this exists
 *
 * A Type 3 page cannot be rewritten by PDFium: `FPDFPage_GenerateContent` writes a Type 3 text object with no font, no
 * text and no `ET` (`fontKindEdits.mjs`, 2026-10-04), so every PDFium command that regenerates such a page now refuses
 * at its read-back and saves nothing. The owner's P1 answer is a writer on the MuPDF side that changes ONLY the edited
 * instructions. The editor names what it edits by PDFium's index (`document.textBlocks`), so that writer has to find,
 * in the content stream's own bytes, the operator a PDFium index names. This measures whether the two numberings
 * agree, before any design rests on it.
 *
 * ## What it reads
 *
 * For each page: PDFium's text objects in its own walk (`textObjectIndices`, each object's text), and the page's
 * content stream, decoded with pdf-lib and tokenised here, every `Tj`, `TJ`, `'` and `"` outside a form, with the font
 * `Tf` last named and the number of character codes it shows. The k-th object is compared with the k-th operator by
 * position, font resource and length.
 *
 * ## Its controls, on every run
 *
 * The positive control is a page of an ordinary font (`fontKindFixtures.mjs`' `type1-standard14`), where nothing about
 * Type 3 is in play: if the numberings disagree there, the instrument is wrong and the run says so instead of
 * reporting the Type 3 pages. The tokeniser's own control is a string holding every delimiter a naive split would break
 * on: `(a\)b[c]<d>)` is one operand.
 *
 * Usage: node scripts/research/type3Correspondence.mjs [file.pdf ...]
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';

import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { CHROMIUM_FIXTURE } from './chromiumType3Fixture.mjs';
import { buildFixture } from './fontKindFixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const built = (/** @type {string} */ relative) => import(pathToFileURL(join(ROOT, relative)).href);

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));
const SHOWS = new Set(['Tj', 'TJ', "'", '"']);

/**
 * A content stream as tokens: `{ kind: 'operator' | 'operand', text, codes? }`, where a string operand carries the
 * character codes it holds, and an array of strings the sum of its strings' codes. Inline images are skipped whole.
 *
 * @param {Uint8Array} bytes
 */
export function tokens(bytes) {
  /** @type {{ kind: 'operator' | 'operand', text: string, codes?: number }[]} */
  const out = [];
  let at = 0;
  /** @type {number[]} */
  const arrays = [];
  /**
   * @param {'operator' | 'operand'} kind
   * @param {string} text
   * @param {number} [codes]
   */
  const push = (kind, text, codes) => {
    if (arrays.length > 0 && kind === 'operand') {
      const top = arrays.length - 1;
      arrays[top] = (arrays[top] ?? 0) + (codes ?? 0);
      return;
    }
    out.push(codes === undefined ? { kind, text } : { kind, text, codes });
  };
  while (at < bytes.length) {
    const byte = bytes[at] ?? 0;
    if (WHITE.has(byte)) {
      at += 1;
      continue;
    }
    if (byte === 0x25) {
      while (at < bytes.length && bytes[at] !== 0x0a && bytes[at] !== 0x0d) at += 1;
      continue;
    }
    if (byte === 0x28) {
      let depth = 1;
      let codes = 0;
      at += 1;
      while (at < bytes.length && depth > 0) {
        const c = bytes[at] ?? 0;
        if (c === 0x5c) {
          const next = bytes[at + 1] ?? 0;
          if (next >= 0x30 && next <= 0x37) {
            let digits = 1;
            while (digits < 3 && (bytes[at + 1 + digits] ?? 0) >= 0x30 && (bytes[at + 1 + digits] ?? 0) <= 0x37) digits += 1;
            at += 1 + digits;
          } else if (next === 0x0d || next === 0x0a) {
            at += next === 0x0d && bytes[at + 2] === 0x0a ? 3 : 2;
            continue;
          } else {
            at += 2;
          }
          codes += 1;
          continue;
        }
        if (c === 0x28) depth += 1;
        if (c === 0x29) depth -= 1;
        if (depth > 0) codes += 1;
        at += 1;
      }
      push('operand', 'string', codes);
      continue;
    }
    if (byte === 0x3c && bytes[at + 1] !== 0x3c) {
      let digits = 0;
      at += 1;
      while (at < bytes.length && bytes[at] !== 0x3e) {
        if (!WHITE.has(bytes[at] ?? 0)) digits += 1;
        at += 1;
      }
      at += 1;
      push('operand', 'hex', Math.ceil(digits / 2));
      continue;
    }
    if (byte === 0x5b) {
      arrays.push(0);
      at += 1;
      continue;
    }
    if (byte === 0x5d) {
      const codes = arrays.pop() ?? 0;
      at += 1;
      push('operand', 'array', codes);
      continue;
    }
    if (byte === 0x3c || byte === 0x3e) {
      at += 2;
      push('operand', byte === 0x3c ? '<<' : '>>');
      continue;
    }
    let end = at + 1;
    if (byte === 0x2f) {
      while (end < bytes.length && !WHITE.has(bytes[end] ?? 0) && !DELIMITERS.has(bytes[end] ?? 0)) end += 1;
      push('operand', new TextDecoder('latin1').decode(bytes.subarray(at, end)));
      at = end;
      continue;
    }
    while (end < bytes.length && !WHITE.has(bytes[end] ?? 0) && !DELIMITERS.has(bytes[end] ?? 0)) end += 1;
    const word = new TextDecoder('latin1').decode(bytes.subarray(at, end));
    at = end;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/u.test(word) || word === 'true' || word === 'false' || word === 'null') {
      push('operand', word);
      continue;
    }
    if (word === 'BI') {
      // AN INLINE IMAGE'S DATA IS BYTES, not tokens: skip to the EI that follows whitespace after ID.
      const id = indexOfWord(bytes, 'ID', at);
      const ei = indexOfWord(bytes, 'EI', id + 3);
      at = ei < 0 ? bytes.length : ei + 2;
      push('operator', 'BI…EI');
      continue;
    }
    push('operator', word);
  }
  return out;
}

/** The first `word` at or after `from` with whitespace before and after it, or -1. */
function indexOfWord(/** @type {Uint8Array} */ bytes, /** @type {string} */ word, /** @type {number} */ from) {
  const a = word.charCodeAt(0);
  const b = word.charCodeAt(1);
  for (let at = from; at + 1 < bytes.length; at += 1) {
    if (bytes[at] === a && bytes[at + 1] === b && WHITE.has(bytes[at - 1] ?? 0x20) && WHITE.has(bytes[at + 2] ?? 0x20)) return at;
  }
  return -1;
}

/** Every text-showing operator on the page, outside forms: the font last named, and the codes it shows. */
export function shows(/** @type {Uint8Array} */ content) {
  /** @type {{ font: string, codes: number }[]} */
  const found = [];
  let font = '';
  /** @type {{ text: string, codes?: number }[]} */
  let operands = [];
  for (const token of tokens(content)) {
    if (token.kind === 'operand') {
      operands.push(token);
      continue;
    }
    if (token.text === 'Tf') font = operands[0]?.text ?? '';
    if (SHOWS.has(token.text)) found.push({ font, codes: operands.at(-1)?.codes ?? 0 });
    operands = [];
  }
  return found;
}

/** The page's content, its streams decoded and joined as the specification joins them. */
async function contentOf(/** @type {Uint8Array} */ bytes, /** @type {number} */ page) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const node = doc.getPage(page).node;
  const contents = node.get(PDFName.of('Contents'));
  /** @type {unknown[]} */
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const parts = refs.map((ref) => {
    const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(stream instanceof PDFRawStream)) throw new Error(`page ${String(page)}'s content is not a raw stream`);
    const filter = stream.dict.get(PDFName.of('Filter'));
    return filter === undefined ? stream.contents : new Uint8Array(inflateSync(stream.contents));
  });
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length + 1, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length + 1;
    joined[at - 1] = 0x0a;
  }
  return joined;
}

async function measure(/** @type {string} */ label, /** @type {Uint8Array} */ bytes, /** @type {any} */ pdfium) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    const indices = await pdfium.textObjectIndices(session, 0);
    const texts = await Promise.all(indices.map((/** @type {number} */ index) => pdfium.textObjectText(session, 0, index)));
    const every = shows(await contentOf(bytes, 0));
    // THE RULE UNDER TEST: PDFium makes no object for an operator that shows no code, so position counts only those
    // that show one. `everyOperator` is the count without the rule, so a run can see what the rule decides.
    const found = every.filter((show) => show.codes > 0);
    const lengths = texts.map((/** @type {string} */ text) => Array.from(text).length);
    const agreeing = lengths.filter((length, at) => found[at]?.codes === length).length;
    const disagreements = lengths.flatMap((length, at) =>
      found[at]?.codes === length ? [] : [{ at, text: texts[at], chars: length, codes: found[at]?.codes, font: found[at]?.font }],
    );
    return { label, objects: indices.length, everyOperator: every.length, operators: found.length, agreeingLengths: agreeing, disagreements };
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

const library = pdfiumLibrary(ROOT);
if (library === null || !existsSync(library)) {
  process.stdout.write('UNVERIFIABLE: PDFium is not provisioned (scripts/provision/pdfium.mjs)\n');
  process.exit(0);
}
const pdfium = await built('packages/kernel/dist/pdfiumFfi.js');
pdfium.openPdfium(library);

// THE TOKENISER'S OWN CONTROL: one string operand holding every delimiter a naive split breaks on.
const control = shows(new TextEncoder().encode('BT /F1 12 Tf (a\\)b[c]<d>) Tj ET'));
// NINE CODES: a ) b [ c ] < d >, the escaped parenthesis one code and the brackets and angles inside the string.
if (control.length !== 1 || control[0]?.codes !== 9 || control[0]?.font !== '/F1') {
  throw new Error(`the tokeniser read the control as ${JSON.stringify(control)}`);
}

const ordinary = await measure('control: type1-standard14', await buildFixture('type1-standard14'), pdfium);
if (ordinary.objects !== ordinary.operators || ordinary.agreeingLengths !== ordinary.objects) {
  throw new Error(`the positive control disagrees, so the instrument is wrong: ${JSON.stringify(ordinary)}`);
}
/**
 * THE HARD SHAPES, each a line of its own between two ordinary ones, in Helvetica so nothing but the operator differs:
 * an empty string, the two quote operators, a TJ of spacing alone, text that only clips (render mode 7), text inside
 * marked content and a saved graphics state. Each is a place where one numbering could count an operator the other
 * does not.
 */
async function hardShapes() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont('Helvetica');
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  const content = [
    'BT /F1 12 Tf 20 360 Td (first) Tj ET',
    'BT /F1 12 Tf 20 340 Td () Tj ET',
    'BT /F1 12 Tf 14 TL 20 320 Td (quote) \' ET',
    'BT /F1 12 Tf 20 300 Td 1 0 (dquote) " ET',
    'BT /F1 12 Tf 20 280 Td [ -100 ] TJ ET',
    'BT /F1 12 Tf 7 Tr 20 260 Td (clip) Tj ET',
    '/Span <</MCID 0>> BDC BT /F1 12 Tf 20 240 Td (marked) Tj ET EMC',
    'q BT /F1 12 Tf 20 220 Td (saved) Tj ET Q',
    'BT /F9 12 Tf 20 210 Td (nofont) Tj ET',
    'BT /F1 12 Tf 20 200 Td (last) Tj ET',
  ].join('\n');
  const stream = doc.context.flateStream(content);
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  return doc.save({ useObjectStreams: false });
}

const rows = [ordinary, await measure('type3 (hand-built)', await buildFixture('type3'), pdfium)];
rows.push(await measure('hard shapes', await hardShapes(), pdfium));
rows.push(await measure('chromium-type3.pdf', new Uint8Array(readFileSync(CHROMIUM_FIXTURE)), pdfium));
for (const file of process.argv.slice(2)) rows.push(await measure(file, new Uint8Array(readFileSync(file)), pdfium));
for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
