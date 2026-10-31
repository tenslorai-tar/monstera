import { appendFileSync, readFileSync } from 'node:fs';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { type Page, expect, test } from '@playwright/test';

/**
 * THE SVG TEXT TRIAL (cloud run 29): today's text layer (`span`) against a copy of it whose lines are SVG text with a
 * position per letter (`svg`), driven as a hand drives it, on run 18's agreement page (Times, standard 14, NOT embedded,
 * 11 pt). It PRINTS measurements to `TRIAL_OUT` and asserts only what keeps a measurement honest. Not a `.pw.ts`, so no
 * suite runs it: a check that asserts nothing would read as coverage.
 *
 * The page's own letters are where Times' metrics put them (`widthOf`), which run 18's `lineEndMarks.proof.mjs` holds
 * against MuPDF's quads for this fixture's line ends.
 */

const OUT = process.env['TRIAL_OUT'] ?? '/tmp/svg-trial.jsonl';
const HARNESS = process.env['TRIAL_HARNESS'] ?? '/tmp/harness.js';
const CSS = ['tokens.css', 'app.css'].map((name) => readFileSync(new URL(`../../ui/src/${name}`, import.meta.url), 'utf8')).join('\n');

interface Fixture {
  readonly size: number;
  readonly x: number;
  readonly pageHeight: number;
  readonly lines: readonly { readonly text: string; readonly baseline: number; readonly box: { x0: number; y0: number; x1: number; y1: number } }[];
}
const FILE = JSON.parse(readFileSync(new URL('../fixtures/text-markup/agreement-lines.json', import.meta.url), 'utf8')) as Fixture;

type Kind = 'span' | 'svg' | 'A' | 'B';
/** Run 29 measured `span,svg`; run 29b measures `span,A,B` (`TRIAL_KINDS`). */
const KINDS = (process.env['TRIAL_KINDS'] ?? 'span,svg').split(',') as readonly Kind[];

/**
 * THE TRIAL'S OWN STYLE, beside the shipped stylesheets: run 29b's paint (the shipped `::selection`'s colour, the
 * system's highlight in forced colours), the browser's own highlight made transparent on both candidates' lines, and
 * the SVG placed over the page. Here rather than in the components, where a style string would be a JSX literal.
 */
const TRIAL_CSS = `
.m-trial-paints { position: absolute; inset: 0; pointer-events: none; }
.m-trial-paint { position: absolute; background: color-mix(in srgb, var(--accent) 35%, transparent); }
@media (forced-colors: active) { .m-trial-paint { background: color-mix(in srgb, Highlight 45%, transparent); forced-color-adjust: none; } }
.trial-kind-A .m-text-line::selection { background: transparent; }
.m-trial-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.m-trial-svg-line { fill: transparent; white-space: pre; }
.m-trial-svg-line::selection { background: transparent; fill: transparent; }
`;
/** `null` is the application's own face (`--font-ui`, which on Linux falls through to the system face). */
const FAMILIES = [null, 'serif', 'sans-serif'] as const;

let widthOf: (text: string) => number = () => 0;
test.beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  widthOf = (text) => font.widthOfTextAtSize(text, FILE.size);
});

/** `TRIAL_SIZED=1` sizes the SVG letters at the glyph size rather than the box's height (today's layer ignores it). */
const SIZED = process.env['TRIAL_SIZED'] === '1';

function record(row: Record<string, unknown>): void {
  appendFileSync(OUT, `${JSON.stringify({ sized: SIZED, ...row })}\n`);
}

/** The fixture's lines in PDF user space, each letter's left from Times' widths. */
function pdfLines(): { text: string; baseline: number; xs: number[]; box: { x0: number; y0: number; x1: number; y1: number } }[] {
  return FILE.lines.map((line) => ({
    text: line.text,
    baseline: line.baseline,
    // ONE POSITION PER UTF-16 UNIT, which is what SVG's `x` list and a Range's offsets both index.
    xs: Array.from({ length: line.text.length }, (_, at) => FILE.x + widthOf(line.text.slice(0, at))),
    box: { x0: line.box.x0, x1: line.box.x1, y0: FILE.pageHeight - line.box.y1, y1: FILE.pageHeight - line.box.y0 },
    ...(SIZED ? { size: FILE.size } : {}),
  }));
}

async function open(page: Page, kind: Kind, family: string | null, rotation = 0, zoom = 1.5, pages: readonly unknown[] | null = null): Promise<void> {
  await page.setContent(`<!doctype html><html><head><style>${CSS}${TRIAL_CSS}</style></head><body style="margin:0;padding:24px"><div id="root"></div></body></html>`);
  if (family !== null) await page.addStyleTag({ content: `.m-text-line, .m-svg-text-line, .m-trial-svg-line { font-family: ${family} !important; }` });
  await page.addScriptTag({ path: HARNESS });
  await page.evaluate(
    (spec) => {
      (globalThis as unknown as { trial: { mount: (s: unknown) => void } }).trial.mount(spec);
    },
    { kind, pages: pages ?? [pdfLines()], size: { width: 612, height: FILE.pageHeight }, rotation, zoom },
  );
  await expect(page.locator('[data-text-line]')).toHaveCount((pages ?? [pdfLines()]).length * FILE.lines.length);
}

/** A PDF point on page 0, in window pixels. */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([px, py]) => (globalThis as unknown as { trial: { point: (a: number, x: number, y: number) => { x: number; y: number } } }).trial.point(0, px, py), [x, y] as const);
}

