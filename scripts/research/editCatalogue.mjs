// @ts-check
/**
 * The catalogue of difficult pages for Edit text (cloud run 22, Part 1): one shape per file, each built here at test
 * time from this repository's own words and freely licensed fonts, with a manifest saying what each file tests, its
 * blocks, and what an edit must and must not do. `scripts/lib/editExpectations.mjs` is the check a later test runs
 * after an edit; `scripts/proofs/editCatalogue.proof.mjs` proves each file is the shape it claims and that every
 * expectation can go red.
 *
 * ## Why every page is written by hand
 *
 * A difficult page is difficult because of HOW its text is drawn — one text object or many, a font drawn as pictures,
 * text inside a form drawn twice, a clip, a rotation — and a layout library chooses all of that for its caller. So each
 * shape writes its own content stream, and every font comes from the one font-kind builder (`fontKindFixtures.mjs`,
 * B3a), which reads each font file's own tables.
 *
 * ## The fonts, and their licences
 *
 * None is committed; each is on any machine that builds this repository. Liberation Sans (SIL OFL 1.1) and PDFium's
 * serif CFF (BSD-3) from `pdfjs-dist`; URW Nimbus Roman (SIL OFL 1.1), Noto Naskh Arabic and Noto Serif Hebrew (SIL OFL
 * 1.1) and Droid Sans Fallback (Apache 2.0, its `NOTICE` beside it) from the MuPDF source the MuPDF provisioning extracts
 * under `.tools`; and the standard 14, which no file embeds.
 *
 * ## Variants: one generator makes the page and every damaged copy of it
 *
 * `build(variant)` makes the page as it is, or as an edit would leave it. An `edit` replaces a block's lines — the
 * correct result of a person's edit, which the expectation check must pass. The damaged results it must fail are made
 * the same way, so they differ from the correct one by the damage alone: a neighbour `move`d, a word `invisible`, a
 * word missing from the edit's lines, and an `omit`ted block or drawing, which is also how the spread of a block's
 * anti-aliasing is measured.
 *
 * Usage: import { SHAPES, buildShape, manifest } from './editCatalogue.mjs'
 *        node scripts/research/editCatalogue.mjs <directory>   writes every file and manifest.json there
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';

import { isMain } from '../lib/isMain.mjs';
import { cidFontOf, drawnFontOf, fontOfKind, urwDirectory } from './fontKindFixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const PDFJS_FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');

/** MuPDF's own font resources, beside the URW fonts `urwDirectory` finds. */
function mupdfFonts() {
  return resolve(urwDirectory(), '..', '..');
}

/**
 * @typedef {{ left: number, bottom: number, right: number, top: number }} Box
 * @typedef {{ ref: import('@cantoo/pdf-lib').PDFRef, show: (text: string) => string, width: (text: string) => number,
 *   ascent: number, descent: number, kind: string, rtl?: boolean, visual?: (text: string) => string }} Face
 * @typedef {{ text: string, face?: Face, normal?: boolean, size?: number, rise?: number, colour?: [number, number, number], render?: number }} Segment
 * @typedef {string | Segment[]} Line
 * @typedef {{ edit?: { block: string, lines: Line[] }, move?: { block: string, dx: number, dy: number },
 *   omit?: string, invisible?: { block: string, word: string }, drawn?: { block: string, word: string } }} Variant
 * @typedef {{ id: string, role: string, text: string, box: Box, angle: number, face: string, visible: boolean,
 *   form?: string }} Block
 * @typedef {{ id: string, role: string, box: Box }} Drawing
 */

/** @param {number} n */
const f = (n) => String(Math.round(n * 1000) / 1000);

/** The text of a line, segments joined. @param {Line} line */
const textOf = (line) => (typeof line === 'string' ? line : line.map((segment) => segment.text).join(''));

