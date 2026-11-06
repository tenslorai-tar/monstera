import { writeFileSync } from 'node:fs';

import { degrees, PDFDocument, PDFName, type PDFRef, rgb, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from './mupdfRaw.js';
import { afterAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyApplyRedactions } from './pageRedact.js';

/**
 * Drawings under redaction marks, read back out of the SAVED FILE (ADR-0286): only what is inside a mark is removed, and
 * everything outside it stays as it was.
 *
 * ## Three readings of every case, and why each
 *
 * 1. **The saved content's points.** Every point a path names — `m`, `l`, `re` corners, the end of every curve — in the
 *    page's content and in every form it draws, taken to page space through `cm` and each form's matrix: none may lie
 *    inside a mark. A render cannot see data a black box hides, so this is the reading the defect needs.
 * 2. **The render outside the marks.** The unmarked document and the burned one, drawn by MuPDF at 2× in RGB, compared
 *    pixel by pixel everywhere further than {@link MARGIN} from any mark: the outside must look as it was.
 * 3. **The original's own tokens**, where a case is about a path staying or going byte for byte.
 *
 * The defect these hold, found by a live run on 2026-11-05: with *remove if covered* a drawn signature under a mark
 * stayed in the saved file under the black box (11 of 19 shapes, d594f808); with *remove if touched* (work/cloud-51, not
 * merged) a background, a line crossing the mark's edge and a line 8 points clear of it went too.
 */

/** A page the size the live run used. */
const PAGE: readonly [number, number] = [612, 460];

/** The live run's line, verbatim: a drawn signature, round-capped, stroked at 1.6. */
const SIGNATURE =
  '100 62 m 118 92 124 88 128 64 c 134 48 146 88 158 68 c 170 50 180 82 196 68 c 212 56 232 78 270 72 c';

/** The same path moved up by `dy` points, so a control is the same shape far from the mark. */
function moved(path: string, dy: number): string {
  const tokens = path.split(' ');
  return tokens
    .map((token, index) => {
      if (!/^-?[\d.]+$/.test(token)) return token;
      let numbersBefore = 0;
      for (let at = index - 1; at >= 0 && /^-?[\d.]+$/.test(tokens[at] ?? ''); at -= 1) numbersBefore += 1;
      return numbersBefore % 2 === 1 ? String(Number(token) + dy) : token;
    })
    .join(' ');
}

/** The Redact area the live run swept, widened to y 42 as its second sweep was: the whole line's ink is inside it. */
const OVER_LINE = { x0: 92, y0: 42, x1: 278, y1: 98 } as const;

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}
type Point = readonly [number, number];
/** A mark's region in user space: its quads where it has them, else its rectangle as one. */
type Region = readonly [Point, Point, Point, Point];

/** Pixels within this many points of a mark may differ: the cut's own edge is drawn there. */
const MARGIN = 1;

/** Every case's render figures, written out at the end when MONSTERA_REDACT_FIGURES names a file, for the report. */
const FIGURES: Record<string, unknown>[] = [];
afterAll(() => {
  const file = process.env['MONSTERA_REDACT_FIGURES'];
  if (file !== undefined) writeFileSync(file, JSON.stringify(FIGURES, null, 1));
});

// ---------------------------------------------------------------- fixtures

interface Painted {
  readonly path: string;
  readonly state: string;
  readonly paint: 'S' | 'f' | 'B';
}

function drawing({ path, state, paint }: Painted): string {
  return [
    `q .1 .2 .45 RG .1 .2 .45 rg ${state} ${path} ${paint} Q`,
    `q .1 .2 .45 RG .1 .2 .45 rg ${state} ${moved(path, 300)} ${paint} Q`,
  ].join('\n');
}

interface Fixture {
  readonly painted: Painted;
  readonly inForm?: boolean;
  readonly rotate?: 0 | 90 | 180 | 270;
}

async function fixture({ painted, inForm = false, rotate = 0 }: Fixture): Promise<ByteImage> {
  const document = await PDFDocument.create();
  const page = document.addPage([...PAGE]);
  if (rotate !== 0) page.setRotation(degrees(rotate));
  let content = drawing(painted);
  if (inForm) {
    // A FORM WITH A MATRIX, placed by a cm: the cut must reach its content in page space through both.
    const form = document.context.stream(`q 1 0 0 1 -10 -5 cm ${content} Q`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [-50, -50, PAGE[0] + 50, PAGE[1] + 50],
      Matrix: [1, 0, 0, 1, 4, 2],
    });
    page.node.setXObject(PDFName.of('Fx'), document.context.register(form));
    content = 'q 1 0 0 1 6 3 cm /Fx Do Q';
  }
  const stream: PDFRef = document.context.register(document.context.stream(content));
  page.node.set(PDFName.of('Contents'), stream);
  return document.save({ useObjectStreams: false });
}