/**
 * A PRESS at `point`, then its anchor is read. Run 29 clicked (`TRIAL_PRESS` unset): the caret a click leaves is the
 * browser's, since `holdAnchorAtPress` anchors only on the first drag event. Run 29b presses and DRAGS 60 px across in
 * four moves (`TRIAL_PRESS=drag`), so the anchor read is the one a drag starts from — what each layer's press rule owns.
 */
async function press(page: Page, point: { x: number; y: number }): Promise<void> {
  if (process.env['TRIAL_PRESS'] !== 'drag') {
    await page.mouse.click(point.x, point.y);
    return;
  }
  // NOTHING SELECTED BEFORE THE PRESS: a press inside the last drag's selection starts the browser's drag of selected
  // text, which moves no anchor — and read as a press 10 letters out on every layer (measured 2026-10-31, then fixed).
  await page.evaluate(() => {
    document.getSelection()?.removeAllRanges();
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 60, point.y, { steps: 4 });
  await page.mouse.up();
}

/** Where the selection's anchor is: the line's index and the offset in it. */
async function anchor(page: Page): Promise<{ line: number; offset: number; collapsed: boolean } | null> {
  return page.evaluate(() => {
    const selection = document.getSelection();
    const node = selection?.anchorNode ?? null;
    const line = (node instanceof Element ? node : node?.parentElement)?.closest('[data-text-line]') ?? null;
    if (selection === null || line === null) return null;
    return { line: Number(line.getAttribute('data-text-line')), offset: selection.anchorOffset, collapsed: selection.isCollapsed };
  });
}

for (const kind of KINDS) {
  for (const family of FAMILIES) {
    test(`letters and presses: ${kind}, ${family ?? 'application face'}`, async ({ page }) => {
      await open(page, kind, family);
      const lines = pdfLines();
      // 1. EVERY LETTER'S LAID-OUT LEFT against the page's, through each line's own text node.
      const zoom = 1.5;
      const lefts = await page.evaluate(() =>
        [...document.querySelectorAll('[data-text-line]')].map((line) => {
          const node = line.firstChild;
          if (!(node instanceof Text)) return [];
          const range = document.createRange();
          return Array.from({ length: node.data.length }, (_, k) => {
            range.setStart(node, k);
            range.setEnd(node, k + 1);
            return range.getBoundingClientRect().left;
          });
        }),
      );
      const origin = await at(page, 0, 0);
      let worst = 0;
      for (const [index, line] of lines.entries()) {
        for (const [k, x] of line.xs.entries()) {
          const shown = ((lefts[index]?.[k] ?? NaN) - origin.x) / zoom;
          if (Math.abs(shown - x) > Math.abs(worst)) worst = shown - x;
        }
      }
      // 2. A PRESS 30% INTO EVERY LETTER that is not a space, at mid-height of the letters: a click, then where the caret is.
      let presses = 0;
      let wrong = 0;
      let worstLetters = 0;
      for (const [index, line] of lines.entries()) {
        for (const [k, x] of line.xs.entries()) {
          if (line.text[k] === ' ') continue;
          const next = line.xs[k + 1] ?? FILE.x + widthOf(line.text);
          const point = await at(page, x + (next - x) * 0.3, line.baseline + FILE.size * 0.3);
          await press(page, point);
          const caret = await anchor(page);
          presses += 1;
          const off = caret?.line !== index ? Infinity : caret.offset - k;
          if (off !== 0) wrong += 1;
          if (Math.abs(off) > Math.abs(worstLetters)) worstLetters = off;
        }
      }
      record({ measure: 'letters', kind, family: family ?? 'app', worstLetterOffPt: Number(worst.toFixed(2)), presses, wrong, worstLetters });
    });
  }
}

/** The letter `k` of line `index` at fraction `f` across it and mid-letter height, in window pixels. */
async function letterAt(page: Page, index: number, k: number, f: number): Promise<{ x: number; y: number }> {
  const line = pdfLines()[index];
  if (line === undefined) throw new Error(`no line ${String(index)}`);
  const x = line.xs[k] ?? FILE.x + widthOf(line.text);
  const next = line.xs[k + 1] ?? FILE.x + widthOf(line.text);
  return at(page, x + (next - x) * f, line.baseline + FILE.size * 0.3);
}

async function selected(page: Page, kind: Kind): Promise<{ platform: string; read: string | null; fromX: number | null; toX: number | null }> {
  return page.evaluate((which) => {
    const trial = (globalThis as unknown as { trial: { read: (k: string) => { text: string; from: { x: number }; to: { x: number } } | undefined } }).trial;
    const read = trial.read(which);
    return { platform: document.getSelection()?.toString() ?? '', read: read?.text ?? null, fromX: read?.from.x ?? null, toX: read?.to.x ?? null };
  }, kind);
}

// WHICH SIDE OF A LETTER: a press 70% across each letter means the caret AFTER it. A glyph cell is the substitute's own
// width from the letter's x, so where its midpoint lies decides this side, whatever x says.
for (const kind of KINDS) {
  for (const family of FAMILIES) {
    test(`press sides: ${kind}, ${family ?? 'application face'}`, async ({ page }) => {
      await open(page, kind, family);
      const lines = pdfLines();
      let presses = 0;
      let wrong = 0;
      const cells: number[] = [];
      for (const [index, line] of lines.entries()) {
        for (const [k] of line.xs.entries()) {
          if (line.text[k] === ' ' || line.text[k + 1] === undefined) continue;
          const point = await letterAt(page, index, k, 0.7);
          await press(page, point);
          const caret = await anchor(page);
          presses += 1;
          if (caret?.line !== index || caret.offset !== k + 1) wrong += 1;
        }
      }
      // EACH GLYPH CELL'S WIDTH against the page letter's, the ratio a side decision turns on.
      const widths = await page.evaluate(() =>
        [...document.querySelectorAll('[data-text-line]')].map((line) => {
          const node = line.firstChild;
          if (!(node instanceof Text)) return [];
          const range = document.createRange();
          return Array.from({ length: node.data.length }, (_, k) => {
            range.setStart(node, k);
            range.setEnd(node, k + 1);
            return range.getBoundingClientRect().width / 1.5;
          });
        }),
      );
      for (const [index, line] of lines.entries()) {
        for (const [k, x] of line.xs.entries()) {
          const next = line.xs[k + 1];
          if (next === undefined || line.text[k] === ' ') continue;
          cells.push((widths[index]?.[k] ?? 0) / (next - x));
        }
      }
      record({ measure: 'sides', kind, family: family ?? 'app', presses, wrong, cellRatioMin: Number(Math.min(...cells).toFixed(2)), cellRatioMax: Number(Math.max(...cells).toFixed(2)) });
    });
  }
}

// WHERE A PRESS FLIPS from before a letter to after it, found by bisection with real clicks, against the page letter's
// middle: the honest measure of "the letter a press lands on", since 30% and 70% leave slack either side of the middle.
for (const kind of KINDS) {
  for (const family of FAMILIES) {
    test(`flip points: ${kind}, ${family ?? 'application face'}`, async ({ page }) => {
      await open(page, kind, family);
      const lines = pdfLines();
      let worst = 0;
      let letters = 0;
      for (const [index, line] of lines.slice(0, 2).entries()) {
        for (const [k, x] of line.xs.entries()) {
          const next = line.xs[k + 1];
          if (next === undefined || line.text[k] === ' ') continue;
          let lo = x - (next - x);
          let hi = next + (next - x);
          for (let step = 0; step < 9; step += 1) {
            const mid = (lo + hi) / 2;
            const point = await at(page, mid, line.baseline + FILE.size * 0.3);
            await press(page, point);
            const caret = await anchor(page);
            if (caret !== null && caret.line === index && caret.offset > k) hi = mid;
            else lo = mid;
          }
          letters += 1;
          const off = (lo + hi) / 2 - (x + next) / 2;
          if (Math.abs(off) > Math.abs(worst)) worst = off;
        }
      }
      record({ measure: 'flips', kind, family: family ?? 'app', letters, worstFlipOffPt: Number(worst.toFixed(2)) });
    });
  }
}

test('the visible highlight of a selection, today and in SVG text, at 400 %', async ({ page }) => {
  for (const kind of KINDS) {
    await page.setViewportSize({ width: 2800, height: 1200 });
    await open(page, kind, 'sans-serif', 0, 4);
    await page.addStyleTag({ content: '.m-text-line, .m-svg-text-line { color: rgba(0,0,0,0.35) !important; fill: rgba(0,0,0,0.35) !important; } .m-svg-text-line::selection { background: rgba(30,90,255,0.35); }' });
    const from = await letterAt(page, 0, 15, 0.1);
    const to = await letterAt(page, 0, 35, 0.9);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const top = await at(page, 150, FILE.lines[0] === undefined ? 0 : FILE.pageHeight - FILE.lines[0].box.y0 + 4);
    await page.screenshot({ path: `${OUT}.${kind}.png`, clip: { x: top.x, y: top.y, width: 900, height: 90 } });
  }
});

// COST: a 300-page text document, every page's layer mounted (an upper bound: the page list mounts the pages near the
// view), each page 45 lines of 95 letters at 11 pt. Elements, the JS heap and the renderer's memory after a collected
// garbage, the time to mount, and a scroll through it driven by the wheel, timed by animation frames.
function densePage(): { text: string; baseline: number; xs: number[]; box: { x0: number; y0: number; x1: number; y1: number }; size?: number }[] {
  const words = 'the parties agree that each obligation under this agreement shall continue until the term ends'.split(' ');
  return Array.from({ length: 45 }, (_, row) => {
    let text = '';
    for (let w = row; text.length < 95; w += 1) text += `${words[w % words.length] ?? ''} `;
    text = text.slice(0, 95);
    const baseline = 760 - row * 15.5;
    return {
      text,
      baseline,
      xs: Array.from({ length: text.length }, (_, k) => 40 + widthOf(text.slice(0, k))),
      box: { x0: 40, y0: baseline - 2.4, x1: 40 + widthOf(text), y1: baseline + 7.9 },
      ...(SIZED ? { size: FILE.size } : {}),
    };
  });
}

for (const kind of KINDS) {
  test(`cost of 300 pages: ${kind}`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.setContent(`<!doctype html><html><head><style>${CSS}${TRIAL_CSS}</style></head><body style="margin:0;padding:24px"><div id="root"></div></body></html>`);
    await page.addScriptTag({ path: HARNESS });
    const pages = Array.from({ length: 300 }, densePage);
    // RENDER (React, the conversions and the attributes) and LAYOUT (forced by reading a letter's box) timed apart.
    const mountMs = await page.evaluate(
      (spec) => {
        const start = performance.now();
        (globalThis as unknown as { trial: { mount: (s: unknown) => void } }).trial.mount(spec);
        const rendered = performance.now();
        const line = document.querySelector('[data-text-line]');
        const range = document.createRange();
        if (line?.firstChild instanceof Text) {
          range.setStart(line.firstChild, 0);
          range.setEnd(line.firstChild, 1);
        }
        range.getBoundingClientRect();
        return { render: Math.round(rendered - start), layout: Math.round(performance.now() - rendered) };
      },
      { kind, pages, size: { width: 612, height: 792 }, rotation: 0, zoom: 1.5 },
    );
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics = (await cdp.send('Performance.getMetrics')).metrics;
    const metric = (name: string): number => metrics.find((each) => each.name === name)?.value ?? NaN;
    const elements = await page.evaluate(() => document.querySelectorAll('*').length);
    // SCROLL: 120 wheel steps of 400 px, each followed by a frame, timing every frame in between.
    await page.evaluate(() => {
      const frames: number[] = [];
      let last = performance.now();
      const tick = (now: number): void => {
        frames.push(now - last);
        last = now;
        if (frames.length < 100000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      (globalThis as unknown as { frames: number[] }).frames = frames;
    });
    await page.mouse.move(700, 500);
    const scrollStart = Date.now();
    for (let step = 0; step < 120; step += 1) await page.mouse.wheel(0, 400);
    const scrollMs = Date.now() - scrollStart;
    const frames = await page.evaluate(() => (globalThis as unknown as { frames: number[] }).frames.slice(1));
    const sorted = [...frames].sort((a, b) => a - b);
    record({
      measure: 'cost',
      kind,
      pages: 300,
      letters: pages.flat().reduce((sum, line) => sum + line.text.length, 0),
      elements,
      mountMs,
      jsHeapMiB: Math.round(metric('JSHeapUsedSize') / 1048576),
      nodes: metric('Nodes'),
      layoutCount: metric('LayoutCount'),
      scrollMs,
      frames: frames.length,
      frameP50: Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1)),
      frameP95: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)),
      frameMax: Number((sorted.at(-1) ?? 0).toFixed(1)),
      over33ms: frames.filter((f) => f > 33.4).length,
    });
  });
}

