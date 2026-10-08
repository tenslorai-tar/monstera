// @ts-check
/**
 * Hebrew and Arabic from a real PDF, through the real read, to the words an editable deck holds
 * ([ADR-0210](../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * `editablePresentation.test.ts` proves the slide model from content handed to it. THIS proves what PDFium actually hands
 * it for right-to-left text, because the two halves agreeing on a convention nobody wrote down is how the first version of
 * the model came to be wrong: PDFium answers the WORDS of a right-to-left line as they sit on the page, left to right,
 * each word's own letters in reading order. A deck that wrote the line as answered would show its first word at the
 * left edge of a right-to-left paragraph.
 *
 * ## What each fixture is
 *
 * - **Bundled fonts.** The page is drawn by the kernel's own text box through MuPDF's layout engine, which carries Noto
 *   Serif Hebrew and Noto Naskh Arabic (ADR-0128), then baked into the page's content. That is what Monstera itself
 *   writes, so it is the right-to-left text a person's own document holds.
 * - **Three producers.** A Hebrew sentence drawn the three ways measured in the field on 2026-10-08, against PDFium
 *   153.0.7999.0: one text object of glyphs in visual order, one object per word placed right to left, and one object per
 *   word placed left to right. A type 0 font with no font program is enough, since a read needs the characters and their
 *   places and never draws them, so the fixtures carry no font file.
 *
 * ## Its controls
 *
 * - The raw words of the one-object producer are NOT in reading order. A model that took PDFium's answer as given would
 *   pass every other case, so this one shows the reordering is the thing under test.
 * - A left-to-right line beside them is left exactly as drawn, so the reordering is not a reversal of everything.
 * - The deck is read back by a zip reader and an XML parser that are not the writer.
 *
 * Usage: node scripts/proofs/rtlDeck.proof.mjs [--require-pdfium]
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '@cantoo/pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';
import { Window } from 'happy-dom';

import { RTL_DECK, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE = process.argv.includes('--require-pdfium');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'Hebrew and Arabic in the editable deck',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}
if (bindNativeEngine(root) === null) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'Hebrew and Arabic in the editable deck',
    why: 'The MuPDF shim is not built, and the bundled-font fixture is drawn by it. Run `npm run provision:mupdf`.',
    flag: '--require-pdfium',
  });
}

refuseStaleBuild(root, RTL_DECK, 10);

const { openPdfium, onImage, pageContent, promoteFormObjects, textRuns } = await import('../../packages/kernel/dist/pdfiumFfi.js');
const { assemblePageContent } = await import('../../packages/kernel/dist/pageContentAssemble.js');
const { buildSlide } = await import('../../packages/kernel/dist/slideModel.js');
const { resolveSlide } = await import('../../packages/kernel/dist/slideResolve.js');
const { presentationParts, slideSize } = await import('../../packages/kernel/dist/presentationDocument.js');
const { ooxmlPackage } = await import('../../packages/kernel/dist/ooxmlPackage.js');
const { localMupdfExecution } = await import('../../packages/kernel/dist/commandSpecs.js');
const { mupdfWriter, withDocument } = await import('../../packages/kernel/dist/mupdfWriter.js');

openPdfium(library);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 11 });

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function check(name, ok, detail) {
  const mark = roster.mark();
  if (!ok) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** @param {string} text */
const codes = (text) => [...text].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join(' ');

const HEBREW_WORDS = ['שלום', 'עולם', 'זה', 'משפט', 'בעברית'];
const HEBREW = HEBREW_WORDS.join(' ');
// TWO WORDS WITHOUT A LAM: MuPDF's text box draws a lam in a glyph its own ToUnicode does not map (PDFium answers U+01C4
// for it, measured 2026-10-08), a defect of the producer's text map that no reading order can repair.
const ARABIC = `${String.fromCodePoint(0x0645, 0x0631, 0x062d, 0x0628, 0x0627)} ${String.fromCodePoint(0x0628, 0x0643, 0x0645)}`;
const LATIN = 'A level English line';

// ---------------------------------------------------------------------------------------------------------------------
// THE DECK, built the way the export builds it and read back by a second reader.

/**
 * What the editable export holds for page 0 of `bytes`: each text box's words and whether it is right to left.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ text: string, rtl: boolean }[]>}
 */
