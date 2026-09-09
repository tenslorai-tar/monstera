// @ts-check
/**
 * Region replacement, as a COMMAND, against the real library.
 *
 * ## What this is and what `proof:pdfiumadapter` already is
 *
 * That proof's subject is the boundary: does `FPDFText_SetText` reach the saved
 * bytes, is a non-text object refused, does a session survive its caller
 * overwriting the image. This one's subject is one layer up — the thing
 * `commandSpecs.ts` routes `replaceTextObject` to — and its question is the
 * wired-tools rule's kernel half: **does the command produce the document
 * effect, and does it survive a round trip?**
 *
 * The two are not the same claim, and the gap between them is where a
 * byte-image writer goes wrong. An adapter that edits correctly and an
 * execution that hands it the right session are different facts, and
 * `localPdfiumExecution`'s whole job is the second one: open the image it was
 * given, apply, serialise, close. Every one of those four steps could be right
 * with the pair wired wrong, and the adapter proof would stay green.
 *
 * ## It runs here rather than in vitest for `proof:pdfiumadapter`'s reason
 *
 * The apply loads `pdfium.dll`. A vitest case would have to stub the binding,
 * and then it would assert that this module calls the functions it was written
 * to call — the display-only shape one layer down. `scripts/lib/unverifiable.mjs`
 * is this project's answer to the skip: **UNVERIFIABLE** with a stated reason
 * where nothing provisioned the library, and a hard failure under
 * `--require-pdfium`, which the job that provisions passes.
 *
 * ## Every case asserts what only the correct path produces
 *
 * - the round trip is read from a **reopened** document, never from the session
 *   that made the edit;
 * - the inverse is checked by asserting the restored bytes read as the ORIGINAL
 *   did — new text absent AND old text present. Either alone passes on a
 *   document that never changed;
 * - `capture` is asserted to answer the prior **string**, not merely
 *   `captured: true`. A capture that reported success with an empty prior would
 *   satisfy the second and produce an inverse that blanks the run;
 * - the failed capture is an OUTCOME with a reason, not a throw, because that
 *   is what the bus branches on — and the case asserts the bus's own branch
 *   value rather than that something went wrong.
 *
 * ## The execution is reached through `specFor`, which is the routing under test
 *
 * Nothing here calls `applyReplaceTextObject` directly. Every case goes through
 * `localPdfiumExecution`, so a declaration whose `writer` and whose spec table
 * disagreed would be a refusal here rather than a green proof about a function
 * nothing dispatches to.
 *
 * Usage: node scripts/proofs/pdfiumCommand.proof.mjs [--require-pdfium]
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { PDFIUM_COMMAND, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE = process.argv.includes('--require-pdfium');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'the PDFium region-replacement command',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

// The proof imports the BUILT modules, so a stale build would prove yesterday's
// routing and say nothing about the diff under review.
refuseStaleBuild(root, PDFIUM_COMMAND, 4);

const { openPdfium, pdfiumWriter, pageText, textObjectIndices } = await import(
  '../../packages/kernel/dist/pdfiumFfi.js'
);
const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
const { declaredCommands } = await import('../../packages/kernel/dist/commandDeclarations.js');

const FIRST = 'FIRST RUN stays exactly where it is';
const SECOND = 'SECOND RUN is the one that changes';
const THIRD = 'THIRD RUN stays exactly where it is';
const REPLACEMENT = 'SECOND RUN has been replaced';

/** `proof:pdfiumadapter`'s fixture, for its reason: the rectangle is the non-text input. */
async function threeRunsAndARectangle() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 20, y: 20, width: 120, height: 40, color: rgb(0.2, 0.4, 0.9) });
  page.drawText(FIRST, { x: 30, y: 230, size: 11, font });
  page.drawText(SECOND, { x: 30, y: 190, size: 11, font });
  page.drawText(THIRD, { x: 30, y: 150, size: 11, font });
  return document.save();
}

/**
 * The case roster.
 *
 * `createRoster` rather than a total printed from what ran, because a total
 * computed over the cases that executed agrees with any collection, including
 * one that has quietly shrunk — audit item 4c. Thirteen is an independent claim
 * about this file, not a count of it.
 *
 * @type {string[]}
 */
