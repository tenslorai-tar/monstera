import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * EVERY COMMENT MARK IS ON SCREEN IN ITS FINAL LOOK FROM ITS RELEASE UNTIL THE PAGE DRAWS IT
 * ([ADR-0257](../../../docs/DECISIONS/0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md), the
 * owner's answer to R19).
 *
 * Each tool draws one mark on a blank page, and every animation frame from before the finishing input until the page has
 * been drawn from the command's version is read in the page: whether a held look is on screen and which parts it has, and
 * whether the overlay's ACCENT PLACEHOLDER (`.m-annotation-preview`) is. The tool's own look must be on screen within
 * 150 ms of the finishing input, and no frame after it may show neither or the placeholder.
 *
 * The shim answers a command with a new version of the SAME bytes, so the page drawn from it does not show the mark: the
 * case asserts the look up to the frame the page presents that version, which is the holder's handover. That the saved
 * mark is on the page at the handover is the live instrument's to read (`markLatencyWalk.mjs`), on the real engine.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

interface Frame {
  readonly t: number;
  readonly looks: readonly string[];
  readonly placeholder: boolean;
}

const WORDS = 'Quarterly totals rose sharply';

/**
 * A page with one line of words at y 600, 28 pt, for the tools whose gesture selects text, and that line as the engine
 * would answer it — in display space, from the font's own advance and its ascent and descent at that size — since the
 * shim's text layer is the engine's answer, not the page's.
 */
async function pageWithWords(): Promise<{ bytes: Uint8Array; line: { text: string; box: { x0: number; y0: number; x1: number; y1: number } } }> {
  const document = await PDFDocument.create();
  const sheet = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  sheet.drawText(WORDS, { x: 150, y: 600, size: 28, font });
  const top = 792 - 600 - font.heightAtSize(28, { descender: false });
  const bottom = 792 - 600 + (font.heightAtSize(28) - font.heightAtSize(28, { descender: false }));
  return { bytes: await document.save(), line: { text: WORDS, box: { x0: 150, y0: top, x1: 150 + font.widthOfTextAtSize(WORDS, 28), y1: bottom } } };
}

async function open(page: Page): Promise<void> {
  const { bytes, line } = await pageWithWords();
  await page.setViewportSize({ width: 1600, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Blank.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    pageLinesPlaced: [[line]],
    // A PICTURE THE STAMP CHOOSER CAN KEEP, a 1 × 1 PNG, for the picture stamp's case.
    library: {
      pick: {
        name: 'Paid',
        bytes: new Uint8Array(
          Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
        ),
      },
    },
    settings: { 'appearance.ribbon-section': 'comment' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
}

/** A point of the first page, in PDF points, on screen now. */
async function onScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  return { x: slot.x + x * scale, y: slot.y + (792 - y) * scale };
}

async function sample(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: Frame[] = [];
    const inputs: number[] = [];
    // THE INPUT AS DISPATCHED, not as created: `event.timeStamp` is when the browser made the event, and a frame may run
    // between that and its dispatch, before the page could have answered it.
    for (const kind of ['pointerup', 'keydown']) {
      window.addEventListener(
        kind,
        () => {
          inputs.push(performance.now());
        },
        { capture: true },
      );
    }
    // WHEN THE LOOK ENTERS THE PAGE, timed by the mutation itself: a frame's time is the browser's to choose, and this
    // browser runs frames irregularly while nothing on the page animates (frames 250 ms apart before a release, no task
    // long enough to explain them, measured 2026-10-21) — so the app's part is when the look is there to be painted.
    const inserted: number[] = [];
    // WHERE IT WAS DRAWN, against the line of words, read as it enters: the look and the words are two layers, and a
    // look in the wrong place passes every rule about time.
    const placed: { look: DOMRect; line: DOMRect | undefined }[] = [];
    new MutationObserver(() => {
      const look = document.querySelector('[data-mark-looks] [data-mark-look]');
      if (inserted.length === 0 && look !== null) {
        inserted.push(performance.now());
        placed.push({ look: look.getBoundingClientRect(), line: document.querySelector('[data-text-line="0"]')?.getBoundingClientRect() });
      }
    }).observe(document.body, { childList: true, subtree: true });
    Reflect.set(window, 'lookInserted', inserted);
    Reflect.set(window, 'lookPlaced', placed);
    let running = true;
    const tick = (): void => {
      if (!running) return;
      frames.push({
        t: performance.now(),
        looks: [...document.querySelectorAll('[data-mark-looks] [data-mark-look]')].map((element) => element.getAttribute('data-mark-look') ?? ''),
        placeholder: document.querySelector('.m-annotation-overlay .m-annotation-preview') !== null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    Reflect.set(window, 'lookSampler', {
      stop: () => {
        running = false;
        return { frames, inputs };
      },
    });
  });
}

async function drag(page: Page, from: readonly [number, number], to: readonly [number, number], steps = 8): Promise<void> {
  const a = await onScreen(page, from[0], from[1]);
  const b = await onScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function clicks(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  for (const [x, y] of points) {
    const at = await onScreen(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
}

/** Opens a writer by `open`, types into it, and finishes it with `finish` — the input the case times from. */
async function writes(page: Page, open: () => Promise<void>, finish: string, words = 'See figure 3'): Promise<void> {
  await open();
  // THE CARET IN A BOX FOR WORDS, whichever kind the writer is.
  await page.waitForFunction(() => {
    const focused = document.activeElement;
    return (
      focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement || (focused instanceof HTMLElement && focused.isContentEditable)
    );
  });
  await page.keyboard.type(words);
  await page.keyboard.press(finish);
}

const TRIANGLE = [
  [150, 620],
  [330, 620],
  [330, 520],
] as const;

/**
 * Every tool that places a mark from a gesture, how it draws one, and the part its look must have. `tool: false` is a
 * route with no tool chosen: `select` runs before the sampler starts, and `draw` finishes the mark.
 */
const TOOLS: readonly {
  /** The command that chooses the tool. */
  readonly title: string;
  /** What the case is called, where two cases choose one tool. */
  readonly name?: string;
  readonly draw: (page: Page) => Promise<void>;
  readonly part: string;
  readonly tool?: false;
  readonly select?: (page: Page) => Promise<void>;
  /** A mark over the selected words of the page's one line, whose look must be drawn over them. */
  readonly overWords?: true;
}[] = [
  { title: 'Rectangle', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'outline' },
  { title: 'Ellipse', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'outline' },
  { title: 'Line', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'poly' },
  { title: 'Arrow', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'poly' },
  { title: 'Freehand', draw: (page) => drag(page, [150, 600], [330, 500], 20), part: 'poly' },
  { title: 'Polygon', draw: (page) => clicks(page, [...TRIANGLE, TRIANGLE[0]]), part: 'poly' },
  { title: 'Cloud', draw: (page) => clicks(page, [...TRIANGLE, TRIANGLE[0]]), part: 'poly' },
  {
    title: 'Connected lines',
    draw: async (page) => {
      await clicks(page, TRIANGLE);
      await page.keyboard.press('Enter');
    },
    part: 'poly',
  },
  { title: 'Measure distance', draw: (page) => drag(page, [150, 600], [330, 520]), part: 'caption' },
  { title: 'Measure area', draw: (page) => clicks(page, [...TRIANGLE, TRIANGLE[0]]), part: 'caption' },
  {
    title: 'Measure perimeter',
    draw: async (page) => {
      await clicks(page, TRIANGLE);
      await page.keyboard.press('Enter');
    },
    part: 'caption',
  },
  { title: 'Highlight an area of the page', draw: (page) => drag(page, [150, 600], [330, 560]), part: 'fill' },
  { title: 'Mark an area for redaction', draw: (page) => drag(page, [150, 600], [330, 560]), part: 'redact' },
  // THE TOOLS WHOSE GESTURE SELECTS TEXT: the drag selects the words, and the release marks them.
  { title: 'Highlight text', draw: (page) => drag(page, [152, 608], [400, 608]), part: 'swash', overWords: true },
  { title: 'Underline text', draw: (page) => drag(page, [152, 608], [400, 608]), part: 'rule', overWords: true },
  { title: 'Strikethrough text', draw: (page) => drag(page, [152, 608], [400, 608]), part: 'rule', overWords: true },
  { title: 'Mark text for redaction', draw: (page) => drag(page, [152, 608], [400, 608]), part: 'redact', overWords: true },
  // THE WRITERS: the mark is made when the words are finished, so the finishing input is the key that finishes them, and
  // the box typed into closes in the same moment the look must take its place.
  { title: 'Text box', draw: (page) => writes(page, () => drag(page, [150, 400], [400, 330]), 'Escape'), part: 'words' },
  { title: 'Typewriter', draw: (page) => writes(page, () => clicks(page, [[150, 400]]), 'Escape'), part: 'words' },
  { title: 'Callout', draw: (page) => writes(page, () => drag(page, [150, 300], [400, 400]), 'Escape'), part: 'words' },
  { title: 'Note', draw: (page) => writes(page, () => clicks(page, [[150, 400]]), 'Control+Enter'), part: 'sign' },
  { title: 'Insertion mark', draw: (page) => clicks(page, [[150, 400]]), part: 'sign' },
  // A STAMP IS CHOSEN IN A DIALOG after its box is drawn: the finishing input is the press on the chooser's action.
  {
    title: 'Stamp',
    draw: async (page) => {
      await drag(page, [150, 400], [390, 340]);
      const chooser = page.getByRole('dialog');
      await chooser.locator('[data-stamp="not-approved"]').click();
      await chooser.getByRole('button', { name: 'Add stamp', exact: true }).click();
    },
    part: 'stamp',
  },
  // A KEPT PICTURE STAMP: kept from the chooser, chosen, and the press on its action finishes it. Main places it.
  {
    title: 'Stamp',
    name: 'a kept picture stamp',
    draw: async (page) => {
      await drag(page, [150, 400], [390, 340]);
      const chooser = page.getByRole('dialog');
      await chooser.getByRole('button', { name: 'Add a picture…' }).click();
      await expect(chooser.getByRole('img', { name: 'Paid' })).toBeVisible();
      await chooser.locator('[data-stamp-picture] input').check();
      await chooser.getByRole('button', { name: 'Add stamp', exact: true }).click();
    },
    part: 'picture',
  },
  // A SIGNATURE IS CHOSEN FIRST, then placed by a click: the finishing input is the click on the page.
  {
    title: 'Signature',
    draw: async (page) => {
      const chooser = page.getByRole('dialog', { name: 'Signature' });
      await chooser.getByRole('button', { name: 'Type' }).click();
      await chooser.getByRole('textbox', { name: 'Your name' }).fill('Ada Lovelace');
      await expect(chooser.getByRole('img', { name: 'Your signature, as it will be placed' })).toBeVisible();
      await chooser.getByRole('button', { name: 'Use Signature' }).click();
      await expect(chooser).toBeHidden();
      await clicks(page, [[270, 400]]);
    },
    part: 'strokes',
  },
  // A PICTURE SIGNATURE, uploaded in the dialog, then placed by a click.
  {
    title: 'Signature',
    name: 'a picture signature',
    draw: async (page) => {
      const chooser = page.getByRole('dialog', { name: 'Signature' });
      await chooser.getByRole('button', { name: 'Upload' }).click();
      await chooser.getByRole('button', { name: 'Choose picture…' }).click();
      await expect(chooser.getByRole('img').first()).toBeVisible();
      await chooser.getByRole('button', { name: 'Use Signature' }).click();
      await expect(chooser).toBeHidden();
      await clicks(page, [[270, 400]]);
    },
    part: 'picture',
  },
  // A LINK'S DESTINATION IS ASKED ON THE PAGE after its box is drawn, and Enter commits it.
  {
    title: 'Link to a web address',
    draw: (page) => writes(page, () => drag(page, [150, 400], [400, 330]), 'Enter', 'https://example.com'),
    part: 'link',
  },
  { title: 'Link to a page', draw: (page) => writes(page, () => drag(page, [150, 400], [400, 330]), 'Enter', '1'), part: 'link' },
  // AND THE SELECTED-TEXT MENU'S ROUTE: words selected with no tool, and the item chosen from the right-click.
  ...[
    ['Highlight', 'swash'],
    ['Mark for redaction', 'redact'],
  ].map(([item = '', part = '']) => ({
    title: `the menu’s ${item}`,
    tool: false as const,
    draw: async (page: Page) => {
      const at = await onScreen(page, 300, 608);
      await page.mouse.click(at.x, at.y, { button: 'right' });
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    },
    select: (page: Page) => drag(page, [152, 608], [400, 608]),
    part,
    overWords: true as const,
  })),
];

for (const tool of TOOLS) {
  test(`${tool.name ?? tool.title}: its final look from the release until the page draws it, never the placeholder or nothing`, async ({ page }) => {
    await open(page);
    if (tool.tool === false) await tool.select?.(page);
    else await runCommand(page, tool.title);
    await sample(page);
    await tool.draw(page);
    // UNTIL THE PAGE HAS BEEN DRAWN FROM THE COMMAND'S VERSION, which is when the holder lets the look go.
    await expect(page.locator('[data-mark-looks]')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(100);
    const { frames, inputs } = await page.evaluate(
      () => (Reflect.get(window, 'lookSampler') as { stop: () => { frames: Frame[]; inputs: number[] } }).stop(),
    );
    const [insertedAt] = await page.evaluate(() => Reflect.get(window, 'lookInserted') as number[]);
    const finished = inputs.at(-1) ?? Number.NaN;
    const after = frames.filter((frame) => frame.t >= finished);
    const first = after.findIndex((frame) => frame.looks.length > 0);
    // THE CONTROL: a look WAS held, and it was this tool's — a run that held nothing would pass every rule below.
    expect(first, 'no frame after the release showed a held look').toBeGreaterThanOrEqual(0);
    const shown = after[first];
    expect(shown?.looks).toContain(tool.part);
    // IN THE PAGE WITHIN 150 MS of the finishing input, timed when it was inserted.
    expect(insertedAt, 'the look was never inserted').toBeDefined();
    expect(Math.round((insertedAt ?? Number.NaN) - finished), 'ms from the release to the look in the page').toBeLessThanOrEqual(150);
    // AND IN THE VERY FIRST FRAME AFTER THE RELEASE: no frame the browser ran passed without it.
    expect(first, 'frames after the release that ran before the look').toBe(0);
    // AND FROM THEN UNTIL THE HANDOVER, never the accent placeholder and never nothing.
    const last = after.findLastIndex((frame) => frame.looks.length > 0);
    const held = after.slice(first, last + 1);
    expect(held.filter((frame) => frame.placeholder).map((frame) => Math.round(frame.t - finished)), 'frames with the placeholder').toStrictEqual([]);
    expect(held.filter((frame) => frame.looks.length === 0).map((frame) => Math.round(frame.t - finished)), 'frames with nothing').toStrictEqual([]);
    expect(after.slice(0, first).filter((frame) => frame.placeholder), 'the placeholder before the look').toStrictEqual([]);
    if (tool.overWords === true) {
      // OVER THE SELECTED WORDS: inside the line's height, starting at its start, and ending before its end — the drag
      // stopped mid-line, so a look the width of the whole line is the line's box and not the selection's.
      const [where] = await page.evaluate(() => Reflect.get(window, 'lookPlaced') as { look: DOMRect; line: DOMRect | undefined }[]);
      const { look, line } = where ?? {};
      if (look === undefined || line === undefined) throw new Error('the look or the line was not there to measure');
      expect(look.top, 'look top against the line').toBeGreaterThanOrEqual(line.top - 1);
      expect(look.bottom, 'look bottom against the line').toBeLessThanOrEqual(line.bottom + 1);
      expect(Math.abs(look.left - line.left), 'look start against the line start').toBeLessThanOrEqual(tool.part === 'swash' ? line.height / 4 + 2 : 2);
      expect(look.right, 'look end against the line end').toBeLessThan(line.right - 20);
    }
  });
}
