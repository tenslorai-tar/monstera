// @ts-check
/**
 * What the three form-data formats actually require, before any of them is
 * designed around.
 *
 * `docs/FEATURES.md` D5 carries *Export / import data (JSON, XFDF, FDF)*, which
 * reads as three encoders over one field model. Two questions decide whether
 * that is true, and both have been answered by assumption in every tool this
 * row could be copied from:
 *
 *   1. **Does an authority already do it?** `the-authority-may-already-do-the-
 *      hard-part`: measure whether the tool already does X before designing
 *      around its absence. FDF is PDF syntax — `%FDF-1.2` and a body of
 *      indirect objects — so MuPDF might simply open one, which would make FDF
 *      a read rather than a parser we write and own.
 *   2. **What does the XFDF side cost?** XFDF is XML and this repository has no
 *      XML dependency in any workspace. So the choice is a new dependency — *a
 *      dependency is a probe*, and one of them took a generator here from 39
 *      packages to 114 — or a parser of our own. That choice should be made
 *      against what a hostile input does, not against which is less work.
 *
 * Run:
 *
 *   node scripts/research/formDataFormats.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive control
 *
 * Question 1's reassuring answer is **"MuPDF refuses it"**, which is also what
 * a wrong magic string, a malformed fixture and a mis-built buffer produce. So
 * the same opening path is exercised against a document MuPDF is known to open
 * — an ordinary PDF built beside the FDF — and the script refuses to report if
 * that one fails too. Without it, *FDF is not supported* would be indeterminate
 * between the library's answer and this file's mistake.
 */
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * A minimal FDF carrying two field values.
 *
 * Built as bytes rather than written to disk, and assembled from a template
 * with the offsets computed, because an FDF's `/Root` is found through its
 * trailer and a hand-counted `startxref` that is wrong makes the reading below
 * *MuPDF cannot read FDF* when the truth is *this fixture is broken*.
 *
 * The structure is the one PDF 32000-1 Annex L describes: a `%FDF-1.2` header,
 * a catalog whose `/FDF` dictionary holds `/Fields`, and one dictionary per
 * field with `/T` and `/V`.
 *
 * @returns {Uint8Array}
 */
function fdf() {
  const objects = [
    '1 0 obj\n<< /FDF << /Fields 2 0 R >> >>\nendobj\n',
    '2 0 obj\n[ 3 0 R 4 0 R ]\nendobj\n',
    '3 0 obj\n<< /T (applicant.name) /V (GRACE HOPPER) >>\nendobj\n',
    '4 0 obj\n<< /T (applicant.agrees) /V /Yes >>\nendobj\n',
  ];

  const header = '%FDF-1.2\n';
  let body = '';
  /** @type {number[]} */
  const offsets = [];
  for (const object of objects) {
    offsets.push(header.length + body.length);
    body += object;
  }

  const xrefAt = header.length + body.length;
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(xrefAt)}\n%%EOF\n`;

  return new TextEncoder().encode(header + body + xref + trailer);
}

/** An ordinary PDF, so *MuPDF refused it* can be told from *this file is wrong*. */
async function pdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([200, 200]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('control', { x: 20, y: 100, size: 12, font });
  return document.save();
}

/**
 * What MuPDF makes of some bytes under a stated magic string.
 *
 * @param {Uint8Array} bytes
 * @param {string} magic
 * @returns {{ opened: boolean, isPDF: boolean | null, detail: string }}
 */
function openedBy(bytes, magic) {
  try {
    const document = mupdf.Document.openDocument(bytes, magic);
    try {
      const isPDF = document.isPDF();
      // `asPDF` is the honest question: a Document that is not a PDFDocument
      // cannot answer anything about `/Fields`, whatever it says about itself.
      const asPdf = document.asPDF();
      return {
        opened: true,
        isPDF,
        detail:
          asPdf === null
            ? 'opened, but not as a PDFDocument — no object access'
            : `opened as a PDFDocument with ${String(asPdf.countObjects())} object(s)`,
      };
    } finally {
      document.destroy();
    }
  } catch (error) {
    return { opened: false, isPDF: null, detail: String(error) };
  }
}

/**
 * Whether the trailer's `/Root` leads to `/FDF /Fields`, if the bytes opened.
 *
 * The second half of question 1, and the half that decides the row: *it opened*
 * is not *we can read the values out of it*. A format that parses into an
 * object graph nothing can navigate is a parser we still have to write.
 *
 * @param {Uint8Array} bytes
 * @param {string} magic
 * @returns {string}
 */
function fieldsReachable(bytes, magic) {
  try {
    const document = mupdf.Document.openDocument(bytes, magic);
    try {
      const asPdf = document.asPDF();
      if (asPdf === null) return 'not a PDFDocument, so no trailer to walk';
      const root = asPdf.getTrailer().get('Root');
      const fdf = root.get('FDF');
      const fields = fdf.get('Fields');
      if (!fields.isArray()) return `\`/Root /FDF /Fields\` is ${String(fields)}`;
      /** @type {string[]} */
      const read = [];
      for (let at = 0; at < fields.length; at += 1) {
        const field = fields.get(at);
        read.push(`${String(field.get('T').asString())}=${String(field.get('V'))}`);
      }
      return `read ${JSON.stringify(read)}`;
    } finally {
      document.destroy();
    }
  } catch (error) {
    return `threw: ${String(error)}`;
  }
}

