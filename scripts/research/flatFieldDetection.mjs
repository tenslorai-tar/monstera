// @ts-check
/**
 * Whether a heuristic can tell a form field from a table cell on a FLAT page,
 * measured before one is written.
 *
 * ## The row, and the question the row does not ask
 *
 * `docs/FEATURES.md` D5 asks for *heuristic field detection on flat documents*:
 * a scanned or printed form has ruled lines and boxes where fields belong and
 * no `/AcroForm` at all, and the feature offers to create fields on them.
 *
 * The row's difficulty is not finding the lines. It is that **a table looks
 * exactly like a form**: both are rules and boxes with text beside them, and a
 * detector that offers a text field on every cell of a financial table is worse
 * than no detector — a person would have to delete forty fields to keep two.
 *
 * So the question this script asks is not *can lines be found* but **does any
 * feature separate the two populations**. If nothing does, the honest outcome
 * is to withdraw the row with the measurement recorded, which is what happened
 * to deskew.
 *
 * ## Ground truth is a property of the GENERATOR
 *
 * ADR-0034's argument, taken at its word: fixtures whose correct answer is
 * known settle *is this usable* more sharply than real documents whose correct
 * answer nobody has written down. Every candidate below is labelled `field` or
 * `cell` by the code that drew it, so precision and recall are computable
 * rather than eyeballed.
 *
 * Three fixtures, and the third is the one that matters:
 *
 * 1. a flat form — labels, rule lines, tick-box squares
 * 2. a table — a ruled grid with text in the cells
 * 3. **both on one page**, which is what a real invoice or application is
 *
 * Run:
 *
 *   node scripts/research/flatFieldDetection.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own controls
 *
 * **The walk's reassuring answer is *found nothing*** — a wrong device, a page
 * that did not run, a filter keyed on the wrong thing all print an empty list.
 * So the walk is pointed at a fixture with a known number of drawn rectangles
 * first, and the script throws if it cannot see them.
 *
 * **And a separator's reassuring answer is *they differ*.** Two populations
 * drawn by two different code paths can differ for reasons that have nothing to
 * do with being a field or a cell — a different stroke width, say, which this
 * script chose. So every feature is reported for BOTH populations and the
 * fixtures deliberately share their stroke width, colour and font.
 */
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/** One thing the page draws, as the device saw it. */
/**
 * @typedef {object} Drawn
 * @property {'stroke' | 'fill'} how
 * @property {number} x0
 * @property {number} y0
 * @property {number} x1
 * @property {number} y1
 */

/** One thing the page draws, with what the generator says it is. */
/**
 * @typedef {object} Truth
 * @property {'field' | 'cell'} label
 * @property {number} x0
 * @property {number} y0
 * @property {number} x1
 * @property {number} y1
 */

/**
 * EVERY FIXTURE SHARES THESE, and that is the control on the separator.
 *
 * Two populations drawn by two code paths differ for many reasons; if the form
 * used hairlines and the table used 1pt rules, *stroke width separates them*
 * would be true of this script and of nothing else.
 */
const INK = { width: 1, colour: rgb(0, 0, 0), size: 10 };

/**
 * The stroke state `getBounds` is asked for a FILL and for TEXT with.
 *
 * `getBounds` takes one for the stroke's own outset, and a fill has none — but
 * the argument is not optional and `new StrokeState()` with no data throws
 * inside the library. A zero-width state is the honest spelling of *no outset*,
 * and it is shared so the two call sites cannot drift into different ones.
 */
/** Every fixture's page, so the frame conversion has one height to use. */
const PAGE_HEIGHT = 792;

const HAIRLINE = new mupdf.StrokeState({
  lineCap: 'Butt',
  lineJoin: 'Miter',
  lineWidth: 0,
  miterLimit: 10,
  dashPhase: 0,
  dashes: [],
});

/** A flat form: labelled rule lines and tick-box squares, no `/AcroForm`. */
async function flatForm() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  /** @type {Truth[]} */
  const truth = [];

  const labels = ['Full name', 'Address', 'Date of birth', 'Telephone'];
  let y = 700;
  for (const label of labels) {
    page.drawText(`${label}:`, { x: 60, y: y + 4, size: INK.size, font });
    // A RULE LINE, drawn as a line rather than a rectangle — which is what a
    // printed form has and what makes the two populations geometrically
    // different in a way the detector may or may not be able to use.
    page.drawLine({
      start: { x: 150, y },
      end: { x: 540, y },
      thickness: INK.width,
      color: INK.colour,
    });
    truth.push({ label: 'field', x0: 150, y0: y, x1: 540, y1: y });
    y -= 40;
  }

  // TICK BOXES, which are squares — the shape a table cell also has, at a
  // different size. Whether size separates them is one of the questions.
  const options = ['Yes', 'No', 'Not applicable'];
  let x = 150;
  for (const option of options) {
    page.drawRectangle({
      x,
      y,
      width: 12,
      height: 12,
      borderWidth: INK.width,
      borderColor: INK.colour,
    });
    page.drawText(option, { x: x + 18, y: y + 2, size: INK.size, font });
    truth.push({ label: 'field', x0: x, y0: y, x1: x + 12, y1: y + 12 });
    x += 120;
  }

  return { bytes: await document.save(), truth };
}

