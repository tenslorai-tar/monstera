// @ts-check
/**
 * Whether an edit disturbed anything outside what it edited: a page drawn by MuPDF before and after, and every pixel that
 * changed outside the boxes the edit was allowed to change. One module, so the edit proofs that ask this question
 * (`editObject.proof.mjs`, `editText.proof.mjs`) ask it the same way (B3a).
 *
 * The MuPDF binding is handed in (`kernel.mupdf`, the built `mupdfRaw.js`), since a proof binds the engine once, after it
 * has checked the build is fresh.
 */

import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

/** Device pixels per point the pages are drawn at: 144 dpi, where a point is two pixels. */
export const SCALE = 2;
/** How far outside an object's box its own edges may draw: a point and a half, for antialiasing and a stroke's width. */
export const EDGE = 1.5;

/**
 * @typedef {{ left: number, bottom: number, right: number, top: number }} Box
 * @typedef {{ width: number, height: number, rgb: Uint8Array, toDevice: (x: number, y: number) => [number, number] }} Render
 */

/** @type {WeakMap<object, WeakMap<Uint8Array, Map<string, unknown>>>} */
const READS = new WeakMap();

/**
 * What `make` answers for `key` of the document `bytes` as `engine` reads it, made once for those exact bytes and that
 * engine and answered again after: the one store of a page's reads (B3a), so a check that asks of the same document
 * many times — the corpus proof judges every try of a page against the one `before` — reads it once.
 *
 * KEYED BY THE ARRAY ITSELF, not its contents: a document's bytes are never changed in place by these tools, a read of
 * them is the same every time, and an answer held is shared, so its reader must not change it either. Held while the
 * bytes are: the store lets go of a document's reads with the document.
 *
 * @template T @param {object} engine the engine module that reads @param {Uint8Array} bytes @param {string} key
 * @param {() => T} make @returns {T}
 */
export function readOnce(engine, bytes, key, make) {
  let documents = READS.get(engine);
  if (documents === undefined) {
    documents = new WeakMap();
    READS.set(engine, documents);
  }
  let reads = documents.get(bytes);
  if (reads === undefined) {
    reads = new Map();
    documents.set(bytes, reads);
  }
  if (!reads.has(key)) reads.set(key, make());
  return /** @type {T} */ (reads.get(key));
}

/**
 * MuPDF's drawing of page `index` of `bytes`, and the map from PDF space to its pixels.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index @returns {Render}
 */
export function render(kernel, bytes, index) {
  return drawing(kernel, bytes, index).render;
}

/**
 * {@link render}'s drawing as the store holds it, with the device pixel its box starts at.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index
 * @returns {{ render: Render, origin: readonly [number, number] }}
 */
function drawing(kernel, bytes, index) {
  return readOnce(kernel.mupdf, bytes, `render:${String(index)}`, () => drawn(kernel, bytes, index));
}

/**
 * {@link render}'s drawing, made.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index @returns {{ render: Render, origin: readonly [number, number] }}
 */
function drawn(kernel, bytes, index) {
  const { mupdf } = kernel;
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    const page = document.loadPage(index);
    const transform = page.getTransform();
    const pixmap = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, false);
    const [x0, y0] = [pixmap.getX(), pixmap.getY()];
    const out = {
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
      rgb: new Uint8Array(pixmap.getPixels()),
      /** @type {(x: number, y: number) => [number, number]} */
      toDevice: (x, y) => [
        (x * transform[0] + y * transform[2] + transform[4]) * SCALE - x0,
        (x * transform[1] + y * transform[3] + transform[5]) * SCALE - y0,
      ],
    };
    pixmap.destroy();
    return { render: out, origin: /** @type {const} */ ([x0, y0]) };
  } finally {
    document.destroy();
  }
}

/**
 * MuPDF's drawing of page `index` with every text operation left out — fills, strokes and clips of text alike — at
 * {@link render}'s size and place, so a pixel of one is the same pixel of the other. What text draws is the difference.
 *
 * MuPDF, not PDFium: PDFium draws a font the file does not embed from the MACHINE's fonts, so a Japanese line drew on a
 * runner with a Japanese font and nothing on one without (CI's Linux leg, 2026-10-26), and a check built on it judged
 * the machine. MuPDF's fallback faces are compiled into the shim, the same on every runner.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index @returns {Render}
 */
export function renderWithoutText(kernel, bytes, index) {
  return readOnce(kernel.mupdf, bytes, `without-text:${String(index)}`, () => drawnWithoutText(kernel, bytes, index));
}

