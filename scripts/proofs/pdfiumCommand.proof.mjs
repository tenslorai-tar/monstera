// @ts-check
/**
 * In-place text editing, as a COMMAND, against the real library.
 *
 * ## The command names a LIST, and both arities are cased here
 *
 * `replaceTextObject` names a list of objects — `objects`, one `text` and the
 * `starts` that cut it, ADR-0142's wire form, built here by the contract's
 * `replacementFieldsOf` — so that a visual line, several text objects because
 * PDFium answers one rect per run, is one command, one
 * `FPDFPage_GenerateContent` and one undo step. The single-entry cases below are
 * region replacement; the two-object ones are the line edit's shape, and they
 * exist because an execution that took the first object and dropped the rest
 * would pass every single-entry case in this file.
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
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
  beginText,
  concatTransformationMatrix,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from '@cantoo/pdf-lib';

import { PDFIUM_COMMAND, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { pageStreams } from '../lib/pageStreams.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { withNoPassword } from '../lib/pdfiumNoPassword.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';
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
refuseStaleBuild(root, PDFIUM_COMMAND, 19);

// EVERY EDIT BUILT THROUGH THE CONTRACT'S ONE ENCODER, as the application builds it (ADR-0142).
const { blockEditOf, replacementFieldsOf } = await import('../../packages/contract/dist/commands.js');
const { lineText, paragraphsOfLines } = await import('../../packages/shared/dist/index.js');
const {
  objectRuns,
  openPdfium,
  pdfiumWriter,
  pageObjects,
  pageRuns,
  pageText,
  renderPageBitmap,
  replaceTextObjects,
  runFonts,
  textObjectIndices,
  textRuns,
} = await import('../../packages/kernel/dist/pdfiumFfi.js');
// THE KERNEL'S OWN NUMBERING of a page's text operators (ADR-0176 Decision 3), which `pageRuns` is joined against.
const { joinedContent, showOperators, textObjectCount } = await import('../../packages/kernel/dist/textOperators.js');
// THE ONE HARFBUZZ READER, to read a rebuilt run font back (ADR-0175).
const { ShapingFace } = await import('../../packages/kernel/dist/textShaping.js');
const { groupIntoBlocks, settingOf } = await import('../../packages/kernel/dist/textLines.js');
const specs = await import('../../packages/kernel/dist/pdfiumSpecs.js');
// OVER BYTES THAT OPEN WITH NO PASSWORD, as every fixture here but the encrypted one does (`withNoPassword`).
const localPdfiumExecution = withNoPassword(specs.localPdfiumExecution);
const { declaredCommands } = await import('../../packages/kernel/dist/commandDeclarations.js');
const { EditRefusedError } = await import('../../packages/kernel/dist/textEditRefusals.js');
const { HeldPassword } = await import('../../packages/shared/dist/index.js');
// THE CATALOGUE AN EDIT SETS A WORD IN, bound as `pdfiumHostEntry.ts` binds it (ADR-0173).
const { bindEditFaces } = await import('../../packages/kernel/dist/editFaces.js');
const { faceSourceOf } = await import('../../packages/kernel/dist/fontCatalogue.js');

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

/** Made up for this proof; no document a person owns carries them. */
const USER_PASSWORD = 'sample-user-0171';
const OWNER_PASSWORD = 'sample-owner-0171';

/**
 * A document that opens only with a password reaches PDFium WITH it
 * ([ADR-0171](../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)'s addendum).
 *
 * `threeRunsAndARectangle` encrypted AES-256 by pdf-lib with a user and an owner password, edited through the very
 * execution the host runs (`specs.localPdfiumExecution`, not the no-password wrapper), with the key the bus hands it.
 * The saved bytes are read back here with PDFium's own open, so what is asserted is the file, not the session.
 */