/** @param {[number, number]} point @param {number} angle degrees @returns {[number, number]} */
function turned([x, y], angle) {
  const r = (angle * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

/**
 * One page's content as it is written: its fonts and pictures by resource name, its operators, and the blocks and
 * drawings it declares. A form's content is a sheet of its own, with its own resources.
 */
class Sheet {
  /** @param {PDFDocument} doc @param {Variant} variant */
  constructor(doc, variant) {
    this.doc = doc;
    this.variant = variant;
    /** @type {Map<Face, string>} */
    this.fonts = new Map();
    /** @type {Record<string, import('@cantoo/pdf-lib').PDFRef>} */
    this.xobjects = {};
    /** @type {string[]} */
    this.ops = [];
    /** @type {Block[]} */
    this.blocks = [];
    /** @type {Drawing[]} */
    this.drawings = [];
    /** An ordinary font, for a new word on a page that has none. @type {Face | null} */
    this.normal = null;
  }

  /** @param {Face} face */
  font(face) {
    // A FACE WITH NO FONT OBJECT writes a page whose text every engine still reads, through a default font: the shape
    // would be missing and its read-back would pass. Measured on this module's first run, 2026-10-26.
    if (face.ref === undefined) throw new Error(`the face “${face.kind}” has no font object`);
    let name = this.fonts.get(face);
    if (name === undefined) {
      name = `F${String(this.fonts.size + 1)}`;
      this.fonts.set(face, name);
    }
    return name;
  }

  resources() {
    return {
      Font: Object.fromEntries([...this.fonts].map(([face, name]) => [name, face.ref])),
      ...(Object.keys(this.xobjects).length > 0 ? { XObject: this.xobjects } : {}),
    };
  }

  /** @param {string} ops */
  raw(ops) {
    this.ops.push(ops);
  }

  /**
   * A drawing — a path, a picture — that belongs to `role`, unless the variant omits it.
   * @param {string} id @param {string} role @param {Box} box @param {string} ops
   */
  draw(id, role, box, ops) {
    this.drawings.push({ id, role, box });
    if (this.variant.omit !== id) this.ops.push(ops);
  }

  /**
   * A grey or colour picture placed at `box`, registered as an image XObject.
   * @param {string} id @param {string} role @param {Box} box
   * @param {{ width: number, height: number, channels: 1 | 3, pixel: (x: number, y: number) => number[] }} picture
   */
  image(id, role, box, picture) {
    const bytes = new Uint8Array(picture.width * picture.height * picture.channels);
    for (let y = 0; y < picture.height; y += 1) {
      for (let x = 0; x < picture.width; x += 1) {
        picture.pixel(x, y).forEach((value, c) => {
          bytes[(y * picture.width + x) * picture.channels + c] = value;
        });
      }
    }
    const name = `Im${String(Object.keys(this.xobjects).length + 1)}`;
    this.xobjects[name] = this.doc.context.register(
      this.doc.context.flateStream(bytes, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: picture.width,
        Height: picture.height,
        ColorSpace: picture.channels === 1 ? 'DeviceGray' : 'DeviceRGB',
        BitsPerComponent: 8,
      }),
    );
    this.draw(id, role, box, `q ${f(box.right - box.left)} 0 0 ${f(box.top - box.bottom)} ${f(box.left)} ${f(box.bottom)} cm /${name} Do Q`);
  }

  /**
   * A block of text: its lines from a first baseline at (x, y), each `leading` below the last in the block's own
   * direction, written as one text object per line or as one for the block. Returns where its lines sit.
   *
   * @param {{ id: string, role: string, face: Face, size: number, x: number, y: number, leading?: number, lines: Line[],
   *   angle?: number, perObject?: 'line' | 'block', align?: 'left' | 'right' | 'justify', measure?: number,
   *   visible?: boolean, render?: number, colour?: [number, number, number], form?: string, prefix?: string }} spec
   */
  paragraph(spec) {
    const { id, face, size, angle = 0, perObject = 'line', align = 'left', render = 0 } = spec;
    const leading = spec.leading ?? size * 1.25;
    const variant = this.variant;
    let lines = variant.edit?.block === id ? variant.edit.lines : spec.lines;
    // A SEGMENT MARKED `normal` is a new word as the owner's rule sets it where the page has no ordinary font: in one.
    // Resolved FIRST, so a damage below (a word made invisible or drawn) is applied to what the edit wrote.
    lines = lines.map((line) =>
      typeof line === 'string'
        ? line
        : line.map(({ normal, ...segment }) => {
            if (normal !== true) return segment;
            if (this.normal === null) throw new Error('a segment asks for an ordinary font and the sheet was given none');
            return { ...segment, face: this.normal };
          }),
    );
    const [mx, my] = variant.move?.block === id ? [variant.move.dx, variant.move.dy] : [0, 0];
    const x = spec.x + mx;
    const y = spec.y + my;
    /** Every line split at `word`, the word changed by `change`, the rest as it was. @param {string} word @param {(segment: Segment) => Segment} change */
    const marked = (word, change) =>
      lines.map((line) =>
        (typeof line === 'string' ? [{ text: line }] : line).flatMap((segment) => {
          const at = segment.text.indexOf(word);
          if (at < 0) return [segment];
          return [{ ...segment, text: segment.text.slice(0, at) }, change({ ...segment, text: word }), { ...segment, text: segment.text.slice(at + word.length) }].filter(
            (part) => part.text !== '',
          );
        }),
      );
    // THE WORD WRITTEN INVISIBLE, in render mode 3; or DRAWN, in a Type 3 font made from Liberation Sans' outlines.
    if (variant.invisible?.block === id) lines = marked(variant.invisible.word, (segment) => ({ ...segment, render: 3 }));
    if (variant.drawn?.block === id) {
      const word = variant.drawn.word;
      const made = drawnFontOf(this.doc, readFileSync(join(PDFJS_FONTS, 'LiberationSans-Regular.ttf')), [...new Set(word)]);
      const drawn = { ref: made.font, show: made.show, width: made.width, ascent: 760, descent: -220, kind: 'Type 3, drawn from Liberation Sans' };
      lines = marked(word, (segment) => ({ ...segment, face: drawn }));
    }
    const segmentsOf = (/** @type {Line} */ line) => (typeof line === 'string' ? [{ text: line }] : line);
    const widthOf = (/** @type {Segment} */ segment) => {
      const used = segment.face ?? face;
      const text = used.visual === undefined ? segment.text : used.visual(segment.text);
      return (used.width(text) * (segment.size ?? size)) / 1000;
    };
    const natural = lines.map((line) => segmentsOf(line).reduce((total, segment) => total + widthOf(segment), 0));
    const measure = spec.measure ?? Math.max(...natural);
    let top = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    /** @type {string[]} */
    const written = [];
    lines.forEach((line, k) => {
      const segments = segmentsOf(line);
      const spaces = segments.reduce((total, segment) => total + ((segment.face ?? face).rtl ? 0 : segment.text.split(' ').length - 1), 0);
      // JUSTIFIED by word spacing, as a word processor writes it; the paragraph's last line is set as it falls.
      const tw = align === 'justify' && k < lines.length - 1 && spaces > 0 ? (measure - (natural[k] ?? 0)) / spaces : 0;
      const width = (natural[k] ?? 0) + tw * spaces;
      const start = align === 'right' ? measure - width : 0;
      const baseline = -k * leading;
      left = Math.min(left, start);
      right = Math.max(right, start + width);
      for (const segment of segments) {
        const used = segment.face ?? face;
        const s = segment.size ?? size;
        top = Math.max(top, baseline + (segment.rise ?? 0) + (used.ascent * s) / 1000);
        bottom = Math.min(bottom, baseline + (segment.rise ?? 0) + (used.descent * s) / 1000);
      }
      // A RIGHT-TO-LEFT LINE IS WRITTEN IN DRAWING ORDER, as producers write it: its segments, and each one's letters,
      // last first.
      const ordered = face.rtl ? [...segments].reverse() : segments;
      const shows = ordered.map((segment) => {
        const used = segment.face ?? face;
        const text = used.visual === undefined ? segment.text : used.visual(segment.text);
        const colour = segment.colour ?? spec.colour ?? [0, 0, 0];
        return (
          `/${this.font(used)} ${f(segment.size ?? size)} Tf ${f(segment.rise ?? 0)} Ts ${segment.render ?? render} Tr ` +
          `${colour.map((c) => f(c)).join(' ')} rg ${used.show(text)} Tj`
        );
      });
      written.push(`${f(tw)} Tw ${shows.join(' ')}`);
    });
    const [cos, sin] = turned([1, 0], angle);
    /**
     * A point in the block's own space (its first baseline's start at 0,0) in page space.
     * @param {number} px @param {number} py @returns {[number, number]}
     */
    const place = (px, py) => {
      const [tx, ty] = turned([px, py], angle);
      return [x + tx, y + ty];
    };
    const corners = [place(left, top), place(right, top), place(left, bottom), place(right, bottom)];
    const box = {
      left: Math.min(...corners.map(([cx]) => cx)),
      right: Math.max(...corners.map(([cx]) => cx)),
      bottom: Math.min(...corners.map(([, cy]) => cy)),
      top: Math.max(...corners.map(([, cy]) => cy)),
    };
    this.blocks.push({
      id,
      role: spec.role,
      text: lines.map(textOf).join('\n'),
      box,
      angle,
      face: face.kind,
      visible: (spec.visible ?? true) && render !== 3,
      ...(spec.form === undefined ? {} : { form: spec.form }),
    });
    if (variant.omit === id) return box;
    const matrix = (/** @type {number} */ k) => {
      const [ox, oy] = place(0, -k * leading);
      return `${f(cos)} ${f(sin)} ${f(-sin)} ${f(cos)} ${f(ox)} ${f(oy)} Tm`;
    };
    const prefix = spec.prefix ?? '';
    if (perObject === 'block') {
      const steps = written.map((each, k) => {
        const start = align === 'right' ? measure - ((natural[k] ?? 0)) : 0;
        return k === 0 ? `${matrix(0)} ${f(start)} 0 Td ${each}` : `${f(start - (align === 'right' ? measure - (natural[k - 1] ?? 0) : 0))} ${f(-leading)} Td ${each}`;
      });
      this.ops.push(`${prefix}BT ${steps.join('\n')} ET`);
    } else {
      written.forEach((each, k) => {
        const start = align === 'right' ? measure - (natural[k] ?? 0) : 0;
        this.ops.push(`${prefix}BT ${matrix(k)} ${f(start)} 0 Td ${each} ET`);
      });
    }
    return box;
  }

  content() {
    return this.ops.join('\n');
  }
}

/**
 * A document and the faces its shapes draw with, each made once per document.
 */
async function documentOf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  /** @type {Map<string, Face>} */
  const made = new Map();
  /**
   * @param {string} key @param {() => Face | Promise<Face>} make
   * @returns {Promise<Face>}
   */
  const once = async (key, make) => {
    const known = made.get(key);
    if (known !== undefined) return known;
    const face = await make();
    made.set(key, face);
    return face;
  };
  /** @param {keyof typeof StandardFonts} name @param {string} kind */
  const standard = (name, kind) =>
    once(name, async () => {
      const font = await doc.embedFont(StandardFonts[name]);
      const descent = name.startsWith('Courier') ? -250 : -220;
      // A CHARACTER AT A TIME: pdf-lib's width of a run applies the font's kerning pairs, and a `Tj` draws none, so a
      // whole-run width left the last letter of a line outside its block (measured 2026-10-26, half a point on a line).
      const width = (/** @type {string} */ text) => [...text].reduce((total, c) => total + font.widthOfTextAtSize(c, 1000), 0);
      return { ref: font.ref, show: (text) => font.encodeText(text).toString(), width, ascent: 760, descent, kind };
    });
  const faces = {
    helvetica: () => standard('Helvetica', 'Type 1, standard 14, not embedded (Helvetica)'),
    helveticaBold: () => standard('HelveticaBold', 'Type 1, standard 14, not embedded (Helvetica-Bold)'),
    times: () => standard('TimesRoman', 'Type 1, standard 14, not embedded (Times-Roman)'),
    courier: () => standard('Courier', 'Type 1, standard 14, not embedded (Courier)'),
    symbol: () => standard('Symbol', 'Type 1, standard 14, not embedded (Symbol)'),
    /** One of `fontKindFixtures.mjs`' kinds, keeping the glyphs of `used`. @param {string} kind @param {string} used */
    ofKind: async (/** @type {string} */ kind, /** @type {string} */ used) =>
      once(`${kind}:${used}`, async () => {
        const helvetica = await doc.embedFont(StandardFonts.Helvetica);
        const { font, show, width } = fontOfKind(doc, kind, [...new Set(used)], helvetica);
        return { ref: font, show, width, ascent: 800, descent: -220, kind };
      }),
    /** A font file embedded as Type0. @param {string} file @param {string} name @param {string} used @param {Partial<Face>} more @param {(c: string) => string} [unicodeOf] */
    cid: async (/** @type {string} */ file, /** @type {string} */ name, /** @type {string} */ used, /** @type {Partial<Face>} */ more, /** @type {((c: string) => string) | undefined} */ unicodeOf) =>
      once(`cid:${name}`, () => {
        const { font, show, width } = cidFontOf(doc, readFileSync(file), { name, used: [...new Set(used)], subset: true, ...(unicodeOf === undefined ? {} : { unicodeOf }) });
        return { ref: font, show, width, ascent: 900, descent: -300, kind: `Type0, embedded subset (${name})`, ...more };
      }),
    /** A Type 3 font drawn from a TrueType font's outlines. @param {string} file @param {string} used @param {string} name */
    drawn: async (/** @type {string} */ file, /** @type {string} */ used, /** @type {string} */ name) =>
      once(`drawn:${name}`, () => {
        const { font, show, width } = drawnFontOf(doc, readFileSync(file), [...new Set(used)]);
        return { ref: font, show, width, ascent: 760, descent: -220, kind: `Type 3, drawn from ${name}` };
      }),
  };
  return { doc, faces };
}

