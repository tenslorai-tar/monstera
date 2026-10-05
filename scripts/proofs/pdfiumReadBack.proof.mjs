// @ts-check
/**
 * Nothing is lost when PDFium rewrites a page: every PDFium command, against the real library, on a page that carries
 * a Type 3 font (ADR-0169).
 *
 * ## The defect, and why a case per command
 *
 * `FPDFPage_GenerateContent` writes a Type 3 text object with no font and no text, so any command that regenerates a
 * page erased the page's Type 3 text and answered success — measured on PDFium 155.0.8044.0: the committed Chromium
 * print went from 60 text objects to 1, and replace, recolour, move and delete on the Helvetica line of a hand-built
 * Type 3 page erased both Type 3 lines beside it. The fix is one read-back in `pdfiumWriter.serialise`, which every
 * command reaches; a case per command is what proves that, since a command that saved by another route would pass
 * every case but its own.
 *
 * ## Every refusal case is built from an input the ABSENT guard would let through
 *
 * Each command edits the page's CIDFontType2 body line, which every font kind but Type 3 edits correctly, and asserts
 * the refusal names step `read-back`. That step is the last one: an edit refused there passed opening, loading, finding,
 * setting, moving and generating, so without the read-back it would have been saved — which is the defect, and the
 * case fails the day the read-back is removed. A refusal at any earlier step is reported as a failure here, because it
 * would pass for the wrong reason.
 *
 * ## And every command has a CONTROL that must be saved, on a page without Type 3
 *
 * The same command on Helvetica lines, with the untouched lines required in the reopened bytes. A read-back that
 * refused everything would pass every refusal case above; it fails these.
 *
 * Fixtures are generated or our own words: the Chromium print is `scripts/research/chromiumType3Fixture.mjs`', the
 * hand-built pages are `scripts/research/fontKindFixtures.mjs`'.
 *
 * Usage: node scripts/proofs/pdfiumReadBack.proof.mjs [--require-pdfium]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';

import { PDFIUM_READ_BACK, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';
import { CHROMIUM_FIXTURE, CHROMIUM_LINES } from '../research/chromiumType3Fixture.mjs';
import { LINES, buildFixture } from '../research/fontKindFixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE = process.argv.includes('--require-pdfium');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'the PDFium read-back after a page rewrite',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

// THE BUILT MODULES are what this reads, so a stale build would prove the previous read-back.
refuseStaleBuild(root, PDFIUM_READ_BACK, 11);

const { blockEditOf, replacementFieldsOf } = await import('../../packages/contract/dist/commands.js');
const { objectRuns, openPdfium, pdfiumWriter, textRuns } = await import('../../packages/kernel/dist/pdfiumFfi.js');
const { groupIntoBlocks, settingOf } = await import('../../packages/kernel/dist/textLines.js');
const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
const { EditRefusedError } = await import('../../packages/kernel/dist/textEditRefusals.js');

/** @type {string[]} */
const failures = [];
// AN INDEPENDENT CLAIM about this file (audit item 4c): two readable premises, nine commands refused on a Type 3 page
// and saved on a Helvetica one (the ninth an emptied replacement, which removes its object), three undos refused, and
// the hand-built page's own edit refused at the read-back.
const roster = createRoster(failures, { cases: 24 });

/** @param {string} name @param {boolean} ok @param {string} detail */
function record(name, ok, detail) {
  const mark = roster.mark();
  if (!ok) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/** @typedef {{ index: number, text: string, left: number, right: number, bottom: number, top: number, style: any }} Run */

/** Page 0's runs as the editor reads them, from bytes. @param {Uint8Array} bytes @returns {Promise<readonly Run[]>} */
async function runsOf(bytes) {
  const session = await pdfiumWriter.open(bytes);
  try {
    return (await textRuns(session, 0)).runs;
  } finally {
    await pdfiumWriter.close(session);
  }
}

/** Page 0's runs one per object, as the replacements walk them. @param {Uint8Array} bytes @returns {Promise<readonly Run[]>} */
async function objectRunsOf(bytes) {
  const session = await pdfiumWriter.open(bytes);
  try {
    return (await objectRuns(session, 0)).runs;
  } finally {
    await pdfiumWriter.close(session);
  }
}

/** @param {readonly Run[]} runs @returns {readonly any[]} `groupIntoBlocks`' answer, imported by a computed path */
const blocksOf = (runs) =>
  groupIntoBlocks(runs.filter((run) => run.style.upright).map((run) => ({ ...run, setting: settingOf(run.style) })));

/** @param {any} block */
const textOfBlock = (block) =>
  block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {Run} */ run) => run.text).join('')).join('\n');

