// @ts-check
/**
 * What `@cantoo/pdf-lib` can CREATE into a document MuPDF wrote, and where it
 * puts it.
 *
 * `docs/ARCHITECTURE.md`:388 assigns *"Form fields: create"* to
 * `@cantoo/pdf-lib` — *"the one concern MuPDF has no API for"* — so the writer
 * is settled and none of this is a B4. What is not settled is anything about
 * what the command can say, and four of the seven questions below decide the
 * payload before a line of it is designed.
 *
 * ## The question this exists for is the RECTANGLE
 *
 * `annotationRectSchema` declares PDF user space, y up, and `toPdf` returns
 * absolute coordinates — it adds `crop.x0` back. `pageAnnotations.ts` measured
 * that MuPDF's `setRect` takes something else entirely: the page's *displayed*
 * space, y down, after rotation, origin at the visible box's corner, so
 * `setRect([10, 20, 110, 70])` on a `/MediaBox [0 0 200 300]` page stores
 * `/Rect [9.5 229.5 110.5 280.5]`.
 *
 * pdf-lib's `addToPage(page, { x, y, width, height })` is a **third** frame,
 * and its declaration says nothing about which. So a create route has a writer
 * in one space and a reader in another with a conversion nobody has measured
 * between them — which is `CLAUDE.md`'s wired-tools blind spot exactly: two
 * halves either side of a boundary, each correct in its own frame, green on
 * both sides, and the field on the wrong part of the page.
 *
 * **It is asked on three page shapes, not one.** An upright page whose boxes
 * start at the origin is the fixture where every candidate answer agrees. A
 * `/Rotate 90` page and a page whose `CropBox` corner is not `(0, 0)` are the
 * two that separate them, and they are the hard shapes item 2 of the stage
 * audit names by name.
 *
 * ## The seven questions
 *
 *   1. **Which of the six types can pdf-lib create at all?** The row names
 *      text, checkbox, radio, dropdown, listbox and signature.
 *      `scripts/research/formFields.mjs` already recorded that pdf-lib's form
 *      API has no signature field and built one by hand; this asks what that
 *      means for a *command*, which cannot carry a hand-built dictionary.
 *   2. **Where does the rectangle land**, raw, against the argument.
 *   3. **What does the READER see** — MuPDF's `getWidgets()`, the walk
 *      `readFormFields` uses, on kind, name, value, options and rect.
 *   4. **Does a create damage fields that were already there?** pdf-lib is the
 *      writer for *create* and MuPDF for *fill* and *delete*, which the matrix
 *      splits deliberately. That split is only safe if a pdf-lib write
 *      preserves what MuPDF wrote — the forms half of the question
 *      `foreignAnnotations.test.ts` pins for annotations.
 *   5. **A document with NO `/AcroForm`.** Most documents have none, so this is
 *      the ordinary case rather than the edge one.
 *   6. **Is the created field visible** without a separate appearance pass, and
 *      does it need a font embedded to be?
 *   7. **Does it survive the round trip back** — MuPDF reopening the byte image
 *      and saving it again, which is what the live session does to every
 *      byte-image command's output.
 *
 * Run:
 *
 *   node scripts/research/formFieldCreate.mjs
 *
 * It prints readings, never a verdict.
 *
 * ## Its own positive controls, and the resolution test
 *
 * Every reading here is a **walk that found something**, so all three failure
 * shapes 4b names are open: a reader pointed at the wrong document, a walk that
 * silently returned nothing, and a comparison satisfied by absence.
 *
 *   - **The empty control.** The same reader is pointed at a document built to
 *     carry no fields at all, and the script refuses to report if it comes back
 *     carrying any. That separates *this walk sees fields* from *this walk sees
 *     whatever it is given*.
 *   - **The calibration row.** One row loads the base document and creates
 *     NOTHING. Its widget count is the floor, and a create row that matches it
 *     moved nothing — which is the reading a broken create produces too.
 *   - **The resolution test, and it is the mandatory one (item 4a).** Two
 *     fields are created one point apart and their rectangles compared. An
 *     instrument that reports them as equal cannot see the difference between
 *     two placements, so it cannot settle question 2 whatever it prints, and
 *     the script throws rather than printing a table nobody can act on.
 */
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

/** The value written into the text field, so ink has something to be. */
const PROBE = 'Xy';

/**
 * Question 9's value, and it is long ON PURPOSE.
 *
 * The first reading there used {@link PROBE}, two nearly square glyphs, and
 * separated upright text from sideways text by 18 by 21 against 22 by 19 — a
 * margin of two or three pixels on a classification, which is narrower than
 * anything a shape observable can carry. A long string clips to a couple of
 * characters in the 24-point direction and lays out fully in the 120-point one,
 * so the two orientations differ by the width of the field rather than by the
 * width of a glyph.
 */
