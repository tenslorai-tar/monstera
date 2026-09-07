// @ts-check
/**
 * What an EXPORT of form data has to get right, measured before one is written.
 *
 * `scripts/research/formDataFormats.mjs` (2026-09-07) measured the **read**
 * side: MuPDF opens an FDF under every magic string tried, so FDF import is a
 * read through the writer of record rather than a parser this build owns. It
 * measured nothing about writing, and the two are not symmetric.
 *
 * ## MuPDF declares no FDF symbol at all
 *
 * Measured 2026-09-08: `fdf`, case-insensitively, appears **zero** times in
 * `mupdf.d.ts` 1.28.0. So an FDF opening as a `PDFDocument` is FDF being *PDF
 * syntax*, not an FDF API — and there is no writer to reach for. Every byte of
 * an export is this build's, in all three formats.
 *
 * That inverts *the authority may already do the hard part*: the authority does
 * the read and none of the write, and a row designed from the read half alone
 * would carry an assumption nobody stated.
 *
 * ## THE RISK ON THE WRITE SIDE IS ESCAPING, and it runs the other way
 *
 * An import is where a hostile document's values reach this build's parser. An
 * **export is where the document's own values reach this build's serialiser** —
 * and a form's values are not this build's data either. A value carrying `)`
 * ends an FDF string early; one carrying `<` opens an element in XFDF. So the
 * same hostile-input question applies to a path that looks like a read.
 *
 * Neither format's escaping is optional and neither is the same:
 *
 * | format | what must be escaped | what a naive encoder produces |
 * |---|---|---|
 * | FDF | `(`, `)`, `\` inside a literal string | a truncated value, or an unparseable file |
 * | XFDF | `<`, `&`, and `>` in text | a value that becomes markup |
 * | JSON | nothing — `JSON.stringify` owns it | — |
 *
 * JSON is in the table **because it is the control**: it is the one format with
 * an authority already in the runtime, so it is what the other two are measured
 * against rather than a third encoder to check.
 *
 * ## The questions
 *
 *   1. Does MuPDF declare anything FDF at all?
 *   2. What does a NAIVE encoder do to a hostile value, per format?
 *   3. Does an escaped FDF this build writes round-trip through MuPDF?
 *   4. What must `/V` BE, per field type? A button's value is a name and a text
 *      field's is a string, and an encoder that writes one shape for both is
 *      wrong on half the form.
 *   5. What does a round trip LOSE? Export, re-import, compare.
 *
 * Run:
 *
 *   node scripts/research/formDataExport.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own controls
 *
 * **The round trip's reassuring answer is *the values match***, and that is also
 * what comparing a value to itself produces. So the naive encoder is run against
 * the same fixture in the same way: if the escaped and the naive encoder both
 * round-trip, this script is not measuring escaping and says so rather than
 * printing a table.
 *
 * **The symbol scan's reassuring answer is *found nothing***, so it is pointed
 * at a symbol known to be present in the same file before it is believed.
 */
import { readFileSync } from 'node:fs';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * Values chosen so a naive encoder is WRONG rather than merely risky.
 *
 * Each one closes a construct the format uses. A fixture of ordinary words
 * would round-trip through both encoders and separate nothing — the rule about
 * never building a fixture the bug also handles correctly.
 */
const HOSTILE = {
  fdf: 'paren ) backslash \\ open ( end',
  xfdf: 'less < amp & greater > close </field>',
  both: 'mixed ) & < \\ >',
};

/** A document carrying one field per hostile value, plus a button and a choice. */
async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();

  let y = 540;
  for (const [name, value] of Object.entries(HOSTILE)) {
    const field = form.createTextField(`hostile.${name}`);
    field.setText(value);
    field.addToPage(page, { x: 20, y, width: 200, height: 18, font, borderWidth: 0 });
    y -= 40;
  }

  // A BUTTON AND A CHOICE, because question 4 is what `/V` must BE and a fixture
  // of text fields answers it for one type out of six.
  const tick = form.createCheckBox('applicant.agrees');
  tick.check();
  tick.addToPage(page, { x: 20, y, width: 16, height: 16, borderWidth: 0 });
  y -= 40;

  const choice = form.createDropdown('applicant.title');
  choice.addOptions(['Dr', 'Mr', 'Ms']);
  choice.select('Dr');
  choice.addToPage(page, { x: 20, y, width: 100, height: 18, font, borderWidth: 0 });

  return document.save();
}