/** A ruled table with text in its cells, and no fields anywhere. */
async function table() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  /** @type {Truth[]} */
  const truth = [];

  const columns = [60, 200, 340, 480];
  const width = 140;
  const height = 24;
  let y = 700;
  for (let row = 0; row < 8; row += 1) {
    for (const [index, left] of columns.entries()) {
      page.drawRectangle({
        x: left,
        y,
        width,
        height,
        borderWidth: INK.width,
        borderColor: INK.colour,
      });
      // TEXT INSIDE THE CELL, which is the difference a person sees instantly
      // and which the detector may be able to use: a form's rule line has
      // nothing on it, because that is where somebody writes.
      page.drawText(`r${String(row)}c${String(index)}`, {
        x: left + 6,
        y: y + 7,
        size: INK.size,
        font,
      });
      truth.push({ label: 'cell', x0: left, y0: y, x1: left + width, y1: y + height });
    }
    y -= height;
  }

  return { bytes: await document.save(), truth };
}

/**
 * An EMPTY ruled grid — a blank timesheet, an expenses claim, a mileage log.
 *
 * ## The fixture the first three cannot stand in for
 *
 * `table()` has a value in every cell, so *holds text* separates it from a form
 * perfectly — and that separation is a fact about the fixture rather than about
 * tables. A blank grid is the commonest thing on a printed form there is, and
 * it holds no text at all, exactly like the rule line beside it.
 *
 * `rows` is a parameter because the OTHER candidate feature — how many column
 * neighbours a box has — is a function of the table's size, and a threshold
 * that works on an eight-row grid is a threshold a three-row grid walks under.
 *
 * `rowLabels` is the fixture that decides the whole row. A timesheet has
 * *Monday*, *Tuesday* down its left edge, OUTSIDE the grid — so every cell in
 * the first column has a label immediately to its left, which is precisely what
 * makes a rule line a field. If any rule survives this it survives the hard
 * case; if none does, the withdrawal is earned rather than assumed.
 *
 * @param {number} rows
 * @param {{ rowLabels?: boolean }} [options]
 */