/**
 * A page added to `doc` with `sheet`'s content and resources, and page-level entries.
 * @param {PDFDocument} doc @param {Sheet} sheet @param {Record<string, unknown>} [entries]
 */
function pageOf(doc, sheet, entries = {}) {
  const page = doc.addPage([612, 792]);
  page.node.set(PDFName.of('Resources'), doc.context.obj(sheet.resources()));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(sheet.content())));
  for (const [key, value] of Object.entries(entries)) page.node.set(PDFName.of(key), doc.context.obj(/** @type {any} */ (value)));
  return page;
}

/** A form XObject from a sheet, its bounding box `bbox`. @param {PDFDocument} doc @param {Sheet} sheet @param {number[]} bbox */
function formOf(doc, sheet, bbox) {
  return doc.context.register(
    doc.context.flateStream(sheet.content(), { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: doc.context.obj(sheet.resources()) }),
  );
}

// ------------------------------------------------------------------------------------------------- words and scripts

/** Our own words, a paragraph's worth, in lines that fit a 400-point measure at 12 points in Helvetica. */
const PARAGRAPH = [
  'The garden club meets on the first Monday of each month,',
  'in the hall beside the library, from seven until nine.',
  'Bring a cutting, a seed packet or a question about soil,',
  'and leave with a plant someone else has grown for you.',
];
const BELOW = ['Members who cannot come may send their cuttings with a friend,', 'labelled with the name and how each likes to be watered.'];

