import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { FRAME, SURFACE } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * THE HAND WALK and THE SPEED ROWS THE EDITOR OWNS (ADR-0271 sections 3, 4 and 7), on the pinned Chromium: what a person
 * does to a block of words, as a hand does it, asserting what they see; and how long each thing they do takes to show,
 * on the window's own clock.
 *
 * ## The walk
 *
 * Presses as a hand makes them (down, a pixel's drift, up) and typing at a person's speed: select the box, place the
 * caret mid-word with a second press, type, choose a word, Bold on and off, a font chosen by name, a click away. After
 * each step, what is on screen: whether there is a caret and where its letters went, that nothing on the page is
 * selected, that the Bold button changes in place (the same element, never mounted again: the C4 class), and the one
 * command the finish sends. The page after the write is the joint test's (Milestone 2): the shim's kernel is stubbed.
 *
 * The typing box of Text box, Typewriter and callouts (`InlineWriter`) is walked too, because the rebuild must not hurt
 * it (section 1): create, type, Bold on and off, finish. Section 1's list also names a font and a reopen. A reopen is
 * `pageWriting.pw.ts`' double-press case; a font is not in this walk, because while a box's words are typed its panel
 * offers a size and no family (*New annotations*), and the family of a typed box is set on the selected box — a step of
 * the real-app walk on Windows, not one this browser walk adds by changing that tool.
 *
 * ## The speed rows, and what this machine can say about them
 *
 * Each is timed from the input event's own timestamp to the first animation frame at which the result is in the page,
 * read in the page, so no round trip to the test runner is counted. The budgets are section 4's, and the gate is the
 * owner's laptop class (the local agent's measurement, against base A); here they are asserted as a floor any machine
 * must clear, and the figures are printed and attached, so a regression on a CI runner is seen. The finishing rows
 * belong to Milestone 2, with the area repaint.
 *
 * ## The instrument's control (CLAUDE.md item 4a)
 *
 * Before any row is trusted, an element is added a known time after a key the page hears, and the same probe must read
 * that time within two frames: a probe that cannot see a 120 ms delay cannot vouch for a 30 ms budget.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d1');
const RUN = { size: 14, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
const LINES = [
  { text: 'The committee met on Tuesday evening and', baseline: 700, soft: true },
  { text: 'agreed the plans for the summer fair.', baseline: 682, soft: false },
] as const;
const width = (text: string): number => text.length * RUN.size * 0.5;

async function onePage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  for (const line of LINES) sheet.drawText(line.text, { x: 72, y: line.baseline, size: RUN.size, font });
  return document.save();
}

const BLOCK = {
  box: { x0: 72, y0: 678, x1: 72 + width(LINES[0].text), y1: 712 },
  lines: LINES.map((line, at) => ({
    runs: [{ index: at, text: line.text, style: RUN }],
    box: { x0: 72, y0: line.baseline - 3, x1: 72 + width(line.text), y1: line.baseline + 11 },
    soft: line.soft,
    baseline: line.baseline,
  })),
  style: RUN,
  shape: { align: 'left' as const, firstIndent: 0 },
  push: { below: [], room: 0 },
};

const OUTLINE = '[data-text-edit-layer="0"] [data-text-block="0"]';

async function openPage(page: Page, sent: { channel: string; params: unknown }[]): Promise<void> {
  const bytes = await onePage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Walk.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [BLOCK],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await installFirstSelected(page);
}

async function editTextMode(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator(OUTLINE)).toBeVisible({ timeout: 10_000 });
}

/** A press as a hand makes it: down, a pixel's drift, up. */
async function press(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y + 1);
  await page.mouse.up();
}

/** Where character `at` of the open editor's words stands on screen: its middle. */
function characterAt(page: Page, at: number): Promise<{ x: number; y: number; width: number }> {
  return page.locator(SURFACE).evaluate((editor, at) => {
    const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let start = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node as Text;
      if (at < start + text.data.length) {
        const range = editor.ownerDocument.createRange();
        range.setStart(text, at - start);
        range.setEnd(text, at - start + 1);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width };
      }
      start += text.data.length;
    }
    throw new Error(`the editor holds no character ${String(at)}`);
  }, at);
}

/** What the document's selection holds: nothing, a caret in the words, or a range, and where. */
function selectionState(page: Page): Promise<{ kind: 'none' | 'caret' | 'range'; inEditor: boolean; text: string }> {
  return page.evaluate((surface) => {
    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0) return { kind: 'none' as const, inEditor: false, text: '' };
    const editor = document.querySelector(surface);
    const inEditor = editor !== null && selection.anchorNode !== null && editor.contains(selection.anchorNode);
    return { kind: selection.isCollapsed ? ('caret' as const) : ('range' as const), inEditor, text: selection.toString() };
  }, SURFACE);
}