/**
 * The XFDF shapes a parser has to have an answer for.
 *
 * Not run through a parser — there is none here, which is the finding. What
 * this prints is the **input set**, so the decision about which parser to adopt
 * is taken against the shapes it must refuse rather than against a feature
 * list. Every one of these is valid XML.
 */
const HOSTILE = [
  {
    name: 'the ordinary case',
    why: 'the only shape a parser must ACCEPT, and the control for the rest',
    xml: '<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><fields><field name="applicant.name"><value>GRACE HOPPER</value></field></fields></xfdf>',
  },
  {
    name: 'external entity (XXE)',
    why: 'reads a file off the machine running the parser and puts it in a field value',
    xml: '<?xml version="1.0"?><!DOCTYPE xfdf [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><xfdf><fields><field name="a"><value>&x;</value></field></fields></xfdf>',
  },
  {
    name: 'entity expansion (billion laughs)',
    why: 'a few hundred bytes that expand to gigabytes inside the parser, before any bound on the VALUES can apply',
    xml: '<?xml version="1.0"?><!DOCTYPE xfdf [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><xfdf><fields><field name="a"><value>&c;</value></field></fields></xfdf>',
  },
  {
    name: 'external DTD',
    why: 'a network fetch during a parse, from a document the user merely opened',
    xml: '<?xml version="1.0"?><!DOCTYPE xfdf SYSTEM "http://example.invalid/x.dtd"><xfdf><fields/></xfdf>',
  },
  {
    name: 'a field with no name',
    why: 'the model is keyed by name; a nameless field has nowhere to go and must be refused rather than skipped',
    xml: '<?xml version="1.0"?><xfdf><fields><field><value>x</value></field></fields></xfdf>',
  },
  {
    name: 'deep nesting',
    why: 'a recursive parser can be made to exhaust its stack by structure alone, with no entities at all',
    xml: `<?xml version="1.0"?><xfdf>${'<fields>'.repeat(5000)}${'</fields>'.repeat(5000)}</xfdf>`,
  },
];

async function main() {
  const control = await pdf();

  // THE CONTROL, before any refusal below is read as a fact about FDF. A wrong
  // magic string or a mis-built buffer refuses in exactly the same voice.
  const controlOpen = openedBy(control, 'application/pdf');
  if (!controlOpen.opened) {
    throw new Error(
      `CONTROL FAILED: MuPDF could not open an ordinary PDF built by this script, so a refusal ` +
        `below says nothing about FDF: ${controlOpen.detail}`,
    );
  }
  console.log('control: MuPDF opens an ordinary PDF —', controlOpen.detail);

  const bytes = fdf();
  console.log(`\n1. does MuPDF open an FDF? (${String(bytes.byteLength)} bytes)`);
  for (const magic of ['application/vnd.fdf', 'application/pdf', 'x.fdf', 'x.pdf']) {
    const answer = openedBy(bytes, magic);
    console.log(`   magic ${magic.padEnd(20)}`, JSON.stringify(answer));
  }

  console.log('\n2. and can the field values be READ out of it?');
  for (const magic of ['application/vnd.fdf', 'application/pdf']) {
    console.log(`   magic ${magic.padEnd(20)}`, fieldsReachable(bytes, magic));
  }

  console.log('\n3. the XFDF inputs a parser must have an answer for');
  console.log('   (no XML parser is a dependency of any workspace here — that is the finding)');
  for (const shape of HOSTILE) {
    console.log(
      `   ${shape.name.padEnd(30)} ${String(shape.xml.length).padStart(7)} bytes  ${shape.why}`,
    );
  }
}

await main();