/** Arabic letters this catalogue writes: isolated, final, initial, medial presentation forms (U+FExx); two forms for a letter that joins only to the right. */
const ARABIC = /** @type {Record<string, number[]>} */ ({
  'ا': [0xfe8d, 0xfe8e],
  'ب': [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  'ت': [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  'ج': [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  'د': [0xfea9, 0xfeaa],
  'ر': [0xfead, 0xfeae],
  'س': [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  'ك': [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  'م': [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  'ن': [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  'و': [0xfeed, 0xfeee],
  'ي': [0xfef1, 0xfef2, 0xfef3, 0xfef4],
});
/** The base letter each presentation form means, for ToUnicode. */
const ARABIC_BASE = new Map(Object.entries(ARABIC).flatMap(([letter, forms]) => forms.map((form) => [String.fromCodePoint(form), letter])));

/**
 * An Arabic run shaped to presentation forms in DRAWING order — what a producer that shapes writes. No lam-alef pair
 * is among the words, so no ligature is needed.
 * @param {string} text
 */
function arabicVisual(text) {
  const words = text.split(' ').map((word) => {
    const letters = [...word];
    return letters
      .map((letter, k) => {
        const forms = ARABIC[letter];
        if (forms === undefined) throw new Error(`no presentation forms here for U+${(letter.codePointAt(0) ?? 0).toString(16)}`);
        const before = k > 0 && (ARABIC[letters[k - 1] ?? '']?.length ?? 0) === 4;
        const after = k < letters.length - 1 && forms.length === 4;
        const form = before ? (after ? forms[3] : forms[1]) : after ? forms[2] : forms[0];
        return String.fromCodePoint(/** @type {number} */ (form));
      })
      .join('');
  });
  return [...words.join(' ')].reverse().join('');
}

/** A Hebrew run in drawing order: its letters last first. @param {string} text */
const hebrewVisual = (text) => [...text].reverse().join('');

// ------------------------------------------------------------------------------------------------------- the shapes

/**
 * @typedef {{ bytes: Uint8Array, page: number, pages: number, blocks: Block[], drawings: Drawing[] }} Built
 * @typedef {{
 *   id: string, title: string, tests: string,
 *   edit: { block: string, lines: Line[], word: string },
 *   neighbour: string,
 *   must: string[], mustNot: string[],
 *   build: (variant: Variant) => Promise<Built>,
 * }} Shape
 */

/** A one-page shape from a function that fills a sheet. @param {(sheet: Sheet, faces: Awaited<ReturnType<typeof documentOf>>['faces'], doc: PDFDocument) => Promise<Record<string, unknown> | void>} fill */
function onePage(fill) {
  return async (/** @type {Variant} */ variant) => {
    const { doc, faces } = await documentOf();
    const sheet = new Sheet(doc, variant);
    if (variant.edit !== undefined) sheet.normal = await faces.helvetica();
    const entries = (await fill(sheet, faces, doc)) ?? {};
    pageOf(doc, sheet, entries);
    return { bytes: await doc.save({ useObjectStreams: false }), page: 0, pages: 1, blocks: sheet.blocks, drawings: sheet.drawings };
  };
}

/** What every shape's edit must do and must not do: the owner's decisions for Edit text (cloud run 22). */
const AGREED = {
  must: [
    'read back, by both engines, as the edited words',
    're-wrap inside the block; a block that grows grows DOWNWARD and may overlap what is below',
    'set new words in the run’s own ordinary font where it has the letters, else in the chain’s font',
  ],
  mustNot: [
    'move, change or remove anything outside the block: no pixel and no page object',
    'be refused, be unseen (change no pixel), or log a defect',
    'set a new word in a drawn (Type 3) font, or in a font built from glyph drawings',
  ],
};

/** @type {Shape[]} */
export const SHAPES = [
  {
    id: '01-truetype-subset',
    title: 'A plain paragraph in an embedded TrueType subset',
    tests: 'a paragraph whose font carries only the glyphs it draws, so a new letter may not be in it',
    edit: { block: 'paragraph', lines: ['The garden club meets on the first Sunday of each month,', ...PARAGRAPH.slice(1)], word: 'Sunday' },
    neighbour: 'below',
    must: [...AGREED.must, 'take a letter the subset lacks from the chain, never draw it as nothing'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      // THE EDIT'S WORD IS IN THE SUBSET, so the correct result the controls are measured against draws it.
      const subset = await faces.ofKind('truetype-subset', [...PARAGRAPH, ...BELOW, 'Sunday'].join(''));
      const helvetica = await faces.helvetica();
      sheet.paragraph({ id: 'title', role: 'a control line in Helvetica above', face: helvetica, size: 14, x: 72, y: 720, lines: ['Garden club notes'] });
      sheet.paragraph({ id: 'paragraph', role: 'the paragraph an edit changes', face: subset, size: 12, x: 72, y: 690, lines: PARAGRAPH, perObject: 'block' });
      sheet.paragraph({ id: 'below', role: 'a paragraph in the same font below, which nothing changes', face: subset, size: 12, x: 72, y: 610, lines: BELOW, perObject: 'block' });
    }),
  },
  {
    id: '02-type1-and-cff-subsets',
    title: 'Type 1 and compact Type 1 (CFF) subsets',
    tests: 'paragraphs in an embedded Type 1 subset and an embedded CFF subset (FontFile3 /Type1C), each holding only its glyphs',
    edit: { block: 'type1', lines: ['Seeds are sorted by season and by colour,', 'and the oldest packets are planted soon.'], word: 'soon' },
    neighbour: 'cff',
    must: AGREED.must,
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const lines = ['Seeds are sorted by season and by colour,', 'and the oldest packets are planted first.'];
      const cffLines = ['Labels are written by hand in pencil,', 'because ink runs when the trays are watered.'];
      const type1 = await faces.ofKind('type1-subset', `${lines.join('')}soon`);
      const cff = await faces.ofKind('type1c-subset', cffLines.join(''));
      sheet.paragraph({ id: 'type1', role: 'a Type 1 subset paragraph', face: type1, size: 13, x: 72, y: 700, lines });
      sheet.paragraph({ id: 'cff', role: 'a CFF (Type1C) subset paragraph', face: cff, size: 13, x: 72, y: 640, lines: cffLines });
    }),
  },
  {
    id: '03-standard-fonts-not-embedded',
    title: 'Standard fonts not embedded: Times, Helvetica, Courier (WinAnsi, no ToUnicode)',
    tests: 'text whose font is only a name, so every engine draws a substitute and reads the letters from the encoding',
    edit: { block: 'times', lines: ['A serif paragraph set in Times, named and not embedded,', 'which every reader draws with a font of its own.'], word: 'reader' },
    neighbour: 'helvetica',
    must: AGREED.must,
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      sheet.paragraph({ id: 'times', role: 'Times-Roman', face: await faces.times(), size: 12, x: 72, y: 700, lines: ['A serif paragraph set in Times, named and not embedded,', 'which every viewer draws with a font of its own.'] });
      sheet.paragraph({ id: 'helvetica', role: 'Helvetica', face: await faces.helvetica(), size: 12, x: 72, y: 650, lines: ['A sans paragraph set in Helvetica, also only a name.'] });
      sheet.paragraph({ id: 'courier', role: 'Courier', face: await faces.courier(), size: 12, x: 72, y: 620, lines: ['A fixed-pitch line set in Courier.'] });
    }),
  },
  {
    id: '04-all-fonts-drawn-type3',
    title: 'A page whose fonts are all drawn (Type 3), as printed from a web browser',
    tests: 'a heading and a paragraph in Type 3 fonts drawn from real outlines; there is no ordinary font on the page',
    // THE NEW WORD IN AN ORDINARY FONT, as the owner's rule sets it: the page has none of its own.
    edit: { block: 'body', lines: [[{ text: 'This page was printed from a ' }, { text: 'browser', normal: true }, { text: ', which drew' }], 'every letter as a little picture of itself.'], word: 'browser' },
    neighbour: 'heading',
    must: [...AGREED.must, 'set new words in a normal font from the chain: the page has no ordinary font to take them'],
    mustNot: [...AGREED.mustNot, 'reuse the drawn font for a new word, even for letters it has'],
    build: onePage(async (sheet, faces) => {
      const body = ['This page was printed from a computer, which drew', 'every letter as a little picture of itself.'];
      const regular = await faces.drawn(join(PDFJS_FONTS, 'LiberationSans-Regular.ttf'), `${body.join('')}browser`, 'Liberation Sans');
      const bold = await faces.drawn(join(PDFJS_FONTS, 'LiberationSans-Bold.ttf'), 'Printed notes', 'Liberation Sans Bold');
      sheet.paragraph({ id: 'heading', role: 'a heading in a drawn bold', face: bold, size: 20, x: 72, y: 710, lines: ['Printed notes'] });
      sheet.paragraph({ id: 'body', role: 'a paragraph in a drawn regular', face: regular, size: 12, x: 72, y: 675, lines: body });
    }),
  },
  {
    id: '05-heading-over-lines',
    title: 'A heading over three lines',
    tests: 'one heading set large over three lines, each its own text object, above a paragraph',
    edit: { block: 'heading', lines: ['What the garden', 'club will plant', 'in the autumn'], word: 'autumn' },
    neighbour: 'body',
    must: AGREED.must,
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      sheet.paragraph({ id: 'heading', role: 'a heading over three lines', face: await faces.helveticaBold(), size: 26, leading: 30, x: 72, y: 710, lines: ['What the garden', 'club will plant', 'in the spring'] });
      sheet.paragraph({ id: 'body', role: 'the paragraph below the heading', face: await faces.helvetica(), size: 12, x: 72, y: 615, lines: PARAGRAPH.slice(0, 2) });
    }),
  },
  {
    id: '06-justified-paragraph',
    title: 'A justified paragraph',
    tests: 'a paragraph justified by word spacing (Tw), its last line set as it falls',
    edit: { block: 'justified', lines: ['The garden club meets on the first Monday of each month,', 'in the hall beside the library, from six until nine.', ...PARAGRAPH.slice(2)], word: 'six' },
    neighbour: 'below',
    must: [...AGREED.must, 'keep the paragraph justified to its measure'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      sheet.paragraph({ id: 'justified', role: 'a justified paragraph', face: helvetica, size: 12, x: 72, y: 700, lines: PARAGRAPH, align: 'justify', measure: 330, perObject: 'block' });
      sheet.paragraph({ id: 'below', role: 'a paragraph below', face: helvetica, size: 12, x: 72, y: 620, lines: BELOW.slice(0, 1) });
    }),
  },
  {
    id: '07-references-and-links',
    title: 'Raised reference markers and links',
    tests: 'a paragraph carrying raised, smaller markers [1] and [2] (text rise), and a link over a phrase, coloured and underlined',
    edit: {
      block: 'cited',
      lines: [
        [{ text: 'Compost should rest for a season' }, { text: '[1]', size: 7, rise: 4 }, { text: ' before it is used,' }],
        [{ text: 'as the ' }, { text: 'club’s soil guide', colour: [0, 0.2, 0.7] }, { text: ' explains' }, { text: '[2]', size: 7, rise: 4 }, { text: ' in full.' }],
      ],
      word: 'full',
    },
    neighbour: 'note',
    must: [...AGREED.must, 'keep each marker raised and small, and the link over its phrase'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces, doc) => {
      const helvetica = await faces.helvetica();
      const lines = /** @type {Line[]} */ ([
        [{ text: 'Compost should rest for a season' }, { text: '[1]', size: 7, rise: 4 }, { text: ' before it is used,' }],
        [{ text: 'as the ' }, { text: 'club’s soil guide', colour: [0, 0.2, 0.7] }, { text: ' explains' }, { text: '[2]', size: 7, rise: 4 }, { text: ' at length.' }],
      ]);
      sheet.paragraph({ id: 'cited', role: 'a paragraph with raised markers and a link', face: helvetica, size: 12, x: 72, y: 700, lines });
      const start = 72 + (helvetica.width('as the ') * 12) / 1000;
      const end = start + (helvetica.width('club’s soil guide') * 12) / 1000;
      sheet.draw('link-underline', 'the link’s underline, the paragraph’s own', { left: start, bottom: 683.5, right: end, top: 684.5 }, `0 0.2 0.7 RG 0.8 w ${f(start)} 684 m ${f(end)} 684 l S`);
      sheet.paragraph({ id: 'note', role: 'the notes below', face: helvetica, size: 9, x: 72, y: 650, lines: ['[1] Kept damp and turned weekly.', '[2] The guide is on the noticeboard.'] });
      const link = doc.context.register(
        doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [start, 682, end, 694], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.org/soil') } }),
      );
      return sheet.variant.omit === 'link' ? {} : { Annots: [link] };
    }),
  },
  {
    id: '08-bulleted-lists',
    title: 'Bulleted lists, the bullet three ways',
    tests: 'a bullet as its own text object in another font, a bullet drawn as a path, and a bullet in the same text object',
    edit: { block: 'path-list', lines: ['Water the seedlings at dawn', 'Turn the compost on Fridays', 'Sweep the greenhouse floor'], word: 'Fridays' },
    neighbour: 'same-list',
    must: [...AGREED.must, 'keep every bullet where it is, in its own font or drawing'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      const symbol = await faces.symbol();
      const items = ['Water the seedlings at dawn', 'Turn the compost on Mondays', 'Sweep the greenhouse floor'];
      // ONE: the bullet a separate text object in the Symbol font, the item's words in Helvetica beside it.
      items.forEach((_, k) => sheet.paragraph({ id: `symbol-bullet-${String(k)}`, role: 'a bullet in Symbol, its own text object', face: symbol, size: 12, x: 76, y: 700 - k * 16, lines: ['•'] }));
      sheet.paragraph({ id: 'separate-list', role: 'list items whose bullets are separate text objects', face: helvetica, size: 12, leading: 16, x: 90, y: 700, lines: items });
      // TWO: the bullet a filled circle drawn as a path.
      items.forEach((_, k) => {
        const cy = 624 - k * 16;
        sheet.draw(`path-bullet-${String(k)}`, 'a bullet drawn as a path', { left: 76, bottom: cy - 2.5, right: 81, top: cy + 2.5 }, `0 0 0 rg ${f(78.5)} ${f(cy)} m ${circle(78.5, cy, 2.5)} f`);
      });
      sheet.paragraph({ id: 'path-list', role: 'list items whose bullets are paths', face: helvetica, size: 12, leading: 16, x: 90, y: 620, lines: items });
      // THREE: the bullet in the same text object as its words.
      sheet.paragraph({ id: 'same-list', role: 'list items whose bullets are in the same text object', face: helvetica, size: 12, leading: 16, x: 76, y: 540, lines: items.map((item) => `•  ${item}`) });
    }),
  },
  {
    id: '09-numbered-list',
    title: 'A numbered list',
    tests: 'numbers in their own text objects at a hanging indent, one item wrapping to a second line',
    edit: { block: 'items', lines: ['Order the bulbs before the end of August,', 'so they arrive in time to be planted.', 'Plant them in groups of seven.', 'Mark each group with a label.'], word: 'August' },
    neighbour: 'numbers',
    must: [...AGREED.must, 'keep each number at its item'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      sheet.paragraph({ id: 'numbers', role: 'the numbers, a text object each', face: helvetica, size: 12, leading: 16, x: 72, y: 700, lines: ['1.', '', '2.', '3.'] });
      sheet.paragraph({ id: 'items', role: 'the items, one wrapping', face: helvetica, size: 12, leading: 16, x: 92, y: 700, lines: ['Order the bulbs before the end of September,', 'so they arrive in time to be planted.', 'Plant them in groups of seven.', 'Mark each group with a label.'] });
    }),
  },
  {
    id: '10-code-block',
    title: 'A code block in monospace, one command per line',
    tests: 'commands in Courier on a grey panel, one text object per line, every line ending hard',
    edit: { block: 'code', lines: ['npm install', 'npm run build', 'npm run check', 'npm start'], word: 'check' },
    neighbour: 'caption',
    must: [...AGREED.must, 'keep one command to a line: no line merged into another'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      sheet.draw('panel', 'the grey panel behind the code', { left: 66, bottom: 625, right: 300, top: 712 }, '0.92 0.92 0.92 rg 66 625 234 87 re f');
      sheet.paragraph({ id: 'code', role: 'four commands, one per line', face: await faces.courier(), size: 11, leading: 18, x: 74, y: 696, lines: ['npm install', 'npm run build', 'npm test', 'npm start'] });
      sheet.paragraph({ id: 'caption', role: 'a caption below the panel', face: await faces.helvetica(), size: 10, x: 66, y: 608, lines: ['Run these from the project folder.'] });
    }),
  },
  {
    id: '11-underline-strike-highlight',
    title: 'Underlined, struck and highlighted words',
    tests: 'words decorated by paths a word processor draws: an underline, a strike-through, and a highlight behind',
    edit: { block: 'decorated', lines: ['Bring gloves, a trowel and a flask of tea.', 'Leave the hose coiled after use.'], word: 'tea' },
    neighbour: 'plain',
    must: [...AGREED.must, 'keep each decoration under, through or behind its word'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      const line = 'Bring gloves, a trowel and a flask of soup.';
      const at = (/** @type {string} */ word) => {
        const start = 72 + (helvetica.width(line.slice(0, line.indexOf(word))) * 12) / 1000;
        return { start, end: start + (helvetica.width(word) * 12) / 1000 };
      };
      const glove = at('gloves');
      const trowel = at('trowel');
      const flask = at('flask');
      sheet.draw('highlight', 'a highlight behind “flask”', { left: flask.start, bottom: 697, right: flask.end, top: 711 }, `1 0.95 0.4 rg ${f(flask.start)} 697 ${f(flask.end - flask.start)} 14 re f`);
      sheet.paragraph({ id: 'decorated', role: 'a paragraph with decorated words', face: helvetica, size: 12, x: 72, y: 700, lines: [line, 'Leave the hose coiled after use.'] });
      sheet.draw('underline', 'an underline under “gloves”', { left: glove.start, bottom: 697.6, right: glove.end, top: 698.4 }, `0 0 0 RG 0.8 w ${f(glove.start)} 698 m ${f(glove.end)} 698 l S`);
      sheet.draw('strike', 'a strike through “trowel”', { left: trowel.start, bottom: 703.6, right: trowel.end, top: 704.4 }, `0 0 0 RG 0.8 w ${f(trowel.start)} 704 m ${f(trowel.end)} 704 l S`);
      sheet.paragraph({ id: 'plain', role: 'a plain paragraph below', face: helvetica, size: 12, x: 72, y: 650, lines: ['Tools go back on the rack by the door.'] });
    }),
  },
  {
    id: '12-form-xobject-text',
    title: 'Text inside a form XObject, shared by two placements, and nested',
    tests: 'a form drawn in two places holding a paragraph, and a second form drawn inside a third',
    edit: { block: 'placement-1', lines: ['A notice drawn in two places', 'on one page, from one form.'], word: 'notice' },
    neighbour: 'placement-2',
    must: [...AGREED.must, 'change the placement edited and leave the other placement’s words as they were'],
    mustNot: AGREED.mustNot,
    build: async (variant) => {
      const { doc, faces } = await documentOf();
      const helvetica = await faces.helvetica();
      const lines = ['A message drawn in two places', 'on one page, from one form.'];
      /** A form holding the shared paragraph, with the edit applied when `edited`. @param {boolean} edited */
      const sharedForm = (edited) => {
        // THE PLACEMENT'S VARIANT, said of the form's own paragraph.
        /** @type {Variant} */
        const own = {};
        if (variant.edit?.block === 'placement-1') own.edit = { ...variant.edit, block: 'shared' };
        if (variant.invisible?.block === 'placement-1') own.invisible = { ...variant.invisible, block: 'shared' };
        if (variant.drawn?.block === 'placement-1') own.drawn = { ...variant.drawn, block: 'shared' };
        const sheet = new Sheet(doc, edited ? own : {});
        sheet.paragraph({ id: 'shared', role: 'the shared paragraph', face: helvetica, size: 12, x: 0, y: 30, lines });
        return formOf(doc, sheet, [0, 0, 300, 50]);
      };
      const original = sharedForm(false);
      // AN EDIT OF ONE PLACEMENT is a form of its own for that placement, which is what the writer must make: the
      // other placement keeps the form as it was.
      const touched = [variant.edit?.block, variant.invisible?.block, variant.drawn?.block].includes('placement-1');
      const first = touched ? sharedForm(true) : original;
      const inner = new Sheet(doc, {});
      inner.paragraph({ id: 'nested-inner', role: 'text in the innermost form', face: helvetica, size: 11, x: 0, y: 20, lines: ['Drawn inside a form inside a form.'] });
      const innerForm = formOf(doc, inner, [0, 0, 300, 40]);
      const outer = new Sheet(doc, {});
      outer.xobjects['Inner'] = innerForm;
      outer.raw('q 1 0 0 1 10 5 cm /Inner Do Q');
      const outerForm = formOf(doc, outer, [0, 0, 320, 50]);
      const sheet = new Sheet(doc, variant);
      sheet.xobjects = { Shared: first, Original: original, Outer: outerForm };
      const helveticaLine = sheet.paragraph({ id: 'title', role: 'a line on the page itself', face: helvetica, size: 14, x: 72, y: 730, lines: ['Two placements of one form'] });
      void helveticaLine;
      const placed = (/** @type {string} */ id, /** @type {string} */ name, /** @type {number} */ tx, /** @type {number} */ ty) => {
        const [mx, my] = variant.move?.block === id ? [variant.move.dx, variant.move.dy] : [0, 0];
        if (variant.omit !== id) sheet.raw(`q 1 0 0 1 ${f(tx + mx)} ${f(ty + my)} cm /${name} Do Q`);
        const width = Math.max(...(id === 'placement-1' && variant.edit?.block === id ? variant.edit.lines : lines).map((line) => (helvetica.width(textOf(line)) * 12) / 1000));
        sheet.blocks.push({
          id,
          role: `the form’s paragraph, placed at ${String(tx)}, ${String(ty)}`,
          text: (id === 'placement-1' && variant.edit?.block === id ? variant.edit.lines : lines).map(textOf).join('\n'),
          box: { left: tx + mx, bottom: ty + my + 30 - 15 - 2.6, right: tx + mx + width, top: ty + my + 30 + 9.1 },
          angle: 0,
          face: helvetica.kind,
          visible: true,
          form: name,
        });
      };
      placed('placement-1', 'Shared', 72, 650);
      placed('placement-2', 'Original', 72, 560);
      if (variant.omit !== 'nested') sheet.raw('q 1 0 0 1 72 480 cm /Outer Do Q');
      sheet.blocks.push({ id: 'nested', role: 'text in a form inside a form', text: 'Drawn inside a form inside a form.', box: { left: 82, bottom: 502.6, right: 82 + (helvetica.width('Drawn inside a form inside a form.') * 11) / 1000, top: 513.4 }, angle: 0, face: helvetica.kind, visible: true, form: 'Outer/Inner' });
      pageOf(doc, sheet);
      return { bytes: await doc.save({ useObjectStreams: false }), page: 0, pages: 1, blocks: sheet.blocks, drawings: sheet.drawings };
    },
  },
  {
    id: '13-clipped-cells',
    title: 'Text under a clip window',
    tests: 'each cell’s words drawn inside a rectangular clip, as table and column layouts write them',
    edit: { block: 'cell-b', lines: ['Tomatoes', 'need sun'], word: 'sun' },
    neighbour: 'cell-c',
    must: [...AGREED.must, 'keep new words inside the clip, where they can be seen'],
    mustNot: [...AGREED.mustNot, 'write words the clip hides'],
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      const cells = [
        { id: 'cell-a', x: 72, lines: ['Beans', 'climb'] },
        { id: 'cell-b', x: 192, lines: ['Tomatoes', 'need heat'] },
        { id: 'cell-c', x: 312, lines: ['Lettuce', 'bolts'] },
      ];
      for (const cell of cells) {
        sheet.draw(`${cell.id}-frame`, 'the cell’s frame', { left: cell.x - 6, bottom: 649.6, right: cell.x + 106, top: 710.4 }, `0 0 0 RG 0.8 w ${f(cell.x - 6)} 650 112 60 re S`);
        sheet.paragraph({ id: cell.id, role: 'a cell’s words under its clip', face: helvetica, size: 12, x: cell.x, y: 690, lines: cell.lines, perObject: 'block', prefix: `q ${f(cell.x - 4)} 652 108 56 re W n ` });
        sheet.raw('Q');
      }
    }),
  },
  {
    id: '14-two-columns',
    title: 'Two columns',
    tests: 'two columns of text side by side; the left column’s paragraph grows',
    edit: { block: 'left', lines: ['The left column tells', 'how the club began,', 'in a shed with four', 'chairs, a kettle and', 'a long list of seeds.'], word: 'list' },
    neighbour: 'right',
    must: AGREED.must,
    mustNot: [...AGREED.mustNot, 'move the right column, or wrap into it'],
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      sheet.paragraph({ id: 'left', role: 'the left column', face: helvetica, size: 12, x: 72, y: 700, lines: ['The left column tells', 'how the club began,', 'in a shed with four', 'chairs and a kettle.'] });
      sheet.paragraph({ id: 'right', role: 'the right column', face: helvetica, size: 12, x: 320, y: 700, lines: ['The right column says', 'where it meets now,', 'and who to ask about', 'joining the club.'] });
      sheet.paragraph({ id: 'left-below', role: 'the left column’s next paragraph', face: helvetica, size: 12, x: 72, y: 630, lines: ['It has grown since.'] });
    }),
  },
  {
    id: '15-table',
    title: 'A table with cell text',
    tests: 'a three-by-three grid of ruled cells, each cell a text object',
    edit: { block: 'r2c2', lines: ['April'], word: 'April' },
    neighbour: 'r3c2',
    must: AGREED.must,
    mustNot: [...AGREED.mustNot, 'move a rule of the grid'],
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      const bold = await faces.helveticaBold();
      const rows = [['Plant', 'Sow', 'Harvest'], ['Peas', 'March', 'June'], ['Kale', 'May', 'October']];
      const xs = [72, 192, 312, 432];
      const ys = [720, 696, 672, 648];
      for (const x of xs) sheet.draw(`rule-x${String(x)}`, 'a column rule', { left: x - 0.4, bottom: 648, right: x + 0.4, top: 720 }, `0 0 0 RG 0.8 w ${f(x)} 648 m ${f(x)} 720 l S`);
      for (const y of ys) sheet.draw(`rule-y${String(y)}`, 'a row rule', { left: 72, bottom: y - 0.4, right: 432, top: y + 0.4 }, `0 0 0 RG 0.8 w 72 ${f(y)} m 432 ${f(y)} l S`);
      rows.forEach((row, r) =>
        row.forEach((text, c) =>
          sheet.paragraph({ id: `r${String(r + 1)}c${String(c + 1)}`, role: r === 0 ? 'a header cell' : 'a cell', face: r === 0 ? bold : helvetica, size: 11, x: (xs[c] ?? 0) + 6, y: (ys[r] ?? 0) - 16, lines: [text] }),
        ),
      );
    }),
  },
  {
    id: '16-right-to-left',
    title: 'Right-to-left text: Arabic and Hebrew',
    tests: 'an Arabic paragraph shaped to presentation forms and a Hebrew one, each written in drawing order and set right',
    edit: { block: 'arabic', lines: ['بيت سميك', 'كتاب جديد'], word: 'سميك' },
    neighbour: 'hebrew',
    must: [...AGREED.must, 'keep the words right to left, joined as Arabic joins'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const fonts = mupdfFonts();
      const arabicWords = 'بيت كبير كتاب جديد سميك';
      const arabicForms = arabicVisual(arabicWords) + arabicVisual('بيت سميك');
      const arabic = await faces.cid(join(fonts, 'noto', 'NotoNaskhArabic-Regular.otf'), 'NotoNaskhArabic', arabicForms, { rtl: true, visual: arabicVisual }, (c) => ARABIC_BASE.get(c) ?? c);
      const hebrew = await faces.cid(join(fonts, 'noto', 'NotoSerifHebrew-Regular.otf'), 'NotoSerifHebrew', 'ספר חדש בית גדול', { rtl: true, visual: hebrewVisual });
      sheet.paragraph({ id: 'arabic', role: 'an Arabic paragraph', face: arabic, size: 16, leading: 26, x: 300, y: 700, lines: ['بيت كبير', 'كتاب جديد'], align: 'right', measure: 240 });
      sheet.paragraph({ id: 'hebrew', role: 'a Hebrew paragraph', face: hebrew, size: 16, leading: 24, x: 300, y: 620, lines: ['ספר חדש', 'בית גדול'], align: 'right', measure: 240 });
    }),
  },
  {
    id: '17-cjk',
    title: 'Chinese and Japanese text',
    tests: 'a CJK line in an embedded TrueType subset (Identity-H) and a Japanese line whose font is not embedded',
    edit: { block: 'embedded', lines: ['秋の庭で会いましょう'], word: '秋' },
    neighbour: 'not-embedded',
    must: AGREED.must,
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const droid = await faces.cid(join(mupdfFonts(), 'droid', 'DroidSansFallback.ttf'), 'DroidSansFallback', '春秋の庭で会いましょう', {});
      const helvetica = await faces.helvetica();
      const kozmin = await faces.ofKind('type0-cidfonttype0', '変更しない行です。');
      void helvetica;
      sheet.paragraph({ id: 'embedded', role: 'a line in an embedded CJK subset', face: droid, size: 16, x: 72, y: 700, lines: ['春の庭で会いましょう'] });
      sheet.paragraph({ id: 'not-embedded', role: 'a Japanese line whose font is only a name', face: kozmin, size: 16, x: 72, y: 660, lines: ['変更しない行です。'] });
    }),
  },
  {
    id: '18-rotated-text',
    title: 'Rotated text: 90 degrees and an odd angle',
    tests: 'a block turned a quarter, reading upwards, and a block turned 30 degrees',
    edit: { block: 'odd', lines: ['Turned thirty degrees,', 'and still two lines long.'], word: 'still' },
    neighbour: 'quarter',
    must: [...AGREED.must, 'keep the block’s turn: its lines grow in its own direction'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      sheet.paragraph({ id: 'quarter', role: 'a block turned 90 degrees', face: helvetica, size: 12, x: 90, y: 420, angle: 90, lines: ['Turned a quarter, reading up.'] });
      sheet.paragraph({ id: 'odd', role: 'a block turned 30 degrees', face: helvetica, size: 12, x: 200, y: 480, angle: 30, lines: ['Turned thirty degrees,', 'and only two lines long.'] });
      sheet.paragraph({ id: 'upright', role: 'an upright control line', face: helvetica, size: 12, x: 200, y: 720, lines: ['An upright line for comparison.'] });
    }),
  },
  {
    id: '19-text-over-image',
    title: 'Text over an image',
    tests: 'a paragraph drawn on top of a colour picture, so its pixels and the picture’s share an area',
    edit: { block: 'over', lines: ['A caption set over the picture,', 'in white on the green.'], word: 'green' },
    neighbour: 'under',
    must: AGREED.must,
    mustNot: [...AGREED.mustNot, 'change the picture'],
    build: onePage(async (sheet, faces) => {
      sheet.image('picture', 'a picture behind the caption', { left: 72, bottom: 560, right: 472, top: 720 }, {
        width: 80,
        height: 32,
        channels: 3,
        pixel: (x, y) => [20 + x, 90 + y * 3, 40 + ((x * y) % 30)],
      });
      sheet.paragraph({ id: 'over', role: 'a caption over the picture', face: await faces.helveticaBold(), size: 14, x: 90, y: 690, lines: ['A caption set over the picture,', 'in white on the dark.'], colour: [1, 1, 1] });
      sheet.paragraph({ id: 'under', role: 'a line below the picture', face: await faces.helvetica(), size: 12, x: 72, y: 540, lines: ['The picture is our own: a green field of noise.'] });
    }),
  },
  {
    id: '20-tagged-text',
    title: 'Tagged text (marked content)',
    tests: 'paragraphs inside BDC/EMC with MCIDs, a structure tree naming them, and a header marked as an artifact',
    edit: { block: 'tagged-1', lines: ['The first tagged paragraph,', 'marked as a P with its own id.'], word: 'id' },
    neighbour: 'tagged-2',
    must: [...AGREED.must, 'keep the edited words inside their marked content'],
    mustNot: AGREED.mustNot,
    build: async (variant) => {
      const { doc, faces } = await documentOf();
      const helvetica = await faces.helvetica();
      const sheet = new Sheet(doc, variant);
      sheet.raw('/Artifact BMC');
      sheet.paragraph({ id: 'header', role: 'a running header marked as an artifact', face: helvetica, size: 9, x: 72, y: 750, lines: ['Garden club newsletter'] });
      sheet.raw('EMC');
      sheet.raw('/P <</MCID 0>> BDC');
      sheet.paragraph({ id: 'tagged-1', role: 'a paragraph in marked content, MCID 0', face: helvetica, size: 12, x: 72, y: 700, lines: ['The first tagged paragraph,', 'marked as a P with its number.'], perObject: 'block' });
      sheet.raw('EMC');
      sheet.raw('/P <</MCID 1>> BDC');
      sheet.paragraph({ id: 'tagged-2', role: 'a paragraph in marked content, MCID 1', face: helvetica, size: 12, x: 72, y: 640, lines: ['The second tagged paragraph.'], perObject: 'block' });
      sheet.raw('EMC');
      const page = pageOf(doc, sheet, { StructParents: 0 });
      const context = doc.context;
      const root = context.nextRef();
      const documentElement = context.nextRef();
      const ps = [0, 1].map((mcid) => context.register(context.obj({ Type: 'StructElem', S: 'P', P: documentElement, Pg: page.ref, K: mcid })));
      context.assign(documentElement, context.obj({ Type: 'StructElem', S: 'Document', P: root, K: ps }));
      context.assign(root, context.obj({ Type: 'StructTreeRoot', K: documentElement, ParentTree: { Nums: [0, ps] }, ParentTreeNextKey: 1 }));
      doc.catalog.set(PDFName.of('StructTreeRoot'), root);
      doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
      return { bytes: await doc.save({ useObjectStreams: false }), page: 0, pages: 1, blocks: sheet.blocks, drawings: sheet.drawings };
    },
  },
  {
    id: '21-cropbox-and-rotate',
    title: 'A page with a CropBox offset and /Rotate 90',
    tests: 'a CropBox whose origin is not the MediaBox’s, and a page turned 90 degrees whose text reads upright when shown',
    edit: { block: 'upright', lines: ['This text reads upright on a turned page,', 'inside a crop box that starts off the origin.'], word: 'inside' },
    neighbour: 'second',
    must: [...AGREED.must, 'grow downward as the person sees the page, which is along the page’s own x axis'],
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      // TURNED 90 FOR A PAGE SHOWN TURNED 90 CLOCKWISE: a baseline running up the page reads left to right on screen,
      // and its next line, below on screen, is further along the page's x axis.
      sheet.paragraph({ id: 'upright', role: 'a paragraph reading upright as shown', face: helvetica, size: 12, x: 120, y: 120, angle: 90, lines: ['This text reads upright on a turned page,', 'within a crop box that starts off the origin.'] });
      sheet.paragraph({ id: 'second', role: 'a second paragraph, below as shown', face: helvetica, size: 12, x: 180, y: 120, angle: 90, lines: ['A second paragraph sits below it.'] });
      return { CropBox: [40, 60, 572, 752], Rotate: 90 };
    }),
  },
  {
    id: '22-scanned-page-ocr',
    title: 'A scanned page with an OCR text layer',
    tests: 'a page that is one grey picture, with the recognised words laid over it invisibly (render mode 3)',
    edit: { block: 'ocr-1', lines: ['Minutes of the spring meeting', 'held in the village hall'], word: 'village' },
    neighbour: 'ocr-2',
    must: ['read back, by both engines, as the edited words', 'stay invisible: the scan is the page’s picture, and the text layer is what search and copy read'],
    mustNot: ['move, change or remove anything outside the block: no pixel and no page object', 'be refused, or log a defect', 'paint words over the scan'],
    build: onePage(async (sheet, faces) => {
      const helvetica = await faces.helvetica();
      const lines = ['Minutes of the spring meeting', 'held in the church hall'];
      const second = ['Twelve members came and four sent apologies.'];
      // THE SCAN: a grey page with dark bars where the words are, at 50 dpi — what a scanner's picture of print is to
      // anything that does not read it.
      const words = [...lines.map((line, k) => ({ line, y: 700 - k * 16 })), ...second.map((line) => ({ line, y: 640 }))];
      sheet.image('scan', 'the scanned page', { left: 0, bottom: 0, right: 612, top: 792 }, {
        width: 425,
        height: 550,
        channels: 1,
        pixel: (px, py) => {
          const x = (px * 612) / 425;
          const y = 792 - (py * 792) / 550;
          const ink = words.some(({ line, y: baseline }) => {
            let start = 72;
            return line.split(' ').some((word) => {
              const end = start + (helvetica.width(word) * 12) / 1000;
              const inside = x >= start && x <= end && y >= baseline - 1 && y <= baseline + 8;
              start = end + (helvetica.width(' ') * 12) / 1000;
              return inside;
            });
          });
          return [ink ? 40 : 235 - ((px * 7 + py * 13) % 9)];
        },
      });
      sheet.paragraph({ id: 'ocr-1', role: 'recognised words, invisible over the scan', face: helvetica, size: 12, leading: 16, x: 72, y: 700, lines, render: 3 });
      sheet.paragraph({ id: 'ocr-2', role: 'more recognised words, invisible', face: helvetica, size: 12, x: 72, y: 640, lines: second, render: 3 });
    }),
  },
  {
    id: '23-word-processor-export',
    title: 'A word-processor export: WinAnsi embedded subsets, no ToUnicode',
    tests: 'a heading and a paragraph in embedded TrueType subsets with WinAnsi encoding and no ToUnicode, one text object per line',
    edit: { block: 'body', lines: ['The committee thanks everyone who helped', 'at the plant sale, which raised enough', 'for a new water butt and two benches.'], word: 'benches' },
    neighbour: 'heading',
    must: AGREED.must,
    mustNot: AGREED.mustNot,
    build: onePage(async (sheet, faces) => {
      const body = ['The committee thanks everyone who helped', 'at the plant sale, which raised enough', 'for a new water butt and a bench.'];
      const regular = await faces.ofKind('truetype-subset', `${body.join('')}benchestwo`);
      const heading = await faces.ofKind('truetype-embedded', 'Committee news');
      sheet.paragraph({ id: 'heading', role: 'a heading', face: heading, size: 18, x: 72, y: 710, lines: ['Committee news'] });
      sheet.paragraph({ id: 'body', role: 'the export’s body paragraph', face: regular, size: 12, x: 72, y: 680, lines: body });
    }),
  },
  {
    id: '24-five-hundred-pages',
    title: 'A 500-page document',
    tests: 'the same page shape five hundred times, for speed; the edit is on page 250',
    edit: { block: 'p250-body', lines: ['This is page 250 of a long report,', 'where a paragraph is edited now.'], word: 'now' },
    neighbour: 'p250-next',
    must: [...AGREED.must, 'touch only page 250'],
    mustNot: AGREED.mustNot,
    build: async (variant) => {
      const { doc, faces } = await documentOf();
      const helvetica = await faces.helvetica();
      /** @type {Built['blocks']} */
      let blocks = [];
      /** @type {Built['drawings']} */
      let drawings = [];
      for (let number = 1; number <= 500; number += 1) {
        const sheet = new Sheet(doc, number === 250 ? variant : {});
        sheet.paragraph({ id: `p${String(number)}-header`, role: 'the running header', face: helvetica, size: 9, x: 72, y: 750, lines: ['A long report'] });
        sheet.paragraph({ id: `p${String(number)}-body`, role: 'the page’s first paragraph', face: helvetica, size: 12, x: 72, y: 700, lines: [`This is page ${String(number)} of a long report,`, 'where one paragraph is edited.'] });
        sheet.paragraph({ id: `p${String(number)}-next`, role: 'the page’s second paragraph', face: helvetica, size: 12, x: 72, y: 650, lines: ['Nothing else on the page changes.'] });
        sheet.paragraph({ id: `p${String(number)}-footer`, role: 'the page number', face: helvetica, size: 9, x: 300, y: 40, lines: [String(number)] });
        pageOf(doc, sheet);
        if (number === 250) {
          blocks = sheet.blocks;
          drawings = sheet.drawings;
        }
      }
      return { bytes: await doc.save({ useObjectStreams: false }), page: 249, pages: 500, blocks, drawings };
    },
  },
];