/** The page-side reader {@link installFirstSelected} puts on the window. */
interface FirstSelected {
  firstSelected: () => Element | null;
}

/**
 * Puts on the window the one reader of the element holding the selection's FIRST SELECTED LETTER: the first text node
 * the range covers a character of. Not the range's start container, which at a run's boundary is the end of the run
 * before it. One reader, which the walk and the probe both take, so the two cannot disagree about which letter it is.
 */
async function installFirstSelected(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as FirstSelected).firstSelected = (): Element | null => {
      const selection = document.getSelection();
      if (selection === null || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const root = range.commonAncestorContainer;
      const walker = document.createTreeWalker(root instanceof Text ? (root.parentNode ?? root) : root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node as Text;
        const from = text === range.startContainer ? range.startOffset : 0;
        const to = text === range.endContainer ? range.endOffset : text.data.length;
        if (from < to && range.intersectsNode(text)) return text.parentElement;
      }
      return null;
    };
  });
}

/** The weight and family the browser draws the selection's first letter in. */
function selectedLook(page: Page): Promise<{ weight: number; family: string }> {
  return page.evaluate(() => {
    const element = (window as unknown as FirstSelected).firstSelected();
    if (element === null) return { weight: 0, family: '' };
    const style = getComputedStyle(element);
    return { weight: Number(style.fontWeight), family: style.fontFamily };
  });
}

/** The block edits the page sent main, each as the JSON it crossed in: the words are in it, in the wire form's own fields. */
function edits(sent: readonly { channel: string; params: unknown }[]): string[] {
  return sent.flatMap(({ channel, params }) => {
    if (channel !== 'document.execute') return [];
    const command = (params as { command?: { kind?: string } }).command;
    return command?.kind === 'editTextBlock' ? [JSON.stringify(command)] : [];
  });
}

test('THE HAND WALK: select the box, a caret where pressed, typing, Bold on and off in place, a font, and a click away that writes once', async ({ page }) => {
  const sent: { channel: string; params: unknown }[] = [];
  await openPage(page, sent);
  await editTextMode(page);
  const outline = await page.locator(OUTLINE).boundingBox();
  if (outline === null) throw new Error('the block has no outline on screen');

  // FIRST PRESS: the box is selected, and there is no caret in its words and nothing selected on the page.
  await press(page, outline.x + 60, outline.y + outline.height / 4);
  await expect(page.locator(FRAME)).toBeFocused({ timeout: 10_000 });
  await expect(page.locator(FRAME)).toHaveAttribute('data-kit-mode', 'box');
  expect((await selectionState(page)).kind === 'range').toBe(false);
  expect((await selectionState(page)).inEditor).toBe(false);

  // SECOND PRESS, MID-WORD in "committee": the caret is there, and a letter typed lands there.
  const words = LINES[0].text;
  const at = words.indexOf('committee') + 4;
  const letter = await characterAt(page, at);
  await press(page, letter.x - letter.width / 2 + 0.5, letter.y);
  await expect(page.locator(SURFACE)).toBeFocused();
  expect(await selectionState(page)).toMatchObject({ kind: 'caret', inEditor: true });
  await page.keyboard.type('X', { delay: 90 });
  await expect(page.locator(SURFACE)).toContainText('commXittee');
  await page.keyboard.press('Backspace');

  // TYPING AT A PERSON'S SPEED at the end of the words.
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Tea was served.', { delay: 90 });
  await expect(page.locator(SURFACE)).toContainText('summer fair. Tea was served.');

  // A WORD CHOSEN BY A DOUBLE PRESS, then Bold on and off: the button changes IN PLACE and the word with it.
  const tea = await characterAt(page, (await page.locator(SURFACE).evaluate((editor) => editor.textContent)).indexOf('Tea') + 1);
  await page.mouse.dblclick(tea.x, tea.y);
  expect(await selectionState(page)).toMatchObject({ kind: 'range', text: 'Tea' });
  const panel = page.locator('[data-text-properties]');
  const bold = panel.getByRole('button', { name: 'Bold' });
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  const button = await bold.elementHandle();
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  expect(await selectedLook(page)).toMatchObject({ weight: 700 });
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  expect((await selectedLook(page)).weight).toBeLessThan(600);
  // THE SAME ELEMENT, never mounted again, and still in the page.
  expect(await button.evaluate((element) => element.isConnected && element === document.querySelector('[data-text-properties] [aria-label="Bold"]'))).toBe(true);

  // A FONT CHOSEN BY NAME draws the chosen word in it, with the editor still open.
  const before = await selectedLook(page);
  await panel.getByRole('button', { name: /^Font:/u }).click();
  const search = panel.getByRole('combobox', { name: 'Search fonts' });
  await search.fill('Courier New');
  await search.press('Enter');
  await expect(page.locator(SURFACE)).toBeFocused();
  await expect.poll(async () => (await selectedLook(page)).family).not.toBe(before.family);

  // A CLICK AWAY finishes: the editor is gone, nothing on the page is selected, and ONE edit carries the words typed.
  await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
  await expect(page.locator(SURFACE)).toHaveCount(0);
  expect((await selectionState(page)).kind === 'range').toBe(false);
  await expect.poll(() => edits(sent).length).toBe(1);
  expect(edits(sent)[0]).toContain('summer fair. Tea was served.');
});