const LONG_PROBE = 'HHHHHHHHHHHHHH';

/**
 * The rectangle every placement question is asked with, as pdf-lib takes it.
 *
 * One box, reused across the three page shapes, so the only thing that varies
 * between those rows is the page — which is what makes the rows comparable at
 * all. Chosen away from the page's edges and away from the origin in both
 * axes: a box at `(0, 0)` cannot tell an offset frame from an unoffset one, and
 * a square box cannot tell a transposed one from an upright one.
 */
const PLACED = { x: 40, y: 500, width: 120, height: 24 };

/**
 * The same box moved by exactly one point, for the resolution test.
 *
 * One point is the smallest difference that could change a decision here: it is
 * the unit `/Rect` is written in, and a placement wrong by less than a point is
 * a placement nobody can see. An instrument that cannot separate these two
 * cannot separate a correct frame from one that is off by a page height either.
 */
const NUDGED = { ...PLACED, x: PLACED.x + 1 };

/**
 * The rectangle question 9 asks every rotation to land on, in PDF user space.
 *
 * **The pre-image of a LANDSCAPE screen drag on the `/Rotate 90` page**, worked
 * through `toPdf` rather than chosen for looking like a form field: a drag from
 * displayed `(100, 100)` to `(220, 124)` — 120 by 24 on screen — converts to
 * user space `(100, 100)` to `(124, 220)`, which is 24 by 120. Portrait.
 *
 * That inversion is the whole reason this question exists, and it is why the
 * first spelling of this row read nothing useful: it passed a landscape
 * user-space rect, which is what a PORTRAIT drag produces, so both readings
 * were about a box turning with the page rather than about content.
 *
 * @type {[number, number, number, number]}
 */
const TARGET = [100, 100, 124, 220];

/**
 * The `addToPage` arguments that land a widget on `rect` when its appearance is
 * turned by `angle`.
 *
 * ## Why this is a candidate rather than a derivation
 *
 * pdf-lib rotates the box **about the anchor point** it was given, so the
 * argument is not the rectangle: measured, `{x: 40, y: 380, width: 24, height:
 * 120}` at 90 degrees writes `/Rect [-80 380 40 404]` — off the page entirely.
 * The four cases below were written from that ONE reading and then checked
 * against all four, which is the point: a formula extrapolated from a single
 * turn is three assumptions, and the instrument prints *lands on the target*
 * per row so a wrong one is visible rather than inferred.
 *
 * `borderWidth` is 0 at every call site, which question 2a is what settles:
 * pdf-lib's default of 1 grows the box by the border and re-centres it, so a
 * rectangle written through the default is the drawn box outset by half a
 * point — a systematic offset nobody asked for.
 *
 * @param {[number, number, number, number]} rect
 * @param {number} angle
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function preImage(rect, angle) {
  const [x0, y0, x1, y1] = rect;
  const width = x1 - x0;
  const height = y1 - y0;
  switch (angle) {
    case 90:
      return { x: x1, y: y0, width: height, height: width };
    case 180:
      return { x: x1, y: y1, width, height };
    case 270:
      return { x: x0, y: y1, width: height, height: width };
    default:
      return { x: x0, y: y0, width, height };
  }
}

/**
 * A page shape, and what makes it a separating one.
 *
 * @typedef {object} Shape
 * @property {string} name
 * @property {[number, number]} size the MediaBox, as pdf-lib's `addPage` takes it
 * @property {number} rotate `/Rotate`, in degrees
 * @property {[number, number, number, number] | null} crop the CropBox, or none
 * @property {string} separates what this shape can tell apart that upright cannot
 */

/** @type {readonly Shape[]} */
const SHAPES = [
  {
    name: 'upright',
    size: [400, 600],
    rotate: 0,
    crop: null,
    separates: 'nothing — this is the shape every candidate answer agrees on',
  },
  {
    name: 'rotate90',
    size: [400, 600],
    rotate: 90,
    crop: null,
    separates: 'a writer that turns the rectangle with the page from one that does not',
  },
  {
    name: 'cropped',
    size: [400, 600],
    rotate: 0,
    // A CORNER AWAY FROM THE ORIGIN IN BOTH AXES, and a different distance in
    // each. Equal offsets would let a frame that swapped the axes read as
    // correct.
    crop: [30, 70, 380, 560],
    separates: 'a rectangle measured from the visible box from one measured from user space',
  },
];

/**
 * A base document **MuPDF wrote**, which is the route rather than a detail.
 *
 * A byte-image command receives the bytes the live MuPDF session serialised, so
 * a fixture pdf-lib both built and read would be answering a question no
 * command ever asks. This builds the page with pdf-lib because that is the only
 * way to get a `/Rotate` and a `/CropBox` set concisely, then passes it through
 * MuPDF's own save so the bytes pdf-lib loads are MuPDF's.
 *
 * @param {Shape} shape
 * @param {boolean} withExistingField whether it already carries a filled field
 * @returns {Promise<Uint8Array>}
 */
