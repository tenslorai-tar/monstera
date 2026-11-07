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

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const MARK: Box = { x0: 250, y0: 350, x1: 350, y1: 450 };
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
function burned(content: string, mark: Box = MARK, cut = true): Burned {
  const was = pageOf(content);
  const document = pageOf(content);
  try {
    const before = drawn(was);
    const page = document.loadPage(0);
    if (!(page instanceof mupdf.PDFPage)) throw new Error('the case expected a PDF page');
    const contentBefore = contentLength(page);
    const annot = page.createAnnotation('Redact');
    annot.setRect([mark.x0, 792 - mark.y1, mark.x1, 792 - mark.y0]);
    annot.update();
    // WITHOUT THE CUT, MuPDF's burn-in alone, with its own line-art rule: what the cut is not answerable for.
    if (cut) mupdf.cutLineArt(page);
    mupdf.redactPage(page, { blackBoxes: false, imageMethod: 2, lineArt: cut ? 0 : 1, text: 0 }, 90);
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
  /** The most any of them moved, and the farthest out one is, in points. */
  readonly worst: number;
  readonly farthest: number;
  /** Pixels inked inside the mark, half a point in from its edge. */
  readonly inside: number;
  /** Pixels the page drew inside the mark before, so `inside` read something. */
  readonly insideBefore: number;
}

/** Outside the mark: `near` within half a point of its edge, `far` beyond. */
function outside(result: Burned, mark: Box = MARK): Outside {
  const width = 612 * SCALE;
  let near = 0;
  let far = 0;
  let worst = 0;
  let farthest = 0;
  let inside = 0;
  let insideBefore = 0;
  for (let at = 0; at < result.before.length; at += 1) {
    const x = (at % width) / SCALE;
    const y = 792 - Math.floor(at / width) / SCALE;
    const away = Math.max(mark.x0 - x, x - mark.x1, mark.y0 - y, y - mark.y1);
    if (away < -0.5) {
      if ((result.after[at] ?? 255) < 255) inside += 1;
      if ((result.before[at] ?? 255) < 255) insideBefore += 1;
      continue;
    }
    if (away <= 0) continue;
    const moved = Math.abs((result.before[at] ?? 0) - (result.after[at] ?? 0));
    if (moved <= 2) continue;
    worst = Math.max(worst, moved);
    farthest = Math.max(farthest, away);
    if (away < 0.5) near += 1;
    else far += 1;
  }
  return { near, far, worst, farthest, inside, insideBefore };
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
    // width of ink beside that end goes (3 pixels, up to 89 levels): accepted by the owner, 2026-11-07, removal
    // first (ADR-0286's amendment). These are its figures; a cut that moves more goes red.
    expect(read.far).toBeLessThanOrEqual(2);
    expect(read.near).toBeLessThanOrEqual(3);
    expect(read.worst).toBeLessThanOrEqual(89);
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

/**
 * WHAT STILL CHANGES OUTSIDE THE MARK, and stays: the owner's decisions of 2026-11-07, recorded in ADR-0286's
 * amendment. Each case holds its limit at the figure the owner accepted, so a change beyond it goes red.
 */
describe('the limits the owner accepted, held at their figures', () => {
  /** 4,000 drawings: filled boxes, 0.5-point lines, filled curves and squares stroked through a transform. */
  function drawings(): string {
    let content = '';
    let seed = 3;
    for (let at = 0; at < 4000; at += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const x = 20 + (seed % 560);
      const y = 20 + ((seed >>> 10) % 740);
      const kind = at % 4;
      if (kind === 0) content += `${String((seed % 100) / 100)} g ${String(x)} ${String(y)} 12.5 8.25 re f\n`;
      else if (kind === 1) content += `0.5 w ${String(x)} ${String(y)} m ${String(x + 20.75)} ${String(y + 3.5)} l S\n`;
      else if (kind === 2) content += `${String(x)} ${String(y)} m ${String(x + 5)} ${String(y + 9)} ${String(x + 11)} ${String(y - 4)} ${String(x + 15)} ${String(y + 2)} c h f\n`;
      else content += `q 1 0 0 1 ${String(x)} ${String(y)} cm 0 0 m 6 0 l 6 6 l 0 6 l h S Q\n`;
    }
    return content;
  }

  it('a line cut short where it crosses the mark is drawn a little differently along its length: no more than measured', () => {
    // THE RENDERER'S, not the cut's: a line drawn from its start to where it meets the mark differs from the same
    // line drawn whole. MuPDF's burn-in alone, the control, moves none of these pixels.
    const corner: Box = { x0: 100, y0: 592, x1: 200, y1: 692 };
    const content = drawings();
    const control = outside(burned(content, corner, false), corner);
    expect({ near: control.near, far: control.far }).toStrictEqual({ near: 0, far: 0 });
    const read = outside(burned(content, corner), corner);
    expect(read.inside).toBe(0);
    expect(read.near + read.far).toBeLessThanOrEqual(143);
    expect(read.worst).toBeLessThanOrEqual(14);
    expect(read.farthest).toBeLessThanOrEqual(9);
  });

  it('a 3-point stroke crossing the mark in one subpath is outlined whole: exact, and no larger than measured', () => {
    const result = burned(`0 G 3 w ${circle(300, 455, 30)} S`);
    expect({ near: outside(result).near, far: outside(result).far }).toStrictEqual({ near: 0, far: 0 });
    // 157 bytes before the burn-in, 180,999 before ADR-0286's amendment, 115,053 since.
    expect(result.contentAfter).toBeLessThanOrEqual(115_053);
  });

  it('MuPDF’s burn-in folds nested transforms and moves drawings no mark touches, the same with the cut and without', () => {
    let seed = 11;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    let content = 'q 0.24 0 0 -0.24 0 792 cm\n';
    for (let at = 0; at < 2000; at += 1) {
      const tx = (40 + next() * 2300).toFixed(3);
      const ty = (40 + next() * 1500).toFixed(3);
      const s = (0.7 + next() * 2.3).toFixed(4);
      content += `q 1 0 0 1 ${tx} ${ty} cm ${s} 0 0 ${s} 0 0 cm 0 0 m 3.31 0 6 2.69 6 6 c 6 9.31 3.31 12 0 12 c -3.31 12 -6 9.31 -6 6 c -6 2.69 -3.31 0 0 0 c h f Q\n`;
    }
    content += 'Q';
    // A MARK IN THE TOP-LEFT CORNER, where these shapes reach only by chance.
    const corner: Box = { x0: 0, y0: 784, x1: 8, y1: 792 };
    const withCut = outside(burned(content, corner), corner);
    const without = outside(burned(content, corner, false), corner);
    // NOT THE CUT'S: MuPDF's own content filter multiplies the nested cm operators out (pdf-op-filter.c 1.28.0).
    expect(withCut).toStrictEqual(without);
    // 215 pixels move at all at 4x (measured 2026-11-07), 112 of them by more than 2 levels, which is what this reads.
    expect(withCut.near + withCut.far).toBeLessThanOrEqual(112);
    expect(withCut.worst).toBeLessThanOrEqual(16);
  });
});
