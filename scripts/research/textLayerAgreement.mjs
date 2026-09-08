// @ts-check
/**
 * Whether PDF.js and the kernel's text substrate agree about what is on a page.
 *
 * ## The decision this exists to inform
 *
 * *Select and copy (native text layer)* needs DOM elements over the rendered
 * page that a browser's own selection can run across, and there are two places
 * their text can come from.
 *
 * **PDF.js's own `getTextContent`.** It is right there, it is what its
 * `TextLayer` is built from, and it needs no channel.
 *
 * **The kernel's substrate** — `textStructure.ts` over MuPDF's structured text,
 * reached through `document.pageText`. It is what *search* already walks, on
 * purpose: `docs/FEATURES.md`:73 records that `findInPages` uses the substrate
 * and not MuPDF's own `search`, because ADR-0034's K.0 bans a second extraction
 * path.
 *
 * Taking PDF.js's would put **two extraction paths** in one application: one
 * that decides what the user finds, and one that decides what the user copies.
 * `CLAUDE.md` names the pathology — *fragile identity joins between two parsers*
 * — and `docs/ARCHITECTURE.md` §3 states the rule the other way round: PDF.js
 * renders and is never a source of truth.
 *
 * **But how much that costs is a measurement, not an argument.** If the two
 * agree character for character on every shape, the rule still decides it and
 * the cost of obeying it is small. If they disagree, the disagreement is what a
 * user would meet — search finds a word, selection copies something else — and
 * that is the reading worth having before either design is built.
 *
 * ## What is compared, and what deliberately is not
 *
 * Text and reading order, per page, as a **string**. Not boxes: the two engines
 * report geometry in different frames and different units, and a coordinate
 * comparison would be measuring the conversion rather than the extraction. The
 * text layer's positioning is a separate question that only arises once the
 * source is chosen.
 *
 * Per fixture, never blended into one score. ADR-0034's own accuracy figure has
 * two numbers and refuses to average them, for the reason that applies here too:
 * *every line correct in an unusable order* and *the right order with mangled
 * lines* are different failures, and one number hides which one you have.
 *
 * ## Its own controls
 *
 * **A fixture the two must agree on**, so a report of universal disagreement is
 * visibly the instrument rather than the engines.
 *
 * **A fixture they are expected to disagree on** — two columns, where reading
 * order is exactly what `FZ_STEXT_SEGMENT` was turned on for and what PDF.js
 * has no equivalent of. A run where even that agrees means the comparison is
 * not discriminating, and this script says so rather than reporting a clean
 * sweep.
 *
 * **And the comparison is resolution-tested before it compares anything**: two
 * strings differing by one character must be reported as differing by one.
 *
 * Run: node scripts/research/textLayerAgreement.mjs
 *
 * It prints readings, never a verdict.
 */
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { STEXT_OPTION_STRING, parsePageText, plainTextOf } from '../../packages/kernel/dist/textStructure.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The substrate is read through the kernel's BUILD, so a stale one answers for
 * code that is no longer there.
 *
 * Importing the source is not available — it is TypeScript — and reimplementing
 * the parse here would be a second opinion about a format `textStructure.ts`
 * owns (B3a), which is worse than the staleness. So the edge is checked instead.
 * `scripts/lib/buildFreshness.mjs` does this properly for proofs, keyed by
 * `proof:*` name and anchored against the set of proofs that import it; this is
 * a research script and adding it to that map would put a non-proof in a roster
 * derived from proofs.
 */
function refuseStaleSubstrate() {
  const source = join(root, 'packages', 'kernel', 'src', 'textStructure.ts');
  const built = join(root, 'packages', 'kernel', 'dist', 'textStructure.js');
  const sourceAt = statSync(source).mtimeMs;
  const builtAt = statSync(built).mtimeMs;
  if (sourceAt > builtAt) {
    throw new Error(
      `packages/kernel/src/textStructure.ts is newer than its build, so this run would compare ` +
        `PDF.js against a substrate that no longer exists. Run: npm run build`,
    );
  }
}

/** The page every fixture uses, in points. */
const PAGE = { width: 500, height: 400 };

/**
 * @typedef {object} Fixture
 * @property {string} name
 * @property {'agree' | 'differ' | 'none'} control what this case is for
 * @property {string} why
 * @property {readonly string[]} expects text the generator put on the page, which
 *   both readers must produce before their agreement means anything
 * @property {(page: import('@cantoo/pdf-lib').PDFPage,
 *            font: import('@cantoo/pdf-lib').PDFFont) => void} draw
 */

/**
 * The fixtures, each a shape where the two engines could plausibly differ.
 *
 * Every string here is written by this file, so nothing from a real document is
 * quoted and the ground truth is a property of the generator rather than of
 * either engine.
 *
 * @type {readonly Fixture[]}
 */
