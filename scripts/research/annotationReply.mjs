// @ts-check
/**
 * Can a reply be written, saved and read back — and does the walk still see it?
 *
 * ## The question
 *
 * §7's annotation context menu owes *reply*, and PDF 32000-1 §12.5.6.2 already
 * answers what one IS: an annotation carrying `/IRT`, an indirect reference to the
 * annotation it answers, and `/RT /R` saying the relationship is a reply rather
 * than a grouped set. B3a says implement that authority rather than invent a
 * shape, so nothing here is a design choice — it is a measurement of whether the
 * engine this build uses can express it.
 *
 * MuPDF declares no `/IRT` accessor. `PDFAnnotation.getObject()` reaches the
 * dictionary, which is the route ADR-0077 already takes for annotation entries.
 * What is NOT established, and what a declaration could never say:
 *
 * 1. does `put` with another annotation's object write a REFERENCE, or copy the
 *    dictionary inline? A copy would produce a second annotation's worth of
 *    entries under `/IRT` and no identity at all;
 * 2. does the reference survive `document.saveToBuffer` and a reopen?
 * 3. does MuPDF's own annotation walk still enumerate both, so the walk index
 *    ADR-0041 names an annotation by remains the identity a reply resolves to?
 * 4. does `update()` on a reply create a `/Popup` companion, as it does for a
 *    plain `/Text` — which `saidBy` already had to filter once?
 *
 * Answering 1 the wrong way is the one that would be invisible: an inline copy
 * still saves, still reopens and still reads back a dictionary under `/IRT`.
 * So the check is on `isIndirect()` and on the object NUMBER matching the
 * parent's, never on the entry being present.
 *
 * ## And it reads a FILE back, which is what a live run needs
 *
 * Given a path it skips the construction and reports that document's thread
 * instead. Same reader, same question — so the answer a live run gets is
 * produced by the instrument that was resolution-tested above rather than by a
 * throwaway written on the day somebody needed it.
 *
 * Usage: node scripts/research/annotationReply.mjs [path-to-pdf]
 */

import { readFileSync } from 'node:fs';

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/**
 * Every non-popup annotation's text and what it answers, read through pdf-lib.
 *
 * `/IRT` is reported as the ANSWERED ENTRY'S POSITION rather than as present,
 * for the header's reason: presence is what an inline copy also produces.
 *
 * @param {Uint8Array} bytes
 */
async function threadIn(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = document.getPages()[0]?.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) throw new Error('no /Annots');
  /** @type {{ ref: PDFRef, dict: PDFDict }[]} */
  const entries = [];
  for (const ref of annots.asArray()) {
    if (!(ref instanceof PDFRef)) continue;
    const dict = document.context.lookup(ref, PDFDict);
    if (dict.lookup(PDFName.of('Subtype')) === PDFName.of('Popup')) continue;
    entries.push({ ref, dict });
  }
  return entries.map(({ dict }, at) => {
    const contents = dict.lookup(PDFName.of('Contents'));
    const irt = dict.get(PDFName.of('IRT'));
    const rt = dict.get(PDFName.of('RT'));
    return {
      at,
      text:
        contents instanceof PDFString || contents instanceof PDFHexString
          ? contents.decodeText()
          : '',
      answers:
        irt instanceof PDFRef ? entries.findIndex((entry) => entry.ref.tag === irt.tag) : null,
      inline: irt !== undefined && !(irt instanceof PDFRef),
      relationship: rt === undefined ? null : String(rt),
    };
  });
}

const given = process.argv[2];
if (given !== undefined) {
  const read = await threadIn(readFileSync(given));
  process.stdout.write(`# The thread in ${given}\n\n`);
  for (const entry of read) process.stdout.write(`${JSON.stringify(entry)}\n`);
  process.exit(0);
}

/**
 * A one-page PDF with nothing on it.
 *
 * Built by pdf-lib rather than by MuPDF, which is what every fixture in this
 * repository does: the annotations under test are then written by the engine
 * whose behaviour is the question, into bytes it did not author.
 */
async function blankDocument() {
  const empty = await PDFDocument.create();
  empty.addPage([400, 400]);
  const bytes = await empty.save();
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the bytes are not a PDF');
  return document;
}

/** @param {unknown} value */
function show(value) {
  return JSON.stringify(value);
}

const lines = [];
/** @param {string} line */
function say(line) {
  lines.push(line);
  process.stdout.write(`${line}\n`);
}

say('# Can a reply be written as PDF defines one?\n');

const document = await blankDocument();
const page = document.loadPage(0);

const parent = page.createAnnotation('Text');
parent.setRect([100, 100, 110, 110]);
parent.setContents('the comment being answered');
parent.update();

const reply = page.createAnnotation('Text');
reply.setRect([100, 100, 110, 110]);
reply.setContents('the answer');

const parentObject = parent.getObject();
const replyObject = reply.getObject();

say(`parent object is indirect: ${show(parentObject.isIndirect())}`);
say(`parent object number: ${show(parentObject.asIndirect())}`);

// THE WRITE. `/RT` is a name; `/IRT` must end up a reference.
replyObject.put('IRT', parentObject);
replyObject.put('RT', document.newName('R'));
reply.update();

const wrote = replyObject.get('IRT');
say(`\nAFTER THE PUT, BEFORE ANY SAVE`);
say(`  /IRT is indirect: ${show(wrote.isIndirect())}`);
say(`  /IRT object number: ${show(wrote.isIndirect() ? wrote.asIndirect() : null)}`);
say(`  /IRT is a dictionary inline: ${show(!wrote.isIndirect() && wrote.isDictionary())}`);
say(`  /RT: ${show(replyObject.get('RT').asName())}`);

// THE ROUND TRIP. An entry that only exists in the live session is not a reply.
const saved = document.saveToBuffer('');
const reopened = mupdf.PDFDocument.openDocument(saved.asUint8Array(), 'application/pdf');
if (!(reopened instanceof mupdf.PDFDocument)) throw new Error('the bytes are not a PDF');
const reopenedPage = reopened.loadPage(0);
const walked = reopenedPage.getAnnotations();

say(`\nAFTER SAVE AND REOPEN`);
say(`  the walk enumerates ${show(walked.length)} annotation(s)`);
for (const [index, annotation] of walked.entries()) {
  const object = annotation.getObject();
  const irt = object.get('IRT');
  const subtype = object.get('Subtype');
  say(
    `  [${String(index)}] /Subtype ${show(subtype.asName())} contents ${show(annotation.getContents())}` +
      ` /IRT ${irt.isNull() ? 'absent' : irt.isIndirect() ? `-> object ${String(irt.asIndirect())}` : 'INLINE COPY'}` +
      ` /RT ${object.get('RT').isNull() ? 'absent' : show(object.get('RT').asName())}`,
  );
}

// DOES /IRT RESOLVE TO SOMETHING IN THE WALK? That is what makes a walk index the
// identity a reply can be shown against. An /IRT pointing at an object the walk
// does not enumerate is a reply to nothing this application can name.
const numbers = walked.map((annotation) => annotation.getObject().asIndirect());
say(`\n  walk object numbers: ${show(numbers)}`);
for (const [index, annotation] of walked.entries()) {
  const irt = annotation.getObject().get('IRT');
  if (irt.isNull() || !irt.isIndirect()) continue;
  const target = numbers.indexOf(irt.asIndirect());
  say(`  annotation ${String(index)} answers walk index ${show(target)} (-1 means NOT IN THE WALK)`);
}

say('\nDone.');
