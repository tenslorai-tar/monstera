// @ts-check
/**
 * In-place text editing, as a COMMAND, against the real library.
 *
 * ## The command names a LIST, and both arities are cased here
 *
 * `replaceTextObject` carries `replacements: [{index, text}]` so that a visual
 * line — several text objects, because PDFium answers one rect per run — is one
 * command, one `FPDFPage_GenerateContent` and one undo step. The single-entry
 * cases below are region replacement; the two-object ones are the line edit's
 * shape, and they exist because an execution that took `replacements[0]` and
 * dropped the rest would pass every single-entry case in this file.
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
const ON_THE_PAGE = 'OUTSIDE, ON THE PAGE';
const INSIDE_FIRST = 'INSIDE THE XOBJECT';
const INSIDE_SECOND = 'SECOND LINE INSIDE';
const PROMOTED_EDIT = 'PROMOTED AND EDITED';

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
 * one that has quietly shrunk — audit item 4c. Twenty-nine is an independent
 * claim about this file, not a count of it.
 *
 * @type {string[]}
 */
const failures = [];
const roster = createRoster(failures, { cases: 35 });

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
  process.stdout.write('# In-place text editing as a command, against the real library\n\n');
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
    replacements: [{ index: texts[1] ?? -1, text: REPLACEMENT }],
    version: 1,
  });

  // CAPTURE FIRST, in the order the bus runs them.
  const captured = await localPdfiumExecution.capture(original, command);
  record(
    'capture answers the prior STRING, not merely success',
    captured.captured === true && (captured.prior.objects[0]?.text ?? '').includes(SECOND),
    captured.captured === true
      ? `it recorded ${JSON.stringify(captured.prior.objects[0]?.text ?? null)}`
      : `it refused: ${captured.reason}`,
  );
  record(
    'and the prior carries the object it came from, so the inverse names no command',
    captured.captured === true &&
      captured.prior.page === 0 &&
      captured.prior.objects.length === 1 &&
      captured.prior.objects[0]?.index === (texts[1] ?? -1),
    captured.captured === true
      ? `page ${String(captured.prior.page)} object ${String(captured.prior.objects[0]?.index)}`
      : 'nothing was captured',
  );

  // A CAPTURE THAT CANNOT READ IS AN OUTCOME, and the case asserts the bus's
  // own branch value rather than that something went wrong. A throw here would
  // reach the bus as `internal`, which it answers by treating the host as
  // unhealthy — a rebuild for a page index the caller got wrong.
  const missed = await localPdfiumExecution.capture(original, {
    ...command,
    replacements: [{ index: 99, text: REPLACEMENT }],
  });
  record(
    'a capture naming no text object reports captured:false with a reason',
    missed.captured === false && missed.reason.length > 0,
    missed.captured === false ? missed.reason : 'it claimed to capture something',
  );

  // ONE UNREADABLE INDEX AMONG READABLE ONES REFUSES THE WHOLE CAPTURE, which
  // is the plural payload's own rule and it needs its own case: a capture that
  // recorded the readable half would produce an inverse restoring some of a
  // line's runs, leaving a state nobody saw and no further undo can leave. The
  // fixture puts the good index FIRST, so a capture that stopped at the first
  // failure and kept what it had would answer `captured: true` here.
  const partly = await localPdfiumExecution.capture(original, {
    ...command,
    replacements: [
      { index: texts[0] ?? -1, text: REPLACEMENT },
      { index: 99, text: REPLACEMENT },
    ],
  });
  record(
    'a capture whose list is partly unreadable refuses the WHOLE command',
    partly.captured === false,
    partly.captured === false
      ? partly.reason
      : `it captured ${String(partly.prior.objects.length)} object(s) of two`,
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

  // TWO OBJECTS IN ONE COMMAND — the shape a visual line edit takes, and the
  // reason the payload carries a list at all. `proof:pdfiumadapter` already
  // proves `replaceTextObjects` writes several; what is unproven one layer up
  // is that the COMMAND carries them there, so an execution that quietly took
  // `replacements[0]` and dropped the rest would pass every case above.
  const bothCommand = /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextObject'>} */ ({
    kind: 'replaceTextObject',
    page: 0,
    replacements: [
      { index: texts[0] ?? -1, text: 'FIRST RUN is edited too' },
      { index: texts[2] ?? -1, text: 'THIRD RUN is edited too' },
    ],
    version: 1,
  });
  const bothPrior = await localPdfiumExecution.capture(original, bothCommand);
  const bothApplied = await localPdfiumExecution.apply(original, bothCommand);
  const bothText = await textOf(bothApplied);
  record(
    'one command replaces BOTH named objects, which is what a line edit is',
    bothText.includes('FIRST RUN is edited too') && bothText.includes('THIRD RUN is edited too'),
    // The two named runs are the outer ones, so an execution that applied only
    // the first and one that applied only the last both fail — a fixture naming
    // adjacent runs would let a partial apply look like an ordering question.
    `read back: ${JSON.stringify(bothText)}`,
  );
  record(
    'and the run BETWEEN them is untouched, so the command edited what it named',
    bothText.includes(SECOND),
    'a command that rewrote the page rather than its named objects would lose this',
  );
  const bothRestored =
    bothPrior.captured === true
      ? await textOf(
          await localPdfiumExecution.invert(bothApplied, 'replaceTextObject', bothPrior.prior),
        )
      : bothText;
  record(
    'ONE inverse puts both runs back, so a line edit is a single undo step',
    bothRestored === originalText,
    `restored ${JSON.stringify(bothRestored)} against ${JSON.stringify(originalText)}`,
  );
  record(
    'CONTROL: the two-object apply changed the text the equality above compares',
    bothText !== originalText,
    'without this, an apply that did nothing would satisfy the restore case',
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

  await replaceAllCases();
  await promotionCases();

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} PDFium command case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('PDFium command case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/**
 * A three-page document whose text is spread the way the limitation needs.
 *
 * Page 0 and page 2 carry the word twice each; page 1 carries it not at all, so
 * *every page was walked* and *every page was rewritten* can be told apart.
 *
 * The last run on page 0 is the SPLIT one: `WIDGET` drawn as two adjacent text
 * objects, `WID` and `GET`. It reads as the word on the page and is in neither
 * object's string, which is the boundary this command cannot cross and the
 * thing a case has to pin so it cannot change in silence.
 *
 * @returns {Promise<Uint8Array>}
 */
async function threePagesOfWidgets() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([400, 300]);
  first.drawText('The WIDGET is on this page', { x: 30, y: 230, size: 11, font });
  first.drawText('and the WIDGET again below', { x: 30, y: 200, size: 11, font });
  // SPLIT ACROSS TWO OBJECTS, deliberately adjacent so it reads as one word.
  first.drawText('WID', { x: 30, y: 170, size: 11, font });
  first.drawText('GET', { x: 49, y: 170, size: 11, font });
  const second = document.addPage([400, 300]);
  second.drawText('This page mentions nothing at all', { x: 30, y: 230, size: 11, font });
  const third = document.addPage([400, 300]);
  third.drawText('A WIDGET here too', { x: 30, y: 230, size: 11, font });
  third.drawText('and a widget in lower case', { x: 30, y: 200, size: 11, font });
  return document.save();
}

