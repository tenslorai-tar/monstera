import { readFileSync } from 'node:fs';

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion, pageTransform, pdfPoint, toViewport } from '@monstera/shared';
import { type Page, expect } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * THE AGREEMENT PAGE WITH ITS LETTERS, for the text layer's rules (ADR-0280) and every reader of a selection: the page's
 * Times lines, each line's letters stated as the engine reads them (each glyph's own width, which `textLetters.test.ts`
 * holds MuPDF to within 0.005 pt), and the layer drawn in `monospace`, whose letters stand far from Times', so anything
 * that read the browser's layout instead of the engine's lands visibly elsewhere.
 *
 * A page may be opened turned, at a zoom, and placed off whole points; every line is then stated in the turned page's
 * display space, as the engine reports it there, and every expectation is converted through the page's own transform.
 */

interface AgreementLine {
  readonly text: string;
  readonly baseline: number;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

const AGREEMENT = JSON.parse(readFileSync(new URL('../fixtures/text-markup/agreement-lines.json', import.meta.url), 'utf8')) as {
  readonly size: number;
  readonly x: number;
  readonly pageHeight: number;
  readonly lines: readonly AgreementLine[];
};

export const LINES = AGREEMENT.lines;
export const SIZE = AGREEMENT.size;
const WIDTH = 612;
const HEIGHT = AGREEMENT.pageHeight;
const CROP = { x0: 0, y0: 0, x1: WIDTH, y1: HEIGHT };

/** How the page is opened. */
export interface Opening {
  /** A line placed as before, with no letters. */
  readonly bare?: number | undefined;
  /** The page's turn, in degrees. */
  readonly rotation?: 0 | 90 | 180 | 270;
  /** The starting zoom setting. */
  readonly zoom?: '50pct' | '100pct' | '400pct';
  /** Points every line is moved right and up by, so nothing sits on a whole point. */
  readonly shift?: number;
  /** Degrees every line is turned by about its own start, against the clock, on an upright page: angled text. */
  readonly angle?: number;
  /** Told every channel call the page makes. */
  readonly observe?: (channel: string, params: unknown) => void;
  /** Anything else the shim is told: a stored key and a model list, for the assistant. */
  readonly more?: Omit<NonNullable<Parameters<typeof bridge>[1]>, 'opens' | 'documentBytes' | 'pageLinesPlaced' | 'viewModels'>;
}

/** One opened agreement page: where each letter boundary of a line is in PDF space, and on screen. */
export interface Agreement {
  /** Each UTF-16 boundary of line `index` along its baseline, from its start, in points. */
  readonly places: (index: number) => number[];
  /** Boundary `at` of line `index` on its baseline, `up` points above it, in the window's pixels. */
  readonly onScreen: (index: number, at: number, up?: number) => { x: number; y: number };
  /** The same point in the layer's own pixels. */
  readonly inLayer: (index: number, at: number, up?: number) => { x: number; y: number };
  /** Boundary `at` of line `index` on its baseline, in PDF user space. */
  readonly inPdf: (index: number, at: number) => { x: number; y: number };
}

/** The page, drawn in Times at each line's baseline, moved by `shift` and turned by `angle`. */
async function timesPage(shift: number, angle: number): Promise<{ bytes: Uint8Array; places: (index: number) => number[] }> {
  const document = await PDFDocument.create();
  const sheet = document.addPage([WIDTH, HEIGHT]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (const line of LINES) {
    sheet.drawText(line.text, { x: AGREEMENT.x + shift, y: line.baseline + shift, size: SIZE, font, rotate: degrees(angle) });
  }
  const placesOf = (text: string): number[] => {
    const out = [0];
    for (const character of text) out.push((out.at(-1) ?? 0) + Math.round(font.widthOfTextAtSize(character, SIZE) * 100));
    return out.map((place) => place / 100);
  };
  return { bytes: await document.save(), places: (index) => placesOf(LINES[index]?.text ?? '') };
}

export async function openAgreement(page: Page, opening: Opening = {}): Promise<Agreement> {
  const rotation = opening.rotation ?? 0;
  const shift = opening.shift ?? 0;
  const angle = ((opening.angle ?? 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  // A TURNED PAGE'S FIRST LINE stands at its right edge or its foot, and at 400% its letters run far right, which at
  // 1280 by 800 is under the side panel or below the window.
  const large = rotation !== 0 || opening.zoom === '400pct';
  await page.setViewportSize(large ? { width: 1920, height: 1200 } : { width: 1280, height: 800 });
  const { bytes, places } = await timesPage(shift, opening.angle ?? 0);
  // THE TURNED PAGE'S DISPLAY SPACE AT SCALE 1, which is where the engine reports a line (`engineBoxOnScreen`).
  const display = pageTransform(CROP, rotation, 1);
  const toDisplay = (x: number, y: number): { x: number; y: number } => toViewport(pdfPoint(x, y), display);
  /** A point `along` the baseline of line `index` from its start and `up` above it, in PDF user space. */
  const pdfAt = (index: number, along: number, up = 0): { x: number; y: number } => {
    const line = LINES[index];
    const start = { x: AGREEMENT.x + shift, y: (line?.baseline ?? 0) + shift };
    return { x: start.x + along * cos - up * sin, y: start.y + along * sin + up * cos };
  };
  const pdfOf = (index: number, at: number, up = 0): { x: number; y: number } => pdfAt(index, places(index)[at] ?? 0, up);
  const docId = asDocId('00000000-0000-4000-8000-0000000000f2');
  await bridge(
    page,
    {
      ...opening.more,
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'agreement.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      viewModels: [{ pageCount: 1, rotations: [rotation] }],
      ...(opening.zoom === undefined ? {} : { settings: { ...opening.more?.settings, 'viewing.starting-zoom': opening.zoom } }),
      pageLinesPlaced: [
        LINES.map((line, index) => {
          // THE LINE'S BOX, from the fixture's upright box (display space, y down) as heights about the baseline and a
          // length along it, turned with the line, then into the turned page's display space.
          const above = HEIGHT - line.box.y0 - line.baseline;
          const below = HEIGHT - line.box.y1 - line.baseline;
          const length = line.box.x1 - line.box.x0;
          const corners = [pdfAt(index, 0, above), pdfAt(index, length, above), pdfAt(index, length, below), pdfAt(index, 0, below)].map(
            (corner) => toDisplay(corner.x, corner.y),
          );
          const box = {
            x0: Math.min(...corners.map((corner) => corner.x)),
            y0: Math.min(...corners.map((corner) => corner.y)),
            x1: Math.max(...corners.map((corner) => corner.x)),
            y1: Math.max(...corners.map((corner) => corner.y)),
          };
          if (index === opening.bare) return { text: line.text, box };
          const at = places(index);
          const start = pdfAt(index, 0);
          const next = pdfAt(index, 1);
          const origin = toDisplay(start.x, start.y);
          const ahead = toDisplay(next.x, next.y);
          return {
            text: line.text,
            box,
            letters: {
              origin,
              direction: { x: ahead.x - origin.x, y: ahead.y - origin.y },
              size: SIZE,
              advances: at.slice(1).map((place, k) => Math.round((place - (at[k] ?? 0)) * 100)),
            },
          };
        }),
      ],
    },
    opening.observe,
  );
  await page.goto('/');
  await page.addStyleTag({ content: '.m-text-line { font-family: monospace !important; }' });
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(LINES.length);
  await pageShown(page);
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (layer === null) throw new Error('no text layer');
  const zoom = layer.width / display.viewport.width;
  const shown = pageTransform(CROP, rotation, zoom);
  const inLayer = (index: number, at: number, up = 0): { x: number; y: number } => {
    const point = pdfOf(index, at, up);
    return toViewport(pdfPoint(point.x, point.y), shown);
  };
  return {
    places,
    inLayer,
    onScreen: (index, at, up = 0) => {
      const point = inLayer(index, at, up);
      return { x: layer.x + point.x, y: layer.y + point.y };
    },
    inPdf: (index, at) => pdfOf(index, at),
  };
}

/** The middle of letter `letter` of line `index` (`fraction` along it), a third of the size up, in the window's pixels. */
export function onLetter(agreement: Agreement, index: number, letter: number, fraction = 0.7): { x: number; y: number } {
  const a = agreement.onScreen(index, letter, SIZE / 3);
  const b = agreement.onScreen(index, letter + 1, SIZE / 3);
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

/** A hand's drag from letter `from` to letter `to` of line `index`, each on its second half; what it selected. */
export async function dragLetters(page: Page, agreement: Agreement, index: number, from: number, to: number): Promise<string> {
  const start = onLetter(agreement, index, from);
  const middle = onLetter(agreement, index, Math.round((from + to) / 2));
  const end = onLetter(agreement, index, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  await page.mouse.up();
  return selected;
}

/** Selects `from` to `to` of line `index` by its text node, as the platform's own selection. */
export async function selectSpan(page: Page, index: number, from: number, to: number): Promise<void> {
  await page.evaluate(
    ({ line, start, end }) => {
      const node = document.querySelector(`[data-text-layer="0"] [data-text-line="${String(line)}"]`)?.firstChild;
      if (node === null || node === undefined) throw new Error('no line');
      document.getSelection()?.setBaseAndExtent(node, start, node, end);
    },
    { line: index, start: from, end: to },
  );
}

/** The polygons painted in one of the layer's surfaces, each as its corner points in the layer's pixels. */
export async function paintedIn(page: Page, surface: 'selection' | 'matches', active = false): Promise<{ x: number; y: number }[][]> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return page.locator(`[data-text-layer="0"] .m-text-layer__${surface} polygon${active ? '.is-active' : ''}`).evaluateAll((polygons) =>
    polygons.map((polygon) =>
      (polygon.getAttribute('points') ?? '').split(' ').map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x ?? NaN, y: y ?? NaN };
      }),
    ),
  );
}

/** Where the browser lays a span out, its box in the layer's pixels: what a reader of the DOM would take. */
export async function laidOut(page: Page, index: number, from: number, to: number): Promise<{ left: number; right: number; top: number; bottom: number }> {
  return page.evaluate(
    ({ line, start, end }) => {
      const layer = document.querySelector('[data-text-layer="0"]');
      const node = layer?.querySelector(`[data-text-line="${String(line)}"]`)?.firstChild;
      if (layer === null || node === null || node === undefined) throw new Error('no line');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const box = range.getBoundingClientRect();
      const origin = layer.getBoundingClientRect();
      return { left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top };
    },
    { line: index, start: from, end: to },
  );
}

/**
 * The four corners a span of a line covers, by the engine's letters, in the layer's pixels: its start and end, from 0.9
 * of the size above the baseline to 0.25 below it, which is the band `textLayerLetters.ts` states.
 */
export function spanCorners(agreement: Agreement, index: number, from: number, to: number): { x: number; y: number }[] {
  return [
    agreement.inLayer(index, from, 0.9 * SIZE),
    agreement.inLayer(index, to, 0.9 * SIZE),
    agreement.inLayer(index, to, -0.25 * SIZE),
    agreement.inLayer(index, from, -0.25 * SIZE),
  ];
}

/** The largest distance from any of `expected` to the nearest of `points`. */
export function farthest(points: readonly { x: number; y: number }[], expected: readonly { x: number; y: number }[]): number {
  return Math.max(...expected.map((want) => Math.min(...points.map((got) => Math.hypot(got.x - want.x, got.y - want.y)))));
}