async function emptyTable(rows, { rowLabels = false } = {}) {
  const document = await PDFDocument.create();
  const page = document.addPage([612, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  /** @type {Truth[]} */
  const truth = [];

  // A HEADER ROW, because a blank grid on a real form has one — and it is the
  // only text on the page, which is what makes the rest indistinguishable.
  const columns = [60, 200, 340, 480];
  for (const [index, left] of columns.entries()) {
    page.drawText(`Column ${String(index + 1)}`, { x: left + 6, y: 712, size: INK.size, font });
  }

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Total'];
  let y = 700;
  for (let row = 0; row < rows; row += 1) {
    if (rowLabels) {
      // OUTSIDE THE GRID, to its left, which is where a timesheet puts them —
      // and which is geometrically identical to a form's label beside a rule.
      page.drawText(days[row] ?? `Row ${String(row)}`, {
        x: 6,
        y: y + 8,
        size: INK.size,
        font,
      });
    }
    for (const left of columns) {
      page.drawRectangle({
        x: left,
        y,
        width: 140,
        height: 24,
        borderWidth: INK.width,
        borderColor: INK.colour,
      });
      truth.push({ label: 'cell', x0: left, y0: y, x1: left + 140, y1: y + 24 });
    }
    y -= 24;
  }

  return { bytes: await document.save(), truth };
}

/** Both on one page, which is what a real application form is. */
async function mixed() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  /** @type {Truth[]} */
  const truth = [];

  page.drawText('Applicant', { x: 60, y: 740, size: 14, font });
  let y = 700;
  for (const label of ['Full name', 'Address']) {
    page.drawText(`${label}:`, { x: 60, y: y + 4, size: INK.size, font });
    page.drawLine({
      start: { x: 150, y },
      end: { x: 540, y },
      thickness: INK.width,
      color: INK.colour,
    });
    truth.push({ label: 'field', x0: 150, y0: y, x1: 540, y1: y });
    y -= 40;
  }

  page.drawText('Previous employment', { x: 60, y: y - 10, size: 14, font });
  y -= 50;
  const columns = [60, 200, 340, 480];
  for (let row = 0; row < 5; row += 1) {
    for (const [index, left] of columns.entries()) {
      page.drawRectangle({
        x: left,
        y,
        width: 140,
        height: 24,
        borderWidth: INK.width,
        borderColor: INK.colour,
      });
      page.drawText(`r${String(row)}c${String(index)}`, {
        x: left + 6,
        y: y + 7,
        size: INK.size,
        font,
      });
      truth.push({ label: 'cell', x0: left, y0: y, x1: left + 140, y1: y + 24 });
    }
    y -= 24;
  }

  return { bytes: await document.save(), truth };
}

/**
 * Every path the page draws, as bounding boxes in the page's own space.
 *
 * A device rather than a content-stream parse, because the device is MuPDF's
 * own answer to *what does this page draw* and a parser here would be a second
 * opinion about it (B3a) — one that would agree until it met a Form XObject.
 *
 * @param {Uint8Array} bytes
 * @returns {{ drawn: Drawn[], text: Drawn[] }}
 */
function walk(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    const page = document.loadPage(0);
    /** @type {Drawn[]} */
    const drawn = [];
    /** @type {Drawn[]} */
    const text = [];
    const device = new mupdf.Device({
      fillPath: (path, _evenOdd, ctm) => {
        const [x0, y0, x1, y1] = path.getBounds(HAIRLINE, ctm);
        drawn.push({ how: 'fill', x0, y0, x1, y1 });
      },
      strokePath: (path, stroke, ctm) => {
        const [x0, y0, x1, y1] = path.getBounds(stroke, ctm);
        drawn.push({ how: 'stroke', x0, y0, x1, y1 });
      },
    });
    page.run(device, mupdf.Matrix.identity);
    device.close();

    // THE TEXT COMES FROM `toStructuredText` AND NOT FROM THE DEVICE, and that
    // is a correction rather than a preference. `Text.getBounds` answers the
    // FONT's box scaled to the run, not the glyphs' ink: measured on this
    // fixture, a run drawn at x=66 inside a cell spanning 59.5–200.5 reported
    // `[55.69, 66.77, 95.96, 96.23]` — starting four points LEFT of the cell it
    // sits in and four points below its floor. Every containment test against
    // it answered false, for all thirty-two cells, which is the column that
    // never varies. `toStructuredText` answers where the glyphs are, which is
    // the question, and it is MuPDF's own answer to it (B3a).
    const structured = JSON.parse(page.toStructuredText().asJSON());
    for (const block of structured.blocks ?? []) {
      for (const line of block.lines ?? []) {
        const box = line.bbox;
        if (box === undefined) continue;
        text.push({ how: 'fill', x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h });
      }
    }
    return { drawn, text };
  } finally {
    document.destroy();
  }
}

/**
 * How many other drawn boxes share this one's left and right edges.
 *
 * THE PROPOSED DISCRIMINATOR. A table cell sits in a grid: its column
 * neighbours share both x-edges exactly, and there are as many of them as the
 * table has rows. A form's rule lines are each their own width, because each
 * follows a label of its own length.
 *
 * @param {Drawn} candidate
 * @param {Drawn[]} all
 * @returns {number}
 */
function columnSiblings(candidate, all) {
  /**
   * @param {number} a
   * @param {number} b
   */
  const near = (a, b) => Math.abs(a - b) < 1;
  return all.filter(
    (other) =>
      other !== candidate &&
      near(other.x0, candidate.x0) &&
      near(other.x1, candidate.x1) &&
      Math.abs(other.y0 - candidate.y0) > 1,
  ).length;
}

/**
 * Whether any text sits INSIDE this box.
 *
 * The second proposed discriminator, and the one a person uses: a table cell
 * holds its value, and a form's rule line is empty because that is where
 * somebody writes.
 *
 * @param {Drawn} candidate
 * @param {Drawn[]} text
 * @returns {boolean}
 */
function holdsText(candidate, text) {
  return text.some(
    (glyph) =>
      glyph.x0 > candidate.x0 - 1 &&
      glyph.x1 < candidate.x1 + 1 &&
      glyph.y0 > candidate.y0 - 1 &&
      glyph.y1 < candidate.y1 + 1,
  );
}

