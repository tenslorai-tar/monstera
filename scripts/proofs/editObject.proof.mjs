// @ts-check
/**
 * Edit object's writers, proven BEFORE the surface is built
 * ([ADR-0264](../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)
 * Decision 7): every edit on every object of a page, through PDFium's reading and the MuPDF writers, as the application
 * makes it, counting what is refused and checking that nothing else on the page is drawn differently.
 *
 * ## What is tried, on every object
 *
 * PDFium lists the page (`pageObjects`) and reads its text blocks (`textRuns` grouped by `groupIntoBlocks`, the read
 * `document.textBlocks` makes of a page as it is). Then, each on a fresh copy of the page:
 *
 * - a picture, a shape or a group (`editDrawnObject`): moved, resized on one axis, recoloured (shapes), brought forward
 *   and sent back where `arrangeNeighbourOf` finds a neighbour (the renderer's own rule), and deleted;
 * - a text block (`editTextOperators`): moved, resized, recoloured whole, arranged the same way, and deleted.
 *
 * ## The two counts, and the pixels
 *
 * A REFUSAL is any edit the writer did not make, with its step. The one refusal the design allows is `cropped`
 * (Decision 4), and it is counted apart. Every edit that was made is drawn by MuPDF before and after at 144 dpi, and
 * every pixel outside the edited object's own box (before and after it moved, widened by a point and a half for edges)
 * must be the same: a DISTURBED page is a pixel that changed somewhere it should not have.
 *
 * ## The documents
 *
 * The brochure (`brochureFixture.mjs`, three pages): the design's gate is that it refuses NOTHING. Then the repository's
 * fixtures: the committed Chromium print (`chromium-type3.pdf`) and the eleven font-kind fixtures (`fontKindFixtures.mjs`).
 * The owner's corpus is not in the repository; the local agent runs this over it with `--corpus <folder>`.
 *
 * ## Controls
 *
 * - RESOLUTION: the comparator is shown two renders that differ in one pixel by one level and must count exactly one.
 * - NOT VACUOUS: an edit that changed no pixel inside its own box did nothing a person could see, and is counted; the
 *   brochure must have none, so a writer that wrote nothing would fail here rather than pass on an unchanged page.
 * - THE INSTRUMENT SEES A DISTURBANCE: the brochure's heading moved through PDFium's block writer, which writes the page
 *   again as the route R20 removed did, is compared the same way and must be found to disturb other pixels, or to be
 *   refused by the writer itself. Measured 2026-10-23 on Linux: 12,574 pixels outside the heading, where every edit of
 *   ADR-0264's writers disturbed none.
 *
 * Usage: node scripts/proofs/editObject.proof.mjs [--require-engines] [--pages <n>] [--corpus <folder>]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { EDIT_OBJECT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { SCALE, compare, inkOf, render } from '../lib/pageDisturbance.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { brochure } from '../research/brochureFixture.mjs';
import { FONT_KINDS, buildFixture } from '../research/fontKindFixtures.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');
const argv = process.argv.slice(2);
const pagesAt = argv.indexOf('--pages');
const PAGES = pagesAt === -1 ? 3 : Number(argv[pagesAt + 1]);
const corpusAt = argv.indexOf('--corpus');
const CORPUS = corpusAt === -1 ? null : (argv[corpusAt + 1] ?? null);
const CHROMIUM = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf');

const CASES = [
  'RESOLUTION: the comparator counts exactly one pixel that differs by one level',
  'THE INSTRUMENT SEES A DISTURBANCE: the brochure’s heading moved by PDFium’s page rewrite is refused or disturbs other pixels',
  'the brochure: every edit of every object is made — no refusal (the design’s gate, ADR-0264 Decision 7)',
  'the brochure: every edit made leaves every pixel outside the edited object as it was',
  'the brochure: every edit made changes what is drawn inside the edited object’s own box (not vacuous)',
  'the repository’s fixtures: every edit is made or refused only as `cropped`, and every edit made disturbs no other pixel',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });
if (CASES.length !== 6) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 6`);

/** @param {string} name @param {boolean} held @param {string} detail */
function check(name, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/**
 * @typedef {import('../lib/pageDisturbance.mjs').Box} Box
 * @typedef {{ object: string, edit: string, outcome: 'made' | 'refused' | 'cropped', disturbed: number, inside: number, why: string }} Try
 */

/**
 * Every edit on every object of page `index` of `bytes`, each on a fresh copy, through PDFium's reading and the MuPDF
 * writers. Answers each try's outcome.
 * @param {any} pdfium @param {any} kernel @param {Uint8Array} bytes @param {number} index
 * @param {boolean} quotes whether a text block may be named by its words: never for the owner's corpus
 * @returns {Promise<Try[]>}
 */
async function walkPage(pdfium, kernel, bytes, index, quotes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  /** @type {any[]} */
  let objects;
  /** @type {any} */
  let read;
  /** @type {any} */
  let runs;
  try {
    objects = await pdfium.pageObjects(session, index);
    read = await pdfium.textRuns(session, index);
    runs = await pdfium.pageRuns(session, index);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  /** @type {import('@monstera/contract').ListedObject[]} */
  const listed = objects.map((object) => ({ index: object.index, kind: object.kind, box: object.shown ?? { left: object.left, bottom: object.bottom, right: object.right, top: object.top } }));
  const blocks = kernel.groupIntoBlocks(
    read.runs.filter((/** @type {any} */ run) => kernel.isEditedInPlace(run.style)).map((/** @type {any} */ run) => ({ ...run, setting: kernel.settingOf(run.style) })),
  );
  const before = render(kernel, bytes, index);
  /** @type {Try[]} */
  const tries = [];

  /**
   * One edit on a fresh copy: made, refused, or cropped, and what its pixels say.
   * @param {string} object @param {string} edit @param {(session: any) => Promise<unknown>} apply @param {Box[]} allowed
   */
  const attempt = async (object, edit, apply, allowed) => {
    const copy = await kernel.mupdfWriter.open(bytes);
    try {
      try {
        await apply(copy);
      } catch (error) {
        const step = /** @type {any} */ (error).step;
        tries.push({ object, edit, outcome: step === 'cropped' ? 'cropped' : 'refused', disturbed: 0, inside: 0, why: `${String(/** @type {any} */ (error).name)} ${String(step ?? '')}: ${String(/** @type {any} */ (error).message)}` });
        return;
      }
      const after = render(kernel, await kernel.mupdfWriter.serialise(copy), index);
      const { outside, inside, farthest } = compare(before, after, allowed);
      tries.push({ object, edit, outcome: 'made', disturbed: outside, inside, why: outside > 0 ? `up to ${String(farthest / SCALE)} pt past its box` : '' });
    } finally {
      await kernel.mupdfWriter.close(copy);
    }
  };

  // DRAWN OBJECTS, each by its kind and its place among its kind, as the renderer names it.
  /** @type {Record<string, number>} */
  const seen = {};
  for (const object of objects) {
    if (!['path', 'image', 'form', 'shading'].includes(object.kind)) continue;
    const ordinal = seen[object.kind] ?? 0;
    seen[object.kind] = ordinal + 1;
    const engine = { left: object.left, bottom: object.bottom, right: object.right, top: object.top };
    const shown = object.shown ?? engine;
    const name = `${String(object.kind)} ${String(ordinal)}`;
    /** @param {any} edit */
    const drawn = (edit) => (/** @type {any} */ copy) =>
      kernel.applyEditDrawnObject(copy, { kind: 'editDrawnObject', page: index, index: object.index, object: object.kind, ordinal, box: engine, edit, version: 1 });
    const placed = (/** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ sx, /** @type {number} */ sy) => ({
      left: engine.left + (shown.left - engine.left) * sx + dx,
      bottom: engine.bottom + (shown.bottom - engine.bottom) * sy + dy,
      right: engine.left + (shown.right - engine.left) * sx + dx,
      top: engine.bottom + (shown.top - engine.bottom) * sy + dy,
    });
    await attempt(name, 'move', drawn({ op: 'place', moveBy: { x: 12, y: -9 }, scaleBy: { x: 1, y: 1 } }), [shown, placed(12, -9, 1, 1)]);
    await attempt(name, 'resize', drawn({ op: 'place', moveBy: { x: 0, y: 0 }, scaleBy: { x: 1.25, y: 1 } }), [shown, placed(0, 0, 1.25, 1)]);
    if (object.kind === 'path') await attempt(name, 'recolour', drawn({ op: 'recolor', colour: { r: 200, g: 30, b: 30 } }), [shown]);
    for (const to of /** @type {const} */ (['forward', 'backward'])) {
      const past = kernel.arrangeNeighbourOf(listed, { text: false, indices: [object.index], box: shown }, to);
      if (past !== undefined) await attempt(name, to, drawn({ op: 'arrange', to, past }), [shown]);
    }
    await attempt(name, 'delete', drawn({ op: 'delete' }), [shown]);
  }

  // TEXT BLOCKS, as Edit text reads them, each through the operator writer with the page's runs as its pre-read.
  for (const [at, block] of blocks.entries()) {
    const box = { left: block.box.x0, bottom: block.box.y0, right: block.box.x1, top: block.box.y1 };
    const lines = block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index));
    const soft = block.lines.map((/** @type {any} */ line) => line.soft);
    const text = kernel.paragraphsOfLines(block.lines.map((/** @type {any} */ line) => ({ text: kernel.lineText(line.runs), soft: line.soft })));
    // A BLOCK OF THE OWNER'S CORPUS IS NAMED BY ITS NUMBER: its words are the owner's and are never printed.
    const name = quotes ? `block ${String(at)} “${text.slice(0, 24)}”` : `block ${String(at)}`;
    /** @param {Record<string, unknown>} rest */
    const written = (rest) => (/** @type {any} */ copy) =>
      kernel.applyEditTextOperators(
        copy,
        { kind: 'editTextOperators', page: index, ...kernel.blockEditOf([{ lines, soft, text, ...rest }]), fit: 'reflow', version: 1 },
        runs,
      );
    // WHERE ITS PIXELS ARE (`inkOf`), which is what may change; the command still names it by PDFium's box.
    const ink = inkOf(kernel, bytes, index, box);
    // SCALED ABOUT ITS TOP LEFT, the operator writer's own anchor, which is the top left of PDFium's box.
    const scaled = {
      left: box.left + (ink.left - box.left) * 1.2,
      bottom: box.top - (box.top - ink.bottom) * 1.2,
      right: box.left + (ink.right - box.left) * 1.2,
      top: box.top - (box.top - ink.top) * 1.2,
    };
    await attempt(name, 'move', written({ place: { move: { x: 12, y: -9 } } }), [ink, { left: ink.left + 12, bottom: ink.bottom - 9, right: ink.right + 12, top: ink.top - 9 }]);
    await attempt(name, 'resize', written({ place: { scale: 1.2 } }), [ink, scaled]);
    if (text.length > 0) {
      await attempt(name, 'recolour', written({ text, marks: [{ from: 0, to: text.length, set: { colour: { r: 200, g: 30, b: 30 } } }] }), [ink]);
    }
    const indices = block.lines.flatMap((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index));
    for (const to of /** @type {const} */ (['forward', 'backward'])) {
      const past = kernel.arrangeNeighbourOf(listed, { text: true, indices, box }, to);
      if (past !== undefined) await attempt(name, to, written({ place: { arrange: { to, past } } }), [ink]);
    }
    await attempt(name, 'delete', written({ text: '' }), [ink]);
  }
  return tries;
}