// ROUTE (a)'S RAW FACTS, for comparison: each letter its own span whose cell is set to the page letter's width by its
// letter-spacing (natural advance read from layout, then the difference added), the line at its box, glyph-sized. Plain
// DOM with none of the application's rules, which assume one text node per line, so this measures the platform alone.
async function openLetters(page: Page, pages: readonly ReturnType<typeof densePage>[], family: string | null): Promise<{ render: number; layout: number }> {
  await page.setContent(`<!doctype html><html><head><style>${CSS}${TRIAL_CSS}</style></head><body style="margin:0;padding:24px"><div id="root"></div></body></html>`);
  if (family !== null) await page.addStyleTag({ content: `.trial-letter-line { font-family: ${family} !important; }` });
  return page.evaluate(
    ({ pages: all, zoom, height }) => {
      const start = performance.now();
      const root = document.getElementById('root');
      if (root === null) throw new Error('no root');
      const spans: { span: HTMLElement; width: number }[] = [];
      for (const [p, lines] of all.entries()) {
        const sheet = document.createElement('div');
        sheet.dataset['trialPage'] = String(p);
        sheet.style.cssText = `position:relative;width:${String(612 * zoom)}px;height:${String(height * zoom)}px;background:#fff;margin-bottom:8px`;
        const layer = document.createElement('div');
        layer.className = 'm-text-layer';
        for (const [index, line] of lines.entries()) {
          const row = document.createElement('span');
          row.className = 'trial-letter-line';
          row.dataset['textLine'] = String(index);
          row.style.cssText = `position:absolute;left:${String(line.box.x0 * zoom)}px;top:${String((height - line.baseline - 0.8 * 11) * zoom)}px;white-space:pre;color:transparent;font-size:${String(11 * zoom)}px;line-height:1`;
          for (const [k, letter] of Array.from({ length: line.text.length }, (_, at) => line.text.charAt(at)).entries()) {
            const span = document.createElement('span');
            span.textContent = letter;
            row.append(span);
            spans.push({ span, width: ((line.xs[k + 1] ?? line.box.x1) - (line.xs[k] ?? 0)) * zoom });
          }
          layer.append(row);
        }
        sheet.append(layer);
        root.append(sheet);
      }
      const rendered = performance.now();
      const natural = spans.map(({ span }) => span.getBoundingClientRect().width);
      spans.forEach(({ span, width }, at) => {
        span.style.letterSpacing = `${String(width - (natural[at] ?? 0))}px`;
      });
      document.body.getBoundingClientRect();
      spans[0]?.span.getBoundingClientRect();
      return { render: Math.round(rendered - start), layout: Math.round(performance.now() - rendered) };
    },
    { pages, zoom: 1.5, height: FILE.pageHeight },
  );
}

