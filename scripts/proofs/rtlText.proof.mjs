// @ts-check
/**
 * Hebrew and Arabic in a text box, a callout and typed text are drawn as their letters, in order, read back by a
 * second library ([ADR-0128](../../docs/DECISIONS/0128-the-shim-carries-mupdfs-layout-engine.md)).
 *
 * ## The failure this closes
 *
 * Until 2026-10-01 the engine drew a text box's Hebrew or Arabic as bytes in Helvetica, so the page showed dots: the
 * build had turned MuPDF's layout engine off along with the document handlers it did not want. The owner's list,
 * item 5: the real letters, in order, proven by a second library.
 *
 * ## What each case runs
 *
 * The kernel's own `addAnnotation`, through the built executor the MuPDF host runs, on a blank page; then MuPDF's bake,
 * which turns each mark's appearance into page content; then **pdf.js** — not the engine that drew it — reads the
 * page's text and where each glyph sits.
 *
 * ## Its controls
 *
 * - **Before the bake pdf.js reads nothing**: it reads page content only, so every letter it reads after the bake came
 *   from what MuPDF drew in the appearance.
 * - **Order without pdf.js's own bidi**: the first Hebrew letter typed must be the RIGHTMOST glyph. pdf.js reorders a
 *   right-to-left run into logical order, so the reading alone would agree with a drawing whose glyphs ran the wrong
 *   way; positions cannot.
 * - **Shaping**: the Arabic is read as its joined presentation forms, which only a shaped drawing yields, and NFKC maps
 *   them back to the letters typed. An unshaped drawing gives the letters' isolated forms.
 * - **Direction is the alignment**: right to left puts the line against the box's right edge, left to right against
 *   its left — the same word, so the setting is what moved it.
 *
 * Usage: node scripts/proofs/rtlText.proof.mjs [--require-engine]
 */

import { PDFDocument } from '@cantoo/pdf-lib';