test('THE HAND WALK, the typing box Text box keeps (InlineWriter, unchanged by the rebuild): create, type, Bold on and off, finish', async ({ page }) => {
  const sent: { channel: string; params: unknown }[] = [];
  await openPage(page, sent);
  await runCommand(page, 'Text box');
  const surface = page.locator('[data-document-layer="active"]').getByLabel('Draw on page 1');
  const area = await surface.boundingBox();
  if (area === null) throw new Error('the drawing surface is not on screen');
  await page.mouse.move(area.x + 80, area.y + 300);
  await page.mouse.down();
  await page.mouse.move(area.x + 380, area.y + 380, { steps: 6 });
  await page.mouse.up();
  const box = page.getByRole('textbox', { name: 'Text box' });
  await expect(box).toBeFocused();
  await page.keyboard.type('Plain ', { delay: 90 });
  await page.keyboard.press('Control+B');
  await page.keyboard.type('bold', { delay: 90 });
  await page.keyboard.press('Control+B');
  await page.keyboard.type(' again', { delay: 90 });
  await expect(box).toContainText('Plain bold again');
  // FINISHED BY ESCAPE, one command, carrying the words and the bold run.
  await page.keyboard.press('Escape');
  await expect.poll(() => sent.filter(({ channel }) => channel === 'document.execute').length).toBe(1);
  const command = (sent.find(({ channel }) => channel === 'document.execute')?.params as { command?: { annotation?: { text?: string } } }).command;
  expect(command?.annotation?.text).toBe('Plain bold again');
  expect(JSON.stringify(command)).toMatch(/"bold":true/u);
});

/**
 * Arms a probe in the page: from the next trusted `start` event's own timestamp to the first animation frame at which
 * `ready` holds. `ready` names one of the page-side tests below, since a function cannot cross into the page.
 *
 * A BUTTON IS TIMED FROM ITS `click`, the event it acts on: a hand's press lasts as long as the hand holds it, and
 * Playwright's click sends its down and its up as two calls to the browser, so from `pointerdown` a button's row would
 * count the runner's time between them (measured 2026-10-26: one Bold read 50.5 ms from the down where its other three
 * read 20.8 to 40.3). The press that places the caret is timed from its `pointerdown`, which is what it acts on.
 */
async function arm(page: Page, start: 'keydown' | 'pointerdown' | 'click', ready: 'caret' | 'text' | 'weight' | 'pressed' | 'tab' | 'control'): Promise<void> {
  await page.evaluate(
    ({ start, ready, surface }) => {
      const editor = (): Element | null => document.querySelector(surface);
      const weight = (): string => {
        const element = (window as unknown as FirstSelected).firstSelected();
        return element === null ? '' : getComputedStyle(element).fontWeight;
      };
      const pressed = (): string | null => document.querySelector('[data-text-properties] [aria-label="Bold"]')?.getAttribute('aria-pressed') ?? null;
      const tab = (): string | null => document.querySelector('.m-ribbon__rail [data-ribbon-section="comment"]')?.getAttribute('aria-current') ?? null;
      const was = { text: editor()?.textContent ?? '', weight: weight(), pressed: pressed(), tab: tab() };
      const tests: Record<string, () => boolean> = {
        caret: () => {
          const selection = document.getSelection();
          const words = editor();
          return words !== null && document.activeElement === words && selection?.anchorNode !== null && selection?.anchorNode !== undefined && words.contains(selection.anchorNode);
        },
        text: () => (editor()?.textContent ?? '') !== was.text,
        weight: () => weight() !== was.weight,
        pressed: () => pressed() !== was.pressed,
        tab: () => tab() !== was.tab,
        control: () => document.querySelector('[data-probe-control]') !== null,
      };
      const probe = window as unknown as { probeResult?: Promise<number> };
      probe.probeResult = new Promise<number>((resolve) => {
        const begin = (event: Event): void => {
          if (!event.isTrusted) return;
          window.removeEventListener(start, begin, true);
          const from = event.timeStamp;
          const frame = (): void => {
            if (tests[ready]?.() === true) resolve(performance.now() - from);
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        };
        window.addEventListener(start, begin, true);
      });
    },
    { start, ready, surface: SURFACE },
  );
}

function measured(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { probeResult: Promise<number> }).probeResult);
}