/** The block reading `line`, or undefined. @param {readonly Run[]} runs @param {string} line */
const blockOf = (runs, line) => blocksOf(runs).find((block) => textOfBlock(block).trimEnd() === line);

/** Whether every line is offered as a block. @param {readonly Run[]} runs @param {readonly string[]} lines */
const hasLines = (runs, lines) => lines.every((line) => blockOf(runs, line) !== undefined);

/**
 * How a call ended: saved bytes, a refusal at a named step, or anything else.
 *
 * @param {() => Promise<Uint8Array>} run
 * @returns {Promise<{ saved: Uint8Array } | { step: string, engineError: number } | { other: string }>}
 */
async function outcomeOf(run) {
  try {
    return { saved: await run() };
  } catch (error) {
    if (error instanceof EditRefusedError) return { step: error.step, engineError: error.engineError };
    return { other: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** @param {Awaited<ReturnType<typeof outcomeOf>>} outcome */
const said = (outcome) =>
  'saved' in outcome
    ? 'it was SAVED'
    : 'step' in outcome
      ? `refused at ${outcome.step} (FPDF_GetLastError ${String(outcome.engineError)})`
      : `it threw ${outcome.other}`;

/**
 * The commands, each built against a page's runs: `target` is the line it edits and must not be Type 3 text, so what
 * a refusal protects is text the command did not touch.
 *
 * @param {readonly Run[]} runs @param {readonly Run[]} objects @param {string} target the target line's text
 * @returns {[string, any][]}
 */
function commandsFor(runs, objects, target) {
  const block = blockOf(runs, target);
  if (block === undefined) throw new Error(`no block reads ${JSON.stringify(target)}, so no command can name it`);
  const first = block.lines[0].runs[0];
  // THE FIRST OBJECT OF THE TARGET LINE holding a whole word, for the two replacements, which name a word by its text.
  const holder = objects.find((run) => target.includes(run.text.trim()) && /\p{L}{3,}/u.test(run.text));
  const word = holder?.text.match(/\p{L}{3,}/u)?.[0];
  if (holder === undefined || word === undefined) throw new Error(`no object of ${JSON.stringify(target)} holds a word`);
  const at = { x: (holder.left + holder.right) / 2, y: (holder.bottom + holder.top) / 2 };
  // SHORTER, NEVER LONGER: every replacement drops a last character, so it uses only characters the run's own font
  // already draws. A subset font lacks what it never drew — measured, the Chromium body's refuses `!` — and a case
  // refused for its characters would be refused before the read-back it exists to reach.
  const shorter = (/** @type {string} */ text) => text.slice(0, -1);
  return [
    ['replaceTextObject', { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: first.index, text: shorter(first.text) }]), version: 1 }],
    // EMPTIED, which removes the object rather than setting it (ADR-0169 Decision 6): a second route to generation.
    ['replaceTextObject emptied', { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: first.index, text: '' }]), version: 1 }],
    ['placePageObject', { kind: 'placePageObject', page: 0, index: first.index, moveBy: { x: 0, y: -12 }, scaleBy: { x: 1, y: 1 }, version: 1 }],
    ['recolorPageObjects', { kind: 'recolorPageObjects', page: 0, indices: [first.index], colour: { red: 200, green: 0, blue: 0, alpha: 255 }, version: 1 }],
    ['deletePageObjects', { kind: 'deletePageObjects', page: 0, indices: [first.index], version: 1 }],
    ['replaceTextAt', { kind: 'replaceTextAt', page: 0, find: word, replace: shorter(word), at }],
    ['replaceAllText', { kind: 'replaceAllText', find: word, replace: shorter(word), version: 1 }],
    [
      'editTextBlock',
      {
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines: block.lines.map((/** @type {any} */ l) => l.runs.map((/** @type {Run} */ r) => r.index)), text: `${target} edited` }]),
        fit: 'reflow',
        version: 1,
      },
    ],
  ];
}