const failures = [];
const roster = createRoster(failures, { cases: 13 });

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, ok, detail) {
  const mark = roster.mark();
  if (!ok) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/**
 * What a document's page 0 says, read from bytes rather than from a session.
 *
 * Every read in this file goes through here, so no case can accidentally
 * observe the session that made an edit — which is the reassuring answer a
 * setter agreeing with itself produces.
 *
 * @param {Uint8Array} bytes
 */
async function textOf(bytes) {
  const session = await pdfiumWriter.open(bytes);
  try {
    return await pageText(session, 0);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * The object indices of page 0's text runs, read from bytes.
 *
 * @param {Uint8Array} bytes
 */
async function textIndicesOf(bytes) {
  const session = await pdfiumWriter.open(bytes);
  try {
    return await textObjectIndices(session, 0);
  } finally {
    await pdfiumWriter.close(session);
  }
}

async function main() {
  process.stdout.write('# Region replacement as a command, against the real library\n\n');
  process.stdout.write(`  PDFium ${PDFIUM_VERSION}\n  ${library}\n\n`);

  openPdfium(library);

  // THE ROUTING, asserted before anything is run through it. If the declaration
  // named a different writer, every case below would still pass against a
  // function nothing dispatches to — which is the shape `proven-in-the-wrong-file`
  // names, and it is cheap to close here.
  record(
    'the declaration routes replaceTextObject to pdfium',
    declaredCommands.replaceTextObject.writer === 'pdfium',
    `it declares ${declaredCommands.replaceTextObject.writer}`,
  );
  record(
    'and declares itself invertible, which is what makes the invert case reachable',
    declaredCommands.replaceTextObject.invertible &&
      declaredCommands.replaceTextObject.undo === 'inverse',
    `invertible=${String(declaredCommands.replaceTextObject.invertible)} undo=${declaredCommands.replaceTextObject.undo}`,
  );

  const original = await threeRunsAndARectangle();
  const originalText = await textOf(original);
  const texts = await textIndicesOf(original);
  record(
    'the fixture carries three text objects',
    texts.length === 3,
    `${String(texts.length)} text object(s), so the index below names a real run`,
  );

  // TYPED FROM THE CONTRACT'S OWN INFERENCE rather than written as a plain
  // object literal, which widens `kind` to `string` under JSDoc checking. The
  // `version` is branded, and this is the one field a `.mjs` cannot mint — so
  // the annotation names the contract's type and the value is asserted once,
  // here, rather than at each of the four call sites.
  const command = /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextObject'>} */ ({
    kind: 'replaceTextObject',
    page: 0,
    index: texts[1] ?? -1,
    text: REPLACEMENT,
    version: 1,
  });

  // CAPTURE FIRST, in the order the bus runs them.
  const captured = await localPdfiumExecution.capture(original, command);
  record(
    'capture answers the prior STRING, not merely success',
    captured.captured === true && captured.prior.text.includes(SECOND),
    captured.captured === true
      ? `it recorded ${JSON.stringify(captured.prior.text)}`
      : `it refused: ${captured.reason}`,
  );
  record(
    'and the prior carries the object it came from, so the inverse names no command',
    captured.captured === true &&
      captured.prior.page === 0 &&
      captured.prior.index === (texts[1] ?? -1),
    captured.captured === true
      ? `page ${String(captured.prior.page)} object ${String(captured.prior.index)}`
      : 'nothing was captured',
  );

  // A CAPTURE THAT CANNOT READ IS AN OUTCOME, and the case asserts the bus's
  // own branch value rather than that something went wrong. A throw here would
  // reach the bus as `internal`, which it answers by treating the host as
  // unhealthy — a rebuild for a page index the caller got wrong.
  const missed = await localPdfiumExecution.capture(original, { ...command, index: 99 });
  record(
    'a capture naming no text object reports captured:false with a reason',
    missed.captured === false && missed.reason.length > 0,
    missed.captured === false ? missed.reason : 'it claimed to capture something',
  );

  const applied = await localPdfiumExecution.apply(original, command);
  record(
    'apply answers NEW bytes rather than mutating the caller’s image',
    applied !== original && (await textOf(original)) === originalText,
    "the caller's array still reads as it did, which is what a byte-image writer owes",
  );

  const after = await textOf(applied);
  record(
    'the replacement is in the bytes apply returned',
    after.includes(REPLACEMENT),
    'read from a reopened document, not from the session that made the edit',
  );
  record(
    'and the text it replaced is gone',
    !after.includes(SECOND),
    'presence alone would pass on a document that never changed',
  );
  record(
    'the runs either side are untouched',
    after.includes(FIRST) && after.includes(THIRD),
    'the command edited one object and did not rewrite the page',
  );

  // THE INVERSE, which is the half that makes the declaration honest. It is
  // applied to the bytes the command produced, exactly as undo applies it.
  const restored =
    captured.captured === true
      ? await localPdfiumExecution.invert(applied, 'replaceTextObject', captured.prior)
      : applied;
  const restoredText = await textOf(restored);
  // EQUALITY, and it is the second spelling of this case rather than the first.
  //
  // It read `restoredText.includes(SECOND) && !restoredText.includes(REPLACEMENT)`,
  // and the mutation written to redden it — an inverse that appends to the
  // recorded string — left it green, because a superstring still `includes` the
  // original. That is checklist item 4's *never build a fixture the bug also
  // handles correctly*, arriving through the assertion rather than the input.
  //
  // What the inverse actually owes is that the page reads as it did, so that is
  // what is asserted. The control below is what stops equality being satisfied
  // by a command that changed nothing.
  record(
    'the inverse restores the page text EXACTLY, not merely to something containing it',
    restoredText === originalText,
    `restored ${JSON.stringify(restoredText)} against ${JSON.stringify(originalText)}`,
  );
  record(
    'CONTROL: the apply changed that same text, so the equality above separates something',
    after !== originalText,
    'an apply that did nothing would satisfy the case above and this is what refuses it',
  );

  // A COMMAND ROUTED ELSEWHERE IS REFUSED BY NAME. `specFor` throws rather than
  // reaching `undefined.apply`, whose TypeError names neither the command nor
  // the writer.
  let refusal = null;
  try {
    await localPdfiumExecution.apply(original, /** @type {never} */ ({ kind: 'rotatePages' }));
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  record(
    'a command routed to another writer is refused by name',
    refusal !== null && refusal.includes('is not routed to PDFium'),
    refusal ?? 'it was accepted',
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} PDFium command case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('PDFium command case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