async function base(shape, withExistingField) {
  const document = await PDFDocument.create();
  const page = document.addPage(shape.size);
  page.setRotation(degrees(shape.rotate));
  if (shape.crop !== null) {
    const [x0, y0, x1, y1] = shape.crop;
    page.setCropBox(x0, y0, x1 - x0, y1 - y0);
  }
  if (withExistingField) {
    const font = await document.embedFont(StandardFonts.Helvetica);
    const existing = document.getForm().createTextField('existing.text');
    existing.setText('before');
    existing.addToPage(page, { x: 40, y: 100, width: 120, height: 20, font });
  }
  return resaved(await document.save());
}

/** A page carrying nothing at all — the empty control's subject. @returns {Promise<Uint8Array>} */
async function bare() {
  const document = await PDFDocument.create();
  document.addPage([400, 600]);
  return resaved(await document.save());
}

/**
 * Opens with MuPDF and hands the document over, always destroying it.
 *
 * @template T
 * @param {Uint8Array} bytes
 * @param {(document: mupdf.PDFDocument) => T} read
 * @returns {T}
 */
function withMupdf(bytes, read) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the bytes are not a PDF');
  try {
    return read(document);
  } finally {
    document.destroy();
  }
}

/**
 * The same bytes as MuPDF would write them.
 *
 * Question 7's operation, and the base fixture's last step: a plain save, the
 * empty option string, which `mupdfWriter.ts` documents as *no incremental
 * update, no garbage-collection pass*. That is what an ordinary command's
 * serialise does to whatever the previous one left.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function resaved(bytes) {
  return withMupdf(bytes, (document) => new Uint8Array(document.saveToBuffer('').asUint8Array()));
}

/**
 * What MuPDF's widget walk — the one `readFormFields` uses — says about page 0.
 *
 * `getRect` is the reader's frame and the raw `/Rect` below is the file's, and
 * both are printed because question 2 is precisely whether they agree.
 *
 * @param {Uint8Array} bytes
 * @returns {Array<Record<string, unknown>>}
 */
function widgets(bytes) {
  return withMupdf(bytes, (document) =>
    document
      .loadPage(0)
      .getWidgets()
      .map((widget, index) => ({
        index,
        type: widget.getFieldType(),
        name: widget.getName(),
        value: widget.getValue(),
        options: widget.getOptions(),
        // MuPDF's DISPLAYED space, y down and turned by /Rotate — the frame
        // `readRect` converts out of.
        displayed: rounded(widget.getRect()),
      })),
  );
}

/**
 * The `/Rect` entries as they stand IN THE FILE, read through the object API.
 *
 * Deliberately not through `getRect`, which is the reading above: an API that
 * answers in the space its setter takes agrees with itself whichever space you
 * believed you were in, and that is the exact round trip `pageAnnotations.ts`
 * records as unable to catch a frame error. Four numbers off the dictionary
 * cannot do that.
 *
 * @param {Uint8Array} bytes
 * @returns {Array<{ name: string, rect: number[] }>}
 */
function rawRects(bytes) {
  return withMupdf(bytes, (document) => {
    const annots = document.findPage(0).get('Annots');
    if (annots.isNull()) return [];
    /** @type {Array<{ name: string, rect: number[] }>} */
    const found = [];
    for (let index = 0; index < annots.length; index += 1) {
      const annotation = annots.get(index);
      const rect = annotation.get('Rect');
      /** @type {number[]} */
      const numbers = [];
      for (let corner = 0; corner < rect.length; corner += 1) {
        numbers.push(rect.get(corner).asNumber());
      }
      const title = annotation.get('T');
      found.push({ name: title.isNull() ? '(inherited)' : title.asString(), rect: rounded(numbers) });
    }
    return found;
  });
}

/**
 * Ink inside one rectangle, from the page's content stream and its widgets.
 *
 * Question 6's observable, and `showExtras` is ON here for the reason the
 * flatten instrument's is off: this asks whether the field is *drawn at all*,
 * which for an unflattened widget happens in the appearance stream the renderer
 * paints on top. With extras off a correctly created field and an absent one
 * both read zero, which is the comparison satisfied by absence.
 *
 * The box is given in MuPDF's displayed space, because that is the space the
 * pixmap is in at identity scale.
 *
 * @param {Uint8Array} bytes
 * @param {[number, number, number, number]} box
 * @returns {number}
 */