const FIXTURES = [
  {
    name: 'one column, plain prose',
    control: 'agree',
    why: 'the two must agree here, or every disagreement below is this instrument',
    expects: [
      'The first line of an ordinary paragraph.',
      'The second line continues the sentence.',
      'And a third closes it.',
    ],
    draw: (page, font) => {
      const lines = [
        'The first line of an ordinary paragraph.',
        'The second line continues the sentence.',
        'And a third closes it.',
      ];
      lines.forEach((line, index) => {
        page.drawText(line, { x: 40, y: 340 - index * 20, size: 12, font });
      });
    },
  },
  {
    name: 'two columns, 60pt gutter, drawn ROW-major',
    control: 'differ',
    why:
      'reading order is what FZ_STEXT_SEGMENT was turned on for; agreement here would mean ' +
      'the comparison is not discriminating',
    // THE INTERLEAVING IS THE WHOLE FIXTURE, and the first version of it did
    // not have one. Drawing the left column's three lines and then the right
    // column's puts the content stream in column-major order already — so
    // PDF.js, which returns stream order, and MuPDF, which segments into
    // columns, produce the same answer and the case separates nothing. It is
    // the fixture-the-bug-also-handles-correctly shape: nothing about the case
    // looks wrong, and its name says it is covered.
    //
    // Interleaved, the stream is row-major, and only an engine that groups by
    // column can produce column-major reading order from it.
    expects: ['Left column line 1', 'Right column line 3'],
    draw: (page, font) => {
      for (let index = 0; index < 3; index += 1) {
        const y = 340 - index * 20;
        page.drawText(`Left column line ${String(index + 1)}`, { x: 40, y, size: 12, font });
        page.drawText(`Right column line ${String(index + 1)}`, { x: 290, y, size: 12, font });
      }
    },
  },
  {
    name: 'a line broken by a wide intra-line gap',
    control: 'none',
    why: 'whether a gap inside one baseline becomes one run or two',
    expects: ['Invoice number', 'INV-00042'],
    draw: (page, font) => {
      page.drawText('Invoice number', { x: 40, y: 300, size: 12, font });
      page.drawText('INV-00042', { x: 300, y: 300, size: 12, font });
    },
  },
  {
    name: 'tight leading, two baselines 2pt apart',
    control: 'none',
    why: 'whether two near-touching baselines merge into one line',
    expects: ['Upper baseline text', 'Lower baseline text'],
    draw: (page, font) => {
      page.drawText('Upper baseline text', { x: 40, y: 300, size: 10, font });
      page.drawText('Lower baseline text', { x: 40, y: 288, size: 10, font });
    },
  },
  {
    name: 'text rotated 90 degrees',
    control: 'none',
    why: 'a rotated run has no baseline either engine reads the same way',
    expects: ['Rotated running head', 'Upright body text'],
    draw: (page, font) => {
      page.drawText('Rotated running head', {
        x: 60,
        y: 120,
        size: 12,
        font,
        rotate: degrees(90),
      });
      page.drawText('Upright body text', { x: 140, y: 300, size: 12, font });
    },
  },
];

/**
 * One fixture as PDF bytes.
 *
 * @param {(typeof FIXTURES)[number]} fixture
 * @returns {Promise<Uint8Array>}
 */
async function build(fixture) {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  fixture.draw(page, font);
  return document.save();
}

/**
 * The page's text as the KERNEL reads it — the same call `readPageTextJson`
 * makes and the same parser `parsePageText` is, so this is the substrate rather
 * than a second opinion about it.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function kernelText(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    const page = document.loadPage(0);
    return plainTextOf(parsePageText(page.toStructuredText(STEXT_OPTION_STRING).asJSON()));
  } finally {
    document.destroy();
  }
}

/**
 * The page's text as PDF.js reads it.
 *
 * Items joined the way a text layer would present them: PDF.js marks a run that
 * ends a line with `hasEOL`, and everything else runs on. Joining every item
 * with a newline would manufacture disagreement with the substrate's lines, and
 * joining them all with spaces would manufacture agreement on order.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function pdfjsText(bytes) {
  // `standardFontDataUrl` is supplied rather than left to warn. Without it
  // PDF.js cannot load the standard-14 metrics and says so on every call — and
  // a run that could not resolve a font is not a run whose extraction should be
  // compared with anything.
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: false,
    standardFontDataUrl: `${new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href}`,
  });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    let out = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      out += item.str;
      if (item.hasEOL === true) out += '\n';
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/**
 * Collapses runs of whitespace so the comparison is about text, not spacing.
 *
 * @param {string} text
 * @returns {string}
 */