const CONTROL_MS = 120;
const FRAME_SLACK_MS = 34;

test('THE SPEED ROWS the editor owns: click until editable, keystroke to paint, a format, a toggle, each inside its budget', async ({ page }, testInfo) => {
  const sent: { channel: string; params: unknown }[] = [];
  await openPage(page, sent);

  // THE PROBE'S CONTROL: an element put in the page CONTROL_MS after a key, read by the same probe.
  await page.evaluate((delay) => {
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'F8') return;
        setTimeout(() => {
          const mark = document.createElement('div');
          mark.setAttribute('data-probe-control', '');
          document.body.append(mark);
        }, delay);
      },
      { once: true },
    );
  }, CONTROL_MS);
  await arm(page, 'keydown', 'control');
  await page.keyboard.press('F8');
  const control = await measured(page);
  expect(control).toBeGreaterThanOrEqual(CONTROL_MS);
  expect(control).toBeLessThan(CONTROL_MS + FRAME_SLACK_MS);

  // A TOGGLE: a ribbon section chosen, before any editor is open.
  await arm(page, 'click', 'tab');
  await page.locator('.m-ribbon__rail [data-ribbon-section="comment"]').click();
  const toggle = await measured(page);

  await editTextMode(page);
  const outline = await page.locator(OUTLINE).boundingBox();
  if (outline === null) throw new Error('the block has no outline on screen');
  // WARM: the box opened and closed once, so the faces and the editor's code are loaded, as a second edit finds them.
  await press(page, outline.x + 60, outline.y + 6);
  await expect(page.locator(FRAME)).toBeFocused({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator(FRAME)).toHaveCount(0);

  // CLICK UNTIL EDITABLE: the second press of the two, on the selected box, until the caret is in its words.
  await press(page, outline.x + 60, outline.y + 6);
  await expect(page.locator(FRAME)).toBeFocused();
  await arm(page, 'pointerdown', 'caret');
  await press(page, outline.x + 120, outline.y + 6);
  const editable = await measured(page);
  await expect(page.locator(SURFACE)).toBeFocused();

  // KEYSTROKE TO PAINT, twenty keys, each its own measurement.
  await page.keyboard.press('Control+End');
  const keys: number[] = [];
  for (const key of 'and the next meeting') {
    await arm(page, 'keydown', 'text');
    await page.keyboard.type(key);
    keys.push(await measured(page));
  }
  const sorted = [...keys].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity;
  const worst = sorted.at(-1) ?? Infinity;

  // A FORMAT VISIBLE: Bold pressed in the panel over chosen words, until the words are drawn in the other weight; and the
  // button's own state, a toggle in the panel. SIX PRESSES EACH, bold on and off in turn, read as a median and a worst,
  // as the keystroke row is: one press lands anywhere in a frame, so one reading is the frame's phase as much as the
  // editor's time (measured 2026-10-26, six single presses 22.0 to 52.1 ms).
  await page.keyboard.press('Shift+Home');
  const bold = page.locator('[data-text-properties]').getByRole('button', { name: 'Bold' });
  const formats: number[] = [];
  const toggles: number[] = [];
  for (let press = 0; press < 6; press += 1) {
    await arm(page, 'click', 'weight');
    await bold.click();
    formats.push(await measured(page));
    await arm(page, 'click', 'pressed');
    await bold.click();
    toggles.push(await measured(page));
  }
  const middle = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Infinity;
  const format = middle(formats);
  const formatWorst = Math.max(...formats);
  const pressed = middle(toggles);

  const table = [
    `probe control (an element ${String(CONTROL_MS)} ms after a key)  ${control.toFixed(1)} ms`,
    `click until editable (warm)          ${editable.toFixed(1)} ms   budget 300`,
    `keystroke to paint, median / worst   ${median.toFixed(1)} / ${worst.toFixed(1)} ms   budget 30 / 50 (of ${String(keys.length)})`,
    `Bold visible, median / worst         ${format.toFixed(1)} / ${formatWorst.toFixed(1)} ms   budget 50 (of ${String(formats.length)})`,
    `ribbon section switch                ${toggle.toFixed(1)} ms   budget 100`,
    `Bold button's own state, median      ${pressed.toFixed(1)} ms   budget 100 (of ${String(toggles.length)})`,
  ].join('\n');
  await testInfo.attach('speed rows', { body: table, contentType: 'text/plain' });
  process.stdout.write(`\n${table}\n`);

  expect(keys).toHaveLength(20);
  expect(editable).toBeLessThan(300);
  expect(median).toBeLessThan(30);
  expect(worst).toBeLessThan(50);
  expect(format).toBeLessThan(50);
  expect(toggle).toBeLessThan(100);
  expect(pressed).toBeLessThan(100);
});