/** What one page of `bytes` says. @param {Uint8Array} bytes @param {number} page */
async function pageOf(bytes, page) {
  const session = await pdfiumWriter.open(bytes);
  try {
    return await pageText(session, page);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * Document-wide replace-all, through the same routing every case above uses.
 *
 * Its own function for `pdfiumObject.proof.mjs`' reason one file along: these
 * share a fixture and a helper, and the roster's count is an independent claim
 * a reader checks by counting `record` calls rather than by scrolling one body.
 */
async function replaceAllCases() {
  const original = await threePagesOfWidgets();
  /**
   * @param {Record<string, unknown>} rest
   * @returns {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceAllText'>}
   */
  const replaceAll = (rest) =>
    /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceAllText'>} */ ({
      kind: 'replaceAllText',
      ...rest,
    });

  const command = replaceAll({ find: 'WIDGET', replace: 'GADGET' });
  const applied = await localPdfiumExecution.apply(original, command);
  const firstPage = await pageOf(applied, 0);
  const secondPage = await pageOf(applied, 1);
  const thirdPage = await pageOf(applied, 2);

  record(
    'a replacement reaches EVERY page, not only the first',
    firstPage.includes('GADGET') && thirdPage.includes('GADGET'),
    // A command that stopped after the first page it changed would pass a case
    // that read only page 0 — which is why the fixture puts a match on the LAST
    // page and a gap in between.
    `page 0 ${JSON.stringify(firstPage.slice(0, 40))}; page 2 ${JSON.stringify(thirdPage.slice(0, 40))}`,
  );
  record(
    'both occurrences on one page are replaced, not just the first',
    (firstPage.match(/GADGET/gu) ?? []).length === 2,
    `${String((firstPage.match(/GADGET/gu) ?? []).length)} on page 0`,
  );
  record(
    'a page with no match is left exactly as it was',
    secondPage === (await pageOf(original, 1)),
    `page 1 reads ${JSON.stringify(secondPage)}`,
  );

  // THE LIMITATION, PINNED. `FPDFText_SetText` replaces an object's whole
  // string, and `WID` + `GET` are two objects — so the word is on the page and
  // in neither object. A future change that made this pass would mean something
  // had started editing across an object boundary without a person confirming
  // the grouping, which is what ADR-0049 refuses.
  record(
    'an occurrence SPLIT ACROSS TWO OBJECTS is not replaced, and that is the shape',
    // ASSERTED ON `WIDGET` ITSELF, and the first spelling of this case was
    // `includes('WID') && includes('GET')` — which the string `WIDGET` satisfies
    // by being itself, and which a partial replacement would also satisfy.
    //
    // The page reads `WIDGET` here because PDFium joins two adjacent objects
    // when it extracts, which is the finding: the word is ON the page and in
    // NEITHER object's string. Every object-internal occurrence became `GADGET`
    // above, so a surviving `WIDGET` on this page can only be the split pair.
    firstPage.includes('WIDGET'),
    `page 0 reads ${JSON.stringify(firstPage)}`,
  );
  record(
    'CONTROL: exactly ONE survives, so the case above is not passing on a missed replacement',
    (firstPage.match(/WIDGET/gu) ?? []).length === 1 &&
      (await pageOf(original, 0)).match(/WIDGET/gu)?.length === 3,
    `${String((firstPage.match(/WIDGET/gu) ?? []).length)} left of ` +
      `${String((await pageOf(original, 0)).match(/WIDGET/gu)?.length)}`,
  );

  // CASE, THROUGH THE SHARED MATCHER. `textMatch.ts` defaults to
  // case-insensitive, so the lower-case `widget` on page 2 is replaced here and
  // must survive the case-sensitive run below — which is what separates *the
  // flag reached the matcher* from *the flag was accepted and ignored*.
  record(
    'matching is case-insensitive by default, which is the find bar’s own default',
    thirdPage.includes('GADGET') && !thirdPage.includes('widget'),
    `page 2 reads ${JSON.stringify(thirdPage)}`,
  );
  const sensitive = await localPdfiumExecution.apply(
    original,
    replaceAll({ find: 'WIDGET', replace: 'GADGET', caseSensitive: true }),
  );
  record(
    'and caseSensitive REACHES the matcher, so the lower-case one survives',
    (await pageOf(sensitive, 2)).includes('widget'),
    `page 2 reads ${JSON.stringify(await pageOf(sensitive, 2))}`,
  );

  // A PATTERN, for the same reason: the flag has to reach `compileQuery` rather
  // than being accepted and dropped. `W.DGET` matches the whole word and not
  // the split pair, so this also cannot pass by matching everything.
  const patterned = await localPdfiumExecution.apply(
    original,
    replaceAll({ find: 'W.DGET', replace: 'GADGET', regex: true }),
  );
  record(
    'a regex pattern reaches the matcher too',
    (await pageOf(patterned, 0)).includes('GADGET'),
    'a build that ignored the flag would have looked for the literal "W.DGET"',
  );

  // AN UNPARSEABLE PATTERN IS A REFUSAL WITH A REASON, not a silent no-op and
  // not an `internal`. The boundary deliberately does not compile the pattern,
  // so this is the layer that answers for it.
  let refused = null;
  try {
    await localPdfiumExecution.apply(original, replaceAll({ find: '(', replace: 'x', regex: true }));
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  record(
    'an unparseable pattern is refused by NAME and changes nothing',
    refused !== null && refused.includes('invalid-pattern'),
    refused ?? 'it was accepted',
  );

  // A REPLACEMENT THAT PRODUCES THE ORIGINAL CHANGES NOTHING. Replacing a word
  // with itself matches everywhere, and regenerating every page for it would be
  // the whole cost of an edit paid for no change.
  const identity = await localPdfiumExecution.apply(
    original,
    replaceAll({ find: 'WIDGET', replace: 'WIDGET' }),
  );
  record(
    'replacing a word with itself leaves every page’s text as it was',
    (await pageOf(identity, 0)) === (await pageOf(original, 0)),
    'the page reads as it did, so no object was rewritten with what it already held',
  );

  // THE CAPTURE REFUSES, which is what makes the bus take a checkpoint — and
  // the reason names the axis rather than the symptom: the prior EXISTS here
  // and is document-scaled, which is a different refusal from a removal's.
  const prior = await localPdfiumExecution.capture(original, command);
  record(
    'a replace-all REFUSES to capture, because its prior scales with the document',
    prior.captured === false && prior.reason.includes('document-scaled'),
    prior.captured === false ? prior.reason : 'it claimed to capture something',
  );
}

/**
 * A page whose text is inside a placed, scaled Form XObject — plus one run that
 * is not.
 *
 * `pdfiumXObjects.mjs`' fixture, and the control is the same: the ordinary run
 * separates *this page's form text became addressable* from *this page has text*.
 * The matrix is non-identity on purpose, because with an identity every
 * composition rule agrees and the fixture would be one the bug also handles.
 */
async function textInsideAForm() {
  const inner = await PDFDocument.create();
  const innerPage = inner.addPage([300, 120]);
  const innerFont = await inner.embedFont(StandardFonts.Helvetica);
  innerPage.drawText(INSIDE_FIRST, { x: 10, y: 60, size: 14, font: innerFont });
  innerPage.drawText(INSIDE_SECOND, { x: 10, y: 30, size: 14, font: innerFont });

  const outer = await PDFDocument.create();
  const embedded = await outer.embedPdf(await inner.save());
  const page = outer.addPage([400, 300]);
  const font = await outer.embedFont(StandardFonts.Helvetica);
  page.drawText(ON_THE_PAGE, { x: 30, y: 260, size: 14, font });
  const form = embedded[0];
  if (form === undefined) throw new Error('embedPdf produced no page');
  page.drawPage(form, { x: 40, y: 80, xScale: 1.2, yScale: 1.2 });
  return outer.save();
}

/** Normalize-then-edit, as a command. */
async function promotionCases() {
  const original = await textInsideAForm();
  /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'promoteFormObjects'>} */
  const command = /** @type {never} */ ({ kind: 'promoteFormObjects', page: 0 });

  // BEFORE: the words are there and the editing commands cannot name them.
  const before = await textOf(original);
  const indicesBefore = await textIndicesOf(original);
  record(
    'BEFORE: the page’s text is findable and only ONE run is addressable',
    before.includes(INSIDE_FIRST) && indicesBefore.length === 1,
    `text ${JSON.stringify(before.slice(0, 30))}; ${String(indicesBefore.length)} addressable ` +
      'object(s) against three runs on the page — which is the gap this command closes',
  );

  const promoted = await localPdfiumExecution.apply(original, command);
  const after = await textOf(promoted);
  const indicesAfter = await textIndicesOf(promoted);

  record(
    'the promotion makes every run addressable',
    indicesAfter.length === 3,
    `${String(indicesAfter.length)} addressable object(s) after, against ` +
      `${String(indicesBefore.length)} before`,
  );
  // THE TEXT IS ASSERTED WHOLE AND IN ORDER, not by `includes`. Inserting the
  // children in reverse leaves every pixel where it was and changes the page's
  // own reading of itself — measured while writing `pdfiumPromote.mjs`, and an
  // `includes` for each string passes for that document.
  record(
    'and the page reads exactly as it did, in the same order',
    after === before,
    `before ${JSON.stringify(before)}; after ${JSON.stringify(after)}`,
  );

  // AND THE EDIT NOW SURVIVES, which is the whole point of the promotion.
  // Measured on 2026-09-10, `FPDFText_SetText` on a NESTED object returns 1,
  // `GenerateContent` returns 1, and the edit is absent from the reopened
  // bytes. So this case is the difference between the two states, asserted
  // through the ordinary editing command rather than through the adapter.
  const target = indicesAfter.find((index) => !indicesBefore.includes(index)) ?? indicesAfter[1];
  const edited = await localPdfiumExecution.apply(
    promoted,
    /** @type {never} */ ({
      kind: 'replaceTextObject',
      page: 0,
      replacements: [{ index: target, text: PROMOTED_EDIT }],
      version: 1,
    }),
  );
  record(
    'a promoted object can then be EDITED, and the edit survives the save',
    (await textOf(edited)).includes(PROMOTED_EDIT),
    `the page reads ${JSON.stringify((await textOf(edited)).slice(0, 60))}`,
  );

  // A PAGE WITH NO FORM IS UNCHANGED. Without this the command could be
  // rewriting every page it is pointed at, and every case above would still
  // pass — the reassuring answer for a promotion is that the text is the same,
  // which is also what an untouched page produces.
  const plain = await threeRunsAndARectangle();
  const untouched = await localPdfiumExecution.apply(
    plain,
    /** @type {never} */ ({ kind: 'promoteFormObjects', page: 0 }),
  );
  record(
    'CONTROL: a page carrying no form is left with the same text and the same objects',
    (await textOf(untouched)) === (await textOf(plain)) &&
      (await textIndicesOf(untouched)).length === (await textIndicesOf(plain)).length,
    'a promotion that rewrote every page would satisfy every case above',
  );

  const prior = await localPdfiumExecution.capture(original, command);
  record(
    'a promotion REFUSES to capture, because PDFium cannot rebuild a Form XObject',
    prior.captured === false && prior.reason.includes('Form XObject'),
    prior.captured === false ? prior.reason : 'it claimed to capture something',
  );
}

await main();
