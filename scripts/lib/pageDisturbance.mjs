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

/**
 * MuPDF's drawing of page `index` of `bytes`, and the map from PDF space to its pixels.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index @returns {Render}
 */
export function render(kernel, bytes, index) {
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
    return out;
  } finally {
    document.destroy();
  }
}

/**
 * Every character MuPDF reads on page `index` of `bytes`: what it is, its origin and its box, in PDF space.
 * @param {any} kernel @param {Uint8Array} bytes @param {number} index
 * @returns {{ character: string, x: number, y: number, box: Box }[]}
 */
export function charactersOf(kernel, bytes, index) {
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
    /** @type {{ character: string, x: number, y: number, box: Box }[]} */
    const found = [];
    const text = page.toStructuredText('preserve-whitespace');
    try {
      text.walk({
        /** @param {string} character @param {[number, number]} origin @param {unknown} _font @param {number} _size @param {number[]} quad */
        onChar: (character, origin, _font, _size, quad) => {
          const [x, y] = toPdf(origin[0], origin[1]);
          const corners = [0, 2, 4, 6].map((at) => toPdf(quad[at] ?? 0, quad[at + 1] ?? 0));
          found.push({
            character,
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
 * How many pixels differ between two renders outside `allowed` (each a box in PDF space, widened by {@link EDGE}), and
 * how many differ inside it.
 * @param {Render} before @param {Render} after @param {Box[]} allowed
 */
export function compare(before, after, allowed) {
  if (before.width !== after.width || before.height !== after.height) return { outside: Number.POSITIVE_INFINITY, inside: 0, farthest: Number.POSITIVE_INFINITY };
  const zones = allowed.map((box) => {
    const corners = [
      before.toDevice(box.left - EDGE, box.bottom - EDGE),
      before.toDevice(box.right + EDGE, box.top + EDGE),
      before.toDevice(box.left - EDGE, box.top + EDGE),
      before.toDevice(box.right + EDGE, box.bottom - EDGE),
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