/** A circle as four cubic curves, from its rightmost point, ending with the path open for `f`. @param {number} cx @param {number} cy @param {number} r */
function circle(cx, cy, r) {
  const k = 0.5523 * r;
  return [
    `${f(cx + r)} ${f(cy)} m`,
    `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c`,
    `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c`,
    `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c`,
    `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c`,
  ].join(' ');
}

/**
 * One shape's file as it is, or as `variant` leaves it.
 * @param {string} id @param {Variant} [variant]
 * @returns {Promise<Built>}
 */
export async function buildShape(id, variant = {}) {
  const shape = SHAPES.find((each) => each.id === id);
  if (shape === undefined) throw new Error(`no catalogue shape ${id}`);
  return await shape.build(variant);
}

/**
 * The manifest: for each file, what it tests, its blocks, and what an edit must and must not do — with the edit a
 * test makes, the text it must read back, and the neighbour the damaged control moves.
 */
export async function manifest() {
  const files = [];
  for (const shape of SHAPES) {
    const built = await shape.build({});
    const edited = await shape.build({ edit: { block: shape.edit.block, lines: shape.edit.lines } });
    files.push({
      file: `${shape.id}.pdf`,
      title: shape.title,
      tests: shape.tests,
      pages: built.pages,
      page: built.page,
      blocks: built.blocks,
      drawings: built.drawings,
      edit: {
        block: shape.edit.block,
        newWord: shape.edit.word,
        text: edited.blocks.find((block) => block.id === shape.edit.block)?.text ?? '',
      },
      neighbour: shape.neighbour,
      must: shape.must,
      mustNot: shape.mustNot,
    });
  }
  return { generatedBy: 'scripts/research/editCatalogue.mjs', files };
}

if (isMain(import.meta.url)) {
  const directory = process.argv[2];
  if (directory === undefined) throw new Error('Usage: node scripts/research/editCatalogue.mjs <directory>');
  mkdirSync(directory, { recursive: true });
  for (const shape of SHAPES) {
    const built = await shape.build({});
    writeFileSync(join(directory, `${shape.id}.pdf`), built.bytes);
    process.stdout.write(`${shape.id}.pdf ${String(built.bytes.length)} bytes\n`);
  }
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(await manifest(), null, 2)}\n`);
}