/**
 * Opens with MuPDF and hands the document over, always destroying it.
 *
 * @template T
 * @param {Uint8Array} bytes
 * @param {string} magic
 * @param {(document: mupdf.PDFDocument) => T} read
 * @returns {T}
 */
function withMupdf(bytes, magic, read) {
  const document = mupdf.PDFDocument.openDocument(bytes, magic);
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF-syntax file');
  try {
    return read(document);
  } finally {
    document.destroy();
  }
}

/**
 * Every field this build would export, as its reader answers them.
 *
 * @param {Uint8Array} bytes
 * @returns {Array<{ name: string, type: string, value: string }>}
 */
function fields(bytes) {
  return withMupdf(bytes, 'application/pdf', (document) =>
    document
      .loadPage(0)
      .getWidgets()
      .map((widget) => ({
        name: widget.getName(),
        type: widget.getFieldType(),
        value: widget.getValue(),
      })),
  );
}

/**
 * A PDF literal string, escaped as the format requires.
 *
 * @param {string} value
 * @returns {string}
 */
function pdfString(value) {
  return `(${value.replace(/[\\()]/gu, (match) => `\\${match}`)})`;
}

/**
 * A PDF literal string, NOT escaped — the naive encoder under test.
 *
 * @param {string} value
 * @returns {string}
 */
function pdfStringNaive(value) {
  return `(${value})`;
}

/**
 * XML text, escaped as the format requires.
 *
 * @param {string} value
 * @returns {string}
 */
function xmlText(value) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

/**
 * XML text, NOT escaped — the naive encoder under test.
 *
 * @param {string} value
 * @returns {string}
 */
function xmlTextNaive(value) {
  return value;
}

/**
 * An FDF carrying the given fields, with offsets computed.
 *
 * The structure PDF 32000-1 Annex L describes, and the same one
 * `formDataFormats.mjs` built to prove MuPDF reads it — written here rather
 * than imported, because that one is a fixture for a read and this is the thing
 * under test.
 *
 * @param {Array<{ name: string, type: string, value: string }>} entries
 * @param {(value: string) => string} encode
 * @returns {Uint8Array}
 */
function fdf(entries, encode) {
  const objects = [
    '1 0 obj\n<< /FDF << /Fields 2 0 R >> >>\nendobj\n',
    `2 0 obj\n[ ${entries.map((_entry, index) => `${String(index + 3)} 0 R`).join(' ')} ]\nendobj\n`,
    ...entries.map(
      (entry, index) =>
        // QUESTION 4 IN ONE LINE. A button's value is a NAME (`/Yes`) and a text
        // field's is a string, so the branch is a fact about the format rather
        // than a convenience. An encoder writing `(Yes)` for a tick box
        // produces a file every reader parses and no reader ticks the box with.
        `${String(index + 3)} 0 obj\n<< /T ${encode(entry.name)} /V ${
          entry.type === 'checkbox' || entry.type === 'radiobutton'
            ? `/${entry.value}`
            : encode(entry.value)
        } >>\nendobj\n`,
    ),
  ];

  let body = '%FDF-1.2\n';
  /** @type {number[]} */
  const offsets = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const startxref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(startxref)}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/**
 * What `/Root /FDF /Fields` says, read with MuPDF.
 *
 * @param {Uint8Array} bytes
 * @returns {Array<{ name: string, value: string }> | string}
 */