/** A paragraph of three lines in Helvetica 12, its first line ending in a word broken by a hyphen. */
async function lineEndHyphen() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  ['The quarterly figures were con-', 'firmed by the board at its meeting', 'on the fourth of the month.'].forEach((line, at) => {
    page.drawText(line, { x: 72, y: 700 - at * 14, size: 12, font });
  });
  return new Uint8Array(await document.save());
}

/**
 * The documents a run walks, each with its pages, and whether its words may be printed (`quotes`): never for the corpus.
 * @returns {Promise<{ name: string, bytes: Uint8Array, pages: number[], gate: boolean, quotes: boolean }[]>}
 */
async function documents() {
  /** @type {{ name: string, bytes: Uint8Array, pages: number[], gate: boolean, quotes: boolean }[]} */
  const found = [];
  for (let page = 1; page <= PAGES; page += 1) found.push({ name: `brochure page ${String(page)}`, bytes: await brochure(page), pages: [0], gate: true, quotes: true });
  found.push({ name: 'chromium-type3.pdf', bytes: new Uint8Array(readFileSync(CHROMIUM)), pages: [0], gate: false, quotes: true });
  for (const kind of FONT_KINDS) found.push({ name: `font kind ${kind.id}`, bytes: await buildFixture(kind.id), pages: [0], gate: false, quotes: true });
  // A WORD BROKEN BY A HYPHEN AT A LINE'S END, which PDFium's text page reads as U+FFFE where MuPDF reads the hyphen the
  // page draws: every edit of such a paragraph was refused over the owner's corpus until the reading took the hyphen.
  found.push({ name: 'line-end hyphen', bytes: await lineEndHyphen(), pages: [0], gate: false, quotes: true });
  if (CORPUS !== null) {
    // BY NUMBER, NEVER BY NAME: the corpus is the owner's own documents, and their names are never printed. The number is
    // the file's place in the folder sorted by name, so a run can be repeated against the same document.
    const files = readdirSync(CORPUS).filter((each) => each.toLowerCase().endsWith('.pdf')).sort();
    files.forEach((file, at) => {
      found.push({ name: `corpus document ${String(at + 1)} of ${String(files.length)}`, bytes: new Uint8Array(readFileSync(join(CORPUS, file))), pages: [0], gate: false, quotes: false });
    });
  }
  return found;
}

