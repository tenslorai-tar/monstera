import { describe, expect, it } from 'vitest';

import * as mupdf from './mupdfRaw.js';

/**
 * Only what is inside a mark is removed, and everything outside it stays (the owner's rule, ADR-0286; its amendment of
 * 2026-11-07). Each case draws one shape that crosses a mark's edge, burns the mark in through the cut and MuPDF's own
 * burn-in, and compares the page outside the mark with the page before, at 4x, pixel by pixel.
 *
 * The cut used to rewrite the whole of every path whose ink met a mark, flattened: on these pages that changed up to
 * 1,116 pixels outside the mark, by up to 91 levels and as far as the shape reached, and grew a filled circle from 177
 * bytes to 11,006; and a thin closed shape cut open at its start lost its corner there, outside the mark. It now
 * rewrites only the pieces against the mark, so these cases hold that the rest is drawn as it was.
 */

const MARK = { x0: 250, y0: 350, x1: 350, y1: 450 } as const;
const SCALE = 4;

function circle(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  const p = (x: number, y: number): string => `${String(x)} ${String(y)}`;
  return `${p(cx + r, cy)} m ${p(cx + r, cy + k)} ${p(cx + k, cy + r)} ${p(cx, cy + r)} c ${p(cx - k, cy + r)} ${p(cx - r, cy + k)} ${p(cx - r, cy)} c ${p(cx - r, cy - k)} ${p(cx - k, cy - r)} ${p(cx, cy - r)} c ${p(cx + k, cy - r)} ${p(cx + r, cy - k)} ${p(cx + r, cy)} c h`;
}