test('route (a) raw: flips, highlight and cost of per-letter cells', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  const one = [densePage()];
  const rows: Record<string, unknown> = { measure: 'route-a' };
  for (const family of FAMILIES) {
    await openLetters(page, one, family);
    // FLIP POINTS on the first two lines' letters, by bisection with clicks; the caret's place read as letter index.
    let worst = 0;
    for (const index of [0, 1]) {
      const line = one[0]?.[index];
      if (line === undefined) continue;
      for (const [k, x] of line.xs.entries()) {
        const next = line.xs[k + 1];
        if (next === undefined || line.text[k] === ' ') continue;
        let lo = x - (next - x);
        let hi = next + (next - x);
        for (let step = 0; step < 9; step += 1) {
          const mid = (lo + hi) / 2;
          const after = await page.evaluate(
            ([px, row, letter]) => {
              const layer = document.querySelector('[data-trial-page="0"]')?.getBoundingClientRect();
              const line = document.querySelectorAll('[data-trial-page="0"] [data-text-line]')[row];
              const box = line?.getBoundingClientRect();
              if (layer === undefined || box === undefined) return false;
              const caret = document.caretPositionFromPoint(layer.left + px * 1.5, (box.top + box.bottom) / 2);
              const span = caret?.offsetNode.parentElement;
              const at = span === null || span === undefined ? -1 : [...(line?.children ?? [])].indexOf(span) + (caret?.offset ?? 0);
              return at > letter;
            },
            [mid, index, k] as const,
          );
          if (after) hi = mid;
          else lo = mid;
        }
        const off = (lo + hi) / 2 - (x + next) / 2;
        if (Math.abs(off) > Math.abs(worst)) worst = off;
      }
    }
    rows[`flipWorstPt_${family ?? 'app'}`] = Number(worst.toFixed(2));
  }
  // THE HIGHLIGHT of a selection across twenty letters, drawn visible, at 400 %.
  await page.setViewportSize({ width: 2800, height: 1200 });
  await openLetters(page, [densePage().map((line) => ({ ...line }))], 'sans-serif');
  await page.addStyleTag({ content: '.trial-letter-line { color: rgba(0,0,0,0.35) !important; } .trial-letter-line ::selection { background: rgba(30,90,255,0.35); }' });
  await page.evaluate(() => {
    const line = document.querySelector('[data-text-line="0"]');
    const first = line?.children[15]?.firstChild;
    const last = line?.children[35]?.firstChild;
    if (first instanceof Text && last instanceof Text) document.getSelection()?.setBaseAndExtent(first, 0, last, 1);
  });
  const shot = await page.locator('[data-text-line="0"]').boundingBox();
  if (shot !== null) await page.screenshot({ path: `${OUT}.letters.png`, clip: { x: shot.x, y: shot.y - 4, width: 900, height: shot.height + 8 } });
  // COST on 300 pages.
  await page.setViewportSize({ width: 1400, height: 1000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const timing = await openLetters(page, Array.from({ length: 300 }, densePage), null);
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = (await cdp.send('Performance.getMetrics')).metrics;
  rows['cost'] = { ...timing, elements: await page.evaluate(() => document.querySelectorAll('*').length), jsHeapMiB: Math.round((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576) };
  record(rows);
});

// RUN 29b: DOES OWNING THE MOVING END FIGHT CHROMIUM'S DRAG? Four drags on line 0, each ending inside a letter at 70%,
// whose right end the rule says is AFTER that letter: the final selection's text, the corrections the rule made, and
// whether the anchor stayed at the press. Fast is one move; slow is sixty; across a line end and back leaves the line
// past its end and returns; off the page and back leaves the page entirely.
for (const kind of KINDS) {
  test(`drags: ${kind}`, async ({ page }) => {
    await open(page, kind, null);
    const first = pdfLines()[0];
    if (first === undefined) throw new Error('fixture');
    const from = 5;
    const to = 41;
    const start = await letterAt(page, 0, from, 0.25);
    const end = await letterAt(page, 0, to, 0.7);
    const pastEnd = await at(page, first.box.x1 + 30, first.baseline + FILE.size * 0.3);
    const offPage = { x: 4, y: 4 };
    const rows: Record<string, unknown> = { measure: 'drags', kind, expected: first.text.slice(from, to + 1) };
    for (const [name, route] of [
      ['fast', [end]],
      ['slow', [end]],
      ['acrossEndAndBack', [pastEnd, end]],
      ['offPageAndBack', [offPage, end]],
    ] as const) {
      await page.evaluate(() => {
        (globalThis as unknown as { trial: { movingEnd: { corrections: number } } }).trial.movingEnd.corrections = 0;
      });
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (const point of route) await page.mouse.move(point.x, point.y, { steps: name === 'fast' ? 1 : name === 'slow' ? 60 : 12 });
      await page.mouse.up();
      const state = await page.evaluate((which) => {
        const trial = (globalThis as unknown as { trial: { read: (k: string) => { text: string } | undefined; movingEnd: { corrections: number } } }).trial;
        const selection = document.getSelection();
        return { text: trial.read(which)?.text ?? null, anchor: selection?.anchorOffset ?? null, corrections: trial.movingEnd.corrections };
      }, kind);
      rows[name] = state;
    }
    record(rows);
  });
}

// RUN 29b: THE MOVING END ON EVERY LETTER. A drag from the line's first letter ending 70% into each letter of line 0 —
// the rule says after it — at two speeds: the wrong ends, and how often the rule corrected the browser's focus, which is
// where a fight would show (a correction undone and redone, or a final end that is neither).
for (const kind of KINDS) {
  test(`moving ends: ${kind}`, async ({ page }) => {
    await open(page, kind, null);
    const first = pdfLines()[0];
    if (first === undefined) throw new Error('fixture');
    const start = await letterAt(page, 0, 0, 0.25);
    const rows: Record<string, unknown> = { measure: 'moving-ends', kind };
    for (const steps of [1, 20]) {
      let drags = 0;
      let wrong = 0;
      let corrections = 0;
      for (let k = 3; k < first.text.length - 1; k += 1) {
        if (first.text[k] === ' ') continue;
        await page.evaluate(() => {
          document.getSelection()?.removeAllRanges();
          const trial = (globalThis as unknown as { trial: { movingEnd: { corrections: number } } }).trial;
          trial.movingEnd.corrections = 0;
        });
        const end = await letterAt(page, 0, k, 0.7);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps });
        await page.mouse.up();
        const got = await page.evaluate(() => {
          const trial = (globalThis as unknown as { trial: { movingEnd: { corrections: number } } }).trial;
          return { text: document.getSelection()?.toString() ?? '', corrections: trial.movingEnd.corrections };
        });
        drags += 1;
        corrections += got.corrections;
        if (got.text !== first.text.slice(0, k + 1)) wrong += 1;
      }
      rows[steps === 1 ? 'fast' : 'slow'] = { drags, wrong, corrections };
    }
    record(rows);
  });
}