function inkedIn(bytes, box) {
  return withMupdf(bytes, (document) => {
    const pixmap = document
      .loadPage(0)
      .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const stride = pixmap.getStride();
    const samples = pixmap.getPixels();
    const [left, top, right, bottom] = box;
    const firstRow = Math.max(0, Math.floor(top));
    const lastRow = Math.min(height, Math.ceil(bottom));
    const firstColumn = Math.max(0, Math.floor(left));
    const lastColumn = Math.min(width, Math.ceil(right));
    let marked = 0;
    for (let y = firstRow; y < lastRow; y += 1) {
      for (let x = firstColumn; x < lastColumn; x += 1) {
        if ((samples[y * stride + x] ?? 255) < 250) marked += 1;
      }
    }
    return marked;
  });
}

/**
 * The bounding box of the ink inside one displayed rectangle, and its shape.
 *
 * A count of marked pixels cannot tell an upright line of text from the same
 * line lying on its side — both mark the same pixels — so question 9's real
 * observable is the ink's **extent**. `Xy` in Helvetica is about half again as
 * wide as it is tall, so `landscape` is upright text and `portrait` is text
 * turned a quarter turn. That is the comparison the count would have been
 * satisfied by absence of.
 *
 * The pixmap is the page **as displayed** — MuPDF applies `/Rotate` — which is
 * what makes the reading about what a person sees rather than about user space.
 *
 * @param {Uint8Array} bytes
 * @param {[number, number, number, number]} box in MuPDF's displayed space
 * @returns {{ width: number, height: number, shape: string } | null}
 */
function inkExtent(bytes, box) {
  return withMupdf(bytes, (document) => {
    const pixmap = document
      .loadPage(0)
      .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true);
    const stride = pixmap.getStride();
    const samples = pixmap.getPixels();
    const [left, top, right, bottom] = box;
    const firstRow = Math.max(0, Math.floor(top));
    const lastRow = Math.min(pixmap.getHeight(), Math.ceil(bottom));
    const firstColumn = Math.max(0, Math.floor(left));
    const lastColumn = Math.min(pixmap.getWidth(), Math.ceil(right));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = firstRow; y < lastRow; y += 1) {
      for (let x = firstColumn; x < lastColumn; x += 1) {
        if ((samples[y * stride + x] ?? 255) < 250) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX === Infinity) return null;
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return { width, height, shape: width >= height ? 'landscape' : 'portrait' };
  });
}

/**
 * The widget's `/Rect`, its appearance `/BBox` and its `/MK /R`, together.
 *
 * Question 9's observable, and the three have to be read as a set. A rectangle
 * says where the field is and nothing about which way UP its content is drawn:
 * `/MK /R` turns the appearance and `/BBox` records the box that appearance was
 * laid out in. On a `/Rotate 90` page a field placed with none of that has a
 * correct rectangle and text lying on its side, which is a defect the rectangle
 * reading above is structurally unable to report.
 *
 * @param {Uint8Array} bytes
 * @returns {Record<string, unknown>}
 */
function appearanceOf(bytes) {
  return withMupdf(bytes, (document) => {
    const annots = document.findPage(0).get('Annots');
    if (annots.isNull() || annots.length === 0) return { widget: 'none' };
    const widget = annots.get(annots.length - 1);
    const appearance = widget.get('AP').get('N');
    const bbox = appearance.isNull() ? null : appearance.get('BBox');
    const mark = widget.get('MK');
    const turn = mark.isNull() ? null : mark.get('R');
    /** @type {number[]} */
    const box = [];
    if (bbox !== null && !bbox.isNull()) {
      for (let corner = 0; corner < bbox.length; corner += 1) box.push(bbox.get(corner).asNumber());
    }
    return {
      rect: rounded(numbersOf(widget.get('Rect'))),
      bbox: rounded(box),
      mkR: turn === null || turn.isNull() ? null : turn.asNumber(),
    };
  });
}

/**
 * How many bytes the FIRST widget's normal appearance stream holds.
 *
 * Question 4's second observable. A length is a coarse reading and it is the
 * right one here: it cannot say *how* an appearance changed, and it separates
 * *rewritten* from *left alone*, which is the only distinction the decision
 * turns on. The first widget is the pre-existing field in every fixture that
 * calls this, because a create appends.
 *
 * @param {Uint8Array} bytes
 * @returns {number | null}
 */
function appearanceBytes(bytes) {
  return withMupdf(bytes, (document) => {
    const annots = document.findPage(0).get('Annots');
    if (annots.isNull() || annots.length === 0) return null;
    const normal = annots.get(0).get('AP').get('N');
    if (normal.isNull()) return null;
    return normal.readStream().asUint8Array().length;
  });
}

/**
 * A PDF array of numbers as a plain one.
 *
 * @param {mupdf.PDFObject} array
 * @returns {number[]}
 */