/** Forty curves round a centre, their radius waving. */
function blob(cx: number, cy: number): string {
  const p = (a: number, r: number): string => `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  let out = '';
  for (let i = 0; i < 40; i += 1) {
    const a0 = (i / 40) * Math.PI * 2;
    const a1 = ((i + 1) / 40) * Math.PI * 2;
    const r0 = 60 + 12 * Math.sin(i * 1.7);
    const r1 = 60 + 12 * Math.sin((i + 1) * 1.7);
    if (i === 0) out += `${p(a0, r0)} m `;
    out += `${p(a0 + 0.05, r0 + 9)} ${p(a1 - 0.05, r1 - 9)} ${p(a1, r1)} c `;
  }
  return `${out}h`;
}

interface Burned {
  readonly before: Uint8Array;
  readonly after: Uint8Array;
  readonly contentBefore: number;
  readonly contentAfter: number;
}

function pageOf(content: string): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  document.insertPage(-1, document.addPage([0, 0, 612, 792], 0, document.addObject({}), content));
  return document;
}

function drawn(document: mupdf.PDFDocument): Uint8Array {
  const pixmap = document.loadPage(0).toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceGray, false, false);
  try {
    return Uint8Array.from(pixmap.getPixels());
  } finally {
    pixmap.destroy();
  }
}

function contentLength(page: mupdf.PDFPage): number {
  const contents = page.getObject().get('Contents');
  let total = 0;
  if (contents.isArray()) contents.forEach((each) => (total += each.readStream().getLength()));
  else total = contents.readStream().getLength();
  return total;
}

/** The page burned in under MARK by the shim's cut and MuPDF's burn-in, the calls `applyApplyRedactions` makes. */
function burned(content: string): Burned {
  const was = pageOf(content);
  const document = pageOf(content);
  try {
    const before = drawn(was);
    const page = document.loadPage(0);
    if (!(page instanceof mupdf.PDFPage)) throw new Error('the case expected a PDF page');
    const contentBefore = contentLength(page);
    const annot = page.createAnnotation('Redact');
    annot.setRect([MARK.x0, 792 - MARK.y1, MARK.x1, 792 - MARK.y0]);
    annot.update();
    mupdf.cutLineArt(page);
    mupdf.redactPage(page, { blackBoxes: false, imageMethod: 2, lineArt: 0, text: 0 }, 90);
    return { before, after: drawn(document), contentBefore, contentAfter: contentLength(page) };
  } finally {
    was.destroy();
    document.destroy();
  }
}

interface Outside {
  /** Pixels outside the mark that moved by more than 2 levels, by how far out they are. */
  readonly near: number;
  readonly far: number;
  /** The most any of them moved. */
  readonly worst: number;
  /** Pixels inked inside the mark, half a point in from its edge. */
  readonly inside: number;
  /** Pixels the page drew inside the mark before, so `inside` read something. */
  readonly insideBefore: number;
}

/** Outside the mark: `near` within half a point of its edge, `far` beyond. */
function outside(result: Burned): Outside {
  const width = 612 * SCALE;
  let near = 0;
  let far = 0;
  let worst = 0;
  let inside = 0;
  let insideBefore = 0;
  for (let at = 0; at < result.before.length; at += 1) {
    const x = (at % width) / SCALE;
    const y = 792 - Math.floor(at / width) / SCALE;
    const away = Math.max(MARK.x0 - x, x - MARK.x1, MARK.y0 - y, y - MARK.y1);
    if (away < -0.5) {
      if ((result.after[at] ?? 255) < 255) inside += 1;
      if ((result.before[at] ?? 255) < 255) insideBefore += 1;
      continue;
    }
    if (away <= 0) continue;
    const moved = Math.abs((result.before[at] ?? 0) - (result.after[at] ?? 0));
    if (moved <= 2) continue;
    worst = Math.max(worst, moved);
    if (away < 0.5) near += 1;
    else far += 1;
  }
  return { near, far, worst, inside, insideBefore };
}

describe('outside the mark, a burn-in leaves the page as it was', () => {
  it.each([
    ['a filled circle across the mark’s edge', `0.2 g ${circle(250, 400, 40)} f`],
    ['a filled shape of forty curves', `0.4 g ${blob(355, 360)} f`],
    ['a ring filled even-odd', `0.6 g ${circle(250, 330, 30)} ${circle(250, 330, 15)} f*`],
    ['a 3-point stroked circle', `0 G 3 w ${circle(300, 455, 30)} S`],
    ['a grid of 1.5-point lines in one path', `0 G 1.5 w ${Array.from({ length: 9 }, (_, i) => `${String(200 + i * 25)} 320 m ${String(200 + i * 25)} 480 l`).join(' ')} S`],
  ])('%s: no pixel outside the mark moves, and none is drawn inside it', (_name, content) => {
    const read = outside(burned(content));
    expect(read.insideBefore, 'CONTROL: the shape drew inside the mark before').toBeGreaterThan(0);
    expect(read.inside).toBe(0);
    expect({ near: read.near, far: read.far }).toStrictEqual({ near: 0, far: 0 });
  });

  it('a thin closed square cut open by the mark keeps the corner where it starts, outside the mark', () => {
    // STARTS AT (360, 460), outside the mark: the corner the cut used to write as two butt ends.
    const read = outside(burned('0 G 0.5 w 360 460 m 340 460 l 340 440 l 360 440 l h S'));
    expect(read.insideBefore).toBeGreaterThan(0);
    expect(read.inside).toBe(0);
    expect({ near: read.near, far: read.far }).toStrictEqual({ near: 0, far: 0 });
  });

  it('a thin wave of curves across the mark: drawn as it was beyond half a point of the mark’s edge', () => {
    const crest = (i: number): string => (i % 2 === 0 ? '440' : '400');
    const wave = `0 G 0.6 w 180 420 m ${Array.from({ length: 12 }, (_, i) => `${String(190 + i * 20)} ${crest(i)} ${String(200 + i * 20)} ${crest(i)} ${String(200 + i * 20)} 420 c`).join(' ')} S`;
    const read = outside(burned(wave));
    expect(read.insideBefore).toBeGreaterThan(0);
    expect(read.inside).toBe(0);
    // BEYOND HALF A POINT, the curves are drawn as written; a curve split where it meets the mark is drawn by the
    // renderer in two pieces, which it flattens a little differently (measured 2026-11-07: 2 pixels, 3 and 7 levels).
    // WITHIN IT, a thin stroke cut on its centre line ends square where its centre meets the mark, so up to half its
    // width of ink beside that end goes (3 pixels): put to the owner, ADR-0286's amendment.
    expect(read.far).toBeLessThanOrEqual(2);
    expect(read.near).toBeLessThanOrEqual(3);
  });

  it('CONTROL: drawings beside the mark that do not cross it are drawn as they were, near the mark included', () => {
    const read = outside(burned(`0.3 g ${Array.from({ length: 30 }, (_, i) => circle(360 + (i % 6) * 9, 470 + Math.floor(i / 6) * 9, 3)).join(' ')} f`));
    expect({ near: read.near, far: read.far, worst: read.worst }).toStrictEqual({ near: 0, far: 0, worst: 0 });
  });

  it.each([
    ['a filled circle', `0.2 g ${circle(250, 400, 40)} f`, 400],
    ['a filled shape of forty curves', `0.4 g ${blob(355, 360)} f`, 4000],
  ])('%s keeps about its size: what is written is the curves, not their flattening', (_name, content, limit) => {
    const result = burned(content);
    expect(result.contentAfter).toBeLessThan(limit);
  });
});