// RUN 29b: ONE RESOLVER (B3a). The painted look and the words must both come from the Selection's range. A selection
// set by script — no pointer moved — is the case where a painter that read anything else (here, the pointer, by the
// trial's `BREAK.painter` mutation) would paint one thing while the copy says another.
for (const kind of KINDS.filter((each) => each === 'A' || each === 'B')) {
  test(`one resolver: ${kind}`, async ({ page }) => {
    await open(page, kind, null);
    const rows: Record<string, unknown> = { measure: 'one-resolver', kind };
    for (const broken of [false, true]) {
      // A DRAG FIRST, so the broken painter has a pointer to read; then the script moves the selection elsewhere.
      const a = await letterAt(page, 1, 0, 0.25);
      const b = await letterAt(page, 1, 6, 0.7);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
      const result = await page.evaluate(
        async ([which, mutate]) => {
          const trial = (globalThis as unknown as { trial: { read: (k: string) => { text: string; boxes: readonly { x: number; width: number }[] } | undefined; breakers: { painter: boolean } } }).trial;
          trial.breakers.painter = mutate;
          const line = document.querySelector('[data-text-line="0"]');
          const node = line?.firstChild;
          if (!(node instanceof Text)) return null;
          document.getSelection()?.setBaseAndExtent(node, 14, node, 28);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const layer = document.querySelector('[data-text-layer="0"]')?.getBoundingClientRect();
          const painted = [...document.querySelectorAll('.m-trial-paint')].map((block) => {
            const r = block.getBoundingClientRect();
            return { left: r.left - (layer?.left ?? 0), width: r.width };
          });
          trial.breakers.painter = false;
          const read = trial.read(which);
          return { text: read?.text ?? null, boxes: read?.boxes.map((box) => ({ left: box.x, width: box.width })) ?? [], painted };
        },
        [kind, broken] as const,
      );
      const agree =
        result !== null &&
        result.painted.length === result.boxes.length &&
        result.painted.every((rect, k) => Math.abs(rect.left - (result.boxes[k]?.left ?? NaN)) < 0.5 && Math.abs(rect.width - (result.boxes[k]?.width ?? NaN)) < 0.5);
      rows[broken ? 'broken' : 'intact'] = { text: result?.text ?? null, paintedAgreesWithWords: agree };
    }
    record(rows);
  });
}