function numbersOf(array) {
  /** @type {number[]} */
  const numbers = [];
  if (array.isNull()) return numbers;
  for (let index = 0; index < array.length; index += 1) numbers.push(array.get(index).asNumber());
  return numbers;
}

/**
 * Numbers at a tenth of a point, so a comparison is not defeated by a float.
 *
 * A tenth is two orders below the one-point difference the resolution test
 * turns on, so it cannot round two distinguishable placements together.
 *
 * @param {ArrayLike<number>} numbers
 * @returns {number[]}
 */
function rounded(numbers) {
  return Array.from(numbers, (value) => Math.round(value * 10) / 10);
}

/**
 * Creates one field of a named type into an existing document.
 *
 * Every branch places the SAME rectangle through the type's own `addToPage`, so
 * question 2 is asked once per type rather than once. Six types is six APIs and
 * a mapping written from one of them is five guesses.
 *
 * @param {PDFDocument} document
 * @param {import('@cantoo/pdf-lib').PDFPage} page
 * @param {import('@cantoo/pdf-lib').PDFFont} font
 * @param {string} type
 * @param {{ x: number, y: number, width: number, height: number }} at
 * @returns {void}
 */
function create(document, page, font, type, at) {
  const form = document.getForm();
  const name = `made.${type}`;
  switch (type) {
    case 'text': {
      const field = form.createTextField(name);
      field.setText(PROBE);
      field.addToPage(page, { ...at, font });
      return;
    }
    case 'checkbox': {
      const field = form.createCheckBox(name);
      field.check();
      field.addToPage(page, at);
      return;
    }
    case 'radio': {
      // ONE FIELD, TWO WIDGETS, which is what a radio group is — so a create
      // command for this type places two rectangles and the payload has to be
      // able to say so. Both go in, side by side.
      const field = form.createRadioGroup(name);
      field.addOptionToPage('first', page, { ...at, width: 16, height: 16 });
      field.addOptionToPage('second', page, { ...at, x: at.x + 24, width: 16, height: 16 });
      field.select('first');
      return;
    }
    case 'dropdown': {
      const field = form.createDropdown(name);
      field.addOptions(['Dr', 'Mr', 'Ms']);
      field.select('Dr');
      field.addToPage(page, { ...at, font });
      return;
    }
    case 'listbox': {
      const field = form.createOptionList(name);
      field.addOptions(['English', 'Dutch', 'Welsh']);
      field.select('Dutch');
      field.addToPage(page, { ...at, font });
      return;
    }
    case 'signature': {
      // THE READING, NOT AN OMISSION. pdf-lib's `PDFForm` has no signature
      // factory: `createTextField`, `createCheckBox`, `createDropdown`,
      // `createOptionList`, `createRadioGroup` and `createButton` are the six
      // it declares. `formFields.mjs` built one by hand out of `context.obj`,
      // which a command cannot do without this build writing a field
      // dictionary itself — a second writer for the concern the matrix has
      // just assigned.
      throw new Error('pdf-lib declares no signature field factory');
    }
    default:
      throw new Error(`no create branch for ${type}`);
  }
}

/** The five types with a factory, plus the one without, in the row's order. */
const TYPES = ['text', 'checkbox', 'radio', 'dropdown', 'listbox', 'signature'];

/**
 * Loads, mutates, saves — the byte-image route, once.
 *
 * @param {Uint8Array} bytes
 * @param {(document: PDFDocument, page: import('@cantoo/pdf-lib').PDFPage, font: import('@cantoo/pdf-lib').PDFFont) => void} mutate
 * @param {boolean} appearances whether to run `updateFieldAppearances`
 * @returns {Promise<Uint8Array>}
 */
async function through(bytes, mutate, appearances) {
  const document = await PDFDocument.load(bytes);
  const page = document.getPage(0);
  const font = await document.embedFont(StandardFonts.Helvetica);
  mutate(document, page, font);
  if (appearances) document.getForm().updateFieldAppearances(font);
  return document.save();
}

