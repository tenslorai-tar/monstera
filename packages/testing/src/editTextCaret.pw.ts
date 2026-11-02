import { PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A caret in an untouched line stands where the page draws the letters beside it (item 2).
 *
 * The editor sets an untouched line's invisible letters in a substitute face, and fitted a word at a time, that face's
 * own letter widths stood inside each word: a caret between two letters sat a fraction of a letter off the page's. Each
 * word now carries its letters' edges from the PDFium read that gives Edit text its words (`drawnWordsOf`), and each
 * letter is fitted there.
 *
 * THE DRAWN LETTER is the page's own pen: each letter's advance summed, as `drawText` sets them (no kerning). The read's
 * edges are PDFium's answer for this same file, measured 2026-11-02 against that pen within 0.014 pt for every face here,
 * upright and turned (`scripts/research/letterEdges.mjs`), so the shim states them as PDFium does.
 *
 * THE CASE FAILS ON THE CODE BEFORE THE FIX: that code placed a line by its words, which is exactly what the words with
 * no edges give, and `CONTROL: by words alone` shows it misses the tolerance (1.25 pt in Times, 0.44 pt in Helvetica). On a
 * page turned a quarter it also measured the line across its letters, 9 to 11 pt off whatever the face (`alongLine`).
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e7');
const TEXT = 'Waving illicit MOMWAW tilt';
const SIZE = 12;
const LEFT = 72;
const BASELINE = 690;
/** How far a caret may stand from the drawn letter edge, in points. */
const TOLERANCE = 0.25;

type Face = 'TimesRoman' | 'Helvetica' | 'Courier';

interface Opened {
  /** Each unit boundary's pen position along the line, in points: `TEXT.length + 1` values. */
  readonly pen: readonly number[];
  readonly right: number;
}

async function open(page: Page, face: Face, options: { readonly widths: boolean; readonly turn: 0 | 90; readonly edges: boolean }): Promise<Opened> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts[face]);
  const drawn = pdf.addPage([612, 792]);
  drawn.drawText(TEXT, { x: LEFT, y: BASELINE, size: SIZE, font });
  if (options.turn !== 0) drawn.setRotation(degrees(options.turn));
  // THE FONT OBJECT EXISTS ONLY ONCE SAVED: loaded back, its /Widths set from the face's own advances, or left absent.
  const saved = await PDFDocument.load(await pdf.save());
  if (options.widths) {
    for (const [, object] of saved.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || String(object.get(PDFName.of('Type'))) !== '/Font') continue;
      const codes = Array.from({ length: 95 }, (_, at) => at + 32);
      object.set(PDFName.of('FirstChar'), PDFNumber.of(32));
      object.set(PDFName.of('LastChar'), PDFNumber.of(126));
      object.set(PDFName.of('Widths'), saved.context.obj(codes.map((code) => font.widthOfTextAtSize(String.fromCharCode(code), 1000))));
    }
  }
  const bytes = await saved.save();
  const pen = [LEFT];
  for (const letter of TEXT) pen.push((pen.at(-1) ?? LEFT) + font.widthOfTextAtSize(letter, SIZE));
  const right = pen.at(-1) ?? LEFT;
  const words = [...TEXT.matchAll(/\S+/gu)].map((match) => {
    const from = match.index;
    const to = from + match[0].length;
    return { from, to, x0: pen[from] ?? LEFT, x1: pen[to] ?? right, ...(options.edges ? { edges: pen.slice(from, to + 1) } : {}) };
  });
  const box = { x0: LEFT, y0: BASELINE - 3, x1: right, y1: BASELINE + 9 };
  const kind = { serif: face === 'TimesRoman', mono: face === 'Courier' };
  const style = { size: SIZE, colour: { r: 0, g: 0, b: 0 }, ...kind, italic: false, bold: false } as const;
  await page.setViewportSize({ width: 1800, height: 1100 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Caret.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    viewModels: [{ pageCount: 1, rotations: [options.turn] }],
    textBlocks: [
      {
        box,
        lines: [{ runs: [{ index: 3, text: TEXT, style, words }], box, soft: false, baseline: BASELINE }],
        style,
        shape: { align: 'left' as const, firstIndent: 0 },
      },
    ],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  return { pen, right };
}

/**
 * Where the caret stands at each unit boundary of the first paragraph, as a share of the frame along the line: 0 at the
 * frame's start and 1 at its end. Along the frame's width on an upright page, and down its height on one turned a
 * quarter clockwise, where the line runs downward.
 */
async function caretShares(page: Page, turn: 0 | 90): Promise<number[]> {
  return page.locator(SURFACE).evaluate((root, turned) => {
    const frame = root.closest('[data-kit-frame]') ?? root;
    const area = frame.getBoundingClientRect();
    const nodes: Text[] = [];
    const walker = root.ownerDocument.createTreeWalker(root.querySelector('[data-kit-paragraph]') ?? root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node instanceof Text) nodes.push(node);
    const shares: number[] = [];
    for (const [at, node] of nodes.entries()) {
      // EACH UNIT'S START in the node holding it, and the line's end in the last.
      const last = at === nodes.length - 1;
      for (let unit = 0; unit < node.data.length + (last ? 1 : 0); unit += 1) {
        const range = root.ownerDocument.createRange();
        range.setStart(node, unit);
        range.collapse(true);
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        shares.push(turned ? (rect.top - area.top) / area.height : (rect.left - area.left) / area.width);
      }
    }
    return shares;
  }, turn === 90);
}

/** The worst distance, in points, between a caret and the pen at each boundary. */
function worst(shares: readonly number[], opened: Opened): { readonly at: number; readonly by: number } {
  let found = { at: -1, by: 0 };
  for (const [at, share] of shares.entries()) {
    const caret = LEFT + share * (opened.right - LEFT);
    const by = Math.abs(caret - (opened.pen[at] ?? Number.NaN));
    if (!(by <= found.by)) found = { at, by };
  }
  return found;
}

const FACES: readonly { readonly face: Face; readonly widths: boolean }[] = [
  { face: 'TimesRoman', widths: true },
  { face: 'TimesRoman', widths: false },
  { face: 'Helvetica', widths: true },
  { face: 'Courier', widths: true },
];

for (const { face, widths } of FACES) {
  for (const turn of [0, 90] as const) {
    test(`a caret at the start, the middle and the end of the letters stands on the page’s letters: ${face}, ${widths ? 'with' : 'without'} /Widths, turned ${String(turn)}`, async ({ page }) => {
      const opened = await open(page, face, { widths, turn, edges: true });
      const shares = await caretShares(page, turn);
      // EVERY BOUNDARY, the line's start and end among them.
      expect(shares).toHaveLength(TEXT.length + 1);
      const off = worst(shares, opened);
      expect(off.by, `the caret before “${TEXT.slice(off.at, off.at + 1)}” (offset ${String(off.at)})`).toBeLessThanOrEqual(TOLERANCE);
    });
  }
}

// NOT COURIER: a fixed-pitch stand-in gives every letter the page's own width, so by words alone its caret is already
// within 0.021 pt (measured 2026-11-02). Its upright case passes on the code before the fix as well; its turned case does
// not, for the rotation `alongLine` answers.
for (const { face, widths } of FACES.filter((each) => each.face !== 'Courier')) {
  for (const turn of [0, 90] as const) {
    test(`CONTROL: by words alone, as before the fix, a caret inside a word stands off the page’s letters: ${face}, ${widths ? 'with' : 'without'} /Widths, turned ${String(turn)}`, async ({ page }) => {
      const opened = await open(page, face, { widths, turn, edges: false });
      const off = worst(await caretShares(page, turn), opened);
      expect(off.by).toBeGreaterThan(TOLERANCE);
    });
  }
}

/**
 * WHAT OPENING A BLOCK AND TYPING IN IT COST, when asked for (`CARET_TIMING=edges|words`): a block of 24 lines of 12 pt
 * Helvetica, every word carrying its letter edges or none (the code before the fix reads none, and its contract refuses
 * a key it does not know, so a run of it is measured with `words`). Opening is the Enter on the box to the first frame
 * after the editor holds the focus; a keystroke is its `keydown` to the next frame after its `input`.
 */
test('TIMING of opening a dense block and typing in it, when asked for', async ({ page }) => {
  const mode = process.env['CARET_TIMING'];
  test.skip(mode !== 'edges' && mode !== 'words', 'a measurement, run by hand');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const drawn = pdf.addPage([612, 792]);
  const LINES = 24;
  const line = 'The quarterly figures were reconciled against the ledger and every account balanced.';
  const lines = [];
  for (let at = 0; at < LINES; at += 1) {
    const baseline = 740 - at * 14;
    drawn.drawText(line, { x: LEFT, y: baseline, size: SIZE, font });
    const pen = [LEFT];
    for (const letter of line) pen.push((pen.at(-1) ?? LEFT) + font.widthOfTextAtSize(letter, SIZE));
    const words = [...line.matchAll(/\S+/gu)].map((match) => ({
      from: match.index,
      to: match.index + match[0].length,
      x0: pen[match.index] ?? LEFT,
      x1: pen[match.index + match[0].length] ?? LEFT,
      ...(mode === 'edges' ? { edges: pen.slice(match.index, match.index + match[0].length + 1) } : {}),
    }));
    const box = { x0: LEFT, y0: baseline - 3, x1: pen.at(-1) ?? LEFT, y1: baseline + 9 };
    lines.push({ runs: [{ index: at, text: line, style: { size: SIZE, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false }, words }], box, soft: false, baseline });
  }
  const style = { size: SIZE, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
  const top = lines[0]?.box.y1 ?? 750;
  const bottom = lines.at(-1)?.box.y0 ?? 400;
  const right = Math.max(...lines.map((each) => each.box.x1));
  const box = { x0: LEFT, y0: bottom, x1: right, y1: top };
  const bytes = await pdf.save();
  await page.setViewportSize({ width: 1800, height: 1100 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Dense.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: [{ box, lines, style, shape: { align: 'left' as const, firstIndent: 0 } }],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  const outline = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
  await outline.click();
  await page.waitForTimeout(500);
  // THE OPEN, from the Enter's own time to the first frame after the editor has the focus.
  await page.evaluate((surface) => {
    const record = window as unknown as { opening?: Promise<number> };
    record.opening = new Promise<number>((resolve) => {
      window.addEventListener(
        'keydown',
        (event) => {
          const began = event.timeStamp;
          // THE CLOCK READ IN THE FRAME'S CALLBACK, never the frame's own timestamp: that is when the frame began, which
          // can be before an event dispatched in the same turn, and it would leave out the work the event did.
          const look = (): void => {
            if (document.activeElement?.matches(surface) === true) resolve(performance.now() - began);
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        },
        { capture: true, once: true },
      );
    });
  }, SURFACE);
  await page.keyboard.press('Enter');
  const opening = await page.evaluate(() => (window as unknown as { opening: Promise<number> }).opening);
  // EACH KEYSTROKE in an untouched line: the first turns it from as-drawn to drawn, the rest type into it.
  await page.keyboard.press('Control+Home');
  await page.evaluate((surface) => {
    const record = window as unknown as { strokes: number[] };
    record.strokes = [];
    const root = document.querySelector(surface);
    if (root === null) throw new Error('no editor surface');
    // THE KIT APPLIES A KEY TO ITS MODEL AND DRAWS IT, so no `input` fires: the stroke ends at the first frame after the
    // editor's own nodes change.
    window.addEventListener(
      'keydown',
      (event) => {
        const began = event.timeStamp;
        const watcher = new MutationObserver(() => {
          watcher.disconnect();
          requestAnimationFrame(() => record.strokes.push(performance.now() - began));
        });
        watcher.observe(root, { subtree: true, childList: true, characterData: true });
      },
      { capture: true },
    );
  }, SURFACE);
  // THE RESOLUTION TEST, when asked for (`CARET_SPIN=<ms>`): a key held up that long on purpose, which the strokes must show.
  const spin = Number(process.env['CARET_SPIN'] ?? '0');
  if (spin > 0) {
    await page.evaluate((ms) => {
      window.addEventListener('keydown', () => {
        const until = performance.now() + ms;
        while (performance.now() < until);
      });
    }, spin);
  }
  // A CPU PROFILE OF THE STROKES, when asked for (`CARET_PROFILE=1`), read against an unminified build for the names.
  const session = process.env['CARET_PROFILE'] === '1' ? await page.context().newCDPSession(page) : undefined;
  if (session !== undefined) {
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 200 });
    await session.send('Profiler.start');
  }
  for (let key = 0; key < 10; key += 1) {
    await page.keyboard.type('x');
    await page.waitForTimeout(120);
  }
  if (session !== undefined) {
    const { profile } = await session.send('Profiler.stop');
    const self = new Map<string, number>();
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    for (const [at, id] of (profile.samples ?? []).entries()) {
      const node = nodes.get(id);
      if (node === undefined) continue;
      const key = `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').at(-1) ?? ''}:${String(node.callFrame.lineNumber)}`;
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas?.[at] ?? 0) / 1000);
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    console.log(`TIMING profile\n${top.map(([name, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${name}`).join('\n')}`);
  }
  const strokes = await page.evaluate(() => (window as unknown as { strokes: number[] }).strokes);
  console.log(`TIMING ${String(mode)} ${JSON.stringify({ openMs: Math.round(opening), strokes: strokes.map(Math.round), worstStroke: Math.round(Math.max(...strokes)) })}`);
  expect(strokes).toHaveLength(10);
});

test('CONTROL: in a line the person typed in, the caret follows the typed text', async ({ page }) => {
  await open(page, 'Helvetica', { widths: true, turn: 0, edges: true });
  await page.keyboard.press('Home');
  await page.keyboard.type('Now ');
  // THE TYPED LINE IS DRAWN, no longer laid out as the page drew it, and its caret is where the typing left it.
  await expect(page.locator(`${SURFACE} .m-kit__paragraph--as-drawn`)).toHaveCount(0);
  const caret = await page.locator(SURFACE).evaluate((root) => {
    const selection = root.ownerDocument.getSelection();
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : undefined;
    if (range === undefined) return undefined;
    const typed = root.ownerDocument.createRange();
    typed.selectNodeContents(root.querySelector('[data-kit-paragraph]') ?? root);
    typed.setEnd(range.startContainer, range.startOffset);
    const before = typed.toString();
    const at = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const words = root.querySelector('[data-kit-paragraph]')?.getBoundingClientRect();
    return { before, inside: words !== undefined && at.left >= words.left && at.left <= words.right };
  });
  expect(caret).toStrictEqual({ before: 'Now ', inside: true });
});