/** @param {any} pdfium @param {any} kernel */
async function run(pdfium, kernel) {
  // RESOLUTION: one pixel, one level.
  const blank = { width: 4, height: 4, rgb: new Uint8Array(48).fill(255), toDevice: (/** @type {number} */ x, /** @type {number} */ y) => /** @type {[number, number]} */ ([x, y]) };
  const one = { ...blank, rgb: Uint8Array.from(blank.rgb, (value, at) => (at === 30 ? value - 1 : value)) };
  const resolved = compare(blank, one, []);
  check(CASES[0] ?? '', resolved.outside === 1 && resolved.inside === 0, `counted ${JSON.stringify(resolved)}`);

  // THE INSTRUMENT SEES A DISTURBANCE: PDFium's own page rewrite (`placePageObject`'s route, removed in R20) is gone from
  // the application; its nearest still-built kin is the PDFium block writer, which regenerates the page. A heading moved
  // through it on the brochure must disturb other pixels or be refused, or this instrument could not see what R20 saw.
  const first = await brochure(1);
  const session = await pdfium.pdfiumWriter.open(first);
  /** @type {any} */
  let read;
  try {
    read = await pdfium.textRuns(session, 0);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const blocks = kernel.groupIntoBlocks(read.runs.filter((/** @type {any} */ run) => kernel.isEditedInPlace(run.style)).map((/** @type {any} */ run) => ({ ...run, setting: kernel.settingOf(run.style) })));
  const heading = blocks[0];
  const headingBox = { left: heading.box.x0, bottom: heading.box.y0, right: heading.box.x1, top: heading.box.y1 };
  /** @type {string} */
  let regenerated;
  try {
    const answer = await kernel.withNoPassword(kernel.localPdfiumExecution).apply({
      session: first,
      command: {
        kind: 'editTextBlock',
        page: 0,
        ...kernel.blockEditOf([
          {
            lines: heading.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ each) => each.index)),
            soft: heading.lines.map((/** @type {any} */ line) => line.soft),
            text: kernel.paragraphsOfLines(heading.lines.map((/** @type {any} */ line) => ({ text: kernel.lineText(line.runs), soft: line.soft }))),
            place: { move: { x: 12, y: -9 } },
          },
        ]),
        fit: 'reflow',
        version: 1,
      },
      sources: [],
      reads: undefined,
    });
    const moved = { left: headingBox.left + 12, bottom: headingBox.bottom - 9, right: headingBox.right + 12, top: headingBox.top - 9 };
    const { outside } = compare(render(kernel, first, 0), render(kernel, answer, 0), [headingBox, moved]);
    regenerated = outside > 0 ? `disturbed ${String(outside)} pixel(s) outside the heading` : 'disturbed nothing';
  } catch (error) {
    // ONLY THE WRITER'S OWN REFUSALS count as the old route refusing: a harness that threw anything else would pass this
    // control for a reason it does not claim (found writing it: a session handed in the wrong shape threw a TypeError).
    const name = String(/** @type {any} */ (error).name);
    regenerated = `${['EditRefusedError', 'TextNotWritableError'].includes(name) ? 'refused' : 'FAILED TO RUN'}: ${name} ${String(/** @type {any} */ (error).message)}`;
  }
  process.stdout.write(`  the instrument's control, PDFium's page rewrite of the brochure's heading: ${regenerated}\n`);
  check(CASES[1] ?? '', regenerated.startsWith('refused:') || /^disturbed [1-9]/u.test(regenerated), regenerated);

  /** @type {{ document: string, gate: boolean, tries: Try[] }[]} */
  const results = [];
  for (const document of await documents()) {
    /** @type {Try[]} */
    const tries = [];
    for (const page of document.pages) tries.push(...(await walkPage(pdfium, kernel, document.bytes, page, document.quotes)));
    results.push({ document: document.name, gate: document.gate, tries });
  }

  // THE REPORT, every document's counts, and every try that was not clean, named.
  for (const { document, tries } of results) {
    const count = (/** @type {Try['outcome']} */ outcome) => tries.filter((each) => each.outcome === outcome).length;
    process.stdout.write(
      `  ${document}: ${String(tries.length)} edit(s), ${String(count('made'))} made, ${String(count('refused'))} refused, ` +
        `${String(count('cropped'))} cropped, ${String(tries.filter((each) => each.disturbed > 0).length)} disturbed, ` +
        `${String(tries.filter((each) => each.outcome === 'made' && each.inside === 0).length)} unseen\n`,
    );
    for (const each of tries.filter((one) => one.outcome !== 'made' || one.disturbed > 0)) {
      process.stdout.write(`      ${each.object}, ${each.edit}: ${each.outcome}${each.disturbed > 0 ? ` and disturbed ${String(each.disturbed)} pixel(s)` : ''} ${each.why}\n`);
    }
  }
  const gate = results.filter((result) => result.gate).flatMap((result) => result.tries);
  const rest = results.filter((result) => !result.gate).flatMap((result) => result.tries);
  // WHAT WAS TRIED, BY EDIT, so a run that never found a neighbour to arrange past says so rather than passing quietly.
  const tally = (/** @type {Try[]} */ list) =>
    ['move', 'resize', 'recolour', 'forward', 'backward', 'delete'].map((edit) => `${edit} ${String(list.filter((each) => each.edit === edit).length)}`).join(', ');
  process.stdout.write(`\n  tried on the brochure: ${tally(gate)}\n  tried on the fixtures: ${tally(rest)}\n`);
  const describe = (/** @type {Try[]} */ list) => list.map((each) => `${each.object} ${each.edit}: ${each.outcome} ${each.why}`).join('; ') || 'none';
  const refused = gate.filter((each) => each.outcome !== 'made');
  check(CASES[2] ?? '', gate.length > 0 && refused.length === 0, `${String(refused.length)} of ${String(gate.length)} refused: ${describe(refused)}`);
  const disturbed = gate.filter((each) => each.disturbed > 0);
  check(CASES[3] ?? '', disturbed.length === 0, `${String(disturbed.length)} disturbed: ${describe(disturbed)}`);
  const unseen = gate.filter((each) => each.outcome === 'made' && each.inside === 0);
  check(CASES[4] ?? '', unseen.length === 0 && gate.some((each) => each.outcome === 'made'), `${String(unseen.length)} changed nothing: ${describe(unseen)}`);
  const restBad = rest.filter((each) => each.outcome === 'refused' || each.disturbed > 0);
  check(CASES[5] ?? '', rest.length > 0 && restBad.length === 0, `${String(restBad.length)} of ${String(rest.length)}: ${describe(restBad)}`);
  process.stdout.write(
    `\nEDIT OBJECT: brochure ${String(refused.length)} refusal(s) in ${String(gate.length)} edit(s); repository fixtures ` +
      `${String(rest.filter((each) => each.outcome === 'refused').length)} refusal(s) and ${String(rest.filter((each) => each.outcome === 'cropped').length)} crop(s) in ${String(rest.length)} edit(s)\n\n`,
  );
}