async function main() {
  console.log('# What pdf-lib can create into a document MuPDF wrote');
  console.log('');

  // ---------------------------------------------------------------- controls
  console.log('## Controls');
  const empty = widgets(await bare());
  if (empty.length !== 0) {
    throw new Error(
      `the empty control read ${String(empty.length)} widgets on a document built with none, so ` +
        `every reading below is this reader answering from somewhere other than the document ` +
        `it was given`,
    );
  }
  console.log('  empty control: a document with no fields reads 0 widgets — the walk can be silent');

  const upright = SHAPES[0];
  if (upright === undefined) throw new Error('the shape table is empty');
  const floor = await base(upright, false);
  const calibration = widgets(
    await through(
      floor,
      () => {
        // DELIBERATELY NOTHING. This row is the floor: a load and a save with no
        // create in between, so a create row that matches its widget count moved
        // nothing — which is the reading a broken create produces too.
      },
      false,
    ),
  );
  console.log(
    `  calibration row: load and save, creating nothing, reads ${String(calibration.length)} widgets`,
  );

  const nudgedBytes = await through(
    floor,
    (document, page, font) => {
      const form = document.getForm();
      // TWO SIBLINGS, and the first spelling of this was two fields where one
      // name was a PREFIX of the other — see question 8. pdf-lib refused it
      // outright, which is the finding rather than an inconvenience.
      const first = form.createTextField('probe.first');
      first.addToPage(page, { ...PLACED, font });
      const second = form.createTextField('probe.second');
      second.addToPage(page, { ...NUDGED, y: NUDGED.y - 40, font });
    },
    false,
  );
  const nudgedRects = rawRects(nudgedBytes);
  const [firstRect, secondRect] = nudgedRects;
  if (firstRect === undefined || secondRect === undefined) {
    throw new Error('the resolution test created two fields and read back fewer than two');
  }
  const separated = firstRect.rect[0] !== secondRect.rect[0];
  if (!separated) {
    throw new Error(
      `the resolution test cannot see one point: ${JSON.stringify(firstRect.rect)} and ` +
        `${JSON.stringify(secondRect.rect)} were placed 1pt apart in x and read back equal, so ` +
        `nothing this script prints about placement can be acted on`,
    );
  }
  console.log(
    `  resolution: two fields placed 1pt apart in x read back at x0 ${String(firstRect.rect[0])} ` +
      `and ${String(secondRect.rect[0])} — the instrument can see one point`,
  );
  console.log('');

  // ------------------------------------------------- 1: which types exist
  console.log('## 1. Which of the six types pdf-lib can create');
  for (const type of TYPES) {
    try {
      const made = await through(
        floor,
        (document, page, font) => create(document, page, font, type, PLACED),
        true,
      );
      const read = widgets(made).filter((widget) => String(widget['name']).startsWith('made.'));
      console.log(`  ${type.padEnd(10)} created; MuPDF reads ${JSON.stringify(read)}`);
    } catch (error) {
      console.log(`  ${type.padEnd(10)} REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('');

  // --------------------------------------------- 2 and 3: where it lands
  console.log('## 2 and 3. Where the rectangle lands, on three page shapes');
  console.log(`   asked with x=${String(PLACED.x)} y=${String(PLACED.y)} w=${String(PLACED.width)} h=${String(PLACED.height)}`);
  console.log(`   so a writer that took the argument verbatim writes /Rect [40 500 160 524]`);
  for (const shape of SHAPES) {
    const bytes = await base(shape, false);
    // THE HALF POINT HAS TO HAVE AN OWNER. The first run read /Rect
    // [39.5 499.5 160.5 524.5] for an argument of [40 500 160 524] — outset by
    // half a point on every side — and two things in this route could have done
    // it: `addToPage`, or the appearance pass that follows it. A figure with no
    // named cause is a guess wearing a measurement's clothes (B6), so both are
    // read and the pair says which.
    const withoutAppearances = await through(
      bytes,
      (document, page, font) => create(document, page, font, 'text', PLACED),
      false,
    );
    const made = await through(
      bytes,
      (document, page, font) => create(document, page, font, 'text', PLACED),
      true,
    );
    // EVERY ENTRY, NOT A FILTERED ONE. The first spelling filtered on a name
    // starting with `made.` and printed an empty list for all three shapes —
    // the reassuring answer, in the instrument's load-bearing question, because
    // pdf-lib puts `/T` on the PARENT field and the widget's own dictionary
    // carries none. A filter on a name the widget does not hold is a search
    // that cannot find anything (4b), and it read exactly like a page with no
    // widgets on it.
    const raw = rawRects(made);
    const read = widgets(made);
    console.log(`  ${shape.name}`);
    console.log(`    separates: ${shape.separates}`);
    console.log(
      `    /Rect, no appearance pass: ${JSON.stringify(rawRects(withoutAppearances).map((entry) => entry.rect))}`,
    );
    console.log(`    /Rect in the file: ${JSON.stringify(raw.map((entry) => entry.rect))}`);
    console.log(`    MuPDF getRect:     ${JSON.stringify(read.map((widget) => widget['displayed']))}`);
  }
  console.log('');

  // -------------------------------------- 2a: who owns the half point
  console.log('## 2a. The half point, and what it scales with');
  console.log('   PDFField.js:258 grows the box by the border width before writing /Rect,');
  console.log('   and rotateRectangle re-centres it — so this is a prediction, not a hunt');
  for (const borderWidth of [0, 1, 2, 6]) {
    const built = await through(
      floor,
      (document, page, font) => {
        const field = document.getForm().createTextField(`border.w${String(borderWidth)}`);
        field.addToPage(page, { ...PLACED, font, borderWidth });
      },
      false,
    );
    const [entry] = rawRects(built);
    console.log(
      `  borderWidth=${String(borderWidth).padEnd(2)} /Rect ${JSON.stringify(entry?.rect ?? null)}`,
    );
  }
  console.log('');

  // ------------------------------- 9: a rotated page turns the CONTENT
  console.log('## 9. What a rotated page does to the appearance, which the rectangle cannot say');
  const turned = SHAPES[1];
  if (turned === undefined) throw new Error('the shape table has no rotated page');
  console.log('   rotate=0 on a /Rotate 90 page lays the content out along user space, so it');
  console.log('   reads sideways; rotate=90 turns it AND MOVES THE RECTANGLE, measured below.');
  console.log('   So the argument is a PRE-IMAGE, and this asks whether one formula inverts');
  console.log('   all four turns or only the one it was derived from.');
  console.log('');
  console.log(`   target rect, in every row: ${JSON.stringify(TARGET)}`);
  console.log(`   value: ${JSON.stringify(LONG_PROBE)} — long, so the two shapes cannot tie`);
  for (const angle of [0, 90, 180, 270]) {
    const argument = preImage(TARGET, angle);
    const built = await through(
      await base(turned, false),
      (document, page, font) => {
        const field = document.getForm().createTextField(`turn.a${String(angle)}`);
        field.setText(LONG_PROBE);
        field.addToPage(page, {
          ...argument,
          font,
          borderWidth: 0,
          rotate: degrees(angle),
        });
      },
      true,
    );
    const shown = appearanceOf(built);
    const landed = Array.isArray(shown['rect']) ? shown['rect'] : [];
    const agrees =
      landed.length === 4 &&
      landed.every((value, index) => Math.abs(value - (TARGET[index] ?? NaN)) < 0.01);
    const displayed = widgets(built).at(-1)?.['displayed'];
    const extent = Array.isArray(displayed)
      ? inkExtent(built, [
          Number(displayed[0]),
          Number(displayed[1]),
          Number(displayed[2]),
          Number(displayed[3]),
        ])
      : null;
    console.log(
      `  rotate=${String(angle).padEnd(3)} argument ${JSON.stringify(argument)} -> ${JSON.stringify(shown)}`,
    );
    console.log(
      `             lands on the target: ${agrees ? 'yes' : 'NO'} · ink as displayed ${JSON.stringify(extent)}`,
    );
  }
  console.log('');

  // ------------------------------------------- 4: what a create preserves
  console.log('## 4. Whether a create preserves a field MuPDF wrote');
  const carrying = await base(upright, true);
  const beforeFill = widgets(carrying);
  const filled = withMupdf(carrying, (document) => {
    const [widget] = document.loadPage(0).getWidgets();
    if (widget === undefined) throw new Error('the base was built with a field and carries none');
    widget.setTextValue('after');
    widget.update();
    return new Uint8Array(document.saveToBuffer('').asUint8Array());
  });
  console.log(`  before the fill: ${JSON.stringify(beforeFill.map((w) => [w['name'], w['value']]))}`);
  console.log(`  after MuPDF filled it: ${JSON.stringify(widgets(filled).map((w) => [w['name'], w['value']]))}`);
  const afterCreate = await through(
    filled,
    (document, page, font) => create(document, page, font, 'text', PLACED),
    true,
  );
  console.log(
    `  after pdf-lib created beside it: ${JSON.stringify(widgets(afterCreate).map((w) => [w['name'], w['value']]))}`,
  );
  // THE VALUE IS NOT THE WHOLE OF WHAT A FIELD IS. `updateFieldAppearances`
  // regenerates the appearance of EVERY field in the form, in the font it is
  // handed — so a create that runs it rewrites the appearance MuPDF wrote for a
  // field this command never named. That is the forms half of the question
  // `foreignAnnotations.test.ts` pins for annotations, and it decides whether
  // the appearance pass may be called at all.
  const withoutPass = await through(
    filled,
    (document, page, font) => create(document, page, font, 'text', PLACED),
    false,
  );
  // AND A ROW THAT DOES REWRITE IT, because the three readings above are
  // otherwise a column that never varies — which is what an observable unable
  // to see the operation prints. This one writes a longer value through pdf-lib
  // and runs the pass, so a length that does not move here means the reading is
  // blind rather than that nothing happened.
  const rewritten = await through(
    filled,
    (document) => {
      document.getForm().getTextField('existing.text').setText('a much longer value than before');
    },
    true,
  );
  console.log(
    `  the existing field's own appearance stream, in bytes:`,
    JSON.stringify({
      beforeAnyCreate: appearanceBytes(filled),
      afterCreateWithoutThePass: appearanceBytes(withoutPass),
      afterCreateWithThePass: appearanceBytes(afterCreate),
      calibrationARewriteThatSHOULDMoveIt: appearanceBytes(rewritten),
    }),
  );
  console.log('');

  // ----------------------------------------------- 5: no /AcroForm at all
  console.log('## 5. A document with no /AcroForm');
  const hadForm = withMupdf(floor, (document) =>
    !document.getTrailer().get('Root').get('AcroForm').isNull(),
  );
  const minted = await through(
    floor,
    (document, page, font) => create(document, page, font, 'text', PLACED),
    true,
  );
  const hasForm = withMupdf(minted, (document) => {
    const form = document.getTrailer().get('Root').get('AcroForm');
    if (form.isNull()) return { present: false, fields: 0, needAppearances: null };
    const fields = form.get('Fields');
    const need = form.get('NeedAppearances');
    return {
      present: true,
      fields: fields.isNull() ? 0 : fields.length,
      needAppearances: need.isNull() ? null : need.asBoolean(),
    };
  });
  console.log(`  the base document has an /AcroForm: ${String(hadForm)}`);
  console.log(`  after the create: ${JSON.stringify(hasForm)}`);
  console.log('');

  // ------------------------------------------------------ 6: is it drawn
  console.log('## 6. Whether the created field is drawn, with and without an appearance pass');
  // A NO-VALUE ROW, BECAUSE THE FIRST READING NEVER VARIED. Both appearance
  // settings answered 720 marked pixels, and an identical number on every row
  // is what an observable that cannot see the operation prints. A field created
  // with no text calibrates it: if that row is lower, the count includes the
  // value and the comparison is real; if it is 720 as well, this is counting
  // the border and nothing else.
  const blankField = await through(
    floor,
    (document, page, font) => {
      const field = document.getForm().createTextField('made.blank');
      field.addToPage(page, { ...PLACED, font });
    },
    false,
  );
  const blankBox = widgets(blankField).at(-1)?.['displayed'];
  if (!Array.isArray(blankBox)) throw new Error('the blank field has no rectangle');
  console.log(
    `  calibration, a field with NO value: ${String(
      inkedIn(blankField, [
        Number(blankBox[0]),
        Number(blankBox[1]),
        Number(blankBox[2]),
        Number(blankBox[3]),
      ]),
    )} marked pixels`,
  );
  for (const appearances of [false, true]) {
    const made = await through(
      floor,
      (document, page, font) => create(document, page, font, 'text', PLACED),
      appearances,
    );
    const read = widgets(made).filter((widget) => String(widget['name']).startsWith('made.'));
    const box = read[0]?.['displayed'];
    if (!Array.isArray(box)) throw new Error('the created field has no rectangle to count ink in');
    const [x0, y0, x1, y1] = box;
    const ink = inkedIn(made, [Number(x0), Number(y0), Number(x1), Number(y1)]);
    console.log(
      `  updateFieldAppearances=${String(appearances)}: ${String(ink)} marked pixels inside the field's own box`,
    );
  }
  console.log('');

  // ------------------------------------------- 7: the round trip back
  console.log('## 7. Whether it survives MuPDF reopening and saving the byte image');
  const made = await through(
    floor,
    (document, page, font) => create(document, page, font, 'text', PLACED),
    true,
  );
  const after = resaved(made);
  console.log(`  as pdf-lib wrote it:  ${JSON.stringify(widgets(made))}`);
  console.log(`  after a MuPDF save:   ${JSON.stringify(widgets(after))}`);
  console.log(`  /Rect after:          ${JSON.stringify(rawRects(after))}`);
  console.log('');

  // ------------------------------------------------- 8: the name is a PATH
  console.log('## 8. What a dot in the name does');
  console.log('   found by the resolution test refusing to build, not by asking');
  /** @type {ReadonlyArray<{ label: string, names: readonly string[] }>} */
  const NAMINGS = [
    { label: 'two siblings', names: ['owner.first', 'owner.second'] },
    { label: 'a name that is a prefix of the other', names: ['owner', 'owner.first'] },
    { label: 'the same name twice', names: ['owner.first', 'owner.first'] },
    { label: 'no dot at all', names: ['plain'] },
  ];
  for (const { label, names } of NAMINGS) {
    try {
      const built = await through(
        floor,
        (document, page, font) => {
          const form = document.getForm();
          let offset = 0;
          for (const name of names) {
            const field = form.createTextField(name);
            field.addToPage(page, { ...PLACED, y: PLACED.y - offset, font });
            offset += 40;
          }
        },
        false,
      );
      const read = widgets(built).map((widget) => widget['name']);
      console.log(`  ${String(label).padEnd(38)} accepted; MuPDF reads ${JSON.stringify(read)}`);
    } catch (error) {
      console.log(
        `  ${String(label).padEnd(38)} REFUSED: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

await main();