/** A page whose content is `content` alone, with `resources` as its resource dictionary. */
async function pageOf(content: string, resources: (document: PDFDocument) => Record<string, unknown> = () => ({})): Promise<ByteImage> {
  const document = await PDFDocument.create();
  const page = document.addPage([...PAGE]);
  page.node.set(PDFName.of('Resources'), document.context.obj(resources(document) as never));
  page.node.set(PDFName.of('Contents'), document.context.register(document.context.stream(content)));
  return document.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------- the burn-in, through the app's command path

type Mark =
  | { readonly kind: 'area'; readonly rect: Rect }
  | { readonly kind: 'text'; readonly from: { x: number; y: number }; readonly to: { x: number; y: number } };

interface Burned {
  /** The saved, reopened file's bytes. */
  readonly saved: ByteImage;
  /** Every mark's region, read from the file before the burn-in consumed them. */
  readonly regions: readonly Region[];
  /** The page's content and every form's, as text. */
  readonly content: string;
}

/** Each Redact mark's region on page 0, in user space: its quads, else its /Rect. */
function regionsOf(document: mupdf.PDFDocument): Region[] {
  const regions: Region[] = [];
  for (const annotation of document.loadPage(0).getAnnotations()) {
    if (annotation.getType() !== 'Redact') continue;
    const object = annotation.getObject();
    const quads = object.get('QuadPoints');
    if (quads.isArray() && quads.length >= 8) {
      for (let at = 0; at + 8 <= quads.length; at += 8) {
        const v = Array.from({ length: 8 }, (_, i) => quads.get(at + i).asNumber());
        regions.push([
          [v[0] ?? 0, v[1] ?? 0],
          [v[2] ?? 0, v[3] ?? 0],
          [v[6] ?? 0, v[7] ?? 0],
          [v[4] ?? 0, v[5] ?? 0],
        ]);
      }
    } else {
      const r = object.get('Rect');
      const [x0, y0, x1, y1] = [0, 1, 2, 3].map((i) => r.get(i).asNumber()) as [number, number, number, number];
      regions.push([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
    }
  }
  return regions;
}

async function burned(bytes: ByteImage, marks: readonly Mark[], cover: 'solid' | 'none' = 'solid'): Promise<Burned> {
  const session: MupdfSession = await mupdfWriter.open(bytes);
  try {
    for (const mark of marks) {
      await applyAddAnnotation(session, {
        kind: 'addAnnotation',
        page: 0,
        stamp: { author: 'A. Tester', created: '2026-11-05T09:00:00.000Z' },
        annotation:
          mark.kind === 'area'
            ? { type: 'redact', over: 'region', rect: mark.rect, colour: [0.85, 0.15, 0.15], opacity: 1 }
            : { type: 'redact', over: 'text', from: mark.from, to: mark.to, colour: [0.85, 0.15, 0.15], opacity: 1 },
      });
    }
    const regions = await withDocument(session, (document) => regionsOf(document));
    if (marks.length > 0) {
      // The dialog's defaults: a filled box, and only the covered part of a picture blanked.
      await applyApplyRedactions(session, { kind: 'applyRedactions', pages: 'all', cover, images: 'pixels', keepTitle: false, keepBookmarks: false });
    }
    const saved = await mupdfWriter.serialise(session);
    const again = await mupdfWriter.open(saved);
    try {
      const content = await withDocument(again, (document) => contentOf(document, 0));
      return { saved, regions, content };
    } finally {
      await mupdfWriter.close(again);
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

// ---------------------------------------------------------------- reading 1: the saved content's points

/** Every content stream the page draws, as text: its own and every form reachable from its resources. */
function contentOf(document: mupdf.PDFDocument, index: number): string {
  const parts: string[] = [];
  const streamsOf = (object: mupdf.PDFObject): void => {
    if (object.isStream()) parts.push(object.readStream().asString());
    else if (object.isArray()) for (let at = 0; at < object.length; at += 1) streamsOf(object.get(at));
  };
  const seen = new Set<number>();
  const formsOf = (resources: mupdf.PDFObject): void => {
    if (resources.isNull()) return;
    const listed = resources.resolve().get('XObject');
    if (listed.isNull()) return;
    listed.resolve().forEach((value) => {
      if (value.isIndirect()) {
        if (seen.has(value.asIndirect())) return;
        seen.add(value.asIndirect());
      }
      if (!value.isStream() || value.get('Subtype').asName() !== 'Form') return;
      parts.push(value.readStream().asString());
      formsOf(value.get('Resources'));
    });
  };
  const page = document.loadPage(index).getObject();
  streamsOf(page.get('Contents'));
  formsOf(page.getInheritable('Resources'));
  return parts.join('\n').replace(/\s+/g, ' ');
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function concat(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Every point a path names in a content stream, in page space, following `q`, `Q`, `cm` and each form's `/Matrix`
 * through `Do`. A curve's control points are not its ink, so only its end is taken.
 */
function pathPoints(document: mupdf.PDFDocument, index: number): Point[] {
  const out: Point[] = [];
  const run = (stream: mupdf.PDFObject, resources: mupdf.PDFObject, base: Matrix, depth: number): void => {
    if (depth > 8) return;
    const tokens = stream.readStream().asString().replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').split(/\s+/).filter((t) => t !== '');
    const stack: Matrix[] = [];
    let ctm: Matrix = IDENTITY;
    const numbers: number[] = [];
    let name: string | undefined;
    for (const token of tokens) {
      if (/^-?(\d+\.?\d*|\.\d+)$/.test(token)) {
        numbers.push(Number(token));
        continue;
      }
      if (token.startsWith('/')) {
        name = token.slice(1);
        numbers.length = 0;
        continue;
      }
      const total = concat(ctm, base);
      const take = (x: number | undefined, y: number | undefined): void => {
        if (x !== undefined && y !== undefined) out.push(apply(total, x, y));
      };
      switch (token) {
        case 'q':
          stack.push(ctm);
          break;
        case 'Q':
          ctm = stack.pop() ?? IDENTITY;
          break;
        case 'cm':
          if (numbers.length >= 6) ctm = concat(numbers.slice(-6) as unknown as Matrix, ctm);
          break;
        case 'm':
        case 'l':
          take(numbers.at(-2), numbers.at(-1));
          break;
        case 'c':
        case 'v':
        case 'y':
          take(numbers.at(-2), numbers.at(-1));
          break;
        case 're': {
          const [x, y, w, h] = numbers.slice(-4);
          if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
            take(x, y);
            take(x + w, y);
            take(x + w, y + h);
            take(x, y + h);
          }
          break;
        }
        case 'Do': {
          const xobject = name === undefined || resources.isNull() ? undefined : resources.resolve().get('XObject');
          const form = xobject === undefined || xobject.isNull() ? undefined : xobject.resolve().get(name ?? '');
          if (form !== undefined && form.isStream() && form.get('Subtype').asName() === 'Form') {
            const matrix = form.get('Matrix');
            const m: Matrix = matrix.isArray() ? ([0, 1, 2, 3, 4, 5].map((i) => matrix.get(i).asNumber()) as unknown as Matrix) : IDENTITY;
            const inner = form.get('Resources');
            run(form, inner.isNull() ? resources : inner, concat(m, total), depth + 1);
          }
          break;
        }
        default:
          break;
      }
      numbers.length = 0;
    }
  };
  const page = document.loadPage(index).getObject();
  const contents = page.get('Contents');
  const resources = page.getInheritable('Resources');
  if (contents.isStream()) run(contents, resources, IDENTITY, 0);
  else if (contents.isArray()) for (let at = 0; at < contents.length; at += 1) run(contents.get(at), resources, IDENTITY, 0);
  return out;
}

/** Whether `p` lies inside the convex region by more than `inset` points. */
function inside(region: Region, p: Point, inset = 0.01): boolean {
  const n = region.length;
  let sign = 0;
  for (let i = 0; i < n; i += 1) {
    const a = region[i] ?? [0, 0];
    const b = region[(i + 1) % n] ?? [0, 0];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const distance = cross / length;
    if (Math.abs(distance) <= inset) return false;
    const s = Math.sign(distance);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** The points the saved page's paths name inside any mark: none, for a burn-in that removed what was marked. */
async function pointsInsideMarks(result: Burned): Promise<Point[]> {
  const session = await mupdfWriter.open(result.saved);
  try {
    return await withDocument(session, (document) =>
      pathPoints(document, 0).filter((p) => result.regions.some((region) => inside(region, p))),
    );
  } finally {
    await mupdfWriter.close(session);
  }
}

// ---------------------------------------------------------------- reading 2: the render outside the marks

interface Rendered {
  readonly width: number;
  readonly height: number;
  readonly samples: Uint8Array;
  readonly transform: Matrix;
}

const SCALE = 2;

function render(bytes: ByteImage, scale = SCALE): Rendered {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    const page = document.loadPage(0);
    // WITHOUT ANNOTATIONS: a pending mark's own appearance is not the page.
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, false);
    const [a, b, c, d, e, f] = page.getTransform();
    return {
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
      samples: Uint8Array.from(pixmap.getPixels()),
      transform: concat([a, b, c, d, e, f], [scale, 0, 0, scale, 0, 0]),
    };
  } finally {
    document.destroy();
  }
}

/** A render at `n` times the scale, each n × n block averaged into one pixel: the same page at 1/n its size. */
function reduced(big: Rendered, n: number): Rendered {
  const width = Math.floor(big.width / n);
  const height = Math.floor(big.height / n);
  const samples = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      for (let k = 0; k < 3; k += 1) {
        let sum = 0;
        for (let dy = 0; dy < n; dy += 1)
          for (let dx = 0; dx < n; dx += 1) sum += big.samples[((n * y + dy) * big.width + n * x + dx) * 3 + k] ?? 0;
        samples[(y * width + x) * 3 + k] = Math.round(sum / (n * n));
      }
  const [a, b, c, d, e, f] = big.transform;
  return { width, height, samples, transform: [a / n, b / n, c / n, d / n, e / n, f / n] };
}

/** The distance from `p` to a convex region, 0 inside it. */
function distanceTo(region: Region, p: Point): number {
  if (inside(region, p, 0)) return 0;
  let best = Infinity;
  for (let i = 0; i < region.length; i += 1) {
    const a = region[i] ?? [0, 0];
    const b = region[(i + 1) % region.length] ?? [0, 0];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

/**
 * How the burned render differs from the original outside the marks.
 *
 * ## Why an edge pixel may differ, and by how much
 *
 * A cut curve and a cut stroke's round caps and joins are polygons, flattened to 0.01 point; a viewer flattens the
 * original at its own tolerance, which depends on the zoom (MuPDF: 0.3 device pixel, so 0.075 point at this 2×). Both
 * approximate the same curve, and where they disagree is the anti-aliased edge of the original's ink, by a fraction of a
 * pixel. So a pixel that differs is allowed only where the original is an edge there — its 3 × 3 neighbourhood holds both
 * lighter and darker pixels — and then by at most {@link EDGE_TOLERANCE}. Anywhere else, ink added or taken away is a
 * difference of more than 8 in a pixel no edge explains, and that is {@link Difference.offEdge}, which must be 0.
 * Measured 2026-11-05: straight butt-capped dashes differed in no pixel at all; round-capped ones by up to 50 of 255 on
 * their caps' edge pixels.
 */
interface Difference {
  /** Pixels further than {@link MARGIN} from every mark. */
  readonly outside: number;
  /** Of those, how many differ in any channel by more than 8 of 255, edge or not. */
  readonly differing: number;
  /** Of those, how many are not on an edge of the original: ink added or taken away. */
  readonly offEdge: number;
  /** The largest channel difference among them. */
  readonly worst: number;
}

const EDGE_TOLERANCE = 64;

function differenceOutside(before: Rendered, after: Rendered, regions: readonly Region[]): Difference {
  const [a, b, c, d, e, f] = before.transform;
  const det = a * d - b * c;
  const toUser = (x: number, y: number): Point => {
    const px = x - e;
    const py = y - f;
    return [(d * px - c * py) / det, (-b * px + a * py) / det];
  };
  let outside = 0;
  let differing = 0;
  let offEdge = 0;
  let worst = 0;
  const value = (x: number, y: number, k: number): number => before.samples[(y * before.width + x) * 3 + k] ?? 0;
  /** Whether the original is an edge at (x, y): its 3 × 3 neighbourhood spans more than 8 in some channel. */
  const edge = (x: number, y: number): boolean => {
    for (let k = 0; k < 3; k += 1) {
      let lo = 255;
      let hi = 0;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = Math.min(before.width - 1, Math.max(0, x + dx));
          const ny = Math.min(before.height - 1, Math.max(0, y + dy));
          lo = Math.min(lo, value(nx, ny, k));
          hi = Math.max(hi, value(nx, ny, k));
        }
      if (hi - lo > 8) return true;
    }
    return false;
  };
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const p = toUser(x + 0.5, y + 0.5);
      // A PIXEL'S REACH: half its diagonal in points, so a pixel any part of which is near a mark is left out.
      if (regions.some((region) => distanceTo(region, p) <= MARGIN + Math.SQRT1_2 / SCALE)) continue;
      outside += 1;
      const at = (y * before.width + x) * 3;
      let most = 0;
      for (let k = 0; k < 3; k += 1) most = Math.max(most, Math.abs((before.samples[at + k] ?? 0) - (after.samples[at + k] ?? 0)));
      if (most > 8) {
        differing += 1;
        if (!edge(x, y) || most > EDGE_TOLERANCE) offEdge += 1;
      }
      worst = Math.max(worst, most);
    }
  }
  return { outside, differing, offEdge, worst };
}

/** Whether every pixel wholly inside the marks is the page's white: nothing painted there, with no box left behind. */
function blankInside(after: Rendered, regions: readonly Region[]): { readonly inside: number; readonly painted: number } {
  const [a, b, c, d, e, f] = after.transform;
  const det = a * d - b * c;
  let inner = 0;
  let painted = 0;
  for (let y = 0; y < after.height; y += 1) {
    for (let x = 0; x < after.width; x += 1) {
      const px = x + 0.5 - e;
      const py = y + 0.5 - f;
      const p: Point = [(d * px - c * py) / det, (-b * px + a * py) / det];
      if (!regions.some((region) => inside(region, p, 1))) continue;
      inner += 1;
      const at = (y * after.width + x) * 3;
      if ((after.samples[at] ?? 0) < 250 || (after.samples[at + 1] ?? 0) < 250 || (after.samples[at + 2] ?? 0) < 250) painted += 1;
    }
  }
  return { inside: inner, painted };
}

/** The tail of a path — its last segment — as a token run, which is how it is found in a stream. */
function tailOf(path: string): string {
  const tokens = path.trim().replace(/ h$/, '').split(' ');
  const last = tokens.length - 1;
  let start = last - 1;
  while (start > 0 && /^-?[\d.]+$/.test(tokens[start - 1] ?? '')) start -= 1;
  return tokens.slice(start, last + 1).join(' ');
}

/**
 * The whole rule for one case: nothing the saved page draws names a point inside a mark, the page renders as it did
 * outside every mark, and — with nothing left behind — nothing is painted inside one.
 */
async function holdsTheRule(bytes: ByteImage, marks: readonly Mark[]): Promise<{ readonly burned: Burned; readonly difference: Difference }> {
  const result = await burned(bytes, marks, 'none');
  expect(result.regions.length, 'the marks were read').toBeGreaterThan(0);
  expect(await pointsInsideMarks(result), 'points inside a mark').toStrictEqual([]);
  const difference = differenceOutside(render(bytes), render(result.saved), result.regions);
  expect(difference.outside, 'the render was read outside the marks').toBeGreaterThan(1000);
  expect(difference, 'the page outside the marks').toMatchObject({ offEdge: 0 });
  FIGURES.push({ case: expect.getState().currentTestName ?? '', ...difference });
  const blank = blankInside(render(result.saved), result.regions);
  expect(blank.inside, 'the render was read inside the marks').toBeGreaterThan(0);
  expect(blank.painted, 'pixels painted inside a mark, with nothing left behind').toBe(0);
  return { burned: result, difference };
}

// ---------------------------------------------------------------- the class

const CLASS: readonly (Fixture & { readonly name: string })[] = [
  { name: 'the live run’s curved signature, round caps, 1.6 wide', painted: { path: SIGNATURE, state: '1 J 1.6 w', paint: 'S' } },
  { name: 'a straight diagonal stroke', painted: { path: '100 50 m 270 90 l', state: '1.6 w', paint: 'S' } },
  { name: 'a straight level stroke', painted: { path: '100 70 m 270 70 l', state: '1.6 w', paint: 'S' } },
  { name: 'a filled curved shape', painted: { path: `${SIGNATURE} h`, state: '', paint: 'f' } },
  { name: 'a filled and stroked curved shape', painted: { path: `${SIGNATURE} h`, state: '1.6 w', paint: 'B' } },
  ...([0, 1, 2] as const).flatMap((cap) =>
    ([0, 1, 2] as const).map((join) => ({
      name: `the signature with line cap ${String(cap)} and line join ${String(join)}`,
      painted: { path: SIGNATURE, state: `${String(cap)} J ${String(join)} j 1.6 w`, paint: 'S' as const },
    })),
  ),
  { name: 'the signature drawn from inside a form XObject with a matrix', painted: { path: SIGNATURE, state: '1 J 1.6 w', paint: 'S' }, inForm: true },
  { name: 'a thick stroke, 6 wide', painted: { path: SIGNATURE, state: '1 J 6 w', paint: 'S' } },
  { name: 'a dashed stroke, 2 wide', painted: { path: SIGNATURE, state: '[6 3] 1 d 2 w', paint: 'S' } },
  { name: 'a dashed hairline, 0.5 wide', painted: { path: SIGNATURE, state: '[6 3] 0 d 0.5 w', paint: 'S' } },
  ...([90, 180, 270] as const).map((rotate) => ({
    name: `the signature on a page turned ${String(rotate)} degrees`,
    painted: { path: SIGNATURE, state: '1 J 1.6 w', paint: 'S' as const },
    rotate,
  })),
];

const AREA: readonly Mark[] = [{ kind: 'area', rect: OVER_LINE }];

describe('drawings under a Redact area mark, read back from the saved file (ADR-0286)', () => {
  for (const shape of CLASS) {
    it(`CONTROL: unredacted, the saved file carries ${shape.name} and its far copy`, async () => {
      const { content } = await burned(await fixture(shape), []);
      expect(content).toContain(tailOf(shape.painted.path));
      expect(content).toContain(tailOf(moved(shape.painted.path, 300)));
    });

    it(`REMOVES ${shape.name} under the mark, keeps its far copy as it was, and changes nothing outside`, async () => {
      const { burned: result } = await holdsTheRule(await fixture(shape), AREA);
      expect(result.content).not.toContain(tailOf(shape.painted.path));
      // THE FAR COPY, BYTE FOR BYTE: a path whose ink meets no mark is passed on unchanged.
      expect(result.content).toContain(tailOf(moved(shape.painted.path, 300)));
    });
  }

  it('CONTROL: the content reading sees a point inside a mark, and the render reading sees a change outside one', async () => {
    // WITHOUT THESE the two readings could be blind: a reading that never finds a point, or a render compared with itself.
    const bytes = await fixture(CLASS[0] ?? { painted: { path: SIGNATURE, state: '', paint: 'S' } });
    const unburned = await burned(bytes, []);
    const regions: Region[] = [
      [
        [OVER_LINE.x0, OVER_LINE.y0],
        [OVER_LINE.x1, OVER_LINE.y0],
        [OVER_LINE.x1, OVER_LINE.y1],
        [OVER_LINE.x0, OVER_LINE.y1],
      ],
    ];
    expect((await pointsInsideMarks({ ...unburned, regions })).length).toBeGreaterThan(0);
    const other = await pageOf('q 0 0 1 rg 400 300 50 50 re f Q');
    // AND THE EDGE ALLOWANCE DOES NOT SWALLOW INK: a square drawn where there was none is off any edge.
    expect(differenceOutside(render(bytes), render(other), regions).offEdge).toBeGreaterThan(100);
  });

  it('a picture of a signature wholly under the mark goes, and the one the mark does not reach stays', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([...PAGE]);
    const [width, height] = [34, 10];
    const samples = new Uint8Array(width * height).fill(255);
    for (let x = 0; x < width; x += 1) samples[Math.round(5 + 3 * Math.sin(x / 3)) * width + x] = 0;
    const image = (): PDFRef =>
      document.context.register(
        document.context.stream(samples, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
      );
    page.node.setXObject(PDFName.of('ImA'), image());
    page.node.setXObject(PDFName.of('ImB'), image());
    page.node.set(
      PDFName.of('Contents'),
      document.context.register(document.context.stream('q 170 0 0 50 100 45 cm /ImA Do Q\nq 170 0 0 50 100 345 cm /ImB Do Q')),
    );
    const bytes = await document.save({ useObjectStreams: false });
    const result = await burned(bytes, AREA);
    // BY PLACEMENT, NOT NAME: the burn-in renames the resources it keeps (`/ImB` comes back as `/Im1`).
    expect(result.content).toMatch(/100 45 cm Q/);
    expect(result.content).toMatch(/100 345 cm \/\S+ Do/);
    expect(differenceOutside(render(bytes), render(result.saved), result.regions).differing).toBe(0);
  });
});

describe('only what is inside a mark goes, and everything outside stays as it was', () => {
  it('a line crossing the mark’s edge loses only its part inside the mark', async () => {
    const bytes = await pageOf('q 1.6 w 40 70 m 400 70 l S Q\nq 0.5 w 40 75 m 400 75 l S Q');
    const { burned: result } = await holdsTheRule(bytes, AREA);
    // THE PARTS OUTSIDE ARE DRAWN: something of each line is painted either side of the mark.
    const after = render(result.saved);
    const ink = (xPt: number, yPt: number): number => {
      const [x, y] = apply(after.transform, xPt, yPt).map(Math.floor) as [number, number];
      return after.samples[(y * after.width + x) * 3] ?? 255;
    };
    expect(ink(60, 70)).toBeLessThan(128);
    expect(ink(350, 70)).toBeLessThan(128);
    expect(ink(60, 75)).toBeLessThan(200);
    expect(ink(350, 75)).toBeLessThan(200);
  });

  it('a mitre-joined line whose ink stays 8 points clear of the mark is passed on byte for byte', async () => {
    const near = moved(SIGNATURE, 44);
    const bytes = await pageOf(`q 1.6 w ${near} S Q`);
    const { burned: result } = await holdsTheRule(bytes, AREA);
    expect(result.content).toContain(near);
  });

  it('a page-wide background keeps everything outside the mark and nothing inside it', async () => {
    await holdsTheRule(await pageOf('q .85 .9 1 rg 0 0 612 460 re f Q\nq 0 0 0 RG 1.6 w 40 370 m 400 370 l S Q'), AREA);
  });

  it('a thick line whose centre stays outside the mark but whose ink reaches into it is cut where the ink enters', async () => {
    // 10 wide, centred 3 points below the mark's bottom edge: 2 points of ink reach into the mark.
    await holdsTheRule(await pageOf('q 10 w 0 0 1 RG 40 39 m 400 39 l S Q'), AREA);
  });

  it('a thick dashed straight line crossing the mark keeps every dash outside it exactly', async () => {
    await holdsTheRule(await pageOf('q 4 w [9 4] 2 d 0 J 0 .5 0 RG 40 70 m 400 70 l S Q\nq 4 w [9 4] 2 d 1 J 1 0 0 RG 40 80 m 400 85 l S Q'), AREA);
  });

  it('a thick dashed CURVE crossing the mark is nearer the original’s true dashes than the original’s own render is', async () => {
    // A VIEWER LAYS DASHES OUT ON ITS OWN FLATTENING of the curve, which depends on the zoom (MuPDF: 0.3 device pixel);
    // the cut lays them out on a 0.01 point one. So the yardstick is the original drawn at 8× and averaged down to 2×,
    // its dashes laid out on a flattening four times finer: the cut must be at least as near it as MuPDF's own 2× is.
    const bytes = await pageOf('q 4 w [9 4] 2 d 1 J 0 .5 0 RG 40 70 m 120 60 230 90 400 70 c S Q');
    const result = await burned(bytes, AREA, 'none');
    expect(await pointsInsideMarks(result)).toStrictEqual([]);
    const fine = reduced(render(bytes, 4 * SCALE), 4);
    const cut = differenceOutside(fine, render(result.saved), result.regions);
    const itself = differenceOutside(fine, render(bytes), result.regions);
    FIGURES.push({ case: 'dashed curve: the cut at 2x against the original at 8x reduced', ...cut });
    FIGURES.push({ case: 'dashed curve: the original at 2x against itself at 8x reduced', ...itself });
    FIGURES.push({ case: 'dashed curve: the cut at 2x against the original at 2x', ...differenceOutside(render(bytes), render(result.saved), result.regions) });
    expect(cut.offEdge).toBeLessThanOrEqual(itself.offEdge);
  });

  it('several marks on one page each take their own part, and an unmarked signature stays', async () => {
    const bytes = await pageOf(
      [`q 1.6 w ${SIGNATURE} S Q`, `q 1.6 w ${moved(SIGNATURE, 150)} S Q`, `q 1.6 w ${moved(SIGNATURE, 300)} S Q`].join('\n'),
    );
    const { burned: result } = await holdsTheRule(bytes, [
      { kind: 'area', rect: OVER_LINE },
      { kind: 'area', rect: { x0: OVER_LINE.x0, y0: OVER_LINE.y0 + 150, x1: OVER_LINE.x1, y1: OVER_LINE.y1 + 150 } },
    ]);
    expect(result.content).toContain(moved(SIGNATURE, 300));
  });

  it('overlapping marks take the signature under their union, and keep what is outside both', async () => {
    await holdsTheRule(await pageOf(`q 1.6 w ${SIGNATURE} S Q\nq 1.6 w 30 70 m 600 70 l S Q`), [
      { kind: 'area', rect: { x0: 92, y0: 42, x1: 200, y1: 98 } },
      { kind: 'area', rect: { x0: 150, y0: 50, x1: 278, y1: 96 } },
    ]);
  });

  it('a clip path crossing the mark is cut, and the black box over the mark is still drawn', async () => {
    // A circle-ish clip through the mark, at the page's own level, clipping a filled square and a line.
    const clip = '150 70 m 150 125 205 160 260 160 c 315 160 360 125 360 70 c 360 15 315 -20 260 -20 c 205 -20 150 15 150 70 c h W n';
    const bytes = await pageOf(`${clip} 0 .6 0 rg 100 0 400 200 re f 0 0 0 RG 2 w 100 60 m 500 60 l S`);
    await holdsTheRule(bytes, AREA);
    const solid = await burned(bytes, AREA, 'solid');
    const after = render(solid.saved);
    const [x, y] = apply(after.transform, 200, 70).map(Math.floor) as [number, number];
    // THE BOX IS BLACK where it was asked for, inside the old clip: a cut clip must not hide the burn-in's own box.
    expect(after.samples[(y * after.width + x) * 3]).toBeLessThan(40);
  });

  it('an unpainted path entering a mark is dropped, and one clear of every mark is kept', async () => {
    const result = await burned(await pageOf('q 120 70 m 200 80 l n 120 300 m 200 310 l n 0 0 1 rg 300 300 20 20 re f Q'), AREA);
    expect(result.content).not.toContain('200 80 l');
    expect(result.content).toContain('200 310 l');
  });
});

describe('Redact text marks, and the cells the words sit in', () => {
  /** A word in a shaded cell, a word in a boxed cell, and a word on a line turned 30 degrees in a shaded band. */
  async function table(): Promise<ByteImage> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([...PAGE]);
    page.drawRectangle({ x: 60, y: 300, width: 200, height: 40, color: rgb(0.8, 0.9, 1) });
    page.drawText('Salary 91000', { x: 70, y: 312, size: 16, font });
    page.drawRectangle({ x: 300, y: 300, width: 200, height: 40, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
    page.drawText('Account 4471', { x: 310, y: 312, size: 16, font });
    page.drawRectangle({ x: 80, y: 80, width: 260, height: 30, color: rgb(1, 0.92, 0.8), rotate: degrees(30) });
    page.drawText('Turned secret words', { x: 90, y: 90, size: 16, font, rotate: degrees(30) });
    return document.save({ useObjectStreams: false });
  }

  it('CONTROL: the words are on the page before any mark', async () => {
    const { content } = await burned(await table(), []);
    expect(content.length).toBeGreaterThan(100);
  });

  it('a word in a shaded cell and a word in a boxed cell: the shading and the box stay outside the marks', async () => {
    const { burned: result } = await holdsTheRule(await table(), [
      { kind: 'text', from: { x: 71, y: 318 }, to: { x: 120, y: 318 } },
      { kind: 'text', from: { x: 311, y: 318 }, to: { x: 372, y: 318 } },
    ]);
    // A TEXT MARK IS ITS QUADS: the shading and the box are cut round the words, never taken whole.
    expect(result.regions.length).toBeGreaterThanOrEqual(2);
  });

  it('a slanted quad on turned text cuts the turned shading along the slant', async () => {
    const turn = (s: number): { x: number; y: number } => ({ x: 92 + s * Math.cos(Math.PI / 6), y: 95 + s * Math.sin(Math.PI / 6) });
    // THE WHOLE TURNED LINE: MuPDF's text rule takes any glyph a quad touches whole, which is the text removal's own
    // behaviour and not the cut's, so the mark ends past the line's last letter.
    const { burned: result } = await holdsTheRule(await table(), [{ kind: 'text', from: turn(-1), to: turn(175) }]);
    // SLANTED, not an upright box: one of the quad's edges is neither level nor upright.
    const quad = result.regions[0];
    expect(quad).toBeDefined();
    const [a, b] = quad ?? [
      [0, 0],
      [0, 0],
    ];
    expect(Math.abs(b[1] - a[1]) > 1 && Math.abs(b[0] - a[0]) > 1).toBe(true);
  });
});

describe('what the cut does not reach, said so', () => {
  it('STATED: a gradient painted with `sh` keeps its data, and paints nothing inside the mark once its clip is cut', async () => {
    const shading = (document: PDFDocument, dy: number): PDFRef =>
      document.context.register(
        document.context.obj({
          ShadingType: 2,
          ColorSpace: 'DeviceRGB',
          Coords: [100, 50 + dy, 270, 90 + dy],
          Function: { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 },
        }),
      );
    // ShA's clip lies wholly inside the mark; ShB's far from it; ShC's crosses the mark's right edge.
    const bytes = await pageOf(
      'q 100 50 170 40 re W n /ShA sh Q\nq 100 350 170 40 re W n /ShB sh Q\nq 250 55 120 30 re W n /ShC sh Q',
      (document) => ({ Shading: { ShA: shading(document, 0), ShB: shading(document, 300), ShC: shading(document, 5) } }),
    );
    const result = await burned(bytes, AREA, 'none');
    // THE GRADIENT WHOLLY UNDER THE MARK IS NOT PAINTED: its clip is cut to nothing, and MuPDF's burn-in then drops a
    // shading painted in an empty clip. The other two are painted, and the one that crosses the mark keeps its
    // definition — coordinates and function — whole, since a function cannot be cut: it is what can survive.
    expect(result.content.match(/ sh /g)?.length).toBe(2);
    expect(blankInside(render(result.saved), result.regions).painted).toBe(0);
    expect(differenceOutside(render(bytes), render(result.saved), result.regions).offEdge).toBe(0);
  });

  it('STATED: a tiling pattern’s cell stays whole in the file, and the fill and the stroke it paints are cut, so none of it shows under the mark', async () => {
    // The cell: a red square in each 20 point tile. A filled rectangle wider than the mark, and a 6 point stroke across
    // it, both painted with the pattern.
    const bytes = await pageOf(
      '/Pattern cs /P1 scn 60 30 260 80 re f\nq /Pattern CS /P1 SCN 6 w 60 130 m 320 60 l S Q',
      (document) => ({
        Pattern: {
          P1: document.context.register(
            document.context.stream(CELL, { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 20, 20], XStep: 20, YStep: 20, Resources: {} }),
          ),
        },
      }),
    );
    expect(blankInside(render(bytes), [rectRegion(OVER_LINE)]).painted, 'CONTROL: unredacted, the pattern paints under the mark').toBeGreaterThan(0);
    const { burned: result } = await holdsTheRule(bytes, AREA);
    // WHAT STAYS: the cell's own content, which is drawn wherever the cut fill reaches and is not a drawing on the page.
    expect(streamsOf(result.saved)).toContain(CELL);
    expect(result.content).toContain('/P1 scn');
  });

  it('STATED: a soft mask’s group stays whole in the file, and the fill it masks is cut, so none of it shows under the mark', async () => {
    // The mask is white (all visible) with a black hole drawn under the mark; it masks a blue rectangle wider than the mark.
    const bytes = await pageOf('q /GS1 gs 0 0 1 rg 60 30 260 80 re f Q', (document) => ({
      ExtGState: {
        GS1: {
          SMask: {
            Type: 'Mask',
            S: 'Luminosity',
            G: document.context.register(
              document.context.stream(MASK, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, ...PAGE], Group: { S: 'Transparency', CS: 'DeviceRGB' }, Resources: {} }),
            ),
          },
        },
      },
    }));
    expect(blankInside(render(bytes), [rectRegion(OVER_LINE)]).painted, 'CONTROL: unredacted, the masked fill shows under the mark').toBeGreaterThan(0);
    const { burned: result } = await holdsTheRule(bytes, AREA);
    // WHAT STAYS: the mask's own drawing, the hole under the mark included. It is a mask, which paints nothing itself.
    expect(streamsOf(result.saved)).toContain(MASK);
    expect(result.content).toContain('/GS1 gs');
  });

  it('STATED: a Type 3 font’s glyph drawings stay in the file, and every glyph shown under the mark goes, so none of it shows there', async () => {
    // A square glyph, 20 points wide at this size. Four shown wholly under the mark, one across its right edge, one far.
    const bytes = await pageOf('BT /T3 20 Tf 120 60 Td (AAAA) Tj ET\nBT /T3 20 Tf 270 60 Td (A) Tj ET\nBT /T3 20 Tf 120 300 Td (A) Tj ET', (document) => ({
      Font: {
        T3: document.context.obj({
          Type: 'Font',
          Subtype: 'Type3',
          FontBBox: [0, 0, 1000, 1000],
          FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
          CharProcs: { square: document.context.register(document.context.stream(GLYPH)) },
          Encoding: { Type: 'Encoding', Differences: [65, PDFName.of('square')] },
          FirstChar: 65,
          LastChar: 65,
          Widths: [1000],
          Resources: {},
        }),
      },
    }));
    expect(blankInside(render(bytes), [rectRegion(OVER_LINE)]).painted, 'CONTROL: unredacted, the glyphs paint under the mark').toBeGreaterThan(0);
    const result = await burned(bytes, AREA, 'none');
    // NOTHING SHOWS UNDER THE MARK, and nothing is written there: MuPDF's text removal takes each glyph that meets it.
    expect(blankInside(render(result.saved), result.regions).painted, 'pixels painted inside the mark').toBe(0);
    expect(await pointsInsideMarks(result)).toStrictEqual([]);
    // WHAT STAYS: the font's glyph procedure, used by the far glyph, which is still shown.
    expect(streamsOf(result.saved)).toContain(GLYPH);
    expect(result.content).toMatch(/120 300 T[dD] \(A\) ?Tj/);
    // THE GLYPH ACROSS THE EDGE GOES WHOLE, as a letter does: text is removed by the glyph, not cut.
    expect(result.content).not.toMatch(/270 60 T[dD]/);
    FIGURES.push({ case: 'Type 3 glyphs', ...differenceOutside(render(bytes), render(result.saved), result.regions) });
  });

  it('STATED: a letter is judged by its advance box, so one shown beside the mark stays, even where its ink reaches inside', async () => {
    // THE HARD SHAPE, built to show the rule, not a font anyone sets: MuPDF's burn-in judges a glyph by its ADVANCE box
    // (origin to advance width, descender to ascender; `pdf-op-filter.c`, the culler's FZ_CULL_GLYPH call), never by
    // its ink. This glyph advances 1,000 units (20 points here) and draws 3,000 (60 points): shown at x 60, its advance
    // box ends at 80, short of the mark at 92, and its ink reaches to 120. The cut does not touch text.
    //
    // THE OWNER'S RULING, 2026-11-06 (ADR-0286's note of that date): not fixed. In ordinary fonts a letter that stays
    // has only a small tail under the box (at most 0.16 em past its advance box, `glyphOverhang.mjs`), and it was not
    // marked and stays readable beside the mark.
    /** Pixels painted inside the mark after the burn-in, for a glyph of this advance and FontBBox. */
    const paintedFor = async (advance: number, bbox: readonly number[]): Promise<number> => {
      const bytes = await pageOf('BT /T3 20 Tf 60 60 Td (A) Tj ET', (document) => ({ Font: { T3: type3(document, LIAR, bbox, advance) } }));
      expect(blankInside(render(bytes), [rectRegion(OVER_LINE)]).painted, 'CONTROL: unredacted, the glyph paints under the mark').toBeGreaterThan(0);
      const result = await burned(bytes, AREA, 'none');
      return blankInside(render(result.saved), result.regions).painted;
    };
    const declared = await paintedFor(1000, [0, 0, 100, 100]);
    const whole = await paintedFor(1000, [0, 0, 3000, 1000]);
    // CONTROL, THE MECHANISM: an advance that reaches the mark makes MuPDF take the glyph, whatever its FontBBox says.
    const reaching = await paintedFor(3000, [0, 0, 100, 100]);
    FIGURES.push({ case: 'a glyph inked past its advance', declared, whole, reaching });
    expect(reaching).toBe(0);
    // THE RULE, STATED: the FontBBox does not change it, because MuPDF never reads it for a glyph shown sideways.
    expect(declared).toBeGreaterThan(0);
    expect(whole).toBeGreaterThan(0);
  });
});

/** A glyph whose d1 box is 100 units square and whose drawing is 3,000 units wide. */
const LIAR = '1000 0 0 0 100 100 d1 0 0 3000 1000 re f';

/** A Type 3 font of one glyph drawn by `glyph`, with `bbox` as its FontBBox and `advance` as its width. */
function type3(document: PDFDocument, glyph: string, bbox: readonly number[], advance = 1000): unknown {
  return document.context.obj({
    Type: 'Font',
    Subtype: 'Type3',
    FontBBox: [...bbox],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: { square: document.context.register(document.context.stream(glyph)) },
    Encoding: { Type: 'Encoding', Differences: [65, PDFName.of('square')] },
    FirstChar: 65,
    LastChar: 65,
    Widths: [advance],
    Resources: {},
  });
}

/** A tiling pattern's cell, a soft mask's group and a Type 3 glyph, as the text each stream holds. */
const CELL = '1 0 0 rg 0 0 10 10 re f';
const MASK = '1 g 0 0 612 460 re f 0 g 150 60 40 20 re f';
const GLYPH = '1000 0 0 0 1000 1000 d1 0 0 1000 1000 re f';

/** A rectangle as the region a mark has. */
function rectRegion({ x0, y0, x1, y1 }: Rect): Region {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** The decoded text of every stream object in a saved file. */
function streamsOf(saved: ByteImage): string {
  const document = mupdf.PDFDocument.openDocument(saved, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
    let text = '';
    for (let at = 1; at < document.countObjects(); at += 1) {
      const object = document.newIndirect(at);
      if (object.isStream()) text += `${object.readStream().asString()}\n`;
    }
    if (text === '') throw new Error('no stream read from the saved file');
    return text;
  } finally {
    document.destroy();
  }
}