async function passwordCases() {
  const locked = await PDFDocument.load(await threeRunsAndARectangle());
  locked.encrypt({ userPassword: USER_PASSWORD, ownerPassword: OWNER_PASSWORD, algorithm: 'AES-256' });
  const bytes = await locked.save();
  const command = /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceAllText'>} */ ({
    kind: 'replaceAllText',
    find: 'SECOND',
    replace: 'LATTER',
  });
  /** What the saved bytes say, opened with `password` or none, or why PDFium refused them. @param {Uint8Array} saved @param {string | undefined} password */
  const reading = async (saved, password) => {
    let session;
    try {
      session = await pdfiumWriter.open(saved, password);
    } catch (error) {
      return `refused: ${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      return await pageText(session, 0);
    } finally {
      await pdfiumWriter.close(session);
    }
  };

  /** @type {readonly (readonly [string, string])[]} */
  const keys = [['USER', USER_PASSWORD], ['OWNER', OWNER_PASSWORD]];
  for (const [which, password] of keys) {
    let saved;
    let answer = 'saved';
    try {
      // THE IMAGE OUT OF THE ANSWER, beside which the apply names any box it drew (ADR-0174).
      saved = (
        await specs.localPdfiumExecution.apply({
          session: { bytes, opensWith: new HeldPassword(password) },
          command,
          sources: [],
          reads: undefined,
        })
      ).image;
    } catch (error) {
      answer = error instanceof Error ? error.message : String(error);
    }
    const withNone = saved === undefined ? 'nothing saved' : await reading(saved, undefined);
    const withUser = saved === undefined ? 'nothing saved' : await reading(saved, USER_PASSWORD);
    record(
      `a document opened with its ${which} password is edited through PDFium with it, and the saved file still needs one`,
      withNone.startsWith('refused') && withUser.includes('LATTER RUN') && !withUser.includes('SECOND RUN'),
      `${answer}; the saved file opened with none: ${withNone.slice(0, 80)}; with the user password: ${JSON.stringify(withUser.slice(0, 120))}`,
    );
  }

  // THE CONTROL, and the input is one the edit WOULD take with its key, measured just above: the same bytes and the
  // same command with no key are refused at the open with PDFium's own number for a password, 4 (FPDF_ERR_PASSWORD).
  let refusal;
  try {
    await specs.localPdfiumExecution.apply({ session: { bytes, opensWith: undefined }, command, sources: [], reads: undefined });
  } catch (error) {
    refusal = error;
  }
  record(
    'CONTROL: the same edit with no key is refused at open with FPDF_ERR_PASSWORD, so nothing reaches a page',
    refusal instanceof EditRefusedError && refusal.step === 'open' && refusal.engineError === 4,
    refusal instanceof Error ? refusal.message : 'it was SAVED without a password',
  );
}

/**
 * The case roster.
 *
 * `createRoster` rather than a total printed from what ran, because a total
 * computed over the cases that executed agrees with any collection, including
 * one that has quietly shrunk — audit item 4c. The figure is an independent
 * claim about this file, not a count of it.
 *
 * @type {string[]}
 */
const failures = [];
// 69 until 2026-10-04, when `replaceAtCases` added five (ADR-0156), and 75 from the stage audit of
// cb62b976..33715f7c, which gave blank paper's refusal its control, and 77 from ADR-0169, which names the characters,
// and 80 from its Decision 6's empty replacement: a word deleted, an object removed, and the checkpoint either takes,
// and 82 from the same decision's *no version*: one occurrence for itself, and a word the page reads but no object
// holds (the identity replace-all case became the nothing-matched one), and 84 from the line rule's two, and 87 from
// ADR-0171's addendum: an edit of a document opened with either password, and its control with none, and 95 from
// ADR-0173's pieces: a word saved in a bundled face, its object, its wrap, the word the twin refused, an unreadable
// catalogue either way, and a control either side, and 97 from its correction: a character past the BMP and its premise,
// and 100 from the box: its premise, its reading, and its answer (ADR-0174), and 117 from ADR-0176's pageRuns: the
// Chromium print's members against the kernel's own numbering, and the ruled page's object indices as the control, and
// 126 from ADR-0179's paragraphs: the fixture's soft ends and its words, a letter that moves one line, a bold word that
// wraps bold, a centred line and an indented first line kept, and a control beside each, and 129 from the render mode an
// edit keeps: invisible text stays invisible, with a visible control and the fixture's own, and 143 from ADR-0180's
// marks: bold, colour, size, underline, superscript and a restated mark, then alignment, line spacing and an indent, each
// with the control that separates the mark from the fixture.
const roster = createRoster(failures, { cases: 157 });

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
    ...replacementFieldsOf([{ index: texts[1] ?? -1, text: REPLACEMENT }]),
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
    ...replacementFieldsOf([{ index: 99, text: REPLACEMENT }]),
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
    ...replacementFieldsOf([
      { index: texts[0] ?? -1, text: REPLACEMENT },
      { index: 99, text: REPLACEMENT },
    ]),
  });
  record(
    'a capture whose list is partly unreadable refuses the WHOLE command',
    partly.captured === false,
    partly.captured === false
      ? partly.reason
      : `it captured ${String(partly.prior.objects.length)} object(s) of two`,
  );

  const applied = await localPdfiumExecution.apply({
    session: original,
    command,
    sources: [],
    reads: undefined,
  });
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
  // the first object and dropped the rest would pass every case above.
  const bothCommand = /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextObject'>} */ ({
    kind: 'replaceTextObject',
    page: 0,
    ...replacementFieldsOf([
      { index: texts[0] ?? -1, text: 'FIRST RUN is edited too' },
      { index: texts[2] ?? -1, text: 'THIRD RUN is edited too' },
    ]),
    version: 1,
  });
  const bothPrior = await localPdfiumExecution.capture(original, bothCommand);
  const bothApplied = await localPdfiumExecution.apply({
    session: original,
    command: bothCommand,
    sources: [],
    reads: undefined,
  });
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
    await localPdfiumExecution.apply({
      session: original,
      command: /** @type {never} */ ({ kind: 'rotatePages' }),
      sources: [],
      reads: undefined,
    });
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  record(
    'a command routed to another writer is refused by name',
    refusal !== null && refusal.includes('is not routed to PDFium'),
    refusal ?? 'it was accepted',
  );

  await replaceAllCases();
  await replaceAtCases();
  await promotionCases();
  await nestedPromotionCases();
  await blockEditCases();
  await paragraphCases();
  await formatCases();
  await placeCases();
  await pastThePageCases();
  await glyphLineCases();
  await settingCases();
  await passwordCases();
  await pageRunsCases();
  // LAST, because they bind the process's catalogue, and unbind it before returning.
  await pieceCases();
  await replacePieceCases();
  await siblingCases();
  await runFontCases();
  await formatPieceCases();

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} PDFium command case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('PDFium command case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/**
 * A word the run's font cannot carry is its own piece, in the resolver's face, and the rest of the line keeps the
 * document's font ([ADR-0173](../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decisions 1 to 4, the owner's Q6).
 *
 * Against {@link aParagraph}, whose Helvetica is WinAnsi and carries no Cyrillic, with the bundled fonts bound as the
 * PDFium host's entry binds them. THE CONTROL is the same edit with no catalogue bound, which must be refused naming
 * the Cyrillic: so the save below is the pieces' doing, and not a font that could draw the word all along. And a Latin
 * edit with the catalogue bound must add no object and no font, so a piece is made only for a word the font lacks.
 */
async function pieceCases() {
  const fonts = fontsDirectory(root);
  if (!existsSync(fonts)) {
    record('the bundled fonts are provisioned for the piece cases', false, `${fonts} is absent; run scripts/provision/fonts.mjs`);
    return;
  }
  const original = await aParagraph();
  const { blocks } = await blocksOf(original);
  const block = blocks[0];
  if (block === undefined) {
    record('the paragraph fixture reads as a block for the piece cases', false, 'it read as none');
    return;
  }
  const lines = block.lines.map((line) => line.runs.map((run) => run.index));
  /** The whole answer, image and boxes (ADR-0174). @param {string} first the block's first line as typed; the other two are kept */
  const editDrawing = (first) =>
    localPdfiumExecution.applyDrawing({
      session: original,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines, soft: lines.map(() => false), text: [first, BLOCK_LINES[1], BLOCK_LINES[2]].join('\n') }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  /** The image alone. @param {string} first */
  const edit = async (first) => (await editDrawing(first)).image;
  const WORD = 'Привет';
  const TYPED = `The first ${WORD} line of the block`;
  /** The lines a reading holds before the block's unedited second line, as one line: what the first line became. */
  const firstLineOf = (/** @type {string} */ text) => {
    const read = text.split(/\r?\n/u).map((line) => line.trim());
    return read.slice(0, read.indexOf(BLOCK_LINES[1] ?? '')).join(' ');
  };
  /** Page 0's runs one per object, from bytes. @param {Uint8Array} bytes */
  const objectRunsOf = async (bytes) => {
    const session = await pdfiumWriter.open(bytes);
    try {
      return (await objectRuns(session, 0)).runs;
    } finally {
      await pdfiumWriter.close(session);
    }
  };

  // THE CONTROL, with nothing bound: the font cannot carry the word and there is nowhere else to set it.
  bindEditFaces(null);
  /** @type {unknown} */
  let unbound;
  try {
    await edit(TYPED);
  } catch (error) {
    unbound = error;
  }
  record(
    'CONTROL: with no catalogue, a Cyrillic word typed into a Helvetica line is refused, naming it',
    unbound instanceof Error && unbound.name === 'TextNotWritableError' && 'characters' in unbound && String(unbound.characters).includes('П'),
    unbound instanceof Error ? `${unbound.name}: ${'characters' in unbound ? String(unbound.characters) : unbound.message}` : 'it was SAVED',
  );

  // A FOLDER THAT CANNOT BE READ fails only the edit that needs a face: the catalogue is read by the first word that
  // needs one, never by an edit the document's own fonts carry. The control is the Cyrillic edit on the same binding,
  // which must meet the fault — so the Latin save is the laziness, and not a binding that was never consulted.
  bindEditFaces(() => {
    throw new Error('this catalogue cannot be read');
  });
  let latinOnBroken = 'saved';
  try {
    await edit('The first line of a block');
  } catch (error) {
    latinOnBroken = error instanceof Error ? error.message : String(error);
  }
  let cyrillicOnBroken = 'it was SAVED';
  try {
    await edit(TYPED);
  } catch (error) {
    cyrillicOnBroken = error instanceof Error ? error.message : String(error);
  }
  record(
    'an unreadable catalogue does not refuse an edit the page’s own font carries',
    latinOnBroken === 'saved',
    latinOnBroken,
  );
  record(
    'CONTROL: and the edit that needs a face meets the unreadable catalogue as a fault, not as a twin',
    cyrillicOnBroken.includes('this catalogue cannot be read'),
    cyrillicOnBroken,
  );

  bindEditFaces(() => faceSourceOf([{ path: fonts, origin: 'bundled' }]));
  try {
    /** @type {Uint8Array | undefined} */
    let saved;
    let answer = 'saved';
    try {
      saved = await edit(TYPED);
    } catch (error) {
      answer = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    // THE BLOCK'S FIRST LINE AS TYPED, read across the line it may wrap onto: the line grew past the block's measure.
    const text = saved === undefined ? '' : await textOf(saved);
    record(
      'with the bundled fonts bound, the same edit is saved and the reopened page says it, the other lines kept',
      firstLineOf(text) === TYPED && text.includes(BLOCK_LINES[1] ?? '') && text.includes(BLOCK_LINES[2] ?? ''),
      `${answer}; it reads ${JSON.stringify(text.slice(0, 160))}`,
    );

    // THE WORD IN ANOTHER FACE AND THE REST IN HELVETICA, read OBJECT BY OBJECT (`objectRuns`): the editor's reading
    // joins the pieces back into one run, since they abut on one line set alike (ADR-0130), and answers the first
    // object's font for all of it. With the space before the word in the word's piece (Decision 2).
    const objects = saved === undefined ? [] : await objectRunsOf(saved);
    const holding = (/** @type {string} */ part) => objects.find((run) => run.text.includes(part));
    const word = holding(WORD);
    const before = holding('The first');
    const after = holding('line of the');
    record(
      'the word is its own object in a bundled face, with the space before it, and the words around it stay in Helvetica',
      word !== undefined &&
        word.text.trimEnd() === ` ${WORD}` &&
        /^[A-Z]{6}\+Arimo/u.test(word.style.font) &&
        before?.style.font === 'Helvetica' &&
        after?.style.font === 'Helvetica' &&
        before !== word &&
        after !== word,
      JSON.stringify(objects.slice(0, 5).map((run) => [run.text, run.style.font])),
    );

    // AND NOTHING TYPED IS LOST WHEN A LINE IN PIECES WRAPS: past the column, the wrap trims the pieces from their
    // end and carries the rest onto a new line, in order. The line OPENS with the word, so its first piece is in the
    // bundled face: the lines it wraps onto must still be made in the run's own Helvetica, never in that piece's face.
    const long = `${WORD} first line of the block grows with words enough to pass the column’s right edge and wrap ${WORD} below`;
    let wrapped = '';
    /** @type {readonly { text: string, style: { font: string } }[]} */
    let wrappedObjects = [];
    try {
      const bytes = await edit(long);
      wrapped = await textOf(bytes);
      wrappedObjects = await objectRunsOf(bytes);
    } catch (error) {
      wrapped = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    const lineCount = wrapped.split(/\r?\n/u).indexOf(BLOCK_LINES[1] ?? '');
    const latinInAFace = wrappedObjects.filter((run) => !run.text.includes(WORD) && run.style.font !== 'Helvetica');
    record(
      'a line in pieces that grows past the column wraps, every word typed reads back in order, and only the word leaves Helvetica',
      firstLineOf(wrapped) === long && lineCount > 2 && wrappedObjects.length > 0 && latinInAFace.length === 0,
      `${String(lineCount)} line(s) before the second; they read ${JSON.stringify(firstLineOf(wrapped))}; ` +
        `not in Helvetica: ${JSON.stringify(latinInAFace.map((run) => [run.text, run.style.font]))}`,
    );

    // THE CASE THE TWIN COULD NOT TAKE: Helvetica in StandardEncoding, where the standard load hands back this very
    // font, refused `é` above with no catalogue. With one, `déjà` is a piece in Arimo, and saved.
    const narrowed = await aParagraphInStandardEncoding('Helvetica');
    const narrowedLines = ((await blocksOf(narrowed)).blocks[0]?.lines ?? []).map((line) => line.runs.map((run) => run.index));
    const accented = 'a second line, déjà vu';
    let accentedText = '';
    /** @type {readonly { text: string, style: { font: string } }[]} */
    let accentedObjects = [];
    try {
      const bytes = await localPdfiumExecution.apply({
        session: narrowed,
        command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
          kind: 'editTextBlock',
          page: 0,
          ...blockEditOf([{ lines: narrowedLines, soft: narrowedLines.map(() => false), text: [BLOCK_LINES[0], accented, BLOCK_LINES[2]].join('\n') }]),
          fit: 'reflow',
          version: 1,
        }),
        sources: [],
        reads: undefined,
      });
      accentedText = await textOf(bytes);
      accentedObjects = await objectRunsOf(bytes);
    } catch (error) {
      accentedText = `refused: ${error instanceof Error ? error.name : String(error)}`;
    }
    const dejaVu = accentedObjects.find((run) => run.text.includes('déjà'));
    record(
      'a word a StandardEncoding Helvetica cannot carry, which the twin refused, is saved as a piece in a bundled face',
      accentedText.includes(accented) && dejaVu !== undefined && /Arimo/u.test(dejaVu.style.font),
      `${JSON.stringify(accentedText.slice(0, 120))}; ${JSON.stringify(dejaVu === undefined ? null : [dejaVu.text, dejaVu.style.font])}`,
    );

    // A CHARACTER PAST THE BMP (ADR-0173's correction): `FPDFText_SetText` draws it as code 0, which the live read-back
    // refuses and a reopened page reads as nothing, so only a piece set by its subset's glyph ids is saved reading it.
    const ASTRAL = String.fromCodePoint(0x10140);
    const carriers = faceSourceOf([{ path: fonts, origin: 'bundled' }]).faces.filter((face) => face.unicodes.has(0x10140));
    record(
      'PREMISE: a bundled face carries U+10140, so the case below asks the setter and not the catalogue',
      carriers.length > 0,
      carriers.map((face) => face.family).join(', ') || 'no bundled face carries it',
    );
    const astralTyped = `The first line ${ASTRAL} of the block`;
    let astralText = '';
    /** @type {readonly { text: string, style: { font: string } }[]} */
    let astralObjects = [];
    try {
      const bytes = await edit(astralTyped);
      astralText = await textOf(bytes);
      astralObjects = await objectRunsOf(bytes);
    } catch (error) {
      astralText = `refused: ${error instanceof Error ? `${error.name} ${'characters' in error ? String(error.characters) : error.message}` : String(error)}`;
    }
    const astralPiece = astralObjects.find((run) => run.text.includes(ASTRAL));
    record(
      'a character past the BMP is saved in a bundled face and the reopened page reads it, the rest kept',
      firstLineOf(astralText) === astralTyped && astralPiece !== undefined && !astralPiece.style.font.includes('Helvetica'),
      `${JSON.stringify(astralText.slice(0, 120))}; ${JSON.stringify(astralPiece === undefined ? null : [astralPiece.text, astralPiece.style.font])}`,
    );

    // A CHARACTER NO FACE CARRIES IS THE BOX (ADR-0173 Decision 7 as corrected), drawn in a box font of its own whose
    // cmap names the real character, so the reopened page READS the character; and the apply ANSWERS it with its page
    // (ADR-0174), which is how the person is told. The premise is that no bundled face carries it, or the case would be
    // asking the resolver rather than the box.
    const NONE_CARRY = String.fromCodePoint(0x4e2d);
    const catalogue = faceSourceOf([{ path: fonts, origin: 'bundled' }]).faces;
    record(
      'PREMISE: no bundled face carries U+4E2D, and one carries the box U+25A1',
      !catalogue.some((face) => face.unicodes.has(0x4e2d)) && catalogue.some((face) => face.unicodes.has(0x25a1)),
      `${String(catalogue.filter((face) => face.unicodes.has(0x4e2d)).length)} carry U+4E2D; ` +
        `${String(catalogue.filter((face) => face.unicodes.has(0x25a1)).length)} carry U+25A1`,
    );
    const boxTyped = `The first ${NONE_CARRY} line of the block`;
    let boxText = '';
    /** @type {readonly { text: string, style: { font: string } }[]} */
    let boxObjects = [];
    /** @type {unknown} */
    let boxAnswer = null;
    try {
      const drawn = await editDrawing(boxTyped);
      boxAnswer = { boxed: drawn.boxed, more: drawn.more };
      boxText = await textOf(drawn.image);
      boxObjects = await objectRunsOf(drawn.image);
    } catch (error) {
      boxText = `refused: ${error instanceof Error ? `${error.name} ${'characters' in error ? String(error.characters) : error.message}` : String(error)}`;
    }
    const boxPiece = boxObjects.find((run) => run.text === NONE_CARRY);
    record(
      'a character no face carries is saved as a box in a font of its own, and the reopened page reads the character',
      firstLineOf(boxText) === boxTyped && boxPiece !== undefined && /^[A-Z]{6}\+.*-Box$/u.test(boxPiece.style.font),
      `${JSON.stringify(boxText.slice(0, 100))}; ${JSON.stringify(boxPiece === undefined ? null : [boxPiece.text, boxPiece.style.font])}`,
    );
    record(
      'and the apply answers it, with the page it is on, so the person is told (ADR-0174)',
      JSON.stringify(boxAnswer) === JSON.stringify({ boxed: [{ character: NONE_CARRY, page: 0 }], more: 0 }),
      JSON.stringify(boxAnswer),
    );

    // CONTROL: a Latin edit with the catalogue bound makes no piece — the same objects, and no new font in the file.
    let latin = 'it was refused';
    let latinObjects = -1;
    /** @type {unknown} */
    let latinBoxes = null;
    try {
      const drawn = await editDrawing('The first line of a block');
      latinObjects = (await textIndicesOf(drawn.image)).length;
      latin = JSON.stringify((await objectRunsOf(drawn.image)).map((run) => run.style.font));
      latinBoxes = { boxed: drawn.boxed, more: drawn.more };
    } catch (error) {
      latin = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    // AND IT ANSWERS NO BOX, the control for the box case's answer: an apply that answered every character it wrote
    // would pass that case and fail here.
    record(
      'CONTROL: a Latin edit with the catalogue bound stays in its own objects and font, and answers no box',
      latinObjects === (await textIndicesOf(original)).length &&
        !latin.includes('Arimo') &&
        latin.includes('Helvetica') &&
        JSON.stringify(latinBoxes) === JSON.stringify({ boxed: [], more: 0 }),
      `${String(latinObjects)} text object(s); fonts ${latin}; boxes ${JSON.stringify(latinBoxes)}`,
    );
  } finally {
    bindEditFaces(null);
  }
}

/**
 * A block typed past the foot of its page is written WHOLE, and nothing typed is lost (the owner's Q7): the edit is
 * never refused for it, every line reads back from the saved bytes in order, and the block read the editor outlines
 * answers every line with its box below the page, which is what the renderer says *no longer fits* from. THE CONTROL is
 * the same paragraph given lines that fit, whose block stays on the page: so the first case's box is the overflow's, not
 * a reading that always reaches below.
 */
async function pastThePageCases() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('A paragraph near the foot of the page', { x: 72, y: 40, size: 11, font });
  page.drawText('and its second line', { x: 72, y: 26, size: 11, font });
  const original = await document.save();
  const lines = ((await blocksOf(original)).blocks[0]?.lines ?? []).map((line) => line.runs.map((run) => run.index));
  /** @param {readonly string[]} typed */
  const typing = (typed) =>
    localPdfiumExecution.apply({
      session: original,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines, soft: lines.map(() => false), text: typed.join('\n') }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  const past = [
    'A paragraph near the foot of the page',
    'and its second line',
    'a third line typed',
    'a fourth line typed',
    'a fifth line typed',
    'THE LAST LINE TYPED',
  ];
  /** @type {string} */
  let read;
  /** @type {{ y0: number, lines: number } | null} */
  let block = null;
  try {
    const bytes = await typing(past);
    read = await pageOf(bytes, 0);
    const [first] = (await blocksOf(bytes)).blocks;
    block = first === undefined ? null : { y0: first.box.y0, lines: first.lines.length };
  } catch (error) {
    read = `refused: ${error instanceof Error ? error.name : String(error)}`;
  }
  const order = read.split(/\r?\n/u).map((line) => line.trim());
  record(
    'a block typed past the foot of its page is saved, and every line typed reads back from the saved bytes in order',
    JSON.stringify(order.slice(0, past.length)) === JSON.stringify(past),
    JSON.stringify(read.slice(0, 200)),
  );
  record(
    'and the block read answers every line with its box below the page, which the editor outlines as past it',
    block !== null && block.lines === past.length && block.y0 < 0,
    JSON.stringify(block),
  );
  /** @type {{ y0: number, lines: number } | string} */
  let fitting = 'it read as no block';
  try {
    const [first] = (await blocksOf(await typing(['A paragraph near the foot', 'of the page']))).blocks;
    if (first !== undefined) fitting = { y0: first.box.y0, lines: first.lines.length };
  } catch (error) {
    fitting = `refused: ${error instanceof Error ? error.name : String(error)}`;
  }
  record(
    'CONTROL: the same paragraph given lines that fit stays on the page',
    typeof fitting !== 'string' && fitting.lines === 2 && fitting.y0 >= 0,
    JSON.stringify(fitting),
  );
}

/**
 * Replace takes the editor's pieces ([ADR-0173](../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decision 9): a word the object's font cannot carry is its own piece, a character no face carries its box, and the
 * line rule (`replaceLineRule.ts`) still refuses a replacement that would move the text after it.
 *
 * Against {@link threePagesOfWidgets}, whose Helvetica is WinAnsi and carries no Cyrillic: each whole line is one
 * object with nothing after it, and page 0's third line is `WID` then `GET`. THE CONTROL for the save is the same
 * command with no catalogue bound, refused naming the word, so the save is the pieces' doing.
 */
async function replacePieceCases() {
  const fonts = fontsDirectory(root);
  if (!existsSync(fonts)) {
    record('the bundled fonts are provisioned for the replace piece cases', false, `${fonts} is absent; run scripts/provision/fonts.mjs`);
    return;
  }
  const original = await threePagesOfWidgets();
  const WORD = 'Привет';
  /**
   * @param {string} find @param {string} replace @param {{ x: number, y: number }} point
   * @returns {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextAt'>}
   */
  const at = (find, replace, point) => ({ kind: 'replaceTextAt', page: 0, find, replace, at: point });
  /** @param {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextAt' | 'replaceAllText'>} command */
  const drawing = (command) => localPdfiumExecution.applyDrawing({ session: original, command, sources: [], reads: undefined });
  /** The refusal's name and characters, or null where it was saved. @param {() => Promise<unknown>} work */
  const refusal = async (work) => {
    try {
      await work();
      return null;
    } catch (error) {
      return error instanceof Error ? `${error.name}${'characters' in error ? ` ${String(error.characters)}` : ''}` : String(error);
    }
  };
  /** Page 0's runs one per object, from bytes. @param {Uint8Array} bytes */
  const objectRunsOf = async (bytes) => {
    const session = await pdfiumWriter.open(bytes);
    try {
      return (await objectRuns(session, 0)).runs;
    } finally {
      await pdfiumWriter.close(session);
    }
  };
  // ON THE FIRST LINE, as `replaceAtCases` points: the whole line is one object, so nothing follows the word's object.
  const first = at('WIDGET', WORD, { x: 80, y: 233 });

  bindEditFaces(null);
  const unbound = await refusal(() => drawing(first));
  record(
    'CONTROL: with no catalogue, a Cyrillic replacement in a Helvetica line is refused naming it, and no twin is made',
    unbound !== null && unbound.startsWith('TextNotWritableError') && unbound.includes('П'),
    unbound ?? 'it was SAVED',
  );

  bindEditFaces(() => faceSourceOf([{ path: fonts, origin: 'bundled' }]));
  try {
    let read = '';
    /** @type {readonly { text: string, style: { font: string } }[]} */
    let objects = [];
    try {
      const drawn = await drawing(first);
      read = await pageOf(drawn.image, 0);
      objects = await objectRunsOf(drawn.image);
    } catch (error) {
      read = `refused: ${error instanceof Error ? error.name : String(error)}`;
    }
    const word = objects.find((run) => run.text.includes(WORD));
    const rest = objects.filter((run) => !run.text.includes(WORD) && run.text.trim() !== '');
    record(
      'with the bundled fonts bound, the replacement is saved, the word in its own object in a bundled face and the rest in Helvetica',
      read.includes(`The ${WORD} is on this page`) &&
        read.includes('and the WIDGET again below') &&
        word !== undefined &&
        word.text.trimEnd() === ` ${WORD}` &&
        /^[A-Z]{6}\+Arimo/u.test(word.style.font) &&
        rest.length > 0 &&
        rest.every((run) => run.style.font === 'Helvetica'),
      `${JSON.stringify(read.slice(0, 90))}; ${JSON.stringify(objects.slice(0, 4).map((run) => [run.text, run.style.font]))}`,
    );

    // ITS UNDO IS A CHECKPOINT: the pieces are new objects after the run, so a string put back by index would land in
    // the wrong object. By either command; CONTROL: a Latin replacement with the catalogue bound still captures.
    const lastObject = (await textIndicesOf(original)).at(-1) ?? -1;
    const replacing = (/** @type {string} */ text) =>
      /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextObject'>} */ ({
        kind: 'replaceTextObject',
        page: 0,
        ...replacementFieldsOf([{ index: lastObject, text }]),
        version: 1,
      });
    const pointPieced = await localPdfiumExecution.capture(original, first);
    const dialogPieced = await localPdfiumExecution.capture(original, replacing(WORD));
    const pointLatin = await localPdfiumExecution.capture(original, at('WIDGET', 'GADGET', { x: 80, y: 233 }));
    const dialogLatin = await localPdfiumExecution.capture(original, replacing('GOT'));
    record(
      'a replacement written in pieces takes a checkpoint, by either command, and a Latin one still captures its string',
      !pointPieced.captured &&
        pointPieced.reason.includes('renumbers') &&
        !dialogPieced.captured &&
        dialogPieced.reason.includes('renumbers') &&
        pointLatin.captured &&
        dialogLatin.captured,
      `point: ${pointPieced.captured ? 'captured' : pointPieced.reason}; dialog: ${dialogPieced.captured ? 'captured' : dialogPieced.reason}; ` +
        `Latin: ${String(pointLatin.captured)}, ${String(dialogLatin.captured)}`,
    );

    // THE LINE RULE HOLDS ON THE PIECES' WIDTH: `WID Дом` would draw into `GET`. Its first piece is `WID` in the run's
    // own object at its own width, and only the piece after it moves the line, so a rule that measured the old index
    // reads an object that did not move and saves the overlap; a wholly Cyrillic word does not separate the two, since
    // the run's own object is set to it before the probe sends it to a piece. `replaceAtCases`' `WDI` is the control
    // that the rule does not refuse every edit on such a line.
    const moving = await refusal(() => drawing(at('WID', 'WID Дом', { x: 35, y: 173 })));
    record(
      'a replacement in pieces that would move the text after it on its line is refused, measured on its pieces',
      moving === 'ReplaceMovesLineError',
      moving ?? 'it was SAVED',
    );

    // A CHARACTER NO FACE CARRIES IS ITS BOX, and the apply answers it with its page (ADR-0174), at a point and across
    // the document. `page` ends page 0's first line and page 1's: both are boxed, each on its own page, in order.
    const NONE_CARRY = String.fromCodePoint(0x4e2d);
    /** @type {unknown} */
    let pointBoxes = null;
    let pointRead = '';
    try {
      const drawn = await drawing(at('WIDGET', NONE_CARRY, { x: 80, y: 233 }));
      pointBoxes = { boxed: drawn.boxed, more: drawn.more };
      pointRead = await pageOf(drawn.image, 0);
    } catch (error) {
      pointRead = `refused: ${error instanceof Error ? error.name : String(error)}`;
    }
    record(
      'one occurrence replaced by a character no face carries is saved as its box, reading the character, and answered',
      pointRead.includes(`The ${NONE_CARRY} is on this page`) &&
        JSON.stringify(pointBoxes) === JSON.stringify({ boxed: [{ character: NONE_CARRY, page: 0 }], more: 0 }),
      `${JSON.stringify(pointRead.slice(0, 60))}; ${JSON.stringify(pointBoxes)}`,
    );
    /** @param {string} find @param {string} replace */
    const everywhere = (find, replace) =>
      /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceAllText'>} */ ({
        kind: 'replaceAllText',
        find,
        replace,
        version: 1,
      });
    /** @type {unknown} */
    let allBoxes = null;
    try {
      const drawn = await drawing(everywhere('page', NONE_CARRY));
      allBoxes = { boxed: drawn.boxed, more: drawn.more };
    } catch (error) {
      allBoxes = `refused: ${error instanceof Error ? error.name : String(error)}`;
    }
    record(
      'a replace-all to a character no face carries answers every box with its own page, across the document',
      JSON.stringify(allBoxes) ===
        JSON.stringify({ boxed: [{ character: NONE_CARRY, page: 0 }, { character: NONE_CARRY, page: 1 }], more: 0 }),
      JSON.stringify(allBoxes),
    );
    /** @type {unknown} */
    let latinBoxes = null;
    try {
      const drawn = await drawing(everywhere('WIDGET', 'GADGET'));
      latinBoxes = { boxed: drawn.boxed, more: drawn.more };
    } catch (error) {
      latinBoxes = `refused: ${error instanceof Error ? error.name : String(error)}`;
    }
    record(
      'CONTROL: a Latin replace-all with the catalogue bound answers no box',
      JSON.stringify(latinBoxes) === JSON.stringify({ boxed: [], more: 0 }),
      JSON.stringify(latinBoxes),
    );
  } finally {
    bindEditFaces(null);
  }
}

/**
 * ADR-0176's `pageRuns`, through this PDFium, joined against the kernel's own numbering of the same content
 * (`textOperators.ts`): what the operator writer finds a run's glyphs by. On the committed Chromium print every member of
 * every run is an operator that shows a code, and the inkless spaces between glyphs are members of none. CONTROL: a page
 * that draws a rule between two lines, where PDFium's text objects are 0 and 2, so a list that answered text ordinals
 * would read [0, 1] and name the rule.
 */
async function pageRunsCases() {
  const chromium = new Uint8Array(readFileSync(resolve(root, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf')));
  const read = async (/** @type {Uint8Array} */ bytes) => {
    const session = await pdfiumWriter.open(bytes);
    try {
      return await pageRuns(session, 0);
    } finally {
      await pdfiumWriter.close(session);
    }
  };
  const runs = await read(chromium);
  const ops = showOperators(joinedContent(await pageStreams(chromium, 0)));
  const opOf = (/** @type {number} */ member) => ops.find((op) => op.object === runs.textObjects.indexOf(member));
  const members = runs.runs.flatMap((run) => [...run.members]);
  const spaces = ops.filter((op) => op.codes.length === 1 && op.codes[0] === 3 && op.state.font === 'F4');
  record(
    'pageRuns names the Chromium print’s glyph objects: every member an operator that shows a code, no space glyph a member',
    runs.textObjects.length === textObjectCount(ops) &&
      members.length > 0 &&
      members.every((member) => (opOf(member)?.codes.length ?? 0) > 0) &&
      spaces.length > 0 &&
      spaces.every((space) => !members.includes(runs.textObjects[space.object ?? -1] ?? -1)) &&
      runs.runs[0]?.text.startsWith('Monstera') === true,
    `${String(runs.textObjects.length)} text objects for ${String(textObjectCount(ops))} operators; ${String(members.length)} members; ${String(spaces.length)} spaces; first ${JSON.stringify(runs.runs[0]?.text)}`,
  );

  const document = await PDFDocument.create();
  const page = document.addPage([300, 300]);
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Above the rule', { x: 20, y: 250, size: 12, font: helvetica });
  page.drawRectangle({ x: 20, y: 240, width: 200, height: 1, color: rgb(0, 0, 0) });
  page.drawText('Below the rule', { x: 20, y: 220, size: 12, font: helvetica });
  const ruled = await read(await document.save());
  record(
    'CONTROL: on a page with a rule between two lines, the text objects are 0 and 2 and the runs are named by them',
    JSON.stringify(ruled.textObjects) === '[0,2]' && JSON.stringify(ruled.runs.map((run) => run.members)) === '[[0],[2]]',
    JSON.stringify({ textObjects: ruled.textObjects, members: ruled.runs.map((run) => run.members) }),
  );
}

/**
 * A word the run's font lacks goes into a SIBLING already in the document before any bundled face
 * ([ADR-0173](../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decision 4): another embedded subset of the same font, by its name less the subset tag.
 *
 * The fixture is made by this writer's own edits, so it is generated: {@link aParagraph}'s first line typed to end in
 * `Привет` makes subset S1 of Arimo, and the block far below typed to end in `Дом` makes S2, each named `TAG+` the same
 * name. Then the S1 piece is replaced by ` Привет Дом`, which S1 cannot draw and S2 can. THE CONTROL is the same
 * replacement on the document before S2 existed, which must load a face of its own: so the reuse is the sibling's
 * doing, and not every replacement landing in an Arimo font whatever the document holds.
 */
async function siblingCases() {
  const fonts = fontsDirectory(root);
  if (!existsSync(fonts)) {
    record('the bundled fonts are provisioned for the sibling cases', false, `${fonts} is absent; run scripts/provision/fonts.mjs`);
    return;
  }
  /** Page 0's runs one per object, from bytes. @param {Uint8Array} bytes */
  const objectRunsOf = async (bytes) => {
    const session = await pdfiumWriter.open(bytes);
    try {
      return (await objectRuns(session, 0)).runs;
    } finally {
      await pdfiumWriter.close(session);
    }
  };
  /** One block retyped, by the block that holds `starts`. @param {Uint8Array} bytes @param {string} starts @param {string} text */
  const retype = async (bytes, starts, text) => {
    const block = (await blocksOf(bytes)).blocks.find((each) => (each.lines[0]?.runs[0]?.text ?? '').startsWith(starts));
    if (block === undefined) throw new Error(`no block begins ${JSON.stringify(starts)}`);
    return localPdfiumExecution.apply({
      session: bytes,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines: block.lines.map((line) => line.runs.map((run) => run.index)), soft: block.lines.map(() => false), text }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  };
  /** The S1 piece replaced, as Replace writes it. @param {Uint8Array} bytes */
  const replaceTheFirst = async (bytes) => {
    const piece = (await objectRunsOf(bytes)).find((run) => run.text.includes('Привет'));
    if (piece === undefined) throw new Error('the first piece is not on the page');
    return {
      piece,
      bytes: await localPdfiumExecution.apply({
        session: bytes,
        command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextObject'>} */ ({
          kind: 'replaceTextObject',
          page: 0,
          ...replacementFieldsOf([{ index: piece.index, text: ' Привет Дом' }]),
          version: 1,
        }),
        sources: [],
        reads: undefined,
      }),
    };
  };
  bindEditFaces(() => faceSourceOf([{ path: fonts, origin: 'bundled' }]));
  try {
    const first = await retype(await aParagraph(), 'The first', [`${BLOCK_LINES[0] ?? ''} Привет`, BLOCK_LINES[1], BLOCK_LINES[2]].join('\n'));
    const both = await retype(first, 'A separate', `${FAR_BELOW} Дом`);
    const named = (await objectRunsOf(both)).map((run) => [run.text, run.style.font]);
    const s1 = named.find(([text]) => String(text).includes('Привет'))?.[1] ?? '';
    const s2 = named.find(([text]) => String(text).includes('Дом'))?.[1] ?? '';
    record(
      'PREMISE: two edits made two Arimo subsets whose names differ by the subset tag alone',
      /^[A-Z]{6}\+Arimo/u.test(s1) && /^[A-Z]{6}\+Arimo/u.test(s2) && s1 !== s2 && s1.slice(7) === s2.slice(7),
      JSON.stringify([s1, s2]),
    );

    let read = '';
    /** @type {readonly { text: string, style: { font: string } }[]} */
    let after = [];
    try {
      const { bytes } = await replaceTheFirst(both);
      read = await pageOf(bytes, 0);
      after = await objectRunsOf(bytes);
    } catch (error) {
      read = `refused: ${error instanceof Error ? `${error.name} ${error.message}` : String(error)}`;
    }
    // TWO RUNS SAY `Дом` now, S2's own and the new one, and BOTH must be in S2: a lookup of the first would find S2's own
    // piece and pass whatever the replacement did.
    const doms = after.filter((run) => run.text.trim() === 'Дом');
    const arimos = new Set(after.map((run) => run.style.font).filter((font) => /Arimo/u.test(font)));
    record(
      'a word the run’s subset lacks and a sibling subset in the document carries is written in that sibling, loading no face',
      read.includes('Привет Дом') && doms.length === 2 && doms.every((run) => run.style.font === s2) && arimos.size === 2,
      `${JSON.stringify(read.slice(0, 80))}; Дом in ${JSON.stringify(doms.map((run) => run.style.font))}; Arimo fonts ${JSON.stringify([...arimos])}`,
    );

    // CONTROL: before S2 existed the same replacement has no sibling, so it loads a face of its own.
    let control = '';
    /** @type {readonly { text: string, style: { font: string } }[]} */
    let controlRuns = [];
    try {
      const { bytes } = await replaceTheFirst(first);
      control = await pageOf(bytes, 0);
      controlRuns = await objectRunsOf(bytes);
    } catch (error) {
      control = `refused: ${error instanceof Error ? error.name : String(error)}`;
    }
    const controlDom = controlRuns.find((run) => run.text.trim() === 'Дом');
    record(
      'CONTROL: with no sibling carrying it, the same replacement loads a face of its own',
      control.includes('Привет Дом') &&
        controlDom !== undefined &&
        /^[A-Z]{6}\+Arimo/u.test(controlDom.style.font) &&
        controlDom.style.font !== s1 &&
        controlDom.style.font !== s2,
      `${JSON.stringify(control.slice(0, 80))}; Дом in ${JSON.stringify(controlDom?.style.font ?? null)}`,
    );
  } finally {
    bindEditFaces(null);
  }
}

/**
 * The font the editor draws a run in, rebuilt by the host from the run's own program
 * ([ADR-0175](../../docs/DECISIONS/0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md)), against the
 * real library: a run in an Arimo subset an edit embedded has one, and its glyphs are the program's. THE CONTROL is the
 * Helvetica run on the same page, which is not embedded, so PDFium's substitute is all there is and nothing is offered.
 */
async function runFontCases() {
  const fonts = fontsDirectory(root);
  if (!existsSync(fonts)) {
    record('the bundled fonts are provisioned for the run font cases', false, `${fonts} is absent; run scripts/provision/fonts.mjs`);
    return;
  }
  bindEditFaces(() => faceSourceOf([{ path: fonts, origin: 'bundled' }]));
  /** @type {Uint8Array} */
  let edited;
  try {
    const original = await aParagraph();
    const lines = ((await blocksOf(original)).blocks[0]?.lines ?? []).map((line) => line.runs.map((run) => run.index));
    edited = await localPdfiumExecution.apply({
      session: original,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines, soft: lines.map(() => false), text: [`${BLOCK_LINES[0] ?? ''} Привет`, BLOCK_LINES[1], BLOCK_LINES[2]].join('\n') }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  } finally {
    bindEditFaces(null);
  }
  const session = await pdfiumWriter.open(edited);
  try {
    const runs = (await objectRuns(session, 0)).runs;
    const piece = runs.find((run) => run.text.includes('Привет'));
    const helvetica = runs.find((run) => run.style.font === 'Helvetica');
    if (piece === undefined || helvetica === undefined) {
      record('the edited page holds a run in the embedded subset and one in Helvetica', false, JSON.stringify(runs.map((run) => run.style.font)));
      return;
    }
    // THE SUBSET'S RUN ASKED TWICE, around the Helvetica run: one font answered, both asks naming it, and the Helvetica
    // run none — so a read that rebuilt per run, or answered every run alike, fails one of the two records.
    const read = await runFonts(session, 0, [piece.index, helvetica.index, piece.index]);
    const pieceFont = read.fonts[0];
    // THE REBUILT FONT DRAWS THE RUN: every character of the piece maps to a glyph in it.
    const mapped = pieceFont === undefined ? [] : Array.from(piece.text.trim(), (c) => runFontGlyph(pieceFont, c));
    record(
      'a block’s runs in an embedded subset have one font rebuilt from its program, mapping every character the run holds',
      read.fonts.length === 1 && read.runs[0] === 0 && read.runs[2] === 0 && mapped.length > 0 && mapped.every((glyph) => glyph > 0),
      `${String(read.fonts.length)} fonts, places ${JSON.stringify(read.runs)}; glyphs ${JSON.stringify(mapped)}`,
    );
    record(
      'CONTROL: a run in a font that is not embedded has none, PDFium’s substitute being all there is',
      read.runs[1] === null,
      `place ${JSON.stringify(read.runs[1])}`,
    );
  } finally {
    await pdfiumWriter.close(session);
  }
}

/** The glyph `font` maps `character` to, read by the one HarfBuzz reader. @param {Uint8Array} font @param {string} character */
function runFontGlyph(font, character) {
  return new ShapingFace(font, 0, {}).glyphFor(character.codePointAt(0) ?? 0) ?? 0;
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
 * One occurrence replaced by its point on the page (ADR-0156), through the same routing.
 *
 * Page 0 of {@link threePagesOfWidgets} holds WIDGET on two lines, each its own object, and once more split across two
 * objects. A point on each line must change that line alone, and the split pair and blank paper must refuse and write
 * nothing — the occurrence is named by where it is, never guessed.
 */
async function replaceAtCases() {
  const original = await threePagesOfWidgets();
  /**
   * @param {{ x: number, y: number }} point
   * @param {string} [find]
   * @param {number} [page]
   * @returns {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextAt'>}
   */
  const at = (point, find = 'WIDGET', page = 0) => ({ kind: 'replaceTextAt', page, find, replace: 'GADGET', at: point });
  /** @param {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextAt'>} command */
  const applied = (command) => localPdfiumExecution.apply({ session: original, command, sources: [], reads: undefined });
  /** @param {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextAt'>} command */
  const refusal = async (command) => {
    try {
      await applied(command);
      return null;
    } catch (error) {
      return error instanceof Error ? error.name : String(error);
    }
  };
  const before = await pageOf(original, 0);

  // ON THE FIRST LINE, baseline 230 at 11 points: the point is inside its object's bounds and outside the second's.
  const first = await pageOf(await applied(at({ x: 80, y: 233 })), 0);
  record(
    'a point on the FIRST line replaces the word there and only there',
    first.includes('The GADGET is on this page') && first.includes('and the WIDGET again below'),
    `page 0 reads ${JSON.stringify(first)}`,
  );
  const second = await pageOf(await applied(at({ x: 80, y: 203 })), 0);
  record(
    'CONTROL: a point on the SECOND line replaces that one instead, so the point decides and not the order',
    second.includes('The WIDGET is on this page') && second.includes('and the GADGET again below'),
    `page 0 reads ${JSON.stringify(second)}`,
  );
  // BLANK PAPER asks for `below`, which ONE object on the page holds: with WIDGET, two objects hold the word and the
  // refusal would be the two-runs rule's whatever the point did, so a pick that ignored the point would pass.
  record(
    'the word SPLIT ACROSS TWO OBJECTS is refused as not in place, and blank paper is too',
    (await refusal(at({ x: 45, y: 173 }))) === 'TextNotInPlaceError' &&
      (await refusal(at({ x: 300, y: 60 }, 'below'))) === 'TextNotInPlaceError',
    'each must throw TextNotInPlaceError rather than write a guess',
  );
  const pointed = await pageOf(await applied(at({ x: 150, y: 203 }, 'below')), 0);
  record(
    'CONTROL: the same word at its own line IS replaced, so blank paper is refused for its point and not its word',
    pointed.includes('and the WIDGET again GADGET'),
    `page 0 reads ${JSON.stringify(pointed)}`,
  );
  record(
    'the word is matched EXACTLY AS WRITTEN: an upper-case find does not take the lower-case word at its point',
    (await refusal(at({ x: 80, y: 203 }, 'WIDGET', 2))) === 'TextNotInPlaceError',
    'page 2 line 2 holds "widget" in lower case',
  );

  // THE WORD FOR ITSELF MAKES NO VERSION (ADR-0169 Decision 6), where a point and a word the page holds would otherwise
  // be saved; the first case of this function is its control, the same point with a different word.
  record(
    'one occurrence replaced with ITSELF is refused as nothing to replace, so no version is made',
    (await refusal({ ...at({ x: 80, y: 233 }), replace: 'WIDGET' })) === 'NothingToReplaceError',
    'it must throw NothingToReplaceError rather than save the page unchanged',
  );

  // AN EMPTY REPLACEMENT DELETES THE WORD (ADR-0169 Decision 6), and the rest of its line stays.
  const deleted = await pageOf(await applied({ ...at({ x: 80, y: 233 }), replace: '' }), 0);
  record(
    'an EMPTY replacement deletes the word, and the rest of its line and the page stay',
    /The\s+is on this page/u.test(deleted) && !deleted.includes('The WIDGET') && deleted.includes('and the WIDGET again below'),
    `page 0 reads ${JSON.stringify(deleted)}`,
  );
  // AND A WORD THAT WAS ITS OBJECT'S WHOLE TEXT REMOVES THE OBJECT. `GET` is the split pair's second object and ends
  // its line: PDFium's set refuses an empty string, so without the removal this is refused at `set-text`.
  const whole = { ...at({ x: 55, y: 173 }, 'GET'), replace: '' };
  const removal = await refusal(whole);
  const objectsBefore = (await textIndicesOf(original)).length;
  const removed = removal === null ? await applied(whole) : null;
  const objectsAfter = removed === null ? objectsBefore : (await textIndicesOf(removed)).length;
  const afterRemoval = removed === null ? '' : await pageOf(removed, 0);
  record(
    'a word that was its object’s WHOLE text, at the END of its line, replaced with nothing, removes that object alone',
    // `WID` AS A WORD, never as a substring: the page's two whole `WIDGET` lines hold `WID` and `GET` too, so a
    // substring test passed whichever of the split pair's objects went.
    objectsAfter === objectsBefore - 1 &&
      (afterRemoval.match(/WIDGET/gu) ?? []).length === 2 &&
      /\bWID\b/u.test(afterRemoval) &&
      !/\bGET\b/u.test(afterRemoval),
    removal === null
      ? `${String(objectsBefore)} text objects before, ${String(objectsAfter)} after; page 0 reads ${JSON.stringify(afterRemoval)}`
      : `it was refused: ${removal}`,
  );

  // A REPLACE THAT WOULD MOVE THE TEXT AFTER IT IS REFUSED (`replaceLineRule.ts`, the owner's answer of 2026-10-05): a
  // wider `WID` would draw into `GET`, and an emptied one would leave a gap before it. CONTROL: `WDI` is the same three
  // letters, so the same width, and is written, so a rule refusing every edit on a line of two objects fails it.
  const wider = await refusal({ ...at({ x: 35, y: 173 }, 'WID'), replace: 'WIDE' });
  const emptied = await refusal({ ...at({ x: 35, y: 173 }, 'WID'), replace: '' });
  const sameWidth = { ...at({ x: 35, y: 173 }, 'WID'), replace: 'WDI' };
  const sameRefusal = await refusal(sameWidth);
  const sameRead = sameRefusal === null ? await pageOf(await applied(sameWidth), 0) : '';
  record(
    'one occurrence that would MOVE the text after it on its line is refused, wider or emptied; the same width is written',
    wider === 'ReplaceMovesLineError' && emptied === 'ReplaceMovesLineError' && sameRead.includes('WDIGET'),
    `wider: ${String(wider)}; emptied: ${String(emptied)}; same width: ${sameRefusal ?? JSON.stringify(sameRead)}`,
  );
  // ITS UNDO IS A CHECKPOINT: a removed object has no constructor, so the one string it held cannot put it back. The
  // same rule for the dialog's command, with a control that keeps an object and captures its string.
  const wholeCapture = await localPdfiumExecution.capture(original, whole);
  const lastObject = (await textIndicesOf(original)).at(-1) ?? -1;
  // TYPED as the case above types its command, the branded `version` being the one field a `.mjs` cannot mint.
  const replacing = (/** @type {string} */ text) =>
    /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextObject'>} */ ({
      kind: 'replaceTextObject',
      page: 0,
      ...replacementFieldsOf([{ index: lastObject, text }]),
      version: 1,
    });
  const dialogEmptied = await localPdfiumExecution.capture(original, replacing(''));
  const dialogKept = await localPdfiumExecution.capture(original, replacing('GOT'));
  record(
    'a replacement that empties an object takes a checkpoint, by either command, and one that keeps it captures',
    !wholeCapture.captured &&
      wholeCapture.reason.includes('cannot rebuild') &&
      !dialogEmptied.captured &&
      dialogEmptied.reason.includes('cannot rebuild') &&
      dialogKept.captured,
    `replaceTextAt ${wholeCapture.captured ? 'captured' : 'checkpoint'}; replaceTextObject emptied ` +
      `${dialogEmptied.captured ? 'captured' : 'checkpoint'}, kept ${dialogKept.captured ? 'captured' : 'checkpoint'}`,
  );

  // UNDONE BY `replaceTextObject`'s INVERSE, given the prior the capture records: the page reads as it did.
  const command = at({ x: 80, y: 233 });
  const captured = await localPdfiumExecution.capture(original, command);
  const restored = captured.captured
    ? await pageOf(await localPdfiumExecution.invert(await applied(command), command.kind, captured.prior), 0)
    : null;
  record(
    'the capture records the one object’s string, and the invert puts the page back as it was',
    captured.captured && captured.prior.objects.length === 1 && restored === before,
    captured.captured ? `restored ${JSON.stringify(restored)}` : `not captured: ${captured.reason}`,
  );
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
  const applied = await localPdfiumExecution.apply({
    session: original,
    command,
    sources: [],
    reads: undefined,
  });
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
  const sensitive = await localPdfiumExecution.apply({
    session: original,
    command: replaceAll({ find: 'WIDGET', replace: 'GADGET', caseSensitive: true }),
    sources: [],
    reads: undefined,
  });
  record(
    'and caseSensitive REACHES the matcher, so the lower-case one survives',
    (await pageOf(sensitive, 2)).includes('widget'),
    `page 2 reads ${JSON.stringify(await pageOf(sensitive, 2))}`,
  );

  // A PATTERN, for the same reason: the flag has to reach `compileQuery` rather
  // than being accepted and dropped. `W.DGET` matches the whole word and not
  // the split pair, so this also cannot pass by matching everything.
  const patterned = await localPdfiumExecution.apply({
    session: original,
    command: replaceAll({ find: 'W.DGET', replace: 'GADGET', regex: true }),
    sources: [],
    reads: undefined,
  });
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
    await localPdfiumExecution.apply({
      session: original,
      command: replaceAll({ find: '(', replace: 'x', regex: true }),
      sources: [],
      reads: undefined,
    });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  record(
    'an unparseable pattern is refused by NAME and changes nothing',
    refused !== null && refused.includes('invalid-pattern'),
    refused ?? 'it was accepted',
  );

  // A REPLACEMENT THAT CHANGES NOTHING MAKES NO VERSION (ADR-0169 Decision 6): refused, so the bus records nothing.
  // Replacing a word with itself matches everywhere, and a find that matches nothing matches nowhere; both serialised
  // the document unchanged until 2026-10-05, a new version with an undo step that did nothing.
  /** @param {Record<string, unknown>} rest */
  const refusedAs = async (rest) => {
    try {
      await localPdfiumExecution.apply({ session: original, command: replaceAll(rest), sources: [], reads: undefined });
      return 'it was SAVED';
    } catch (error) {
      return error instanceof Error ? error.name : String(error);
    }
  };
  // CASE-SENSITIVE, because by default `WIDGET` also matches page 2's `widget`, and writing it as `WIDGET` changes it.
  const identity = await refusedAs({ find: 'WIDGET', replace: 'WIDGET', caseSensitive: true });
  const absent = await refusedAs({ find: 'GIZMO', replace: 'GADGET' });
  record(
    'a replacement that matches NOTHING, or replaces a word with ITSELF, is refused and saves nothing',
    identity === 'NothingToReplaceError' && absent === 'NothingToReplaceError',
    // ITS CONTROL IS THE FIRST CASE OF THIS FUNCTION: the same fixture with a find that matches is saved, so a rule that
    // refused every replacement fails there and one that refused none fails here.
    `itself: ${identity}; nothing matched: ${absent}`,
  );
  // AND THE CASE A PERSON MEETS: the page READS the word, as the find bar does, and no object holds it whole.
  const split = await PDFDocument.create();
  const splitFont = await split.embedFont(StandardFonts.Helvetica);
  const splitPage = split.addPage([400, 300]);
  splitPage.drawText('WID', { x: 30, y: 170, size: 11, font: splitFont });
  splitPage.drawText('GET', { x: 49, y: 170, size: 11, font: splitFont });
  const splitBytes = await split.save();
  let splitAnswer = 'it was SAVED';
  try {
    await localPdfiumExecution.apply({
      session: splitBytes,
      command: replaceAll({ find: 'WIDGET', replace: 'GADGET' }),
      sources: [],
      reads: undefined,
    });
  } catch (error) {
    splitAnswer = error instanceof Error ? error.name : String(error);
  }
  record(
    'a word the page READS but no object holds whole is refused as nothing to replace, not saved unchanged',
    (await pageOf(splitBytes, 0)).includes('WIDGET') && splitAnswer === 'NothingToReplaceError',
    `page reads ${JSON.stringify(await pageOf(splitBytes, 0))}; ${splitAnswer}`,
  );
  // ONE REPLACEMENT THAT WOULD MOVE ITS LINE REFUSES THE WHOLE COMMAND (`replaceLineRule.ts`): `WID` matches on every
  // line, inside the single-object lines where nothing follows and in the split pair where `GET` does, so a refusal
  // that dropped only the offending one would save the rest. CONTROL: the same-width `WDI` is written everywhere.
  const movesLine = await refusedAs({ find: 'WID', replace: 'WIDE', caseSensitive: true });
  /** @type {string} */
  let everywhere;
  try {
    const written = await localPdfiumExecution.apply({
      session: original,
      command: replaceAll({ find: 'WID', replace: 'WDI', caseSensitive: true }),
      sources: [],
      reads: undefined,
    });
    everywhere = `${await pageOf(written, 0)} | ${await pageOf(written, 2)}`;
  } catch (error) {
    everywhere = `refused: ${error instanceof Error ? error.name : String(error)}`;
  }
  record(
    'a replace-all where ONE replacement would move its line is refused WHOLE; the same width is written on every page',
    movesLine === 'ReplaceMovesLineError' && (everywhere.match(/WDIGET/gu) ?? []).length === 4,
    `wider: ${movesLine}; same width: ${JSON.stringify(everywhere)}`,
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

  const promoted = await localPdfiumExecution.apply({
    session: original,
    command,
    sources: [],
    reads: undefined,
  });
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
  const edited = await localPdfiumExecution.apply({
    session: promoted,
    // TYPED AS THE COMMAND, never cast to `never`: a cast let this case keep the replaced `replacements` shape past
    // ADR-0142's change, so it compiled and then failed on the one runner that has the library.
    command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'replaceTextObject'>} */ ({
      kind: 'replaceTextObject',
      page: 0,
      ...replacementFieldsOf([{ index: target ?? -1, text: PROMOTED_EDIT }]),
      version: 1,
    }),
    sources: [],
    reads: undefined,
  });
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
  const untouched = await localPdfiumExecution.apply({
    session: plain,
    command: /** @type {never} */ ({ kind: 'promoteFormObjects', page: 0 }),
    sources: [],
    reads: undefined,
  });
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

/**
 * A paragraph of three lines, set as three text objects 14pt apart in Helvetica 11 — one block by
 * ADR-0096's grouping — and a second block far below it that no edit may touch.
 */
const BLOCK_LINES = ['The first line of the block', 'a second line that changes', 'and the third line ends it'];
const FAR_BELOW = 'A separate block far below';

async function aParagraph() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [at, line] of BLOCK_LINES.entries()) {
    page.drawText(line, { x: 72, y: 300 - at * 14, size: 11, font });
  }
  page.drawText(FAR_BELOW, { x: 72, y: 80, size: 11, font });
  return document.save();
}

/**
 * {@link aParagraph} with its font re-encoded in StandardEncoding — an encoding with NO accented
 * lowercase letters, so the page's own font cannot carry `é` (ADR-0097). A subset built with MuPDF
 * read back with every glyph width zero (`pdfiumReflow.mjs`), so the encoding is what is narrowed
 * rather than the glyphs.
 *
 * `baseFont` renames it. Under its own name the standard twin is a new Helvetica in WinAnsi and can
 * carry `é`; left as Helvetica, PDFium's standard-font load hands back THIS font — measured
 * 2026-09-24, the twin's write landed in the same StandardEncoding dictionary — so there is no twin
 * to be had and the edit must be refused.
 *
 * @param {string} baseFont
 */
async function aParagraphInStandardEncoding(baseFont) {
  const document = await PDFDocument.load(await aParagraph());
  let fonts = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
    object.set(PDFName.of('Encoding'), PDFName.of('StandardEncoding'));
    object.set(PDFName.of('BaseFont'), PDFName.of(baseFont));
    fonts += 1;
  }
  if (fonts === 0) throw new Error('The paragraph fixture carried no font dictionary to re-encode.');
  return document.save();
}

/**
 * Page 0's runs and blocks, read from BYTES through the same read and grouping main uses.
 *
 * @param {Uint8Array} bytes
 */
async function blocksOf(bytes) {
  const session = await pdfiumWriter.open(bytes);
  try {
    const { runs, unaddressable } = await textRuns(session, 0);
    // EACH RUN'S SETTING by the one `settingOf`, as `composition.ts` keys it for the grouping.
    return { runs, unaddressable, blocks: groupIntoBlocks(runs.map((run) => ({ ...run, setting: settingOf(run.style) }))) };
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * `editTextBlock` ([ADR-0096](../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md))
 * through the routing, against the real library. Every reading is from reopened bytes, and each
 * case names what only the correct write produces: an edit that fits makes NO new object; one that
 * grows past the block makes one AND moves the line below AND leaves nothing past the edge.
 */
/** A line a producer drew ONE GLYPH PER TEXT OBJECT — every character its own `drawText`. */
const GLYPH_LINE = 'Drawn one glyph at a time';

/** One page carrying {@link GLYPH_LINE}, each character a separate text object. */
async function aLineOfGlyphs() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  let x = 72;
  for (const character of GLYPH_LINE) {
    page.drawText(character, { x, y: 700, size: 12, font, color: rgb(0, 0, 0) });
    x += font.widthOfTextAtSize(character, 12);
  }
  return document.save();
}

/**
 * A page drawn one glyph per object reads as ONE run and is edited as one
 * ([ADR-0130](../../docs/DECISIONS/0130-a-documents-size-never-refuses-an-action.md) Decision 1). Such a page passed
 * the old 8,192-run bound at 60 lines of 140 characters, and what passed it could not be edited. Against the real
 * library, from reopened bytes: the read joins the line, and an edit naming the joined run rewrites the whole of it.
 */
async function glyphLineCases() {
  const original = await aLineOfGlyphs();
  const objects = (await textIndicesOf(original)).length;
  const { runs } = await blocksOf(original);
  const [run] = runs;
  record(
    'CONTROL: the fixture is one text object per glyph',
    objects === GLYPH_LINE.replace(/ /gu, '').length || objects === GLYPH_LINE.length,
    `${String(objects)} text objects for ${String(GLYPH_LINE.length)} characters`,
  );
  record(
    'a line drawn one glyph per object reads as ONE run, named by its first object and carrying its last',
    runs.length === 1 && run !== undefined && run.last > run.index && run.text.replace(/\s+/gu, ' ').trim() === GLYPH_LINE,
    `${String(runs.length)} run(s); first ${String(run?.index)} last ${String(run?.last)} "${String(run?.text)}"`,
  );
  if (run === undefined) return;
  const edited = await localPdfiumExecution.apply({
    session: original,
    command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
      kind: 'editTextBlock',
      page: 0,
      // THE JOINED RUN, by its first object alone: the edit expands it through the same join.
      ...blockEditOf([{ lines: [[run.index]], soft: [false], text: 'Drawn as one line and edited whole' }]),
      fit: 'reflow',
      version: 1,
    }),
    sources: [],
    reads: undefined,
  });
  const after = (await textOf(edited)).replace(/\s+/gu, ' ');
  record(
    'and an edit naming that run rewrites the whole line — no glyph of the old text is left behind',
    after.includes('Drawn as one line and edited whole') && !after.includes('glyph at a time'),
    after.slice(0, 120),
  );
}

/** The words two forms deep, the words one form deep, and the words on the page, in reading order. */
const DEEPEST = 'DEEPEST LINE IN THE INNER FORM';
const MIDDLE = 'MIDDLE LINE IN THE OUTER FORM';
const AFTER_INNER = 'LAST LINE OF THE OUTER FORM';

/**
 * A page whose text is in a form INSIDE a form, placed and scaled at each level — the owner's page 1 (2026-10-02) had
 * its text nested so, and one promotion left 597 of 2,511 characters in a form. Each level's matrix is non-identity,
 * for {@link textInsideAForm}'s reason.
 */
async function textTwoFormsDeep() {
  const inner = await PDFDocument.create();
  const innerPage = inner.addPage([300, 60]);
  innerPage.drawText(DEEPEST, { x: 10, y: 20, size: 12, font: await inner.embedFont(StandardFonts.Helvetica) });

  const middle = await PDFDocument.create();
  const middlePage = middle.addPage([360, 160]);
  const middleFont = await middle.embedFont(StandardFonts.Helvetica);
  middlePage.drawText(MIDDLE, { x: 10, y: 130, size: 12, font: middleFont });
  const [innerForm] = await middle.embedPdf(await inner.save());
  if (innerForm === undefined) throw new Error('embedPdf produced no page');
  middlePage.drawPage(innerForm, { x: 20, y: 60, xScale: 1.1, yScale: 1.1 });
  // A LINE AFTER THE INNER FORM, in the content and on the page, so the order case separates *flattened in its
  // place* from *flattened after its siblings*: the second reads this line before the deepest one.
  middlePage.drawText(AFTER_INNER, { x: 10, y: 20, size: 12, font: middleFont });

  const outer = await PDFDocument.create();
  const page = outer.addPage([500, 400]);
  page.drawText(ON_THE_PAGE, { x: 30, y: 360, size: 14, font: await outer.embedFont(StandardFonts.Helvetica) });
  const [middleForm] = await outer.embedPdf(await middle.save());
  if (middleForm === undefined) throw new Error('embedPdf produced no page');
  page.drawPage(middleForm, { x: 40, y: 60, xScale: 0.9, yScale: 0.9 });
  return outer.save();
}

/** One promotion empties every form at every depth, and the page reads as it did. */
async function nestedPromotionCases() {
  const original = await textTwoFormsDeep();
  const before = await blocksOf(original);
  const textBefore = await textOf(original);
  record(
    'PREMISE: the nested page’s words are on it, in content order, and only the page’s own run is addressable',
    textBefore.indexOf(MIDDLE) < textBefore.indexOf(DEEPEST) &&
      textBefore.indexOf(DEEPEST) < textBefore.indexOf(AFTER_INNER) &&
      textBefore.indexOf(MIDDLE) >= 0 &&
      before.runs.length === 1 &&
      before.unaddressable > 0,
    `${String(before.runs.length)} addressable run(s), ${String(before.unaddressable)} character(s) no command can name`,
  );

  const promoted = await localPdfiumExecution.apply({
    session: original,
    command: /** @type {never} */ ({ kind: 'promoteFormObjects', page: 0 }),
    sources: [],
    reads: undefined,
  });
  const after = await blocksOf(promoted);
  record(
    'ONE promotion leaves no character in a form, at any depth — every run addressable',
    after.unaddressable === 0 && after.runs.length === 4,
    `${String(after.runs.length)} run(s), ${String(after.unaddressable)} character(s) still unaddressable after one press`,
  );
  // THE WORDS, IN ORDER, with runs of whitespace as one: nested, PDFium's text page joins the inner form's last line to
  // the outer form's next one with a space, and flattened it reports the line break they always had (measured
  // 2026-10-03). What a flatten after the siblings would change is the ORDER, and that is what this compares.
  const words = (/** @type {string} */ text) => text.replace(/\s+/gu, ' ').trim();
  const textAfter = await textOf(promoted);
  record(
    'and the page reads as it did, in the same order — the inner form’s line between the lines around it',
    words(textAfter) === words(textBefore),
    `before ${JSON.stringify(textBefore)}; after ${JSON.stringify(textAfter)}`,
  );
}

/**
 * The owner's Part A page (2026-10-02), from its measured numbers — the document is not copied. A heading in
 * Helvetica-Bold, filled 66, 83, 149, set with a text matrix scaled 1.5 and FLIPPED inside a flipped 0.75 CTM, so it
 * is drawn at 11.58 × 1.5 × 0.75 = 13.03 pt; under it, set the same way at Tf 12.26 and Tm scale 1, list lines drawn at
 * 9.195 pt in 64, 64, 64, each a Helvetica-Bold lead word and a Helvetica rest — tight enough that the gap is less
 * than a line's height.
 */
const HEADING_TEXT = 'Typography spacing guide';
const LIST_LEAD = 'Lead';
const LIST_REST = 'words that follow the lead word';
const HEADING_SIZE = 11.58 * 1.5 * 0.75;
const LIST_SIZE = 12.26 * 0.75;

async function headingOverList() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const boldKey = page.node.newFontDictionary(bold.name, bold.ref);
  const regularKey = page.node.newFontDictionary(regular.name, regular.ref);
  /** One line, in the owner's matrices: CTM [0.75 0 0 -0.75 x y] and Tm [s 0 0 -s tx 0]. */
  const line = (/** @type {{ font: typeof bold, key: import('@cantoo/pdf-lib').PDFName, size: number, scale: number, colour: [number, number, number], text: string, x: number, y: number, tx?: number }} */ run) => [
    pushGraphicsState(),
    concatTransformationMatrix(0.75, 0, 0, -0.75, run.x, run.y),
    setFillingRgbColor(run.colour[0] / 255, run.colour[1] / 255, run.colour[2] / 255),
    beginText(),
    setFontAndSize(run.key, run.size),
    setTextMatrix(run.scale, 0, 0, -run.scale, run.tx ?? 0, 0),
    showText(run.font.encodeText(run.text)),
    endText(),
    popGraphicsState(),
  ];
  page.pushOperators(
    ...line({ font: bold, key: boldKey, size: 11.58, scale: 1.5, colour: [66, 83, 149], text: HEADING_TEXT, x: 2, y: 360 }),
  );
  // 12.6 pt below each baseline: the heading's descenders to a list line's ascenders leave about 3 pt, under the
  // 8–9 pt a list line is tall.
  let y = 360 - 12.6;
  for (let at = 0; at < 3; at += 1) {
    const leadWidth = bold.widthOfTextAtSize(`${LIST_LEAD} `, 12.26);
    page.pushOperators(
      ...line({ font: bold, key: boldKey, size: 12.26, scale: 1, colour: [64, 64, 64], text: LIST_LEAD, x: 15.773, y }),
      ...line({ font: regular, key: regularKey, size: 12.26, scale: 1, colour: [64, 64, 64], text: LIST_REST, x: 15.773, y, tx: leadWidth }),
    );
    y -= 12.3;
  }
  return document.save();
}

/**
 * Two runs whose EMBEDDED programs and descriptors disagree: Liberation Sans Bold Italic under a descriptor saying
 * weight 400, upright, named `Probe-Regular`; and Liberation Sans Regular under one saying weight 700, italic, named
 * `Probe-BoldItalic`. The programs are `pdfjs-dist`'s, which every installed checkout carries.
 */
async function programsAgainstDescriptors() {
  const fonts = resolve(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts');
  const document = await PDFDocument.create();
  const page = document.addPage([400, 120]);
  const context = document.context;
  /** @param {string} file @param {string} name @param {number} weight @param {number} flags */
  const embedded = (file, name, weight, flags) => {
    const program = readFileSync(resolve(fonts, file));
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: name,
        Flags: flags,
        FontBBox: [-200, -300, 1200, 1000],
        ItalicAngle: 0,
        Ascent: 900,
        Descent: -210,
        CapHeight: 700,
        StemV: 80,
        FontWeight: weight,
        FontFile2: context.register(context.stream(program, { Length1: program.length })),
      }),
    );
    return context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'TrueType',
        BaseFont: name,
        FirstChar: 32,
        LastChar: 126,
        Widths: Array.from({ length: 95 }, () => 556),
        Encoding: 'WinAnsiEncoding',
        FontDescriptor: descriptor,
      }),
    );
  };
  page.node.set(
    PDFName.of('Resources'),
    context.obj({
      Font: context.obj({
        F0: embedded('LiberationSans-BoldItalic.ttf', 'Probe-Regular', 400, 32),
        F1: embedded('LiberationSans-Regular.ttf', 'Probe-BoldItalic', 700, 32 + 64),
      }),
    }),
  );
  page.node.set(
    PDFName.of('Contents'),
    context.register(context.flateStream('BT /F0 12 Tf 20 80 Td (Program says bold italic) Tj ET BT /F1 12 Tf 20 40 Td (Program says regular) Tj ET')),
  );
  return document.save();
}

/** Blocks break on a change of setting, and the editor's box is where the run is drawn. */
async function settingCases() {
  {
    const { runs } = await blocksOf(await programsAgainstDescriptors());
    const loud = runs.find((run) => run.text.includes('bold italic'));
    const quiet = runs.find((run) => run.text.includes('says regular'));
    record(
      'an EMBEDDED program’s own face decides over its descriptor and its name, both ways',
      loud?.style.bold === true && loud.style.italic && quiet?.style.bold === false && !quiet.style.italic,
      `bold-italic program under a regular descriptor ${JSON.stringify(loud?.style)}; regular program under a bold-italic one ${JSON.stringify(quiet?.style)}`,
    );
  }

  const bytes = await headingOverList();
  const { runs, blocks } = await blocksOf(bytes);
  const heading = runs.find((run) => run.text.includes('Typography'));
  const rest = runs.find((run) => run.text.includes('follow'));
  record(
    'the runs are read at the size they are DRAWN — Tf times the text matrix times the CTM — in their own fill',
    heading !== undefined &&
      rest !== undefined &&
      Math.abs(heading.style.size - HEADING_SIZE) < 0.01 &&
      Math.abs(rest.style.size - LIST_SIZE) < 0.01 &&
      heading.style.colour.r === 66 && heading.style.colour.g === 83 && heading.style.colour.b === 149 &&
      rest.style.colour.r === 64 && rest.style.colour.g === 64 && rest.style.colour.b === 64,
    `heading ${String(heading?.style.size)} ${JSON.stringify(heading?.style.colour)}; list ${String(rest?.style.size)} ${JSON.stringify(rest?.style.colour)}`,
  );

  // THE CONTROL FIRST: grouped by the gap alone — every run set alike — the heading and the list are one block,
  // so the page really does hold the shape that fooled the old rule.
  const alike = groupIntoBlocks(runs.map((run) => ({ ...run, setting: 'one' })));
  const headingBlock = blocks.find((block) => block.lines.some((line) => line.runs.some((run) => run.text.includes('Typography'))));
  const listBlock = blocks.find((block) => block.lines.some((line) => line.runs.some((run) => run.text.includes('follow'))));
  record(
    'CONTROL: by the gap alone the heading and the list lines are ONE block, set as the heading',
    alike.length === 1 && Math.abs((alike[0]?.style.size ?? 0) - HEADING_SIZE) < 0.01,
    `${String(alike.length)} block(s) of ${JSON.stringify(alike.map((block) => block.lines.length))} line(s)`,
  );
  record(
    'by setting they are TWO blocks, each opening in its own size and colour — the list in its rest, not its lead word',
    blocks.length === 2 &&
      headingBlock !== listBlock &&
      headingBlock?.lines.length === 1 &&
      listBlock?.lines.length === 3 &&
      Math.abs((headingBlock?.style.size ?? 0) - HEADING_SIZE) < 0.01 &&
      headingBlock?.style.colour.b === 149 &&
      Math.abs((listBlock?.style.size ?? 0) - LIST_SIZE) < 0.01 &&
      listBlock?.style.colour.r === 64 &&
      listBlock?.style.bold === false,
    `${String(blocks.length)} block(s): ${JSON.stringify(blocks.map((block) => [block.lines.length, Math.round(block.style.size * 100) / 100, block.style.bold]))}`,
  );

  // THE EDITOR'S BOX IS THE RUN'S INK: the heading block's box, read from the engine's character boxes, against
  // where the heading's own colour is painted on a raster of the page — 4 px per point.
  const session = await pdfiumWriter.open(bytes);
  let ink = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  try {
    const scale = 4;
    const bitmap = await renderPageBitmap(session, 0, 400 * scale, 400 * scale);
    for (let row = 0; row < bitmap.height; row += 1) {
      for (let column = 0; column < bitmap.width; column += 1) {
        const at = (row * bitmap.width + column) * 4;
        // BGRA. The heading's blue, within antialiasing's reach: blue well above red, and red well below white.
        const b = bitmap.bgra[at] ?? 255;
        const r = bitmap.bgra[at + 2] ?? 255;
        if (b - r > 40 && r < 160) {
          const x = column / scale;
          const y = 400 - row / scale;
          ink = { x0: Math.min(ink.x0, x), y0: Math.min(ink.y0, y), x1: Math.max(ink.x1, x), y1: Math.max(ink.y1, y) };
        }
      }
    }
  } finally {
    await pdfiumWriter.close(session);
  }
  const box = headingBlock?.box;
  record(
    'the heading block’s box is where its ink is: every blue pixel inside it, and the ink filling most of its height',
    box !== undefined &&
      Number.isFinite(ink.x0) &&
      ink.x0 >= box.x0 - 0.5 && ink.x1 <= box.x1 + 0.5 && ink.y0 >= box.y0 - 0.5 && ink.y1 <= box.y1 + 0.5 &&
      ink.y1 - ink.y0 >= 0.8 * (box.y1 - box.y0),
    `box ${JSON.stringify(box)}; ink ${JSON.stringify(ink)}`,
  );
}

async function blockEditCases() {
  record(
    'the declaration routes editTextBlock to pdfium, terminal, with a checkpoint undo',
    declaredCommands.editTextBlock.writer === 'pdfium' &&
      declaredCommands.editTextBlock.invertible === false &&
      declaredCommands.editTextBlock.undo === 'checkpoint',
    `writer=${declaredCommands.editTextBlock.writer} invertible=${String(declaredCommands.editTextBlock.invertible)}`,
  );

  const original = await aParagraph();
  const before = await blocksOf(original);
  const [block, separate] = before.blocks;
  record(
    'the fixture reads as TWO blocks, the paragraph of three lines and the one far below',
    before.blocks.length === 2 && block?.lines.length === 3 && separate?.lines.length === 1,
    `${String(before.blocks.length)} block(s), lines ${before.blocks.map((b) => b.lines.length).join('/')}`,
  );
  if (block === undefined) return;
  const lines = block.lines.map((line) => line.runs.map((run) => run.index));
  const right = block.box.x1;
  const objectsBefore = (await textIndicesOf(original)).length;

  /** @param {string} text */
  const edit = (text) =>
    localPdfiumExecution.apply({
      session: original,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines, soft: lines.map(() => false), text }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });

  const refusedCapture = await localPdfiumExecution.capture(original, {
    kind: 'editTextBlock',
    page: 0,
    ...blockEditOf([{ lines, soft: lines.map(() => false), text: 'x' }]),
    fit: 'reflow',
    version: /** @type {never} */ (1),
  });
  record(
    'a block edit REFUSES to capture, because PDFium cannot rebuild what it removes',
    refusedCapture.captured === false && refusedCapture.reason.includes('rebuild'),
    refusedCapture.captured === false ? refusedCapture.reason : 'it claimed to capture something',
  );

  // AN EDIT THAT FITS writes the one run it touched and makes NOTHING new.
  const fitted = await edit([BLOCK_LINES[0], 'a second line, edited', BLOCK_LINES[2]].join('\n'));
  const fittedText = await textOf(fitted);
  record(
    'an edit that fits changes its line, leaves the others, and makes no new object',
    fittedText.includes('a second line, edited') &&
      !fittedText.includes('that changes') &&
      fittedText.includes(BLOCK_LINES[0] ?? '') &&
      fittedText.includes(FAR_BELOW) &&
      (await textIndicesOf(fitted)).length === objectsBefore,
    `${String((await textIndicesOf(fitted)).length)} objects against ${String(objectsBefore)}`,
  );

  // A LINE THAT GROWS PAST THE BLOCK WRAPS: a new object, the next line moved down, and no
  // object's right edge past the block's.
  const grown = `${BLOCK_LINES[0] ?? ''} and then a great many more words than fit`;
  const wrapped = await edit([grown, BLOCK_LINES[1], BLOCK_LINES[2]].join('\n'));
  const after = await blocksOf(wrapped);
  const wrappedText = await textOf(wrapped);
  const secondBefore = before.runs.find((run) => run.text.startsWith('a second'));
  const secondAfter = after.runs.find((run) => run.text.startsWith('a second'));
  const widest = Math.max(...after.runs.filter((run) => run.top > 150).map((run) => run.right));
  record(
    'a line that grows past the block WRAPS into a new object in the page’s own font',
    (await textIndicesOf(wrapped)).length > objectsBefore &&
      ['great', 'many', 'more', 'words', 'than', 'fit'].every((word) => wrappedText.includes(word)),
    `${String((await textIndicesOf(wrapped)).length)} objects against ${String(objectsBefore)}`,
  );
  record(
    'and the wrapped words READ where they are seen: before the next line, not at the page’s end',
    // THE PAGE'S TEXT ORDER, which is the object order generation writes and copy, search and a
    // screen reader take. Appended, the wrap read after the block far below — measured 2026-09-24.
    wrappedText.indexOf('great') !== -1 &&
      wrappedText.indexOf('great') < wrappedText.indexOf('a second') &&
      wrappedText.indexOf('fit') < wrappedText.indexOf(FAR_BELOW),
    wrappedText.replace(/\s+/gu, ' ').slice(0, 200),
  );
  record(
    'and the line below it MOVES DOWN, so the wrap does not overprint it',
    secondBefore !== undefined && secondAfter !== undefined && secondAfter.top < secondBefore.bottom,
    `the second line's top ${String(secondAfter?.top)} against its old bottom ${String(secondBefore?.bottom)}`,
  );
  record(
    'and no line reaches past the block’s right edge',
    widest <= right + 0.5,
    `widest right ${widest.toFixed(2)} against the block's ${right.toFixed(2)}`,
  );
  record(
    'CONTROL: the block far below is untouched by the wrap',
    after.runs.some((run) => run.text.trim() === FAR_BELOW && Math.abs(run.bottom - (before.runs.find((r) => r.text.trim() === FAR_BELOW)?.bottom ?? -1)) < 0.01),
    'a layout that moved every line on the page would satisfy the wrap case above',
  );

  // LINES REMOVED AND ADDED.
  const shortened = await edit([BLOCK_LINES[0], BLOCK_LINES[1]].join('\n'));
  record(
    'a line the person deleted is removed from the page',
    !(await textOf(shortened)).includes('third line') && (await textIndicesOf(shortened)).length === objectsBefore - 1,
    `${String((await textIndicesOf(shortened)).length)} objects against ${String(objectsBefore)}`,
  );
  const lengthened = await edit([...BLOCK_LINES, 'and a fourth line typed below'].join('\n'));
  const fourth = (await blocksOf(lengthened)).runs.find((run) => run.text.startsWith('and a fourth'));
  const third = before.runs.find((run) => run.text.startsWith('and the third'));
  record(
    'a line the person typed below the block is made, below its last line',
    fourth !== undefined && third !== undefined && fourth.top < third.bottom && fourth.left === third.left,
    fourth === undefined ? 'no fourth line on the page' : `at ${fourth.left.toFixed(2)},${fourth.bottom.toFixed(2)}`,
  );

  // A CHARACTER THE FONT CANNOT CARRY is refused by NAME, before anything is written.
  let refused = null;
  try {
    await edit([BLOCK_LINES[0], 'a second line with 中 in it', BLOCK_LINES[2]].join('\n'));
  } catch (error) {
    refused = error instanceof Error ? error.name : String(error);
  }
  record(
    'a character NEITHER the page’s font NOR a standard one can carry is refused as TextNotWritableError',
    refused === 'TextNotWritableError',
    refused ?? 'it was written',
  );

  // A LINE LAID OUT BESIDE OTHER TEXT READS BACK WITH A SPACE THE TEXT PAGE GENERATED, and that is
  // not the font refusing. Measured 2026-09-24 on a live translation: a heading wrapped one word
  // onto a new line above the next block, the new line read back `prochaine ` for `prochaine`, and
  // a correct write was refused. The layout is that page's.
  const newsletter = await (async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([595, 842]);
    const heading = await document.embedFont(StandardFonts.HelveticaBold);
    const body = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('Spring planting starts next week', { x: 60, y: 720, size: 14, font: heading });
    page.drawText('Volunteers are welcome every Saturday morning from nine until noon.', { x: 60, y: 690, size: 11, font: body });
    return document.save();
  })();
  const newsletterBlocks = (await blocksOf(newsletter)).blocks;
  const headingLines = (newsletterBlocks[0]?.lines ?? []).map((line) => line.runs.map((run) => run.index));
  /** @type {string} */
  let headingOutcome;
  try {
    const result = await localPdfiumExecution.apply({
      session: newsletter,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines: headingLines, soft: headingLines.map(() => false), text: 'Les plantations de printemps commencent la semaine prochaine' }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
    const text = (await textOf(result)).replace(/\s+/gu, ' ');
    headingOutcome = text.includes('prochaine') && text.includes('Volunteers') ? 'written' : `saved as ${text.slice(0, 120)}`;
  } catch (error) {
    headingOutcome = `refused: ${error instanceof Error ? error.name : String(error)}`;
  }
  record(
    'a wrapped line beside the next block is WRITTEN — a generated space is not the font refusing',
    headingOutcome === 'written',
    headingOutcome,
  );

  // A ONE-LINE BLOCK WRAPS AT ITS COLUMN, not at its own old end (ADR-0097 4a). The block far below
  // is one line; a few more words fit the page easily, so it must stay ONE line — no new object.
  const farLines = (separate?.lines ?? []).map((line) => line.runs.map((run) => run.index));
  /** @param {string} text @param {'reflow' | 'shrink'} fit @param {number[][]} target */
  const editOne = (text, fit, target) =>
    localPdfiumExecution.apply({
      session: original,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines: target, soft: target.map(() => false), text }]),
        fit,
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  // `, two more` takes the line past its old end (the old rule wrapped it there) and not past the
  // column: 400 wide, 72 in, so the column ends at 328 and the line at about 270.
  const widened = await editOne(`${FAR_BELOW}, two more`, 'reflow', farLines);
  record(
    'a one-line block that grows stays ONE line while its column has room',
    (await textOf(widened)).includes('two more') &&
      (await textIndicesOf(widened)).length === objectsBefore,
    `${String((await textIndicesOf(widened)).length)} objects against ${String(objectsBefore)}`,
  );

  // A FITTED BLOCK ENDS WHERE IT DID (ADR-0097 4b). The paragraph, given twice its words: `reflow`
  // grows below its old last line — the control — and `shrink` ends at or above it, every word kept.
  const doubled = [BLOCK_LINES.join(' '), BLOCK_LINES.join(' ')].join(' ');
  const lastBottom = (/** @type {Awaited<ReturnType<typeof blocksOf>>} */ read) =>
    Math.min(...read.runs.filter((run) => run.top > 150).map((run) => run.bottom));
  const oldBottom = lastBottom(before);
  const grownBottom = lastBottom(await blocksOf(await editOne(doubled, 'reflow', lines)));
  const shrunk = await editOne(doubled, 'shrink', lines);
  const shrunkRead = await blocksOf(shrunk);
  const shrunkText = (await textOf(shrunk)).replace(/\s+/gu, ' ');
  record(
    'a SHRINK block ends at or above its old last line with every word, where REFLOW grows below it',
    grownBottom < oldBottom - 1 &&
      lastBottom(shrunkRead) >= oldBottom - 1 &&
      doubled.split(' ').every((word) => shrunkText.includes(word)),
    `old bottom ${oldBottom.toFixed(2)}, reflow ${grownBottom.toFixed(2)}, shrink ${lastBottom(shrunkRead).toFixed(2)}`,
  );

  // AND AT THE FLOOR, WRITTEN: text that cannot fit even at 0.6 is written there, not refused.
  const flood = Array.from({ length: 12 }, () => BLOCK_LINES.join(' ')).join(' ');
  /** @type {string} */
  let floorOutcome;
  try {
    const floored = (await textOf(await editOne(flood, 'shrink', lines))).replace(/\s+/gu, ' ');
    floorOutcome = floored.includes('ends it The first') ? 'written' : 'written without all its words';
  } catch (error) {
    floorOutcome = `refused: ${error instanceof Error ? error.name : String(error)}`;
  }
  record('a block too long even at the floor is WRITTEN at the floor, not refused', floorOutcome === 'written', floorOutcome);

  // A LINE OF TWO RUNS REPLACED WHOLE — the shape of every translated line in a real document, and
  // of a person retyping across a bold word. The diff empties the second run, and PDFium refuses to
  // set an empty string (measured 2026-09-24): the run must be REMOVED, and the words the first run
  // now carries must wrap at the line's last run WITH TEXT, not at the emptied one.
  const twoRuns = await (async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 400]);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    const regular = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('Bold start', { x: 72, y: 300, size: 11, font: bold });
    page.drawText(' and the rest', { x: 72 + bold.widthOfTextAtSize('Bold start', 11), y: 300, size: 11, font: regular });
    return document.save();
  })();
  const twoRunLines = ((await blocksOf(twoRuns)).blocks[0]?.lines ?? []).map((line) => line.runs.map((run) => run.index));
  const replacedWhole = 'Un début tout neuf, suivi de bien plus de mots que la ligne ne pouvait en contenir';
  /** @type {string} */
  let twoRunOutcome;
  try {
    const result = await localPdfiumExecution.apply({
      session: twoRuns,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines: twoRunLines, soft: twoRunLines.map(() => false), text: replacedWhole }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
    const text = (await textOf(result)).replace(/\s+/gu, ' ');
    const runsAfter = (await blocksOf(result)).runs;
    const widest = Math.max(...runsAfter.map((run) => run.right));
    twoRunOutcome =
      replacedWhole.split(' ').every((word) => text.includes(word)) && !text.includes('the rest') && widest <= 400
        ? 'written'
        : `written wrongly: ${String(runsAfter.length)} run(s), widest right ${widest.toFixed(1)}`;
  } catch (error) {
    twoRunOutcome = `refused: ${error instanceof Error ? error.name : String(error)}`;
  }
  record(
    'a line of TWO runs replaced whole is written: the emptied run removed, the words wrapped inside the page',
    twoRunOutcome === 'written',
    twoRunOutcome,
  );

  // TWO BLOCKS IN ONE COMMAND (ADR-0097): both written, by one apply.
  if (separate === undefined) return;
  const both = await localPdfiumExecution.apply({
    session: original,
    command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
      kind: 'editTextBlock',
      page: 0,
      ...blockEditOf([
        { lines, soft: lines.map(() => false), text: [BLOCK_LINES[0], 'a second line, rewritten', BLOCK_LINES[2]].join('\n') },
        {
          lines: separate.lines.map((line) => line.runs.map((run) => run.index)),
          soft: separate.lines.map(() => false),
          text: 'The block below, rewritten',
        },
      ]),
      fit: 'reflow',
      version: 1,
    }),
    sources: [],
    reads: undefined,
  });
  const bothText = await textOf(both);
  record(
    'ONE edit carrying two blocks writes both, and leaves what neither named',
    bothText.includes('a second line, rewritten') &&
      bothText.includes('The block below, rewritten') &&
      !bothText.includes(FAR_BELOW) &&
      bothText.includes(BLOCK_LINES[0] ?? ''),
    bothText.replace(/\s+/gu, ' ').slice(0, 160),
  );

  // A STANDARD-FONT TWIN (ADR-0097), and the reopened read that decides when one is needed.
  const accented = 'a second line, déjà vu';
  /**
   * The narrowed fixture, its block's lines, and an apply writing `accented` into its second line.
   *
   * @param {string} baseFont
   */
  const narrowedFixture = async (baseFont) => {
    const bytes = await aParagraphInStandardEncoding(baseFont);
    const found = await blocksOf(bytes);
    const narrowedLines = (found.blocks[0]?.lines ?? []).map((line) => line.runs.map((run) => run.index));
    const apply = () =>
      localPdfiumExecution.apply({
        session: bytes,
        command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
          kind: 'editTextBlock',
          page: 0,
          ...blockEditOf([{ lines: narrowedLines, soft: narrowedLines.map(() => false), text: [BLOCK_LINES[0], accented, BLOCK_LINES[2]].join('\n') }]),
          fit: 'reflow',
          version: 1,
        }),
        sources: [],
        reads: undefined,
      });
    /** The saved page's text, or the refusal's name — so a case records a refusal rather than crashing on it. */
    const written = async () => {
      try {
        return await textOf(await apply());
      } catch (error) {
        return `refused: ${error instanceof Error ? error.name : String(error)}`;
      }
    };
    return { bytes, narrowedLines, apply, written };
  };
  const renamed = await narrowedFixture('MonsteraNarrowSans');

  // THE PREMISE, asserted rather than assumed: the fixture's own font cannot carry `é`. Without it the
  // case below passes for a build that never twins, on a font that could carry the word all along.
  //
  // TWO OBSERVATIONS ESTABLISH IT, and since CR-NAT-10 the first is the one this build makes: the raw
  // write's read-back refuses the word before anything is generated (TextNotWritableError), and a
  // write that got past it would save `é` where a reader of the file does not see it. A font that
  // could carry the word fails both, since the write is then accepted and the saved text holds it.
  let premise = 'the page’s own font carried é';
  try {
    const session = await pdfiumWriter.open(renamed.bytes);
    try {
      const [object] = renamed.narrowedLines[1] ?? [];
      if (object !== undefined) {
        await replaceTextObjects(session, 0, [{ index: object, text: accented }], 'as-written');
        const saved = await pdfiumWriter.serialise(session);
        premise = (await textOf(saved)).includes('déjà') ? 'the page’s own font carried é' : 'held: written and unseen';
      }
    } finally {
      await pdfiumWriter.close(session);
    }
  } catch (error) {
    premise =
      error instanceof Error && error.name === 'TextNotWritableError'
        ? 'held: refused by the read-back'
        : `the premise could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  record('PREMISE: a font in StandardEncoding cannot carry é', premise.startsWith('held'), premise);

  const twinnedText = await renamed.written();
  record(
    'a word the page’s font cannot carry is WRITTEN through a standard-font twin, read from the saved bytes',
    // AND THE ORIGINAL IS GONE: left in place it would still say what its own encoding made of the
    // word — `ÿ`, measured — beside the twin.
    twinnedText.includes(accented) && !twinnedText.includes('ÿ'),
    twinnedText.includes(accented) ? 'written' : twinnedText.replace(/\s+/gu, ' ').slice(0, 120),
  );

  // A STANDARD-NAMED font twins too, where its twin is a different font. Times-Roman in
  // StandardEncoding cannot carry `é`; its twin is Helvetica, which this page does not have, so the
  // twin is a real one — the contrast to the refusal below, whose twin would be the page's own font.
  const timesText = await (await narrowedFixture('Times-Roman')).written();
  record(
    'a standard-named font whose twin is a DIFFERENT font writes the word through it',
    timesText.includes(accented),
    timesText.includes(accented) ? 'written' : timesText.replace(/\s+/gu, ' ').slice(0, 120),
  );

  // THE SCRATCH PAGE LEAVES NOTHING: every write above probed its font on a page appended and deleted
  // within the edit. A page object in the saved bytes beyond the document's own would be that page,
  // orphaned — counted in the file's text, since a page no tree names is invisible to a page count.
  const pageObjects = (/** @type {Uint8Array} */ bytes) =>
    (Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/gu) ?? []).length;
  const probedSaved = await renamed.apply();
  record(
    'a probed edit leaves NO page object behind: the saved file has exactly the pages it had',
    pageObjects(probedSaved) === pageObjects(renamed.bytes) && pageObjects(renamed.bytes) === 1,
    `page objects in the saved file ${String(pageObjects(probedSaved))}, before ${String(pageObjects(renamed.bytes))}`,
  );

  // NOR A FONT NO PAGE USES (CR-NAT-16): a probe that needs a twin loads a standard font into the document, and
  // PDFium's save writes every object the document holds. So every font object in the saved file must be one a
  // page's resources name, counted from the parsed file rather than from its text.
  const fontsOf = async (/** @type {Uint8Array} */ bytes) => {
    const parsed = await PDFDocument.load(bytes);
    const all = parsed.context
      .enumerateIndirectObjects()
      .filter(([, object]) => object instanceof PDFDict && object.get(PDFName.of('Type'))?.toString() === '/Font')
      .map(([ref]) => ref.toString());
    const named = parsed.getPages().flatMap((page) => {
      const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
      return fonts === undefined ? [] : fonts.values().map((value) => value.toString());
    });
    return { all, unnamed: all.filter((ref) => !named.includes(ref)) };
  };
  const probedFonts = await fontsOf(probedSaved);
  record(
    'a probed edit leaves NO font behind that no page names',
    // THE POSITIVE CONTROL: the edit wrote through a twin, so the file holds more than the page's own font.
    probedFonts.all.length >= 2 && probedFonts.unnamed.length === 0,
    `${String(probedFonts.all.length)} font object(s); not named by a page: ${JSON.stringify(probedFonts.unnamed)}`,
  );

  // AND WHERE NO TWIN CAN BE HAD, REFUSED — never saved as `Ø`. Helvetica itself in StandardEncoding:
  // the standard load returns this very font, so the retry reads wrong again.
  /** @type {string} */
  let helveticaRefusal;
  /** The characters the refusal named, or `null` where it named none or did not refuse. */
  let named = null;
  try {
    const result = await (await narrowedFixture('Helvetica')).apply();
    helveticaRefusal = `it was written, saying ${JSON.stringify((await textOf(result)).split(/\r?\n/u)[1] ?? '')}`;
  } catch (error) {
    helveticaRefusal = error instanceof Error ? error.name : String(error);
    named = error instanceof Error && 'characters' in error ? String(error.characters) : null;
  }
  record(
    'where the twin would be the same font, the edit is REFUSED rather than saved as a different letter',
    helveticaRefusal === 'TextNotWritableError',
    helveticaRefusal,
  );
  // AND IT NAMES THE CHARACTERS (ADR-0169 Decision 4), and only those: the saved bytes read `déjà` back as `dØjà`
  // (PDFium 155.0.8044.0, Linux build, 2026-10-05), so `é` is the one the font cannot show and `à` is carried. A
  // refusal that compared nothing would name every letter of the line, and one that named `à` would be guessing.
  record(
    'and the refusal names exactly the characters the font cannot show',
    named === 'é',
    named === null ? 'it named nothing' : `it named ${JSON.stringify(named)}`,
  );
}

/**
 * A page typeset as a person would: `text` filled greedily into lines of at most `limit` points, each word in its own
 * font (the words named in `bold` in Helvetica-Bold), the first line starting `indent` points in. `lines` instead sets
 * each given line on its own, centred on `centre` when that is given.
 *
 * @param {{ text?: string; lines?: string[]; bold?: string[]; limit?: number; indent?: number; centre?: number; invisible?: boolean }} options
 */
async function aTypeset({ text = '', lines, bold = [], limit = 200, indent = 0, centre, invisible = false }) {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  // RENDER MODE 3, an OCR'd scan's invisible words: set before the text, so each `q BT ... ET Q` the drawing writes
  // inherits it (`Tr` is graphics state).
  if (invisible) page.pushOperators(setTextRenderingMode(3));
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const strong = await document.embedFont(StandardFonts.HelveticaBold);
  const size = 11;
  /** @param {string} word */
  const fontOf = (word) => (bold.includes(word) ? strong : regular);
  /** @param {string} word */
  const widthOf = (word) => fontOf(word).widthOfTextAtSize(`${word} `, size);
  /** @type {string[]} */
  let rows = lines ?? [];
  if (lines === undefined) {
    rows = [];
    let current = [];
    let used = 0;
    for (const word of text.split(' ')) {
      const room = limit - (rows.length === 0 ? indent : 0);
      if (current.length > 0 && used + widthOf(word) > room) {
        rows.push(current.join(' '));
        current = [];
        used = 0;
      }
      current.push(word);
      used += widthOf(word);
    }
    rows.push(current.join(' '));
  }
  for (const [at, row] of rows.entries()) {
    /** @type {{ text: string; font: typeof regular }[]} */
    const segments = [];
    const words = row.split(' ');
    for (const [index, word] of words.entries()) {
      const font = fontOf(word);
      const piece = index < words.length - 1 ? `${word} ` : word;
      const last = segments.at(-1);
      if (last?.font === font) last.text += piece;
      else segments.push({ text: piece, font });
    }
    const width = segments.reduce((sum, segment) => sum + segment.font.widthOfTextAtSize(segment.text, size), 0);
    let cursor = centre === undefined ? 72 + (at === 0 ? indent : 0) : centre - width / 2;
    for (const segment of segments) {
      page.drawText(segment.text, { x: cursor, y: 300 - at * 14, size, font: segment.font });
      cursor += segment.font.widthOfTextAtSize(segment.text, size);
    }
  }
  return document.save();
}

/** A page of two blocks, one above the other with a gap no line rule joins, each of two lines. */
async function twoBlocks() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [at, row] of ['Upper block first line', 'Upper block second line'].entries()) {
    page.drawText(row, { x: 72, y: 340 - at * 14, size: 11, font });
  }
  for (const [at, row] of ['Lower block first line', 'Lower block second line'].entries()) {
    page.drawText(row, { x: 72, y: 200 - at * 14, size: 11, font });
  }
  return document.save();
}

/**
 * PLACEMENT AND ADDED BOXES on the block wire (ADR-0180, corrected 2026-10-06): a block moved, scaled, rotated and set at
 * a new measure as one thing, and a box of new text laid out by the same writer. Each case reads the reopened bytes, and
 * carries the control the bug would also pass: the block that was not named stays where it was.
 */
async function placeCases() {
  const original = await twoBlocks();
  const read = await blocksOf(original);
  const upper = read.blocks.find((block) => block.lines[0]?.runs[0]?.text.startsWith('Upper'));
  const lower = read.blocks.find((block) => block.lines[0]?.runs[0]?.text.startsWith('Lower'));
  if (upper === undefined || lower === undefined) {
    record('the two-block fixture reads as two blocks', false, `${String(read.blocks.length)} block(s)`);
    return;
  }
  /** One block as the wire names it, with what is done to its place. */
  const entry = (/** @type {typeof upper} */ block, /** @type {object | undefined} */ place) => ({
    lines: block.lines.map((line) => line.runs.map((run) => run.index)),
    soft: block.lines.map((line) => line.soft),
    text: paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft }))),
    ...(place === undefined ? {} : { place }),
  });
  const send = (
    /** @type {ReturnType<typeof entry>[]} */ blocks,
    /** @type {object[]} */ inserts = [],
    /** @type {Uint8Array} */ session = original,
  ) =>
    localPdfiumExecution.apply({
      session,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf(blocks, /** @type {never} */ (inserts)),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  const runStarting = async (/** @type {Uint8Array} */ bytes, /** @type {string} */ words) =>
    (await blocksOf(bytes)).runs.find((run) => run.text.startsWith(words));
  const before = await runStarting(original, 'Upper block first');
  const lowerBefore = await runStarting(original, 'Lower block first');

  // MOVE: every object of the block, by one amount.
  const moved = await send([entry(upper, { move: { x: 50, y: -40 } }), entry(lower, undefined)]);
  const after = await runStarting(moved, 'Upper block first');
  const secondAfter = await runStarting(moved, 'Upper block second');
  const secondBefore = await runStarting(original, 'Upper block second');
  record(
    'a move shifts every line of the block by the same amount, in points',
    before !== undefined && after !== undefined && secondBefore !== undefined && secondAfter !== undefined &&
      Math.abs(after.left - before.left - 50) < 0.05 && Math.abs(after.bottom - before.bottom + 40) < 0.05 &&
      Math.abs(secondAfter.left - secondBefore.left - 50) < 0.05 && Math.abs(secondAfter.bottom - secondBefore.bottom + 40) < 0.05,
    `first ${JSON.stringify(after && [after.left - (before?.left ?? 0), after.bottom - (before?.bottom ?? 0)])}, second ${JSON.stringify(secondAfter && [secondAfter.left - (secondBefore?.left ?? 0), secondAfter.bottom - (secondBefore?.bottom ?? 0)])}`,
  );
  const lowerAfter = await runStarting(moved, 'Lower block first');
  record(
    'CONTROL: the block that was named in the same edit with no place stays exactly where it was',
    lowerBefore !== undefined && lowerAfter !== undefined &&
      Math.abs(lowerAfter.left - lowerBefore.left) < 0.001 && Math.abs(lowerAfter.bottom - lowerBefore.bottom) < 0.001,
    `lower ${JSON.stringify(lowerAfter && [lowerAfter.left - (lowerBefore?.left ?? 0), lowerAfter.bottom - (lowerBefore?.bottom ?? 0)])}`,
  );
  record(
    'and a move keeps the words: the moved block says what it said',
    after?.text.trim() === 'Upper block first line' && secondAfter?.text.trim() === 'Upper block second line',
    `${JSON.stringify(after?.text)} ${JSON.stringify(secondAfter?.text)}`,
  );

  // SCALE, about the block's top left.
  const scaled = await send([entry(upper, { scale: 2 })]);
  const big = await runStarting(scaled, 'Upper block first');
  record(
    'a scale of two sets the block at twice its size',
    before !== undefined && big !== undefined && Math.abs(big.style.size / before.style.size - 2) < 0.05,
    `size ${String(before?.style.size)} then ${String(big?.style.size)}`,
  );
  record(
    'about its top left: its left edge and its top stay where they were',
    before !== undefined && big !== undefined && Math.abs(big.left - before.left) < 0.5 && Math.abs(big.top - before.top) < 0.5,
    `left ${String(before?.left)} then ${String(big?.left)}, top ${String(before?.top)} then ${String(big?.top)}`,
  );

  // ROTATE: a quarter turn swaps the block's width and height, about its centre.
  const extentOf = async (/** @type {Uint8Array} */ bytes, /** @type {string} */ first) => {
    const session = await pdfiumWriter.open(bytes);
    try {
      const objects = (await pageObjects(session, 0)).filter((object) => object.kind === 'text' && object.top > (first === 'Upper' ? 250 : 0));
      const left = Math.min(...objects.map((object) => object.left));
      const right = Math.max(...objects.map((object) => object.right));
      const bottom = Math.min(...objects.map((object) => object.bottom));
      const top = Math.max(...objects.map((object) => object.top));
      return { width: right - left, height: top - bottom, centre: [(left + right) / 2, (bottom + top) / 2] };
    } finally {
      await pdfiumWriter.close(session);
    }
  };
  const flat = await extentOf(original, 'Upper');
  const turned = await extentOf(await send([entry(upper, { rotate: 90 })]), 'Upper');
  record(
    'a quarter turn swaps the block’s width and height',
    Math.abs(turned.width - flat.height) < 1.5 && Math.abs(turned.height - flat.width) < 1.5,
    `${flat.width.toFixed(1)} by ${flat.height.toFixed(1)} became ${turned.width.toFixed(1)} by ${turned.height.toFixed(1)}`,
  );
  record(
    'about its centre: the middle of the block does not move',
    Math.abs((turned.centre[0] ?? 0) - (flat.centre[0] ?? 0)) < 1.5 && Math.abs((turned.centre[1] ?? 0) - (flat.centre[1] ?? 0)) < 1.5,
    `centre ${JSON.stringify(flat.centre)} became ${JSON.stringify(turned.centre)}`,
  );

  // A PLACEMENT THAT PLACES NOTHING is no edit.
  const nothing = await send([entry(upper, { scale: 1, move: { x: 0, y: 0 } })]).then(
    () => 'wrote',
    (error) => (error instanceof Error ? error.message : String(error)),
  );
  record('a place that moves, scales and turns nothing changes nothing, and the edit says so', nothing.includes('changed nothing'), nothing);

  // WIDTH: the block laid out again at a new measure.
  const narrow = await send([entry(upper, { width: 60 })]);
  const narrowRuns = (await blocksOf(narrow)).runs.filter((run) => run.top > 250);
  const wordsOf = (/** @type {{ text: string }[]} */ runs) => runs.map((run) => run.text).join(' ').replace(/\s+/gu, ' ').trim();
  record(
    'a width of sixty sets the block in lines no wider than that, with every word kept',
    narrowRuns.length > 2 && Math.max(...narrowRuns.map((run) => run.right)) - Math.min(...narrowRuns.map((run) => run.left)) <= 61 &&
      wordsOf(narrowRuns) === 'Upper block first line Upper block second line',
    `${String(narrowRuns.length)} runs, width ${(Math.max(...narrowRuns.map((run) => run.right)) - Math.min(...narrowRuns.map((run) => run.left))).toFixed(1)}, words ${JSON.stringify(wordsOf(narrowRuns))}`,
  );
  const wide = await send([entry(upper, { width: 300 })]).then(
    () => 'wrote',
    (error) => (error instanceof Error ? error.message : String(error)),
  );
  record(
    'CONTROL: a width as wide as the block already was lays out the same lines and writes nothing new',
    wide.includes('changed nothing') || wide === 'wrote',
    wide,
  );

  // AN ADDED BOX: a text object made for it and laid out as an edit of it.
  const added = await send([], [{ left: 100, baseline: 120, measure: 150, size: 14, text: 'A note added to the page' }]);
  const note = await runStarting(added, 'A note');
  record(
    'an added box writes its words at its left edge and baseline, in its size',
    note !== undefined && Math.abs(note.left - 100) < 2 && Math.abs(note.bottom - 120) < 6 && Math.abs(note.style.size - 14) < 0.3 &&
      // WRAPPED AT ITS MEASURE of 150 (a fourteen-point line of that sentence is wider), so the words are across its lines.
      wordsOf((await blocksOf(added)).runs.filter((run) => run.top < 140 && run.left >= 99)) === 'A note added to the page',
    `${JSON.stringify(note && { text: note.text, left: note.left, bottom: note.bottom, size: note.style.size })}`,
  );
  const untouched = await runStarting(added, 'Upper block first');
  record(
    'CONTROL: the blocks already on the page are exactly where they were, and the page without the box has no such words',
    untouched !== undefined && before !== undefined && Math.abs(untouched.bottom - before.bottom) < 0.001 &&
      (await runStarting(original, 'A note')) === undefined,
    `upper ${String(untouched?.bottom)} against ${String(before?.bottom)}`,
  );
  const wrapped = await send([], [{ left: 100, baseline: 120, measure: 70, size: 11, text: 'a long note that must wrap at its measure' }]);
  const wrappedRuns = (await blocksOf(wrapped)).runs.filter((run) => run.top < 140 && run.bottom > 0 && run.left >= 99);
  record(
    'an added box wraps its words at the measure it was given',
    wrappedRuns.length >= 3 && Math.max(...wrappedRuns.map((run) => run.right)) - 100 <= 72,
    `${String(wrappedRuns.length)} lines, right edge ${Math.max(...wrappedRuns.map((run) => run.right)).toFixed(1)}`,
  );
  const marked = await send([], [{ left: 100, baseline: 120, measure: 200, size: 12, text: 'plain heavy plain', marks: [{ from: 6, to: 11, set: { bold: true } }] }]);
  const heavy = (await blocksOf(marked)).runs.find((run) => run.text.trim() === 'heavy');
  const plain = (await blocksOf(marked)).runs.find((run) => run.text.includes('plain'));
  record(
    'an added box takes marks as an edit does: its bold word is bold and the rest of it is not',
    heavy?.style.bold === true && plain?.style.bold === false,
    `heavy ${String(heavy?.style.bold)}, plain ${String(plain?.style.bold)}`,
  );
}

/**
 * A bold mark with the catalogue bound: the words are set in the resolver's bold face, not in a standard font, and the
 * width the plan measured is the width drawn (the line's right edge stays inside the block's).
 */
async function formatPieceCases() {
  const fonts = fontsDirectory(root);
  if (!existsSync(fonts)) {
    record('the bundled fonts are provisioned for the formatting piece cases', false, `${fonts} is absent`);
    return;
  }
  bindEditFaces(() => faceSourceOf([{ path: fonts, origin: 'bundled' }]));
  try {
    const PARAGRAPH = 'The quick brown fox jumps over the lazy dog while the keen reviewer reads every single line twice more today';
    const original = await aTypeset({ text: PARAGRAPH });
    const [block] = (await blocksOf(original)).blocks;
    if (block === undefined) {
      record('the piece formatting fixture reads as a block', false, 'no block');
      return;
    }
    const words = paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft })));
    const from = words.indexOf('quick');
    const edited = await localPdfiumExecution.apply({
      session: original,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([
          {
            lines: block.lines.map((line) => line.runs.map((run) => run.index)),
            soft: block.lines.map((line) => line.soft),
            text: words,
            marks: [{ from, to: from + 'quick'.length, set: { bold: true } }],
          },
        ]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
    const after = await blocksOf(edited);
    const quick = after.runs.find((run) => run.text.trim() === 'quick');
    const brown = after.runs.find((run) => run.text.includes('brown'));
    record(
      'with a catalogue, a bold mark sets its words in a bold face of the resolver’s, and the rest of the line keeps its font',
      quick?.style.bold === true && !/helvetica/iu.test(quick.style.font) && brown?.style.bold === false && /helvetica/iu.test(brown.style.font),
      `quick ${String(quick?.style.font)} bold ${String(quick?.style.bold)}; brown ${String(brown?.style.font)}`,
    );
    record(
      'and no line reaches past the block’s right edge: the width the plan measured is the width the face draws',
      Math.max(...after.runs.map((run) => run.right)) <= block.box.x1 + 1,
      `widest ${Math.max(...after.runs.map((run) => run.right)).toFixed(2)} against ${block.box.x1.toFixed(2)}`,
    );
  } finally {
    bindEditFaces(null);
  }
}

/**
 * FORMATTING as marks over a block's words (ADR-0180), written by the PDFium writer: each style the contract names, read
 * back from reopened bytes against what the same edit without the mark leaves, which is the control every case carries.
 */
async function formatCases() {
  const PARAGRAPH = 'The quick brown fox jumps over the lazy dog while the keen reviewer reads every single line twice more today';
  const original = await aTypeset({ text: PARAGRAPH });
  const read = await blocksOf(original);
  const [block] = read.blocks;
  if (block === undefined) {
    record('the formatting fixture reads as a block', false, 'no block');
    return;
  }
  const lines = block.lines.map((line) => line.runs.map((run) => run.index));
  const soft = block.lines.map((line) => line.soft);
  const words = paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft })));
  /**
   * @param {{ marks?: { from: number; to: number; set: object }[]; paragraphs?: { paragraph: number; align?: 'left' | 'center' | 'right'; leftIndent?: number; firstIndent?: number; lineSpacing?: number; spaceBefore?: number }[]; text?: string }} extra
   */
  const format = (extra) =>
    localPdfiumExecution.apply({
      session: original,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines, soft, text: extra.text ?? words, marks: extra.marks ?? [], paragraphs: extra.paragraphs ?? [] }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  /** The run holding `word`, in a reading of the saved bytes. */
  const runOf = async (/** @type {Uint8Array} */ bytes, /** @type {string} */ word) => {
    const { runs } = await blocksOf(bytes);
    // THE WORD'S OWN OBJECT where a mark made it one, else the line's run that holds it.
    return runs.find((run) => run.text.trim() === word) ?? runs.find((run) => run.text.includes(word));
  };
  const at = (/** @type {string} */ word) => ({ from: words.indexOf(word), to: words.indexOf(word) + word.length });

  // BOLD: the words are in a bold face, their neighbours are not.
  const bolded = await format({ marks: [{ ...at('quick'), set: { bold: true } }] });
  const quick = await runOf(bolded, 'quick');
  const brown = await runOf(bolded, 'brown');
  record(
    'a bold mark sets its words in a bold face and leaves the words beside them as they were',
    quick?.style.bold === true && brown?.style.bold === false,
    `quick bold ${String(quick?.style.bold)}, brown bold ${String(brown?.style.bold)}`,
  );
  record(
    'CONTROL: the same edit with no mark leaves the page as it was, so the bold above is the mark’s',
    (await runOf(original, 'quick'))?.style.bold === false,
    `bold before ${String((await runOf(original, 'quick'))?.style.bold)}`,
  );

  // COLOUR.
  const coloured = await format({ marks: [{ ...at('fox'), set: { colour: { r: 200, g: 20, b: 20 } } }] });
  const fox = await runOf(coloured, 'fox');
  const dog = await runOf(coloured, 'dog');
  record(
    'a colour mark paints its words in that colour, and not the words after them',
    fox?.style.colour.r === 200 && fox.style.colour.g === 20 && dog?.style.colour.r === 0,
    `fox ${JSON.stringify(fox?.style.colour)}, dog ${JSON.stringify(dog?.style.colour)}`,
  );

  // SIZE.
  const sized = await format({ marks: [{ ...at('jumps'), set: { size: 20 } }] });
  const jumps = await runOf(sized, 'jumps');
  const neighbour = await runOf(sized, 'quick');
  record(
    'a size mark sets its words at that size, and the line it is on takes room for it',
    jumps !== undefined && Math.abs(jumps.style.size - 20) < 0.6 && Math.abs((neighbour?.style.size ?? 0) - 11) < 0.6,
    `jumps ${String(jumps?.style.size)}, quick ${String(neighbour?.style.size)}`,
  );

  // UNDERLINE: a rule, one object, the width of the words.
  const objectKinds = async (/** @type {Uint8Array} */ bytes) => {
    const session = await pdfiumWriter.open(bytes);
    try {
      return (await pageObjects(session, 0)).filter((object) => object.kind === 'path');
    } finally {
      await pdfiumWriter.close(session);
    }
  };
  const metrics = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const reviewerWidth = metrics.widthOfTextAtSize('reviewer', 11);
  const underlined = await format({ marks: [{ ...at('reviewer'), set: { underline: true } }] });
  const rules = await objectKinds(underlined);
  const reviewer = await runOf(underlined, 'reviewer');
  record(
    'an underline mark draws one rule under its words, as wide as they are, a little below their baseline',
    rules.length === 1 && reviewer !== undefined && rules[0] !== undefined &&
      // THE WORD'S OWN WIDTH, from the font's metrics (the reading's run is the whole line the object joined into).
      Math.abs(rules[0].right - rules[0].left - reviewerWidth) < 1 &&
      rules[0].bottom >= reviewer.bottom - 1 &&
      rules[0].top <= reviewer.top,
    `${String(rules.length)} rule(s); ${JSON.stringify(rules[0])} against a ${reviewerWidth.toFixed(2)} wide word in a line ${String(reviewer?.bottom)}..${String(reviewer?.top)}`,
  );
  record('CONTROL: with no underline mark the page has no rule', (await objectKinds(original)).length === 0, 'rules before the edit');

  // SUPERSCRIPT: smaller, and higher than the words beside it.
  const raised = await format({ marks: [{ ...at('lazy'), set: { rise: 'superscript' } }] });
  const lazy = await runOf(raised, 'lazy');
  const dogs = await runOf(raised, 'dog');
  record(
    'a superscript mark sets its words smaller and above the baseline of the words beside them',
    lazy !== undefined && dogs !== undefined && lazy.style.size < 0.8 * 11 && lazy.top > dogs.top - 0.5 * 11 && lazy.bottom > dogs.bottom + 1,
    `lazy ${JSON.stringify(lazy && { size: lazy.style.size, bottom: lazy.bottom })}, dog bottom ${String(dogs?.bottom)}`,
  );

  // A MARK THAT RESTATES THE RUN IS NO EDIT: the same bold, sent again, writes nothing (the page's own words are already bold).
  const doubly = await localPdfiumExecution.apply({
    session: bolded,
    command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
      kind: 'editTextBlock',
      page: 0,
      ...blockEditOf([
        {
          lines: (await blocksOf(bolded)).blocks[0]?.lines.map((line) => line.runs.map((run) => run.index)) ?? [],
          soft: (await blocksOf(bolded)).blocks[0]?.lines.map((line) => line.soft) ?? [],
          text: words,
          marks: [{ ...at('quick'), set: { bold: true } }],
        },
      ]),
      fit: 'reflow',
      version: 1,
    }),
    sources: [],
    reads: undefined,
  }).then(
    () => 'wrote',
    (error) => (error instanceof Error ? error.message : String(error)),
  );
  record(
    'a mark that restates what its words already are changes nothing, so the edit says so and writes nothing',
    doubly.includes('changed nothing'),
    doubly,
  );

  // PARAGRAPH SETTINGS: alignment, indent and spacing.
  const centred = await format({ paragraphs: [{ paragraph: 0, align: 'center' }] });
  const centredBlock = (await blocksOf(centred)).blocks[0];
  const middles = centredBlock?.lines.map((line) => (line.box.x0 + line.box.x1) / 2) ?? [];
  record(
    'a centre setting sets every line of the paragraph about one middle',
    middles.length >= 3 && Math.max(...middles) - Math.min(...middles) < 3,
    `middles ${JSON.stringify(middles.map((middle) => Math.round(middle * 10) / 10))}`,
  );
  const lefts = block.lines.map((line) => line.box.x0);
  record(
    'CONTROL: the lines were flush left before, so the centred spread is the setting’s and not the fixture’s',
    Math.max(...lefts) - Math.min(...lefts) < 1.5,
    `lefts ${JSON.stringify(lefts)}`,
  );
  const spaced = await format({ paragraphs: [{ paragraph: 0, lineSpacing: 2 }] });
  // THE GAP BETWEEN THE FIRST TWO LINES, from the runs themselves: a doubled gap may read as two blocks, which is the
  // reading's grouping and not what is being asked.
  const gap = async (/** @type {Uint8Array} */ bytes) => {
    const rows = [...new Set((await blocksOf(bytes)).runs.map((run) => Math.round(run.bottom * 10) / 10))].sort((a, b) => b - a);
    return rows.length < 2 ? 0 : (rows[0] ?? 0) - (rows[1] ?? 0);
  };
  const beforeGap = await gap(original);
  const afterGap = await gap(spaced);
  record(
    'a line-spacing setting of two doubles the gap between the paragraph’s lines',
    beforeGap > 0 && Math.abs(afterGap / beforeGap - 2) < 0.15,
    `gap ${beforeGap.toFixed(2)} before, ${afterGap.toFixed(2)} after`,
  );
  const indented = await format({ paragraphs: [{ paragraph: 0, leftIndent: 30 }] });
  const indentedBlock = (await blocksOf(indented)).blocks[0];
  record(
    'a left indent of 30 points moves every line of the paragraph in by 30',
    indentedBlock !== undefined && indentedBlock.lines.every((line) => Math.abs(line.box.x0 - (lefts[0] ?? 0) - 30) < 2),
    `lefts ${JSON.stringify(indentedBlock?.lines.map((line) => Math.round(line.box.x0 * 10) / 10))} against ${String(lefts[0])}`,
  );
}

/**
 * A block edited as PARAGRAPHS (ADR-0179): a paragraph's words flow, each in the style it was typed or drawn in, and a
 * paragraph is set as its first lines were. Every reading is from reopened bytes; every case names what only the
 * correct write produces, and the controls are the edits that must move more or less than the case under test.
 */
async function paragraphCases() {
  const PARAGRAPH =
    'The quick brown fox jumps over the lazy dog while the keen reviewer reads every single line twice more today';
  const original = await aTypeset({ text: PARAGRAPH, bold: ['jumps'] });
  const before = await blocksOf(original);
  const [block] = before.blocks;
  record(
    'the typeset paragraph reads as ONE block of soft-ended lines, and its last line is a hard end',
    before.blocks.length === 1 && block !== undefined && block.lines.length >= 3 &&
      block.lines.every((line, at) => line.soft === (at < block.lines.length - 1)),
    `${String(before.blocks.length)} block(s); soft ${JSON.stringify(block?.lines.map((line) => line.soft))}`,
  );
  if (block === undefined) return;
  const lines = block.lines.map((line) => line.runs.map((run) => run.index));
  const soft = block.lines.map((line) => line.soft);
  const words = paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft })));
  record(
    'PREMISE: the paragraph’s words are the sentence drawn, joined across the soft wraps by single spaces',
    words === PARAGRAPH,
    JSON.stringify(words),
  );
  /**
   * @param {string} text
   * @param {Uint8Array} bytes
   * @param {typeof lines} on
   * @param {typeof soft} ends
   */
  const edit = (text, bytes = original, on = lines, ends = soft) =>
    localPdfiumExecution.apply({
      session: bytes,
      command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines: on, soft: ends, text }]),
        fit: 'reflow',
        version: 1,
      }),
      sources: [],
      reads: undefined,
    });
  /** @param {Uint8Array} bytes */
  const runsAfter = async (bytes) => (await blocksOf(bytes)).runs;
  const right = block.box.x1;

  // A LETTER TYPED INTO A LINE THAT HAS ROOM sets that line again and nothing else: the lines below stay as they
  // were, objects and places. The first line's last word is the one that gains the letter.
  const [firstWord] = words.split(' ');
  const typedFirst = await edit(words.replace(`${firstWord ?? ''} `, `${firstWord ?? ''}s `));
  const afterFirst = await runsAfter(typedFirst);
  const lastBefore = before.runs.find((run) => run.text.includes('twice more today') || run.text.includes('today'));
  const lastAfter = afterFirst.find((run) => run.text.includes('today'));
  record(
    'a letter typed into the first line is on the page, and the last line stands where it was',
    (await textOf(typedFirst)).includes(`${firstWord ?? ''}s`) &&
      lastBefore !== undefined && lastAfter !== undefined &&
      Math.abs(lastAfter.left - lastBefore.left) < 0.01 && Math.abs(lastAfter.bottom - lastBefore.bottom) < 0.01,
    `last line ${JSON.stringify(lastAfter && { left: lastAfter.left, bottom: lastAfter.bottom })} against ${JSON.stringify(lastBefore && { left: lastBefore.left, bottom: lastBefore.bottom })}`,
  );

  // A LONG WORD TYPED IN FRONT OF THE BOLD ONE makes it wrap, and it WRAPS BOLD: every word keeps its own style.
  const widened = await edit(words.replace('brown fox', 'brown unmistakably fox'));
  const afterWide = await runsAfter(widened);
  const boldRun = afterWide.find((run) => run.text.includes('jumps'));
  const plainRun = afterWide.find((run) => run.text.includes('quick'));
  const boldBefore = before.runs.find((run) => run.text.includes('jumps'));
  record(
    'a word wrapped by a longer line keeps its style: the bold word is bold on its new line, its neighbour is not',
    boldRun !== undefined && plainRun !== undefined && boldBefore !== undefined &&
      boldRun.style.bold === true && plainRun.style.bold === false &&
      Math.max(...afterWide.map((run) => run.right)) <= right + 0.5,
    `bold ${String(boldRun?.style.bold)}, plain ${String(plainRun?.style.bold)}, widest ${Math.max(...afterWide.map((run) => run.right)).toFixed(2)} against ${right.toFixed(2)}`,
  );
  const lineBelow = afterWide.find((run) => run.text.includes('today'));
  record(
    'CONTROL: that same edit DOES move the last line, so the unchanged lines above were kept by the plan and not by the edit being small',
    lastBefore !== undefined && lineBelow !== undefined &&
      (Math.abs(lineBelow.left - lastBefore.left) > 0.01 || Math.abs(lineBelow.bottom - lastBefore.bottom) > 0.01),
    `last line at ${String(lineBelow?.left)},${String(lineBelow?.bottom)} against ${String(lastBefore?.left)},${String(lastBefore?.bottom)}`,
  );

  // A CENTRED BLOCK STAYS CENTRED when a line grows: the lines are set about the centre they kept.
  const centred = await aTypeset({ lines: ['Annual report', 'prepared for the board', 'March'], centre: 200 });
  const centredBlock = (await blocksOf(centred)).blocks[0];
  const centredLines = centredBlock?.lines.map((line) => line.runs.map((run) => run.index)) ?? [];
  const grown = await edit(
    'Annual report of 2026\nprepared for the board\nMarch',
    centred,
    centredLines,
    centredLines.map(() => false),
  );
  const centres = (await blocksOf(grown)).blocks[0]?.lines.map((line) => (line.box.x0 + line.box.x1) / 2) ?? [];
  record(
    'a centred line that grows is still centred, and so are the lines beside it',
    centres.length === 3 && centres.every((centre) => Math.abs(centre - 200) < 1.5),
    `centres ${JSON.stringify(centres.map((centre) => Number(centre.toFixed(2))))}`,
  );
  record(
    'CONTROL: the lines were centred on the same point before the edit and were not the same width, so the case above measured the writer',
    (centredBlock?.lines ?? []).every((line) => Math.abs((line.box.x0 + line.box.x1) / 2 - 200) < 1.5) &&
      new Set((centredBlock?.lines ?? []).map((line) => Math.round(line.box.x1 - line.box.x0))).size === 3,
    `before ${JSON.stringify((centredBlock?.lines ?? []).map((line) => Number(((line.box.x0 + line.box.x1) / 2).toFixed(2))))}`,
  );

  // A FIRST-LINE INDENT IS KEPT: the first line starts where it did, and the lines after it start at the paragraph's own edge.
  const indented = await aTypeset({ text: PARAGRAPH, indent: 24 });
  const indentedBlock = (await blocksOf(indented)).blocks[0];
  const indentedLines = indentedBlock?.lines.map((line) => line.runs.map((run) => run.index)) ?? [];
  const indentedSoft = indentedBlock?.lines.map((line) => line.soft) ?? [];
  const indentedWords = paragraphsOfLines(
    (indentedBlock?.lines ?? []).map((line) => ({ text: lineText(line.runs), soft: line.soft })),
  );
  const longer = await edit(`${indentedWords} Thank you very much indeed for reading all of it.`, indented, indentedLines, indentedSoft);
  const longerLines = (await blocksOf(longer)).blocks[0]?.lines ?? [];
  const firstLeft = longerLines[0]?.box.x0;
  const restLefts = longerLines.slice(1).map((line) => line.box.x0);
  record(
    'a paragraph that grows keeps its first-line indent: the first line is 24 points in, every other line is at the edge',
    longerLines.length > (indentedBlock?.lines.length ?? 0) && firstLeft !== undefined &&
      restLefts.every((left) => Math.abs(left - 72) < 1.5) && Math.abs(firstLeft - 96) < 1.5,
    `first ${String(firstLeft)}; rest ${JSON.stringify(restLefts)}`,
  );
  // INVISIBLE TEXT STAYS INVISIBLE (render mode 3, an OCR'd scan's words): a line set again is painted as the line it
  // replaced, or the recognised words appear over the picture they were read from.
  /** @param {Uint8Array} bytes */
  const darkPixels = async (bytes) => {
    const session = await pdfiumWriter.open(bytes);
    try {
      const bitmap = await renderPageBitmap(session, 0, 400, 400);
      let count = 0;
      for (let at = 0; at < bitmap.bgra.length; at += 4) if ((bitmap.bgra[at] ?? 255) < 128) count += 1;
      return count;
    } finally {
      await pdfiumWriter.close(session);
    }
  };
  const hidden = await aTypeset({ text: PARAGRAPH, invisible: true });
  const hiddenBlock = (await blocksOf(hidden)).blocks[0];
  const hiddenLines = hiddenBlock?.lines.map((line) => line.runs.map((run) => run.index)) ?? [];
  const hiddenSoft = hiddenBlock?.lines.map((line) => line.soft) ?? [];
  const hiddenWords = paragraphsOfLines((hiddenBlock?.lines ?? []).map((line) => ({ text: lineText(line.runs), soft: line.soft })));
  const widenedHidden = await edit(hiddenWords.replace('brown fox', 'brown unmistakably fox'), hidden, hiddenLines, hiddenSoft);
  const shown = await edit(words.replace('brown fox', 'brown unmistakably fox'));
  record(
    'text drawn invisibly (render mode 3) is still invisible after an edit that wraps it, and its words are there',
    (await textOf(widenedHidden)).includes('unmistakably') && (await darkPixels(widenedHidden)) === 0,
    `${String(await darkPixels(widenedHidden))} dark pixel(s)`,
  );
  record(
    'CONTROL: the same edit to visible text paints it, so the invisible case above is the render mode and not an empty render',
    (await darkPixels(shown)) > 100 && (await darkPixels(original)) > 100,
    `${String(await darkPixels(shown))} dark pixel(s) after, ${String(await darkPixels(original))} before`,
  );
  record(
    'CONTROL: the invisible fixture itself draws nothing, so the edit did not hide anything that was showing',
    (await darkPixels(hidden)) === 0,
    `${String(await darkPixels(hidden))} dark pixel(s)`,
  );
  record(
    'CONTROL: the indent was in the fixture, so a writer that flushed every line left would have failed the case above',
    Math.abs((indentedBlock?.lines[0]?.box.x0 ?? 0) - 96) < 1.5 && Math.abs((indentedBlock?.lines[1]?.box.x0 ?? 0) - 72) < 1.5,
    `fixture first ${String(indentedBlock?.lines[0]?.box.x0)}, second ${String(indentedBlock?.lines[1]?.box.x0)}`,
  );
}

await main();