/** @param {Uint8Array} image @param {any} command */
const applied = (image, command) => () => localPdfiumExecution.apply({ session: image, command, sources: [], reads: undefined });

/**
 * A hand-built page carrying `id`'s font kind, with a Form XObject of a Helvetica line drawn IN THE SAME CONTENT
 * STREAM as the page's own lines — the input `promoteFormObjects` needs, which neither research page has.
 *
 * ## One stream, because PDFium regenerates only the streams that changed
 *
 * Measured 2026-10-05 on PDFium 155.0.8044.0's Linux build: pdf-lib's `drawPage` appends a content stream of its own,
 * and a promotion on that page KEPT both Type 3 lines — the stream holding them held no changed object, so it was not
 * rewritten. A fixture like that is one the defect also handles correctly, and the refusal case on it failed by being
 * saved. Joined into one stream, the promotion rewrites the stream the Type 3 lines are in.
 *
 * @param {string} id
 */
async function withAForm(id) {
  const inner = await PDFDocument.create();
  const innerPage = inner.addPage([300, 80]);
  const font = await inner.embedFont(StandardFonts.Helvetica);
  innerPage.drawText('A line inside the form.', { x: 10, y: 40, size: 12, font });
  const outer = await PDFDocument.load(await buildFixture(id));
  const [form] = await outer.embedPdf(await inner.save());
  const page = outer.getPage(0);
  if (form === undefined) throw new Error('embedPdf produced no page');
  page.drawPage(form, { x: 40, y: 40 });
  // SAVED AND LOADED AGAIN, so every content stream is a parsed one, whatever pdf-lib holds a stream it drew as.
  const drawn = await PDFDocument.load(await outer.save());
  const target = drawn.getPage(0);
  const contents = target.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [contents];
  const decoded = streams.map((ref) => {
    const stream = drawn.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('a content stream of the reloaded page is not a raw stream');
    return decodePDFRawStream(stream).decode();
  });
  if (decoded.length < 2) throw new Error('the page has one content stream already, so this fixture joins nothing');
  // A NEWLINE BETWEEN, so the last operator of one stream and the first of the next stay two tokens.
  const joined = Buffer.concat(decoded.flatMap((bytes) => [Buffer.from(bytes), Buffer.from('\n')]));
  target.node.set(PDFName.of('Contents'), drawn.context.register(drawn.context.stream(joined)));
  return drawn.save();
}