// RUN 29b: THE PAINTED HIGHLIGHT, in light, dark and high contrast, at 400 %: screenshots, evidence and not baselines.
test('the painted highlight in light, dark and high contrast', async ({ page }) => {
  await page.setViewportSize({ width: 2800, height: 1200 });
  for (const kind of KINDS) {
    for (const [scheme, forced] of [
      ['light', 'none'],
      ['dark', 'none'],
      ['light', 'active'],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, forcedColors: forced });
      await open(page, kind, 'sans-serif', 0, 4);
      await page.addStyleTag({ content: 'body { background: var(--surface, white); } .trial-page { background: var(--paper, white) !important; }' });
      const from = await letterAt(page, 0, 15, 0.1);
      const to = await letterAt(page, 0, 35, 0.9);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const top = await at(page, 150, FILE.lines[0] === undefined ? 0 : FILE.pageHeight - FILE.lines[0].box.y0 + 4);
      await page.screenshot({ path: `${OUT}.highlight-${kind}-${scheme}${forced === 'active' ? '-contrast' : ''}.png`, clip: { x: top.x, y: top.y, width: 900, height: 90 } });
    }
  }
  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
});

// RUN 29b: COST WHILE SCROLLING WITH PAGES ARRIVING, from a cold start. Pages mount as the application mounts them: the
// pages on screen, once the visible set has held for `SETTLE_MS` (`useSettledPages`). Two scrolls: a FLING (a wheel event
// every frame for two seconds, then still for a second, so the pages it stops on arrive), and a READING scroll (a page's
// worth, then a pause longer than the settle, thirty times, so pages arrive between scrolls). Every frame is timed by
// animation frames; each arrival's render-and-layout time is the harness's own.
for (const kind of KINDS) {
  test(`scrolling with pages arriving: ${kind}`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.setContent(`<!doctype html><html><head><style>${CSS}${TRIAL_CSS}</style></head><body style="margin:0;padding:24px"><div id="root"></div></body></html>`);
    await page.addScriptTag({ path: HARNESS });
    const pages = Array.from({ length: 300 }, densePage);
    const rows: Record<string, unknown> = { measure: 'arriving', kind };
    for (const scroll of ['fling', 'reading'] as const) {
      await page.evaluate(
        (spec) => {
          window.scrollTo(0, 0);
          (globalThis as unknown as { trial: { mount: (s: unknown) => void } }).trial.mount(spec);
        },
        { kind, pages, size: { width: 612, height: 792 }, rotation: 0, zoom: 1.5, settled: true },
      );
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const state = globalThis as unknown as { frames: number[]; arrivalsAt: number; trial: { arrivals: unknown[] } };
        state.frames = [];
        state.arrivalsAt = state.trial.arrivals.length;
        let last = performance.now();
        const tick = (now: number): void => {
          state.frames.push(now - last);
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.mouse.move(700, 500);
      if (scroll === 'fling') {
        const until = Date.now() + 2000;
        while (Date.now() < until) await page.mouse.wheel(0, 260);
        await page.waitForTimeout(1000);
      } else {
        for (let step = 0; step < 30; step += 1) {
          await page.mouse.wheel(0, 900);
          await page.waitForTimeout(400);
        }
      }
      const result = await page.evaluate(() => {
        const state = globalThis as unknown as { frames: number[]; arrivalsAt: number; trial: { arrivals: { pages: number; ms: number }[] } };
        const frames = state.frames.slice(1);
        const arrivals = state.trial.arrivals.slice(state.arrivalsAt);
        const perPage = arrivals.filter((each) => each.pages > 0).map((each) => each.ms / each.pages);
        return {
          frames: frames.length,
          over16_7: frames.filter((f) => f > 16.7 + 0.5).length,
          over33: frames.filter((f) => f > 33.4).length,
          worstFrame: Number(Math.max(...frames).toFixed(1)),
          arrivals: arrivals.length,
          arrivedPages: arrivals.reduce((sum, each) => sum + each.pages, 0),
          worstArrivalMs: Number(Math.max(0, ...arrivals.map((each) => each.ms)).toFixed(1)),
          perPageMs: perPage.length === 0 ? null : Number((perPage.reduce((a, b) => a + b, 0) / perPage.length).toFixed(1)),
        };
      });
      rows[scroll] = result;
    }
    record(rows);
  });
}