const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'Edit object’s writers on every object of the brochure and the repository’s fixtures',
    why:
      `${String(CASES.length)} case(s) need both engines:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (existsSync(library) ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.' : 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'),
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, EDIT_OBJECT, 4);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(library);
  const { blockEditOf, arrangeNeighbourOf } = await import('../../packages/contract/dist/commands.js');
  const { groupIntoBlocks, isEditedInPlace, settingOf } = await import('../../packages/kernel/dist/textLines.js');
  const { paragraphsOfLines, lineText } = await import('../../packages/shared/dist/index.js');
  const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
  const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
  const { applyEditDrawnObject } = await import('../../packages/kernel/dist/drawnObjectEdit.js');
  const { applyEditTextOperators } = await import('../../packages/kernel/dist/textOperatorEdit.js');
  const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
  const { withNoPassword } = await import('../lib/pdfiumNoPassword.mjs');
  await run(pdfium, {
    blockEditOf,
    arrangeNeighbourOf,
    groupIntoBlocks,
    isEditedInPlace,
    settingOf,
    paragraphsOfLines,
    lineText,
    mupdf,
    mupdfWriter,
    applyEditDrawnObject,
    applyEditTextOperators,
    localPdfiumExecution,
    withNoPassword,
  });
  process.stdout.write(
    failures.length > 0 ? `\n${String(failures.length)} Edit object case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n` : roster.format('Edit object case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