async function deckBoxes(bytes) {
  const read = await onImage({ bytes, opensWith: undefined }, (session) => pageContent(session, 0));
  const { blob, ...meta } = read;
  const content = assemblePageContent(meta, blob);
  const size = { width: content.frame.crop.x1 - content.frame.crop.x0, height: content.frame.crop.y1 - content.frame.crop.y0 };
  const deck = slideSize(size);
  const built = buildSlide(content, deck);
  if (built.kind !== 'editable') throw new Error(`the page fell back to Exact look: ${built.reason}`);
  const slide = await resolveSlide(built.slide, {
    cut: () => Promise.reject(new Error('this page cuts no picture')),
    page: () => Promise.reject(new Error('this page is not a scan')),
  });
  /** @returns {AsyncGenerator<any>} */
  async function* pages() {
    yield { size, slide };
  }
  /** @type {Uint8Array[]} */
  const chunks = [];
  for await (const chunk of ooxmlPackage(presentationParts(pages(), size, 1, { editable: true }))) chunks.push(chunk);
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  const files = unzipSync(joined);
  const xml = strFromU8(files['ppt/slides/slide1.xml'] ?? new Uint8Array());
  const window = new Window();
  const document = new window.DOMParser().parseFromString(xml, 'text/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error('the slide is not well formed XML');
  return [...document.getElementsByTagName('p:sp')]
    .filter((shape) => shape.getElementsByTagName('p:txBody').length > 0)
    .map((shape) => ({
      text: [...shape.getElementsByTagName('a:t')].map((t) => t.textContent ?? '').join(''),
      rtl: shape.getElementsByTagName('a:pPr')[0]?.getAttribute('rtl') === '1',
    }));
}

// ---------------------------------------------------------------------------------------------------------------------
// FIXTURE ONE: the kernel's own text box, drawn by MuPDF's layout engine in its bundled faces, baked into the page.

/**
 * @param {{ text: string, direction: 'left-to-right' | 'right-to-left', y: number }[]} marks
 * @returns {Promise<Uint8Array>}
 */
async function bundledPage(marks) {
  const made = await PDFDocument.create();
  made.addPage([612, 792]);
  const blank = await made.save();
  const session = await mupdfWriter.open(blank);
  try {
    for (const mark of marks) {
      await localMupdfExecution.apply({
        session,
        command: {
          kind: 'addAnnotation',
          page: 0,
          annotation: {
            type: 'text-box',
            rect: { x0: 72, y0: mark.y, x1: 540, y1: mark.y + 60 },
            colour: [0, 0, 0],
            opacity: 1,
            fontSize: 24,
            font: 'sans',
            text: mark.text,
            direction: mark.direction,
          },
          stamp: { author: 'Proof', created: '2026-10-08T00:00:00.000Z' },
        },
        sources: [],
        reads: undefined,
      });
    }
    await withDocument(session, (/** @type {any} */ document) => document.bake(true, true));
    return new Uint8Array(await mupdfWriter.serialise(session));
  } finally {
    await mupdfWriter.close(session);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// FIXTURE TWO: a type 0 font with no program, so a text object is exactly the glyphs and places the case states.

/**
 * @param {{ text: string, x: number, y: number }[]} objects every text object, drawn as one glyph string at (x, y), in drawing order
 * @param {number} size
 */
function syntheticPage(objects, size = 18) {
  /** @type {Map<string, number>} */
  const gids = new Map();
  /** @param {string} text */
  const hexOf = (text) => {
    let out = '';
    for (const ch of text) {
      let gid = gids.get(ch);
      if (gid === undefined) {
        gid = gids.size + 1;
        gids.set(ch, gid);
      }
      out += gid.toString(16).padStart(4, '0');
    }
    return out;
  };
  const content = objects.map((object) => `BT /F1 ${String(size)} Tf ${object.x.toFixed(2)} ${String(object.y)} Td <${hexOf(object.text)}> Tj ET`).join('\n');
  const widths = [...gids.entries()].map(([ch, gid]) => `${String(gid)} [${ch === ' ' ? '280' : '560'}]`).join(' ');
  const bfchars = [...gids.entries()]
    .map(([ch, gid]) => `<${gid.toString(16).padStart(4, '0')}> <${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}>`)
    .join('\n');
  const toUnicode =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def ' +
    `/CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange ${String(gids.size)} beginbfchar\n${bfchars}\n` +
    'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const bodies = [
    '<< /Type /Font /Subtype /Type0 /BaseFont /Proof /Encoding /Identity-H /DescendantFonts [2 0 R] /ToUnicode 5 0 R >>',
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Proof /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 3 0 R /CIDToGIDMap /Identity /DW 560 /W [${widths}] >>`,
    '<< /Type /FontDescriptor /FontName /Proof /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 9 0 R >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    `<< /Length ${String(toUnicode.length)} >>\nstream\n${toUnicode}\nendstream`,
    '<< /Type /Page /Parent 7 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 1 0 R >> >> >>',
    '<< /Type /Pages /Kids [6 0 R] /Count 1 >>',
    '<< /Type /Catalog /Pages 7 0 R >>',
    // THE FONT PROGRAM, built here: a glyph with no outline has no box to read, and a producer's own font always has one.
    (() => {
      const program = squareFont(gids.size + 1);
      return `<< /Length ${String(program.length)} /Length1 ${String(program.length)} >>\nstream\n${program}\nendstream`;
    })(),
  ];
  let out = '%PDF-1.7\n';
  /** @type {number[]} */
  const offsets = [];
  bodies.forEach((body, n) => {
    offsets.push(out.length);
    out += `${String(n + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const at = out.length;
  out += `xref\n0 ${String(bodies.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(bodies.length + 1)} /Root 8 0 R >>\nstartxref\n${String(at)}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/**
 * A TrueType font of `count` glyphs, every one a square 400 wide and 700 tall, as a string of one byte per character.
 *
 * Only the tables a face needs to load and give a glyph its box: `head`, `hhea`, `maxp`, `hmtx`, `loca` and `glyf`. A
 * type 0 font addressed by glyph index (`/CIDToGIDMap /Identity`) reads no character map.
 *
 * @param {number} count
 */
function squareFont(count) {
  /** @param {number} value @param {number} bytes */
  const uint = (value, bytes) => {
    const out = Buffer.alloc(bytes);
    if (bytes === 2) out.writeUInt16BE(value & 0xffff);
    else out.writeUInt32BE(value >>> 0);
    return out;
  };
  /** @param {number} value */
  const int16 = (value) => {
    const out = Buffer.alloc(2);
    out.writeInt16BE(value);
    return out;
  };
  const glyph = Buffer.concat([
    int16(1), int16(50), int16(0), int16(450), int16(700), // one contour, and its box
    uint(3, 2), // the contour ends at point 3
    uint(0, 2), // no instructions
    Buffer.from([1, 1, 1, 1]), // four on-curve points, each a 16 bit delta in x and in y
    int16(50), int16(400), int16(0), int16(-400),
    int16(0), int16(0), int16(700), int16(0),
  ]);
  const padded = Buffer.concat([glyph, Buffer.alloc((4 - (glyph.length % 4)) % 4)]);
  const glyf = Buffer.concat(Array.from({ length: count }, () => padded));
  const loca = Buffer.concat(Array.from({ length: count + 1 }, (_, at) => uint((at * padded.length) / 2, 2)));
  const hmtx = Buffer.concat(Array.from({ length: count }, () => Buffer.concat([uint(560, 2), int16(50)])));
  const head = Buffer.concat([
    uint(0x00010000, 4), uint(0x00010000, 4), uint(0, 4), uint(0x5f0f3cf5, 4), uint(0, 2), uint(1000, 2),
    Buffer.alloc(16), // created and modified
    int16(0), int16(-200), int16(1000), int16(800), uint(0, 2), uint(8, 2), int16(2), int16(0), int16(0),
  ]);
  const hhea = Buffer.concat([
    uint(0x00010000, 4), int16(800), int16(-200), int16(0), uint(1000, 2), int16(0), int16(0), int16(1000), int16(1), int16(0), int16(0),
    Buffer.alloc(8), int16(0), uint(count, 2),
  ]);
  const maxp = Buffer.concat([uint(0x00010000, 4), uint(count, 2), uint(4, 2), uint(1, 2), uint(0, 2), uint(0, 2), uint(1, 2), uint(0, 2), uint(0, 2), uint(0, 2), uint(0, 2), uint(0, 2), uint(0, 2), uint(0, 2), uint(0, 2)]);
  const tables = /** @type {const} */ ([
    ['glyf', glyf],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', loca],
    ['maxp', maxp],
  ]);
  const directory = Buffer.concat([uint(0x00010000, 4), uint(tables.length, 2), uint(64, 2), uint(2, 2), uint(32, 2)]);
  let offset = directory.length + tables.length * 16;
  /** @type {Buffer[]} */
  const entries = [];
  /** @type {Buffer[]} */
  const bodies = [];
  for (const [tag, table] of tables) {
    entries.push(Buffer.concat([Buffer.from(tag, 'latin1'), uint(0, 4), uint(offset, 4), uint(table.length, 4)]));
    const body = Buffer.concat([table, Buffer.alloc((4 - (table.length % 4)) % 4)]);
    bodies.push(body);
    offset += body.length;
  }
  return Buffer.concat([directory, ...entries, ...bodies]).toString('latin1');
}

/** A space is narrower than a letter, as in every text face: a gap this wide between two words is a space, not a column. */
const SPACE_ADVANCE = 0.28 * 18;
const ADVANCE = 0.56 * 18;
/** @param {string} text */
const widthOf = (text) => [...text].reduce((sum, ch) => sum + (ch === ' ' ? SPACE_ADVANCE : ADVANCE), 0);
/**
 * A word's glyphs in the order a producer draws them for a right-to-left line: reversed, as they sit on the page.
 *
 * @param {string} word
 */
const visual = (word) => [...word].reverse().join('');

async function main() {
  process.stdout.write('# Hebrew and Arabic in the editable deck, against the real library\n\n');
  process.stdout.write(`  PDFium ${PDFIUM_VERSION}\n  ${library}\n\n`);

  // ONE: the bundled faces, as Monstera writes them.
  const bundledBytes = await bundledPage([
    { text: HEBREW, direction: 'right-to-left', y: 600 },
    { text: ARABIC, direction: 'right-to-left', y: 500 },
    { text: LATIN, direction: 'left-to-right', y: 400 },
  ]);
  const bundled = await deckBoxes(bundledBytes);
  const hebrewBox = bundled.find((box) => box.text.replace(/\s+/gu, '') === HEBREW.replace(/\s+/gu, ''));
  const arabicBox = bundled.find((box) => box.text.normalize('NFKC').replace(/\s+/gu, '') === ARABIC.replace(/\s+/gu, ''));
  const latinBox = bundled.find((box) => box.text === LATIN);
  check(
    'a Hebrew sentence in the bundled face is ONE box whose words are in reading order, and it is right to left',
    hebrewBox?.text === HEBREW && hebrewBox.rtl,
    `box [${codes(hebrewBox?.text ?? '')}] rtl ${String(hebrewBox?.rtl)} against typed [${codes(HEBREW)}]`,
  );
  check(
    'an Arabic phrase in the bundled face is written as the LETTERS typed, in reading order, and is right to left',
    arabicBox?.text === ARABIC && arabicBox.rtl,
    `box [${codes(arabicBox?.text ?? '')}] rtl ${String(arabicBox?.rtl)} against typed [${codes(ARABIC)}]`,
  );
  check(
    'CONTROL: a left-to-right line beside them is as drawn and is NOT right to left',
    latinBox !== undefined && !latinBox.rtl,
    JSON.stringify(bundled),
  );

  // TWO: the same sentence drawn three ways.
  const right = 400;
  // (a) One text object of glyphs in visual order, spaces included: the whole line reversed.
  const oneObject = syntheticPage([
    { text: LATIN, x: 72, y: 700 },
    { text: [...HEBREW].reverse().join(''), x: right - widthOf(HEBREW), y: 650 },
  ]);
  // (b) One object per word, placed right to left in reading order, each word's glyphs in visual order.
  /** @type {{ text: string, x: number, y: number }[]} */
  const perWord = [{ text: LATIN, x: 72, y: 700 }];
  let x = right;
  HEBREW_WORDS.forEach((word, at) => {
    x -= widthOf(word);
    perWord.push({ text: visual(word), x, y: 650 });
    x -= at < HEBREW_WORDS.length - 1 ? SPACE_ADVANCE : 0;
  });
  // (c) One object per word, drawn left to right (visual order), a space glyph after every word but the last drawn.
  /** @type {{ text: string, x: number, y: number }[]} */
  const leftToRight = [{ text: LATIN, x: 72, y: 700 }];
  let left = right - widthOf(HEBREW);
  [...HEBREW_WORDS].reverse().forEach((word, at) => {
    const glyphs = visual(word) + (at < HEBREW_WORDS.length - 1 ? ' ' : '');
    leftToRight.push({ text: glyphs, x: left, y: 650 });
    left += widthOf(glyphs);
  });
  const producers = /** @type {const} */ ([
    ['one object of glyphs in visual order', oneObject],
    ['one object per word, placed right to left in reading order', syntheticPage(perWord)],
    ['one object per word, placed left to right', syntheticPage(leftToRight)],
  ]);
  for (const [label, bytes] of producers) {
    const boxes = await deckBoxes(bytes);
    const hebrew = boxes.find((box) => box.text !== LATIN);
    const level = boxes.find((box) => box.text === LATIN);
    check(
      `Hebrew drawn as ${label} is one box in READING order, right to left, and the English line beside it is as drawn`,
      hebrew?.text === HEBREW && hebrew.rtl && level !== undefined && !level.rtl,
      `box [${codes(hebrew?.text ?? '')}] rtl ${String(hebrew?.rtl)} against typed [${codes(HEBREW)}]; level ${JSON.stringify(level)}`,
    );
  }

  // THE CONTROLS THAT SHOW THE REORDERING IS WHAT IS TESTED: what PDFium itself answers (`textRuns`, which the reading order
  // is not applied to) is NOT in reading order, and differs by producer.
  const rawOne = await onImage({ bytes: oneObject, opensWith: undefined }, (session) => textRuns(session, 0));
  const rawHebrew = rawOne.runs.find((run) => run.text !== LATIN)?.text;
  check(
    'CONTROL: PDFium answers the one-object line with its WORDS in the order they sit, not the order they are read',
    rawHebrew === [...HEBREW_WORDS].reverse().join(' '),
    `answered [${codes(rawHebrew ?? '')}]`,
  );
  // The page's text is inside forms until they are flattened, which `pageContent` does first and this read must too.
  const rawBundled = await onImage({ bytes: bundledBytes, opensWith: undefined }, async (session) => {
    await promoteFormObjects(session, 0);
    return await textRuns(session, 0);
  });
  const rawWord = rawBundled.runs.find((run) => run.text.length === HEBREW_WORDS[0]?.length && [...run.text].every((ch) => HEBREW_WORDS[0]?.includes(ch)))?.text;
  check(
    'CONTROL: PDFium answers a word MuPDF drew with its LETTERS as they sit, which the one-object producer’s is not',
    rawWord === [...(HEBREW_WORDS[0] ?? '')].reverse().join(''),
    `answered [${codes(rawWord ?? '')}] for [${codes(HEBREW_WORDS[0] ?? '')}]`,
  );

  // ARABIC IN PRESENTATION FORMS: a producer whose font maps glyphs to the joined shapes.
  const shapes = String.fromCodePoint(0xfee3, 0xfeae, 0xfea3, 0xfe92, 0xfe8e);
  const letters = String.fromCodePoint(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);
  const shaped = await deckBoxes(syntheticPage([{ text: [...shapes].reverse().join(''), x: 300, y: 600 }]));
  check(
    'Arabic drawn in its joined presentation forms is written as the letters',
    shaped[0]?.text === letters && shaped[0].rtl,
    `box [${codes(shaped[0]?.text ?? '')}] against [${codes(letters)}]`,
  );
  check(
    'CONTROL: the page really holds the shapes and not the letters, so the case above is the normalisation',
    shapes !== letters && ![...shapes].some((ch) => letters.includes(ch)),
    `shapes [${codes(shapes)}]`,
  );

  // A LEFT-TO-RIGHT SENTENCE IN THE SAME PRODUCERS IS NOT TOUCHED.
  const english = await deckBoxes(syntheticPage([{ text: 'one two three four', x: 72, y: 600 }]));
  check('a left-to-right sentence drawn the same way is as drawn', english[0]?.text === 'one two three four' && !english[0].rtl, JSON.stringify(english));

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} right-to-left deck case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('right-to-left deck case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