/** {@link renderWithoutText}'s drawing, made. @param {any} kernel @param {Uint8Array} bytes @param {number} index @returns {Render} */
function drawnWithoutText(kernel, bytes, index) {
  const { mupdf } = kernel;
  // THE SAME BOX the full drawing takes, read from it rather than worked out again: that drawing's own, as the store
  // holds it, so the page is not drawn whole a second time only to learn its size.
  const full = drawing(kernel, bytes, index);
  const [x0, y0] = full.origin;
  const { width, height } = full.render;
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    const page = document.loadPage(index);
    const transform = page.getTransform();
    const matrix = mupdf.Matrix.scale(SCALE, SCALE);
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [x0, y0, x0 + width, y0 + height], false);
    pixmap.clear(255);
    const draw = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
    /** @param {string} name */
    const forward = (name) => (/** @type {unknown[]} */ ...args) => draw[name](...args);
    const kept = ['fillPath', 'strokePath', 'clipPath', 'clipStrokePath', 'fillShade', 'fillImage', 'fillImageMask', 'clipImageMask', 'popClip', 'beginMask', 'endMask', 'beginGroup', 'endGroup', 'beginTile', 'endTile', 'beginLayer', 'endLayer'];
    // A CLIP BY TEXT is still a clip a later pop closes, so it is kept as a clip — of an empty path, which lets nothing
    // through: what showed through the letters goes with them. Filled, stroked and invisible text is left out.
    const filter = new mupdf.Device({
      ...Object.fromEntries(kept.map((name) => [name, forward(name)])),
      clipText: () => draw.clipPath(new mupdf.Path(), false, mupdf.Matrix.identity),
      clipStrokeText: () => draw.clipPath(new mupdf.Path(), false, mupdf.Matrix.identity),
    });
    // THE PAGE'S CONTENTS ONLY, as {@link render} draws them (`toPixmap`'s showExtras false): with the annotations run
    // here too, an annotation's appearance over a character made the two drawings differ there whatever the text drew,
    // and an invisible word under one was judged drawn (the stage audit of dabf6041..f1c1dc16, measured).
    page.runPageContents(filter, matrix);
    filter.close();
    draw.close();
    const out = {
      width,
      height,
      rgb: new Uint8Array(pixmap.getPixels()),
      /** @type {(x: number, y: number) => [number, number]} */
      toDevice: (x, y) => [
        (x * transform[0] + y * transform[2] + transform[4]) * SCALE - x0,
        (x * transform[1] + y * transform[3] + transform[5]) * SCALE - y0,
      ],
    };
    pixmap.destroy();
    return out;
  } finally {
    document.destroy();
  }
}

/**
 * Every character MuPDF reads on page `index` of `bytes`: what it is, its origin and its box, in PDF space, and the name
 * MuPDF gives its font — `Type3 (n 0 R)` for a drawn one. Read once for those bytes ({@link readOnce}), and frozen, since
 * every caller after the first is handed the same list.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index
 * @returns {readonly { character: string, x: number, y: number, box: Box, font: string }[]}
 */
export function charactersOf(kernel, bytes, index) {
  return readOnce(kernel.mupdf, bytes, `characters:${String(index)}`, () => Object.freeze(read(kernel, bytes, index)));
}

/**
 * {@link charactersOf}'s reading, made.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index
 * @returns {{ character: string, x: number, y: number, box: Box, font: string }[]}
 */
function read(kernel, bytes, index) {
  const { mupdf } = kernel;
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    const page = document.loadPage(index);
    // MuPDF's structured text is in its own page space; the page's transform takes PDF space there, so its inverse
    // takes a point back. No axis is assumed: the inverse is the matrix's.
    const [a, b, c, d, e, f] = page.getTransform();
    const det = a * d - b * c;
    /** @param {number} x @param {number} y @returns {[number, number]} */
    const toPdf = (x, y) => [(d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det];
    /** @type {{ character: string, x: number, y: number, box: Box, font: string }[]} */
    const found = [];
    const text = page.toStructuredText('preserve-whitespace');
    try {
      text.walk({
        /** @param {string} character @param {[number, number]} origin @param {{ getName: () => string }} font @param {number} _size @param {number[]} quad */
        onChar: (character, origin, font, _size, quad) => {
          const [x, y] = toPdf(origin[0], origin[1]);
          const corners = [0, 2, 4, 6].map((at) => toPdf(quad[at] ?? 0, quad[at + 1] ?? 0));
          found.push({
            character,
            font: font.getName(),
            x,
            y,
            box: {
              left: Math.min(...corners.map(([qx]) => qx)),
              right: Math.max(...corners.map(([qx]) => qx)),
              bottom: Math.min(...corners.map(([, qy]) => qy)),
              top: Math.max(...corners.map(([, qy]) => qy)),
            },
          });
        },
      });
    } finally {
      text.destroy();
    }
    return found;
  } finally {
    document.destroy();
  }
}