function readFdf(bytes) {
  try {
    return withMupdf(bytes, 'application/vnd.fdf', (document) => {
      const list = document.getTrailer().get('Root').get('FDF').get('Fields');
      if (list.isNull()) return [];
      /** @type {Array<{ name: string, value: string }>} */
      const found = [];
      for (let index = 0; index < list.length; index += 1) {
        const entry = list.get(index);
        const value = entry.get('V');
        found.push({
          name: entry.get('T').asString(),
          value: value.isName() ? `/${value.asName()}` : value.asString(),
        });
      }
      return found;
    });
  } catch (error) {
    return `REFUSED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * An XFDF carrying the given fields.
 *
 * @param {Array<{ name: string, value: string }>} entries
 * @param {(value: string) => string} encode
 * @returns {string}
 */
function xfdf(entries, encode) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xfdf xmlns="http://ns.adobe.com/xfdf/">',
    '  <fields>',
    ...entries.map(
      (entry) =>
        `    <field name="${encode(entry.name)}"><value>${encode(entry.value)}</value></field>`,
    ),
    '  </fields>',
    '</xfdf>',
  ].join('\n');
}

async function main() {
  console.log('# What an export of form data has to get right');
  console.log('');

  // ------------------------------------------------- 1: does MuPDF have one
  console.log('## 1. Whether MuPDF declares any FDF API');
  const declarations = readFileSync('node_modules/mupdf/dist/mupdf.d.ts', 'utf8');
  const fdfMentions = declarations.match(/fdf/giu) ?? [];
  // THE POSITIVE CONTROL. `found nothing` is what a wrong path, an empty read
  // and a broken pattern all produce, so the same scan must locate a symbol
  // this file is known to declare before its silence means anything.
  const knownPresent = declarations.match(/getWidgets/gu) ?? [];
  if (knownPresent.length === 0) {
    throw new Error(
      'the symbol scan cannot find `getWidgets`, which mupdf.d.ts certainly declares, so its ' +
        'answer about FDF is this script being broken rather than a fact about the library',
    );
  }
  console.log(`  control: \`getWidgets\` found ${String(knownPresent.length)} time(s) — the scan can see`);
  console.log(`  \`fdf\`, case-insensitively: ${String(fdfMentions.length)} occurrence(s)`);
  console.log('');

  const built = await fixture();
  const read = fields(built);
  console.log('## The fixture, as this build reads it');
  for (const entry of read) console.log(`  ${JSON.stringify(entry)}`);
  console.log('');

  // ------------------------------------- 2 and 3: naive against escaped
  console.log('## 2 and 3. What a naive encoder does, and whether an escaped one round-trips');
  const escaped = readFdf(fdf(read, pdfString));
  const naive = readFdf(fdf(read, pdfStringNaive));
  console.log(`  escaped FDF -> ${JSON.stringify(escaped)}`);
  console.log(`  naive   FDF -> ${JSON.stringify(naive)}`);

  // THE CONTROL THIS COMPARISON NEEDS. If both encoders round-trip, escaping is
  // not what this fixture measures and every conclusion below is unearned.
  if (JSON.stringify(escaped) === JSON.stringify(naive)) {
    throw new Error(
      'the escaped and the naive encoder produced the same reading, so this fixture does not ' +
        'separate them and nothing here says anything about escaping',
    );
  }
  const intact =
    Array.isArray(escaped) &&
    escaped.length === read.length &&
    escaped.every((entry, index) => {
      const source = read[index];
      if (source === undefined) return false;
      const expected =
        source.type === 'checkbox' || source.type === 'radiobutton'
          ? `/${source.value}`
          : source.value;
      return entry.name === source.name && entry.value === expected;
    });
  console.log(`  the escaped round trip is lossless: ${intact ? 'yes' : 'NO'}`);
  console.log('');

  // ------------------------------------------------------ 4: XFDF's shape
  console.log('## 4. XFDF, escaped and naive');
  console.log('   no parser is run here — this repository has no XML dependency, which is the');
  console.log('   decision the row owes. What is printed is what each encoder EMITS.');
  const hostile = read.filter((entry) => entry.name.startsWith('hostile.'));
  console.log('  escaped:');
  for (const line of xfdf(hostile, xmlText).split('\n').slice(3, -2)) console.log(`    ${line}`);
  console.log('  naive:');
  for (const line of xfdf(hostile, xmlTextNaive).split('\n').slice(3, -2)) console.log(`    ${line}`);
  console.log('');

  // ------------------------------------------------------------ 5: JSON
  console.log('## 5. JSON, which is the control rather than a third encoder');
  const json = JSON.stringify(read);
  const back = JSON.parse(json);
  console.log(`  round-trips losslessly: ${JSON.stringify(back) === json ? 'yes' : 'NO'}`);
  console.log(`  the hostile value survives: ${JSON.stringify(back[0]?.value ?? null)}`);
  console.log('');

  // --------------------------------------------- what a name may contain
  console.log('## 6. A field NAME is a path, and a name is also encoded');
  console.log('   the create row measured that a dot makes a parent, so a name carrying a');
  console.log('   paren or an ampersand is a name AND a construct in two of three formats');
  const named = read.map((entry) => entry.name);
  console.log(`  names in the fixture: ${JSON.stringify(named)}`);
  console.log(`  as FDF /T, escaped:   ${JSON.stringify(named.map(pdfString))}`);
  console.log(`  as XFDF @name, escaped: ${JSON.stringify(named.map(xmlText))}`);
}

await main();
