import { type Page, expect, test } from '@playwright/test';

import {
  type Agreement,
  LINES,
  type Opening,
  dragLetters,
  farthest,
  laidOut,
  onLetter,
  openAgreement,
  paintedIn,
  selectSpan,
  spanCorners,
} from './agreementLetters.js';

/**
 * EVERY READER OF A PAGE'S SELECTION, on the engine's letters (ADR-0280, Decision 5): what a search paints, what each
 * markup and the redaction mark send, the text Copy, *Search for this* and the assistant's four items take, a double and
 * a triple click, and both rules on a page turned three ways, at two zooms, on angled text and off whole points.
 *
 * Each case is on the agreement page drawn in `monospace` (`agreementLetters.ts`), so a reader that took the browser's
 * layout of the substitute lands visibly away from the engine's letters, and every case carries the control that says by
 * how much. The kernel half of the markups is `lineEndMarks.proof.mjs`, which saves and reopens marks made from points at
 * these lines' glyph edges; this file holds the renderer to sending exactly those points.
 */

const LINE = LINES[0]?.text ?? '';
/** The run every drag below selects: from letter 10's second half to letter 40's, so letters 11 to 40. */
const RUN = LINE.slice(11, 41);

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

/**
 * Opens the page and drags the run, from letter `from` to letter `to` (each on its second half); the page's selection
 * must be the letters after the first to the last, or nothing below means anything.
 */
async function withRun(page: Page, opening: Opening = {}, from = 10, to = 40): Promise<Agreement> {
  const agreement = await openAgreement(page, opening);
  expect(await dragLetters(page, agreement, 0, from, to)).toBe(LINE.slice(from + 1, to + 1));
  return agreement;
}

/** Right-click on the run, and the menu item `name`. */
async function fromMenu(page: Page, agreement: Agreement, name: string): Promise<void> {
  const at = onLetter(agreement, 0, 25);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}

/** The first object in `value` carrying a `from` and a `to` point: a command's two ends. */
function endsOf(value: unknown): { from: { x: number; y: number }; to: { x: number; y: number } } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const point = (each: unknown): each is { x: number; y: number } =>
    typeof each === 'object' && each !== null && typeof (each as { x?: unknown }).x === 'number' && typeof (each as { y?: unknown }).y === 'number';
  const [from, to] = [record['from'], record['to']];
  if (point(from) && point(to)) return { from, to };
  for (const each of Object.values(record)) {
    const found = endsOf(each);
    if (found !== undefined) return found;
  }
  return undefined;
}

test('SEARCH: a match is painted over the engine’s letters', async ({ page }) => {
  const agreement = await openAgreement(page);
  const word = 'commence';
  const from = LINE.indexOf(word);
  await page.keyboard.press('Control+F');
  await page.locator('[data-find-input="true"]').fill(word);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-layer="0"] .m-text-layer__matches polygon')).toHaveCount(1);
  const [shape] = await paintedIn(page, 'matches');
  const expected = spanCorners(agreement, 0, from, from + word.length);
  expect(farthest(shape ?? [], expected)).toBeLessThan(0.5);
  // CONTROL: the range the registry records lies where the substitute lays the word out, so a match painted through
  // `::highlight` stood elsewhere — which is what it did until this.
  const dom = await laidOut(page, 0, from, from + word.length);
  expect(Math.max(Math.abs(dom.left - (expected[0]?.x ?? 0)), Math.abs(dom.right - (expected[1]?.x ?? 0)))).toBeGreaterThan(5);
  const recorded = await page.evaluate(() => [...(CSS.highlights.get('monstera-find') ?? [])].map((range) => (range instanceof Range ? range.toString() : '')));
  expect(recorded).toStrictEqual([word]);
});

for (const name of ['Highlight', 'Underline', 'Strikethrough', 'Mark for redaction']) {
  test(`MARKUP: ${name} from a selection sends the engine’s two ends of the run`, async ({ page }) => {
    const sent: unknown[] = [];
    const agreement = await withRun(page, {
      observe: (channel, params) => {
        if (channel === 'document.execute') sent.push(params);
      },
    });
    await fromMenu(page, agreement, name);
    await expect.poll(() => sent.length).toBe(1);
    const ends = endsOf(sent[0]);
    if (ends === undefined) throw new Error(`${name} sent no two ends: ${JSON.stringify(sent[0])}`);
    const start = agreement.inPdf(0, 11);
    const end = agreement.inPdf(0, 41);
    // AT THE RUN'S FIRST AND LAST LETTERS' OUTER EDGES, on the line: the points `lineEndMarks.proof.mjs` marks from.
    expect(Math.abs(ends.from.x - start.x), `from ${String(ends.from.x)} against ${String(start.x)}`).toBeLessThan(0.3);
    expect(Math.abs(ends.to.x - end.x), `to ${String(ends.to.x)} against ${String(end.x)}`).toBeLessThan(0.3);
    for (const point of [ends.from, ends.to]) {
      expect(point.y).toBeGreaterThan(start.y - 0.25 * 11);
      expect(point.y).toBeLessThan(start.y + 0.9 * 11);
    }
  });
}