function normalise(text) {
  return text
    .split('\n')
    .map((line) => line.replaceAll(/\s+/gu, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * How far apart two strings are, as edit distance over lines and characters.
 *
 * @param {string} left
 * @param {string} right
 * @returns {{ identical: boolean, leftLines: number, rightLines: number, sameLines: number }}
 */
function compare(left, right) {
  const one = left.split('\n');
  const two = right.split('\n');
  const remaining = [...two];
  let sameLines = 0;
  for (const line of one) {
    const at = remaining.indexOf(line);
    if (at !== -1) {
      sameLines += 1;
      remaining.splice(at, 1);
    }
  }
  return {
    identical: left === right,
    leftLines: one.length,
    rightLines: two.length,
    sameLines,
  };
}

/**
 * The comparison's resolution test.
 *
 * Its reassuring answer is `identical`, and a comparison that returned that for
 * everything would report perfect agreement between any two engines. One
 * character must separate them, and identical inputs must not.
 */
function resolutionTest() {
  const near = compare('alpha\nbravo', 'alpha\nbravl');
  console.log(
    `  one character apart: identical=${String(near.identical)}, ` +
      `${String(near.sameLines)} of ${String(near.leftLines)} lines match`,
  );
  if (near.identical || near.sameLines !== 1) {
    throw new Error(
      'the comparison reports two strings differing by one character as ' +
        `${near.identical ? 'identical' : `${String(near.sameLines)} matching lines`}, so every ` +
        'agreement below would be a fact about this function',
    );
  }
  const same = compare('alpha\nbravo', 'alpha\nbravo');
  console.log(`  identical inputs: identical=${String(same.identical)}`);
  if (!same.identical) throw new Error('the comparison separates two identical strings');
}

async function main() {
  console.log('# Do PDF.js and the kernel substrate agree about a page');
  console.log('');
  console.log(`  pdfjs-dist ${pdfjs.version ?? 'unknown'}, MuPDF via the npm package`);
  console.log(`  substrate options: ${JSON.stringify(STEXT_OPTION_STRING)}`);
  console.log(`  repository: ${root}`);
  console.log('');

  console.log('## 0. The comparison can see a difference that would change a decision');
  refuseStaleSubstrate();
  resolutionTest();
  console.log('');

  /** @type {{ name: string, control: string, identical: boolean }[]} */
  const outcomes = [];

  for (const fixture of FIXTURES) {
    console.log(`## ${fixture.name}`);
    console.log(`   ${fixture.why}`);
    const bytes = await build(fixture);
    const kernel = normalise(kernelText(bytes));
    const viewer = normalise(await pdfjsText(bytes));
    // BOTH READERS MUST CARRY THE FIXTURE'S OWN TEXT, before their agreement
    // or disagreement means anything. This is ground truth from the generator
    // rather than from either engine, so it separates *the two extract
    // differently* from *one of them extracted nothing usable* — which is what
    // a font that failed to resolve would produce, and PDF.js warns on every
    // call here that it cannot fetch standard font data over a file: URL.
    /** @type {readonly [string, string][]} */
    const readers = [
      ['substrate', kernel],
      ['PDF.js', viewer],
    ];
    for (const [label, text] of readers) {
      const missing = fixture.expects.filter((phrase) => !text.includes(phrase));
      if (missing.length > 0) {
        throw new Error(
          `${label} did not extract ${JSON.stringify(missing)} from "${fixture.name}", which ` +
            'this file drew. Whatever it produced is not this page, so comparing it with the ' +
            `other engine measures a broken read.\n  got: ${JSON.stringify(text)}`,
        );
      }
    }

    const result = compare(kernel, viewer);
    outcomes.push({ name: fixture.name, control: fixture.control, identical: result.identical });

    console.log(
      `  identical: ${result.identical ? 'YES' : 'no'} — substrate ${String(result.leftLines)} ` +
        `line(s), PDF.js ${String(result.rightLines)} line(s), ${String(result.sameLines)} shared`,
    );
    if (!result.identical) {
      console.log('  substrate:');
      for (const line of kernel.split('\n')) console.log(`    | ${line}`);
      console.log('  PDF.js:');
      for (const line of viewer.split('\n')) console.log(`    | ${line}`);
    }
    console.log('');
  }

  console.log('## The instrument’s own controls');
  const mustAgree = outcomes.filter((item) => item.control === 'agree');
  const mustDiffer = outcomes.filter((item) => item.control === 'differ');
  for (const item of mustAgree) {
    console.log(`  must agree — ${item.name}: ${item.identical ? 'agreed' : 'DISAGREED'}`);
    if (!item.identical) {
      throw new Error(
        `the two engines disagree on "${item.name}", which is the fixture they must agree on. ` +
          'Every disagreement above is then this instrument rather than the engines — a ' +
          'normalisation difference, a joining rule, or a fixture that draws something else.',
      );
    }
  }
  for (const item of mustDiffer) {
    console.log(`  must differ — ${item.name}: ${item.identical ? 'AGREED' : 'differed'}`);
    if (item.identical) {
      throw new Error(
        `the two engines agree on "${item.name}", where reading order is the whole question and ` +
          'FZ_STEXT_SEGMENT exists to change it. A comparison that cannot separate them there ' +
          'is not discriminating, and the clean results above mean nothing.',
      );
    }
  }
}

await main();