import { RTL_TEXT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engine');

const HEBREW = String.fromCodePoint(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const ARABIC = String.fromCodePoint(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);
const LATIN = 'see figure 3';

/** The box every mark is drawn in, PDF user space, on a 300 × 200 page. */
const BOX = { x0: 20, y0: 40, x1: 280, y1: 160 };
/** How far a line may start from the edge it sits against: the border, MuPDF's inset, and rounding. */
const EDGE_SLACK = 8;

const CASES = [
  'CONTROL: before the bake pdf.js reads nothing on the page, so what it reads after came from the drawing',
  'a HEBREW text box reads back as the letters typed, in order',
  'and its first letter is the RIGHTMOST glyph, an order pdf.js’s own reordering cannot supply',
  'an ARABIC text box reads back as JOINED forms, which NFKC maps to the letters typed',
  'CONTROL: a LATIN text box reads back as typed, in its base-14 face',
  'HEBREW typed text and a HEBREW callout read back as the letters typed too',
  'RIGHT TO LEFT puts the line against the box’s right edge',
  'CONTROL: LEFT TO RIGHT puts the same word against the left edge',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });
if (CASES.length !== 8) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 8`);

/** @param {number} index @param {boolean} held @param {string} detail */
function check(index, held, detail) {
  const mark = roster.mark();
  const name = CASES[index] ?? '';
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** @param {string} text */
const codes = (text) => [...text].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join(' ');

/**
 * @typedef {{ str: string, x: number, width: number }} Glyphs
 * @typedef {{ type: string, text: string, direction: string, at?: { x: number, y: number } }} Mark
 */

/**
 * One page with one mark, drawn by the kernel's command, optionally baked, read by pdf.js.
 *
 * @param {any} kernel @param {any} pdfjs @param {Uint8Array} blank @param {Mark} mark @param {boolean} bake
 * @returns {Promise<Glyphs[]>}
 */
async function readBack(kernel, pdfjs, blank, mark, bake) {
  const session = await kernel.mupdfWriter.open(blank);
  try {
    await kernel.localMupdfExecution.apply({
      session,
      command: {
        kind: 'addAnnotation',
        page: 0,
        annotation: { rect: BOX, colour: [0, 0, 0], opacity: 1, fontSize: 24, font: 'sans', ...mark },
        stamp: { author: 'Proof', created: '2026-10-01T00:00:00.000Z' },
      },
      source: undefined,
      reads: undefined,
    });
    if (bake) await kernel.withDocument(session, (/** @type {any} */ document) => document.bake(true, true));
    const bytes = await kernel.mupdfWriter.serialise(session);
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
    try {
      const page = await (await task.promise).getPage(1);
      const content = await page.getTextContent();
      return content.items
        .filter((/** @type {any} */ item) => typeof item.str === 'string' && item.str.trim() !== '')
        .map((/** @type {any} */ item) => ({ str: item.str, x: item.transform[4], width: item.width }));
    } finally {
      await task.destroy();
    }
  } finally {
    await kernel.mupdfWriter.close(session);
  }
}

/** @param {Glyphs[]} glyphs */
const joined = (glyphs) => glyphs.map((glyph) => glyph.str).join('').replace(/\s+/gu, '');

/** @param {any} kernel @param {any} pdfjs */
async function run(kernel, pdfjs) {
  const made = await PDFDocument.create();
  made.addPage([300, 200]);
  const blank = await made.save();

  const unbaked = await readBack(kernel, pdfjs, blank, { type: 'text-box', text: HEBREW, direction: 'right-to-left' }, false);
  check(0, unbaked.length === 0, `pdf.js read ${JSON.stringify(unbaked.map((glyph) => glyph.str))} before the bake`);

  const hebrew = await readBack(kernel, pdfjs, blank, { type: 'text-box', text: HEBREW, direction: 'right-to-left' }, true);
  check(1, joined(hebrew) === HEBREW, `read [${codes(joined(hebrew))}] against typed [${codes(HEBREW)}]`);
  const shin = hebrew.find((glyph) => glyph.str.includes(HEBREW.charAt(0)));
  const rightmost = Math.max(...hebrew.map((glyph) => glyph.x));
  check(2, shin !== undefined && shin.x === rightmost, `the first letter sits at x ${String(shin?.x)}, the rightmost glyph at ${String(rightmost)}`);

  const arabic = await readBack(kernel, pdfjs, blank, { type: 'text-box', text: ARABIC, direction: 'right-to-left' }, true);
  const arabicRead = joined(arabic);
  check(
    3,
    arabicRead !== ARABIC && arabicRead.normalize('NFKC') === ARABIC,
    `read [${codes(arabicRead)}], NFKC [${codes(arabicRead.normalize('NFKC'))}], typed [${codes(ARABIC)}] — the read must be the joined forms and normalise to the typed letters`,
  );

  const latin = await readBack(kernel, pdfjs, blank, { type: 'text-box', text: LATIN, direction: 'left-to-right' }, true);
  check(4, joined(latin) === LATIN.replace(/\s+/gu, ''), `read "${joined(latin)}"`);

  const typed = await readBack(kernel, pdfjs, blank, { type: 'typewriter', text: HEBREW, direction: 'right-to-left' }, true);
  const callout = await readBack(
    kernel,
    pdfjs,
    blank,
    { type: 'callout', text: HEBREW, direction: 'right-to-left', at: { x: 5, y: 5 } },
    true,
  );
  check(5, joined(typed) === HEBREW && joined(callout) === HEBREW, `typed text read [${codes(joined(typed))}], the callout [${codes(joined(callout))}]`);

  const rightEdge = Math.max(...hebrew.map((glyph) => glyph.x + glyph.width));
  check(6, BOX.x1 - rightEdge <= EDGE_SLACK, `the line ends at x ${rightEdge.toFixed(1)} against the box's right edge at ${String(BOX.x1)}`);
  const leftAligned = await readBack(kernel, pdfjs, blank, { type: 'text-box', text: HEBREW, direction: 'left-to-right' }, true);
  const leftStart = Math.min(...leftAligned.map((glyph) => glyph.x));
  const leftEnd = Math.max(...leftAligned.map((glyph) => glyph.x + glyph.width));
  check(
    7,
    leftStart - BOX.x0 <= EDGE_SLACK && BOX.x1 - leftEnd > EDGE_SLACK,
    `the same word starts at x ${leftStart.toFixed(1)} (box's left edge ${String(BOX.x0)}) and ends at ${leftEnd.toFixed(1)}`,
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} right-to-left case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('right-to-left case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

// THE ENTRY IS LAST, so every constant above is initialised before the first case reads one.
if (bindNativeEngine(ROOT) === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'Hebrew and Arabic in text marks',
    why:
      `${String(CASES.length)} case(s) need the native engine:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      'The MuPDF shim is not built. Run `npm run provision:mupdf`.',
    flag: '--require-engine',
  });
} else {
  // THE BUILT EXECUTOR AND WRITER ARE THE SUBJECT, and the engine they draw with.
  refuseStaleBuild(ROOT, RTL_TEXT, 4);
  const [{ localMupdfExecution }, { mupdfWriter, withDocument }] = await Promise.all([
    import('../../packages/kernel/dist/commandSpecs.js'),
    import('../../packages/kernel/dist/mupdfWriter.js'),
  ]);
  /** @type {any} */
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  await run({ localMupdfExecution, mupdfWriter, withDocument }, pdfjs);
}