test('COPY, from the menu and by Ctrl+C, takes the run the engine’s letters selected', async ({ page }) => {
  const agreement = await withRun(page);
  await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
  await fromMenu(page, agreement, 'Copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(RUN.trim());
  await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
  await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(RUN.trim());
});

test('SEARCH FOR THIS searches for the run', async ({ page }) => {
  const agreement = await withRun(page);
  await fromMenu(page, agreement, 'Search for this');
  await expect(page.locator('[data-find-input="true"]')).toHaveValue(RUN.trim());
});

test('ASK AI quotes the run in the assistant’s box', async ({ page }) => {
  const agreement = await withRun(page);
  await fromMenu(page, agreement, 'Ask AI');
  await expect(page.getByLabel('Ask about this document')).toHaveValue(`“${RUN.trim()}” `);
});

for (const name of ['Explain', 'Summarise', 'Translate']) {
  test(`${name.toUpperCase()} asks about the run`, async ({ page }) => {
    const asked: unknown[] = [];
    const agreement = await withRun(page, {
      observe: (channel, params) => {
        if (channel === 'ai.ask') asked.push(params);
      },
      // A STORED KEY AND A MODEL, without which the panel asks nothing (`AssistantPanel`'s readiness).
      more: {
        secrets: { 'ai.anthropic-key': 'a-fixture-key' },
        aiModels: { source: 'fetched', models: [{ id: 'fixture-model', label: 'Fixture', capabilities: { vision: null, streaming: null } }] },
      },
    });
    await fromMenu(page, agreement, name);
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    expect(JSON.stringify(asked[0])).toContain(JSON.stringify(RUN.trim()).slice(1, -1));
  });
}

test('EDIT › TRANSLATE on the selected text sends the words as `readTextSelection` reads them, a space where a line ended', async ({ page }) => {
  const sent: string[] = [];
  await openAgreement(page, {
    observe: (channel, params) => {
      if (channel === 'ai.translatePage' || channel === 'ai.translateText') sent.push(JSON.stringify(params));
    },
    more: {
      secrets: { 'ai.openai-key': 'a-fixture-key' },
      aiModels: { source: 'fetched', models: [{ id: 'fixture-model', label: 'Fixture', capabilities: { vision: null, streaming: null } }] },
    },
  });
  // THE RIBBON'S BUTTON, as a person reaches it: the palette's field would take the selection with its focus.
  await page.locator('nav.m-ribbon__rail').getByRole('button', { name: 'Edit' }).click();
  // FROM *term of* AT LINE 0'S END TO *twelve* AT LINE 1'S START.
  await page.evaluate(() => {
    const first = document.querySelector('[data-text-layer="0"] [data-text-line="0"]')?.firstChild;
    const second = document.querySelector('[data-text-layer="0"] [data-text-line="1"]')?.firstChild;
    if (!(first instanceof Text) || !(second instanceof Text)) throw new Error('no lines');
    document.getSelection()?.setBaseAndExtent(first, first.length - 7, second, 6);
  });
  await page.locator('.m-ribbon__tools').getByRole('button', { name: 'Translate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Translate', exact: true });
  await dialog.getByRole('button', { name: 'Selected text' }).click();
  await dialog.locator('[data-translate-language]').selectOption('fr');
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  // THE CONTROL IS THE PLATFORM'S TEXT OF THE SAME RANGE, *term oftwelve*, which the command read before.
  expect(sent[0]).toContain('term of twelve');
  expect(sent[0]).not.toContain('oftwelve');
});

/**
 * A word of the line whose first letter, by the engine, lies under ANOTHER word of the substitute: where the browser's
 * own double click would select that other word. Found rather than chosen, so the premise is measured on this machine.
 */
async function misplacedWord(page: Page, agreement: Agreement): Promise<{ start: number; end: number; at: { x: number; y: number } }> {
  const words = [...LINE.matchAll(/\S+/gu)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  for (const word of words.slice(1)) {
    const at = onLetter(agreement, 0, word.start, 0.5);
    // THE SUBSTITUTE'S LETTER AT THAT POINT ACROSS: the one whose laid-out box holds it.
    const browser = await page.evaluate((x) => {
      const node = document.querySelector('[data-text-layer="0"] [data-text-line="0"]')?.firstChild;
      if (!(node instanceof Text)) return -1;
      const range = document.createRange();
      for (let letter = 0; letter < node.length; letter += 1) {
        range.setStart(node, letter);
        range.setEnd(node, letter + 1);
        const box = range.getBoundingClientRect();
        if (x >= box.left && x < box.right) return letter;
      }
      return -1;
    }, at.x);
    if (browser < word.start || browser >= word.end) return { ...word, at };
  }
  throw new Error('every word’s first letter lies under its own word in the substitute, so no case here separates anything');
}

test('DOUBLE CLICK selects the word the engine has under the pointer', async ({ page }) => {
  const agreement = await openAgreement(page);
  const word = await misplacedWord(page, agreement);
  await page.mouse.dblclick(word.at.x, word.at.y);
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe(LINE.slice(word.start, word.end));
  // AND IT IS PAINTED THERE.
  const [shape] = await paintedIn(page, 'selection');
  expect(farthest(shape ?? [], spanCorners(agreement, 0, word.start, word.end))).toBeLessThan(0.5);
});

test('A DOUBLE CLICK AND THEN A TRIPLE CLICK on the same word end with its line selected', async ({ page }) => {
  // FIVE PRESSES, the first of the triple inside the word the double click selected: the browser's state from that
  // press is what removed the line when the layer cancelled the browser's handling of the next two.
  const agreement = await openAgreement(page);
  const at = onLetter(agreement, 0, LINE.indexOf('Effective') + 3, 0.5);
  await page.mouse.dblclick(at.x, at.y);
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('Effective');
  await page.mouse.click(at.x, at.y, { clickCount: 3 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect((await page.evaluate(() => document.getSelection()?.toString() ?? '')).trim()).toBe(LINE.trim());
});

test('CONTROL: on a line placed as before, the double click is the browser’s word and not the engine’s', async ({ page, context }) => {
  const agreement = await openAgreement(page);
  const word = await misplacedWord(page, agreement);
  // THE SAME POINT on the same page in a second tab, with the line's letters taken away.
  const second = await context.newPage();
  const bare = await openAgreement(second, { bare: 0 });
  const at = onLetter(bare, 0, word.start, 0.5);
  expect(at).toStrictEqual(word.at);
  await second.mouse.dblclick(at.x, at.y);
  expect(await second.evaluate(() => document.getSelection()?.toString() ?? '')).not.toBe(LINE.slice(word.start, word.end));
});

for (const rotation of [90, 180, 270] as const) {
  test(`TURNED ${String(rotation)}: the selection is painted over the engine’s letters, and a drag and a double click take them`, async ({ page }) => {
    const agreement = await withRun(page, { rotation });
    const [shape] = await paintedIn(page, 'selection');
    expect(farthest(shape ?? [], spanCorners(agreement, 0, 11, 41))).toBeLessThan(0.5);
    // A DOUBLE CLICK on *Effective*'s fourth letter.
    const from = LINE.indexOf('Effective');
    const at = onLetter(agreement, 0, from + 3, 0.5);
    await page.mouse.dblclick(at.x, at.y);
    expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('Effective');
  });

  test(`TURNED ${String(rotation)}: a triple click selects the line the engine has under the pointer`, async ({ page }) => {
    const agreement = await openAgreement(page, { rotation });
    const at = onLetter(agreement, 0, LINE.indexOf('Effective') + 3, 0.5);
    await page.mouse.click(at.x, at.y, { clickCount: 3 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect((await page.evaluate(() => document.getSelection()?.toString() ?? '')).trim()).toBe(LINE.trim());
  });
}

for (const zoom of ['50pct', '400pct'] as const) {
  test(`ZOOM ${zoom}: the selection is painted over the engine’s letters, and a drag takes them`, async ({ page }) => {
    // AT 400% letter 40 is past the window's edge, so the run there is letters 3 to 18.
    const [from, to] = zoom === '400pct' ? [2, 18] : [10, 40];
    const agreement = await withRun(page, { zoom }, from, to);
    const [shape] = await paintedIn(page, 'selection');
    expect(farthest(shape ?? [], spanCorners(agreement, 0, from + 1, to + 1))).toBeLessThan(0.5);
  });
}

test('ANGLED TEXT: a line turned 20 degrees is painted along its letters, and a drag takes them', async ({ page }) => {
  const agreement = await withRun(page, { angle: 20 });
  const [shape] = await paintedIn(page, 'selection');
  expect(farthest(shape ?? [], spanCorners(agreement, 0, 11, 41))).toBeLessThan(0.5);
});

test('OFF WHOLE POINTS: a page placed 0.37 pt off is painted and selected by the engine’s letters', async ({ page }) => {
  const agreement = await withRun(page, { shift: 0.37 });
  const [shape] = await paintedIn(page, 'selection');
  expect(farthest(shape ?? [], spanCorners(agreement, 0, 11, 41))).toBeLessThan(0.5);
});

test('SHIFT+ARROW extends the selection by letters, and the paint follows the engine’s', async ({ page }) => {
  const agreement = await openAgreement(page);
  await selectSpan(page, 0, 5, 30);
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe(LINE.slice(5, 33));
  const [shape] = await paintedIn(page, 'selection');
  expect(farthest(shape ?? [], spanCorners(agreement, 0, 5, 33))).toBeLessThan(0.5);
});