async function main() {
  process.stdout.write('# Nothing is lost when PDFium rewrites a page\n\n');
  process.stdout.write(`  PDFium ${PDFIUM_VERSION}\n  ${library}\n\n`);
  openPdfium(library);

  // THE PREMISES: each page reads as written before anything is edited, or a refusal below would mean nothing.
  const chromium = new Uint8Array(readFileSync(CHROMIUM_FIXTURE));
  const chromiumRuns = await runsOf(chromium);
  const chromiumLines = [CHROMIUM_LINES.heading, CHROMIUM_LINES.second, CHROMIUM_LINES.body];
  record(
    'PREMISE: the Chromium print reads its three lines, two of them Type 3',
    hasLines(chromiumRuns, chromiumLines),
    `${String(blocksOf(chromiumRuns).length)} block(s) read`,
  );
  const helvetica = await buildFixture('type1-standard14');
  const helveticaRuns = await runsOf(helvetica);
  record(
    'PREMISE: the Helvetica page reads its three lines',
    hasLines(helveticaRuns, [LINES.a, LINES.b, LINES.c]),
    `${String(blocksOf(helveticaRuns).length)} block(s) read`,
  );

  // EVERY COMMAND, on the Chromium print's CIDFontType2 body: refused at the read-back.
  const onType3 = commandsFor(chromiumRuns, await objectRunsOf(chromium), CHROMIUM_LINES.body);
  for (const [kind, command] of onType3) {
    const outcome = await outcomeOf(applied(chromium, command));
    record(
      `${kind} on a page with Type 3 text is refused at the read-back, so nothing is saved`,
      'step' in outcome && outcome.step === 'read-back',
      said(outcome),
    );
  }

  // AND ITS CONTROL: the same command on Helvetica line C, saved, with lines A and B in the reopened bytes.
  const onHelvetica = commandsFor(helveticaRuns, await objectRunsOf(helvetica), LINES.c);
  for (const [kind, command] of onHelvetica) {
    const outcome = await outcomeOf(applied(helvetica, command));
    const kept = 'saved' in outcome && hasLines(await runsOf(outcome.saved), [LINES.a, LINES.b]);
    record(
      `CONTROL: ${kind} on a page without Type 3 is SAVED, and keeps the lines it did not touch`,
      kept,
      'saved' in outcome ? (kept ? 'saved, lines A and B kept' : 'saved WITHOUT lines A and B') : said(outcome),
    );
  }

  // THE EIGHTH COMMAND, which needs a Form XObject: promoted onto a Type 3 page and refused; onto Helvetica, saved.
  const promote = { kind: 'promoteFormObjects', page: 0 };
  const promotedType3 = await outcomeOf(applied(await withAForm('type3'), promote));
  record(
    'promoteFormObjects on a page with Type 3 text is refused at the read-back, so nothing is saved',
    'step' in promotedType3 && promotedType3.step === 'read-back',
    said(promotedType3),
  );
  const promotedHelvetica = await outcomeOf(applied(await withAForm('type1-standard14'), promote));
  const promotedKept = 'saved' in promotedHelvetica && hasLines(await runsOf(promotedHelvetica.saved), [LINES.a, LINES.b, LINES.c]);
  record(
    'CONTROL: promoteFormObjects on a page without Type 3 is SAVED, and keeps every line',
    promotedKept,
    'saved' in promotedHelvetica ? (promotedKept ? 'saved, lines A, B and C kept' : 'saved WITHOUT its lines') : said(promotedHelvetica),
  );

  // AN UNDO REGENERATES THE PAGE AS THE EDIT DID, so each invertible command's inverse is refused the same way. The
  // prior is the command's own capture, which only reads.
  for (const kind of /** @type {const} */ (['replaceTextObject', 'placePageObject', 'recolorPageObjects'])) {
    const entry = onType3.find(([name]) => name === kind);
    const captured = entry === undefined ? undefined : await localPdfiumExecution.capture(chromium, entry[1]);
    const outcome =
      captured?.captured === true
        ? await outcomeOf(() => localPdfiumExecution.invert(chromium, kind, captured.prior))
        : { other: `the capture did not record a prior: ${captured?.captured === false ? captured.reason : 'no command'}` };
    record(`undoing ${kind} on a page with Type 3 text is refused at the read-back`, 'step' in outcome && outcome.step === 'read-back', said(outcome));
  }

  // THE HAND-BUILT PAGE'S OWN EDIT, of its Type 3 line: refused at the read-back, where it used to be refused as a
  // font that cannot carry the words — the wrong sentence, since the save is what lost them (ADR-0169).
  const type3 = await buildFixture('type3');
  const type3Runs = await runsOf(type3);
  const lineA = blockOf(type3Runs, LINES.a);
  const ownEdit =
    lineA === undefined
      ? { other: 'line A of the Type 3 page was not offered as a block' }
      : await outcomeOf(
          applied(type3, {
            kind: 'editTextBlock',
            page: 0,
            ...blockEditOf([{ lines: lineA.lines.map((/** @type {any} */ l) => l.runs.map((/** @type {Run} */ r) => r.index)), text: `${LINES.a} edited` }]),
            fit: 'reflow',
            version: 1,
          }),
        );
  record(
    'editing a Type 3 line itself is refused at the read-back, not as a font that cannot carry the words',
    'step' in ownEdit && ownEdit.step === 'read-back',
    said(ownEdit),
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} PDFium read-back case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('PDFium read-back case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