/**
 * Whether a text run sits immediately to this box's LEFT, on its own line.
 *
 * THE FEATURE A PERSON ACTUALLY USES. *Full name:* beside a rule is what makes
 * it a field; a grid's headings sit **above** a column, not beside every cell.
 * It is measured because the two features above are geometric and this one is
 * about layout, and a negative result from geometry alone would not have earned
 * a withdrawal.
 *
 * @param {Drawn} candidate
 * @param {Drawn[]} text
 * @returns {boolean}
 */
function labelledLeft(candidate, text) {
  const middle = (candidate.y0 + candidate.y1) / 2;
  return text.some(
    (run) =>
      run.x1 <= candidate.x0 + 1 &&
      candidate.x0 - run.x1 < 60 &&
      run.y0 - 6 <= middle &&
      run.y1 + 6 >= middle,
  );
}

/**
 * Whether a text run sits immediately to this box's RIGHT, on its own line.
 *
 * A TICK BOX'S LABEL IS ON THE OTHER SIDE. `☐ Yes` puts the word right of the
 * square, which is why the left-hand rule alone scores 0.57 on a form carrying
 * both shapes — it finds the four rule lines and none of the three boxes.
 *
 * @param {Drawn} candidate
 * @param {Drawn[]} text
 * @returns {boolean}
 */
function labelledRight(candidate, text) {
  const middle = (candidate.y0 + candidate.y1) / 2;
  return text.some(
    (run) =>
      run.x0 >= candidate.x1 - 1 &&
      run.x0 - candidate.x1 < 60 &&
      run.y0 - 6 <= middle &&
      run.y1 + 6 >= middle,
  );
}

/**
 * What the generator says this drawn box is, or `null` for something neither.
 *
 * Matched by geometry with a tolerance, because a stroked rectangle's bounds
 * include half its stroke width on every side — so the device's numbers are
 * never the generator's exactly, and a comparison demanding equality would
 * label nothing and report a perfect absence of both populations.
 *
 * @param {Drawn} candidate
 * @param {Truth[]} truth
 * @returns {'field' | 'cell' | null}
 */
function labelOf(candidate, truth) {
  const found = truth.find(
    (entry) =>
      Math.abs(entry.x0 - candidate.x0) < 3 &&
      Math.abs(entry.x1 - candidate.x1) < 3 &&
      Math.abs(entry.y0 - candidate.y0) < 3 &&
      Math.abs(entry.y1 - candidate.y1) < 3,
  );
  return found?.label ?? null;
}

/**
 * The generator's rectangle, in the frame the DEVICE reports.
 *
 * ## The join was broken and the instrument said so, which is the point
 *
 * The first run matched **0 of 61** shapes across three fixtures and scored
 * every population `n/a` — a clean table of nothing, which is exactly what a
 * detector that separates nothing would also print. It was caught because the
 * report prints matched and unmatched counts side by side rather than only the
 * score; without that line, `precision n/a` reads as *the rule decided nothing*
 * rather than *the join is broken*.
 *
 * The cause is the frame. `pdf-lib` draws in PDF user space, y up from the
 * bottom; MuPDF's device reports in the page's display space, y **down** from
 * the top, so a rectangle at `y=700` on a 792-point page arrives at `y=68` and
 * its two edges have swapped roles.
 *
 * @param {Truth} entry
 * @param {number} height the page's height in points
 * @returns {Truth}
 */
function asDrawn(entry, height) {
  return {
    label: entry.label,
    x0: entry.x0,
    x1: entry.x1,
    y0: height - entry.y1,
    y1: height - entry.y0,
  };
}

/**
 * @param {string} name
 * @param {{ bytes: Uint8Array, truth: Truth[] }} fixture
 */