// RUN 29b: THE COST OF PAINTING: a selection across a whole dense page set by script, and a drag that grows one down
// the page in sixty moves, each paint timed by the painter itself.
for (const kind of KINDS.filter((each) => each === 'A' || each === 'B')) {
  test(`painting cost: ${kind}`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1400 });
    await page.setContent(`<!doctype html><html><head><style>${CSS}${TRIAL_CSS}</style></head><body style="margin:0;padding:24px"><div id="root"></div></body></html>`);
    await page.addScriptTag({ path: HARNESS });
    await page.evaluate(
      (spec) => {
        (globalThis as unknown as { trial: { mount: (s: unknown) => void } }).trial.mount(spec);
      },
      { kind, pages: [densePage()], size: { width: 612, height: 792 }, rotation: 0, zoom: 1.5 },
    );
    const whole = await page.evaluate(async () => {
      const trial = (globalThis as unknown as { trial: { paints: { frames: number; ms: number } } }).trial;
      const lines = document.querySelectorAll('[data-text-line]');
      const first = lines[0]?.firstChild;
      const last = lines[lines.length - 1]?.firstChild;
      if (!(first instanceof Text) || !(last instanceof Text)) return null;
      trial.paints.frames = 0;
      trial.paints.ms = 0;
      document.getSelection()?.setBaseAndExtent(first, 0, last, last.length);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { paints: trial.paints.frames, ms: Number(trial.paints.ms.toFixed(2)), rects: document.querySelectorAll('.m-trial-paint').length };
    });
    const top = await letterAt(page, 0, 2, 0.3);
    await page.evaluate(() => {
      const trial = (globalThis as unknown as { trial: { paints: { frames: number; ms: number } } }).trial;
      trial.paints.frames = 0;
      trial.paints.ms = 0;
      document.getSelection()?.removeAllRanges();
    });
    await page.mouse.move(top.x + 300, 60);
    await page.mouse.down();
    await page.mouse.move(top.x + 300, 1150, { steps: 60 });
    await page.mouse.up();
    const grown = await page.evaluate(() => {
      const trial = (globalThis as unknown as { trial: { paints: { frames: number; ms: number } } }).trial;
      return { paints: trial.paints.frames, msPerPaint: Number((trial.paints.ms / Math.max(1, trial.paints.frames)).toFixed(2)), rects: document.querySelectorAll('.m-trial-paint').length };
    });
    record({ measure: 'painting', kind, whole, grown });
  });
}

test('what a screen reader is given, by the svg element’s role', async ({ page }) => {
  const read: Record<string, string> = {};
  for (const role of [null, 'none', 'group', 'document', 'text']) {
    await open(page, 'svg', null);
    if (role !== null) await page.evaluate((r) => document.querySelector('svg.m-svg-text-layer')?.setAttribute('role', r), role);
    read[role ?? 'unset'] = await page.locator('[data-text-layer="0"]').ariaSnapshot();
  }
  record({ measure: 'aria-roles', ...read });
});