/**
 * A text block's box as the renderer of this comparison inks it: PDFium's box for the block, grown to hold every glyph
 * MuPDF draws whose ORIGIN lies in that box.
 *
 * PDFium's box alone is not where the block's pixels are for a font the document does not embed: both engines place each
 * glyph's origin from the page's own widths, but the height of the box comes from whatever substitute PDFium found among
 * the machine's fonts, and the glyph from MuPDF's own fallback. Measured 2026-10-23: the CIDFontType0 fixture, its
 * Japanese font not embedded, drew 941 to 4,042 pixels outside PDFium's box on a runner with no Japanese font — a
 * recolour among them, which moves nothing — and none here, where PDFium found one. An origin is on the baseline, where
 * the two engines agree, so it names the glyph without trusting either box.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index @param {Box} box @returns {Box}
 */
export function inkOf(kernel, bytes, index, box) {
  const ink = { ...box };
  for (const each of charactersOf(kernel, bytes, index)) {
    if (each.x < box.left - EDGE || each.x > box.right + EDGE || each.y < box.bottom - EDGE || each.y > box.top + EDGE) continue;
    ink.left = Math.min(ink.left, each.box.left);
    ink.right = Math.max(ink.right, each.box.right);
    ink.bottom = Math.min(ink.bottom, each.box.bottom);
    ink.top = Math.max(ink.top, each.box.top);
  }
  return ink;
}

/**
 * A picture of a disturbance, written as a PNG to `path`: the page before, the page after, and the difference — every
 * changed pixel red outside the allowed zones and green inside them, the zones shaded blue, the rest of the page grey.
 * For a person to look at what a count says. The PNG is written here, by `zlib`, so no image library is a dependency.
 * @param {string} path @param {Render} before @param {Render} after @param {Box[]} allowed
 */
export function differencePicture(path, before, after, allowed) {
  const { width: w, height: h } = before;
  const zones = allowed.map((box) => {
    const [x0, y0] = before.toDevice(box.left - EDGE, box.top + EDGE);
    const [x1, y1] = before.toDevice(box.right + EDGE, box.bottom - EDGE);
    return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
  });
  const width = w * 3;
  const raw = Buffer.alloc((width * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      const inside = zones.some((zone) => x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1);
      const differs = before.rgb[i] !== after.rgb[i] || before.rgb[i + 1] !== after.rgb[i + 1] || before.rgb[i + 2] !== after.rgb[i + 2];
      const grey = Math.round(((before.rgb[i] ?? 0) + (before.rgb[i + 1] ?? 0) + (before.rgb[i + 2] ?? 0)) / 6 + 128);
      const marked = differs ? (inside ? [0, 160, 0] : [255, 0, 0]) : inside ? [200, 220, 255] : [grey, grey, grey];
      for (let c = 0; c < 3; c += 1) {
        raw[row + 1 + x * 3 + c] = before.rgb[i + c] ?? 0;
        raw[row + 1 + (w + x) * 3 + c] = after.rgb[i + c] ?? 0;
        raw[row + 1 + (2 * w + x) * 3 + c] = marked[c] ?? 0;
      }
    }
  }
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/**
 * How many pixels differ between two renders outside `allowed` (each a box in PDF space, widened by `edge`, {@link EDGE}
 * unless a caller has measured its own), and how many differ inside it.
 * @param {Render} before @param {Render} after @param {Box[]} allowed @param {number} [edge]
 */
export function compare(before, after, allowed, edge = EDGE) {
  if (before.width !== after.width || before.height !== after.height) return { outside: Number.POSITIVE_INFINITY, inside: 0, farthest: Number.POSITIVE_INFINITY };
  const zones = allowed.map((box) => {
    const corners = [
      before.toDevice(box.left - edge, box.bottom - edge),
      before.toDevice(box.right + edge, box.top + edge),
      before.toDevice(box.left - edge, box.top + edge),
      before.toDevice(box.right + edge, box.bottom - edge),
    ];
    return {
      x0: Math.floor(Math.min(...corners.map(([x]) => x))),
      y0: Math.floor(Math.min(...corners.map(([, y]) => y))),
      x1: Math.ceil(Math.max(...corners.map(([x]) => x))),
      y1: Math.ceil(Math.max(...corners.map(([, y]) => y))),
    };
  });
  let outside = 0;
  let inside = 0;
  // HOW FAR OUTSIDE, in device pixels to the nearest allowed zone: a changed pixel just past the margin (a stroke thicker
  // than the margin allows for) and one across the page are both "outside", and only this tells them apart.
  let farthest = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const at = (y * before.width + x) * 3;
      if (before.rgb[at] === after.rgb[at] && before.rgb[at + 1] === after.rgb[at + 1] && before.rgb[at + 2] === after.rgb[at + 2]) continue;
      if (zones.some((zone) => x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1)) inside += 1;
      else {
        outside += 1;
        const near = Math.min(...zones.map((zone) => Math.max(zone.x0 - x, x - zone.x1, zone.y0 - y, y - zone.y1, 0)));
        farthest = Math.max(farthest, near);
      }
    }
  }
  return { outside, inside, farthest };
}