function report(name, fixture) {
  const { drawn, text } = walk(fixture.bytes);
  console.log(`## ${name}`);
  console.log(`  the generator drew ${String(fixture.truth.length)} labelled shapes`);
  console.log(`  the device saw ${String(drawn.length)} path(s) and ${String(text.length)} text run(s)`);

  const truth = fixture.truth.map((entry) => asDrawn(entry, PAGE_HEIGHT));
  const rows = drawn.map((candidate) => ({
    label: labelOf(candidate, truth),
    width: Math.round(candidate.x1 - candidate.x0),
    height: Math.round(candidate.y1 - candidate.y0),
    siblings: columnSiblings(candidate, drawn),
    holdsText: holdsText(candidate, text),
    labelled: labelledLeft(candidate, text),
    labelledEither: labelledLeft(candidate, text) || labelledRight(candidate, text),
  }));

  const unlabelled = rows.filter((row) => row.label === null).length;
  console.log(`  matched to the generator: ${String(rows.length - unlabelled)}, unmatched: ${String(unlabelled)}`);

  for (const population of /** @type {const} */ (['field', 'cell'])) {
    const of = rows.filter((row) => row.label === population);
    if (of.length === 0) continue;
    const siblings = of.map((row) => row.siblings);
    const holding = of.filter((row) => row.holdsText).length;
    console.log(
      `  ${population}: ${String(of.length)} · column siblings ${String(Math.min(...siblings))}–${String(Math.max(...siblings))}` +
        ` · holds text ${String(holding)}/${String(of.length)}` +
        ` · labelled left ${String(of.filter((row) => row.labelled).length)}/${String(of.length)}` +
        ` · heights ${String(Math.min(...of.map((row) => row.height)))}–${String(Math.max(...of.map((row) => row.height)))}`,
    );
  }
  console.log('');
  return rows;
}

async function main() {
  console.log('# Can a heuristic tell a form field from a table cell on a flat page');
  console.log('');

  // ------------------------------------------------ the walk's own control
  console.log('## 0. The device can see, before any silence below means anything');
  const control = await table();
  const seen = walk(control.bytes);
  console.log(`  first drawn box: ${JSON.stringify(seen.drawn[0])}`);
  console.log(`  first text run:  ${JSON.stringify(seen.text[0])}`);
  if (seen.drawn.length === 0) {
    throw new Error(
      'the device walked a page carrying 32 drawn rectangles and reported none, so every ' +
        'reading below would be this script being broken rather than a fact about detection',
    );
  }
  console.log(
    `  a page with ${String(control.truth.length)} drawn rectangles reports ` +
      `${String(seen.drawn.length)} path(s) — the walk can see`,
  );
  console.log('');

  const form = report('1. A flat form: rule lines and tick boxes', await flatForm());
  const grid = report('2. A table: a ruled grid with text in the cells', control);
  const both = report('3. Both on one page, which is the real case', await mixed());
  const blankLong = report('4. An EMPTY eight-row grid — a blank timesheet', await emptyTable(8));
  const blankShort = report('5. The same grid with THREE rows', await emptyTable(3));
  const timesheet = report(
    '6. A blank TIMESHEET — an empty grid with a label left of every first cell',
    await emptyTable(7, { rowLabels: true }),
  );

  /** @type {[string, ReturnType<typeof report>][]} */
  const fixtures = [
    ['flat form', form],
    ['filled table', grid],
    ['mixed', both],
    ['empty grid, 8 rows', blankLong],
    ['empty grid, 3 rows', blankShort],
    ['blank timesheet', timesheet],
  ];

  // ------------------------------------------- each candidate feature alone
  console.log('## 7. Each candidate rule, scored against the generator');
  console.log('   Scored SEPARATELY, because a rule of two clauses that scores well can be');
  console.log('   one clause working and one doing harm, and the combination hides which.');
  /**
   * @type {[string, (row: { siblings: number, holdsText: boolean, labelled: boolean,
   *   labelledEither: boolean, height: number }) => boolean][]}
   */
  const rules = [
    ['holds no text', (row) => !row.holdsText],
    ['fewer than 3 column siblings', (row) => row.siblings < 3],
    ['a label immediately to its left', (row) => row.labelled],
    ['a label on EITHER side', (row) => row.labelledEither],
    ['it is a LINE rather than a box (height < 3)', (row) => row.height < 3],
    ['no text AND a label on either side', (row) => !row.holdsText && row.labelledEither],
    [
      'no text, a label on either side, and under 3 column siblings',
      (row) => !row.holdsText && row.labelledEither && row.siblings < 3,
    ],
  ];
  for (const [ruleName, decide] of rules) {
    console.log(`  RULE: ${ruleName}`);
    for (const [name, rows] of fixtures) {
      const decided = rows.filter((row) => row.label !== null);
      const called = decided.filter(decide);
      const right = called.filter((row) => row.label === 'field').length;
      const fields = decided.filter((row) => row.label === 'field').length;
      console.log(
        `    ${name.padEnd(20)} called ${String(called.length).padStart(3)}` +
          ` · correct ${String(right).padStart(3)}` +
          ` · of ${String(fields).padStart(3)} real` +
          ` · precision ${called.length === 0 ? ' n/a' : (right / called.length).toFixed(2)}` +
          ` · recall ${fields === 0 ? ' n/a' : (right / fields).toFixed(2)}`,
      );
    }
  }
}

await main();