for (const kind of KINDS) {
  test(`selection gestures: ${kind}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, kind, null);
    const lines = pdfLines();
    const first = lines[0];
    const second = lines[1];
    const fourth = lines[3];
    if (first === undefined || second === undefined || fourth === undefined) throw new Error('fixture');
    const word = (line: typeof first, n: number): { from: number; to: number } => {
      const words = line.text.split(' ');
      const from = words.slice(0, n).join(' ').length + (n > 0 ? 1 : 0);
      return { from, to: from + (words[n] ?? '').length };
    };
    const rows: Record<string, unknown> = { measure: 'gestures', kind };

    // A DRAG from 25% into the third word's first letter to 75% into the sixth word's last, with twelve moves.
    const k = word(first, 2).from;
    const m = word(first, 5).to;
    const start = await letterAt(page, 0, k, 0.25);
    const end = await letterAt(page, 0, m - 1, 0.75);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    const drag = await selected(page, kind);
    rows['drag'] = { expected: first.text.slice(k, m), platform: drag.platform, read: drag.read, fromOffPt: drag.fromX === null ? null : Number((drag.fromX - (first.xs[k] ?? 0)).toFixed(2)), toOffPt: drag.toX === null ? null : Number((drag.toX - (first.xs[m] ?? 0)).toFixed(2)) };

    // A DOUBLE CLICK in the middle of "commence", and a TRIPLE CLICK on the second line.
    const commence = word(first, 3);
    const middle = await letterAt(page, 0, commence.from + 3, 0.5);
    await page.mouse.dblclick(middle.x, middle.y);
    rows['double'] = { expected: first.text.slice(commence.from, commence.to), ...(await selected(page, kind)) };
    const onSecond = await letterAt(page, 1, 10, 0.5);
    await page.mouse.click(onSecond.x, onSecond.y, { clickCount: 3 });
    rows['triple'] = { expected: second.text, ...(await selected(page, kind)) };

    // A CLICK before "Effective", then Shift+Right three times.
    const effective = word(first, 6);
    const before = await letterAt(page, 0, effective.from, 0.2);
    await page.mouse.click(before.x, before.y);
    for (let n = 0; n < 3; n += 1) await page.keyboard.press('Shift+ArrowRight');
    rows['shift'] = { expected: first.text.slice(effective.from, effective.from + 3), ...(await selected(page, kind)) };

    // COPY ACROSS A LINE END: from "the term of" to "twelve months,", then Ctrl+C. The quote Ask AI takes is `read`.
    const term = first.text.lastIndexOf('term');
    const from = await letterAt(page, 0, term, 0.25);
    const to = await letterAt(page, 1, second.text.indexOf(',') , 0.75);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const across = await selected(page, kind);
    // WHAT THE COPY PUTS ON THE CLIPBOARD, read on `window`, after the layer's own listener on the document wrote it.
    await page.evaluate(() => {
      window.addEventListener('copy', (event) => {
        (globalThis as unknown as { copied: string }).copied = event.clipboardData?.getData('text/plain') ?? '';
      });
    });
    await page.keyboard.press('Control+C');
    const clipboard = await page.evaluate(() => (globalThis as unknown as { copied?: string }).copied ?? null);
    rows['copy'] = { expected: `${first.text.slice(term)} ${second.text.slice(0, second.text.indexOf(',') + 1)}`, clipboard, read: across.read };

    // THE CARET API on a letter: what `caretPositionFromPoint` answers, which `exactCaretOf` takes as it is.
    const probe = await letterAt(page, 0, 5, 0.3);
    rows['caretApi'] = await page.evaluate(([x, y]) => {
      const caret = document.caretPositionFromPoint(x, y);
      return caret === null ? null : { text: caret.offsetNode.nodeType === Node.TEXT_NODE, offset: caret.offset, in: (caret.offsetNode.parentElement?.tagName ?? '').toLowerCase() };
    }, [probe.x, probe.y] as const);

    // A CLICK'S WOBBLE: a press on a letter that drifts 2 px across before the release selects nothing.
    const wobble = await letterAt(page, 0, 20, 0.4);
    await page.mouse.move(wobble.x, wobble.y);
    await page.mouse.down();
    await page.mouse.move(wobble.x + 2, wobble.y + 1, { steps: 3 });
    await page.mouse.up();
    rows['wobble'] = (await selected(page, kind)).platform;

    // BLANK SPACE: a press 30 pt below the last line, under its tenth letter, dragged up onto its twentieth.
    const below = await at(page, fourth.xs[10] ?? 0, fourth.baseline - 30);
    const onto = await letterAt(page, 3, 20, 0.25);
    await page.mouse.move(below.x, below.y);
    await page.mouse.down();
    await page.mouse.move(onto.x, onto.y, { steps: 12 });
    await page.mouse.up();
    rows['blank'] = { expected: fourth.text.slice(10, 20), ...(await selected(page, kind)) };

    // BESIDE A LINE: a press 2 pt before the first line, dragged into its third word.
    const beside = await at(page, (first.xs[0] ?? 0) - 2, first.baseline + FILE.size * 0.3);
    const into = await letterAt(page, 0, k + 2, 0.75);
    await page.mouse.move(beside.x, beside.y);
    await page.mouse.down();
    await page.mouse.move(into.x, into.y, { steps: 12 });
    await page.mouse.up();
    rows['beside'] = { expected: first.text.slice(0, k + 3), ...(await selected(page, kind)) };

    // THE LINE ELEMENT'S BOX, which `lineUnder` and `caretBesideLine` read as the engine's, against the engine's.
    rows['lineBox'] = await page.evaluate(() =>
      [...document.querySelectorAll('[data-text-line]')].map((line) => {
        const r = line.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      }),
    );
    const boxes = [];
    for (const line of lines) {
      const a = await at(page, line.box.x0, line.box.y1);
      const b = await at(page, line.box.x1, line.box.y0);
      boxes.push([Math.round(a.x), Math.round(a.y), Math.round(b.x - a.x), Math.round(b.y - a.y)]);
    }
    rows['engineBox'] = boxes;

    // WHAT A SCREEN READER IS GIVEN: the accessibility tree's reading of the layer.
    rows['aria'] = await page.locator('[data-text-layer="0"]').ariaSnapshot();
    record(rows);
  });
}

for (const kind of KINDS) {
  for (const [rotation, zoom] of [
    [90, 1],
    [180, 1],
    [270, 1],
    [0, 0.5],
    [0, 4],
  ] as const) {
    test(`presses at ${String(rotation)} degrees, ${String(zoom * 100)} %: ${kind}`, async ({ page }) => {
      await page.setViewportSize({ width: 2800, height: 3400 });
      await open(page, kind, null, rotation, zoom);
      const lines = pdfLines();
      let presses = 0;
      let wrong = 0;
      for (const [index, line] of lines.entries()) {
        for (const [k, x] of line.xs.entries()) {
          if (line.text[k] === ' ') continue;
          const next = line.xs[k + 1] ?? FILE.x + widthOf(line.text);
          const point = await at(page, x + (next - x) * 0.3, line.baseline + FILE.size * 0.3);
          await press(page, point);
          const caret = await anchor(page);
          presses += 1;
          if (caret?.line !== index || caret.offset !== k) wrong += 1;
        }
      }
      record({ measure: 'turned-zoomed', kind, rotation, zoom, presses, wrong });
    });
  }
}
