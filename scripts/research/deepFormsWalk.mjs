// @ts-check
/**
 * The deep forms walk (cloud-33, findings BBBBBBBBB-6 and -26): a page whose drawn forms nest sixteen deep and draw the
 * next twice, 65,535 placements of text from a file of 4.9 KB, opened in the running app on Windows with a real mouse
 * and keyboard.
 *
 *   node scripts/research/deepFormsWalk.mjs [--app-root <checkout>]
 *
 * What it walks: the page shows; its text layer has lines, and a drag across them copies words (D2: the page-text read
 * follows the forms no further than Edit text's bounded walk); Edit text reads the page and outlines blocks rather than
 * saying it could not (D1: the count of characters the walk cannot name crosses unclipped); and a word typed in one of
 * the blocks is written. Each step records how long the app took, the walk's own clock.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';

import { appRootOption, startWalk } from './liveWalk.mjs';
import { textSteps } from './textWalkSteps.mjs';

// LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const { formGraph } = await import('../../packages/kernel/dist/formGraphFixture.js');

const walk = await startWalk('deep-forms', appRootOption(process.argv));
const { app, page, output, open, section, step, finish } = walk;
const { editor, ensureEditText, openAt, pressAway, problems } = textSteps(walk);

const deep = join(output, 'deep-forms.pdf');
await writeFile(deep, await formGraph(16, 2, 1, 300));

/**
 * Every sentence the page's notes and alerts say, so a page Edit text could not read is named rather than missed. Edit
 * text's own notes are `.m-page-mode__notes` (`EditTextLayer.tsx`), which this read missed until a screenshot showed one
 * (2026-11-02); step 3's expected note is the control that it now sees them.
 */
const said = () =>
  page
    .locator('[data-page-note], .m-page-mode__notes p, [role=alert], [role=alertdialog]')
    .allInnerTexts()
    .then((texts) => texts.map((text) => text.replaceAll(/\s+/gu, ' ').trim()).filter((text) => text !== ''));

await step('the page opens and its text layer has lines', async () => {
  const started = Date.now();
  // HOW LONG THE PAGE TAKES TO SHOW IS THIS STEP'S MEASUREMENT: `open` waits 30 s for the page to be drawn, and this page
  // took longer than that on 2026-11-02 (its text layer's lines came at 22.6 s to 33.0 s, in 1.1.2610.0 as on main), so
  // an `open` that stops waiting is read on to the page drawn, and the time it took is recorded.
  const slow = await open(deep).then(
    () => false,
    () => true,
  );
  await page.locator('canvas.m-page:visible').first().waitFor({ state: 'visible', timeout: 120_000 });
  const shownMs = Date.now() - started;
  const lines = page.locator('[data-text-layer="0"]:visible [data-text-line]');
  await expect.poll(() => lines.count(), { timeout: 120_000, intervals: [100] }).toBeGreaterThan(0);
  return { shownMs, pastOpensWait: slow, linesMs: Date.now() - started, lines: await lines.count(), said: await said() };
});

/**
 * Zoom in by the status bar's button, as a hand does, until the page is drawn at `percent` or more: the page's words are
 * 3 pt, about 4 px at 100 %, and every placement stands a point from the last, so at 100 % they are one blot.
 * @param {number} percent
 */
async function zoomTo(percent) {
  // THE PERCENT THE STATUS BAR SHOWS, as a person reads it: the slider holds the scale (1.25, not 125) and stops at its
  // last step, and this read compared that scale with a percent until a screenshot showed 125 % (2026-11-02).
  const shown = page.locator('.m-status-zoom').first();
  const now = async () => Number.parseInt((await shown.innerText()).replaceAll(/\D/gu, ''), 10);
  /** How long each press took to show its zoom, which is this page's cost of a redraw. */
  const pressMs = [];
  for (let press = 0; press < 20; press += 1) {
    const before = await now();
    if (before >= percent) return pressMs;
    const pressed = Date.now();
    // THE STATUS BAR'S OR THE FLOATING BAR'S: both are named so, and either zooms the page.
    await page.getByRole('button', { name: 'Zoom in', exact: true }).first().click();
    await expect.poll(now, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(before);
    pressMs.push(Date.now() - pressed);
  }
  throw new Error(`the zoom did not reach ${String(percent)} % in twenty presses`);
}

await step('zoomed in, a drag across the text layer’s first line copies its words', async () => {
  const pressMs = await zoomTo(400);
  const line = page.locator('[data-text-layer="0"]:visible [data-text-line]').first();
  await line.scrollIntoViewIfNeeded();
  const box = await line.boundingBox();
  if (box === null) throw new Error('the first line has no box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  for (let at = 1; at <= 10; at += 1) await page.mouse.move(box.x + 1 + ((box.width - 2) * at) / 10, y);
  await page.mouse.up();
  // THE WALK'S OWN MARKER FIRST: the clipboard is the computer's, and on 2026-11-02 it held what the person had copied,
  // which an empty-string wait took for the copy and this step then printed. What the copy put there is told apart from
  // the marker, and words are recorded only where they are this page's own; anything else is recorded by its length.
  const MARKER = 'monstera-deep-forms-walk';
  await app.evaluate(({ clipboard }, marker) => clipboard.writeText(marker), MARKER);
  const started = Date.now();
  await page.keyboard.press('Control+C');
  const read = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const changed = await expect
    .poll(read, { timeout: 30_000 })
    .not.toBe(MARKER)
    .then(
      () => true,
      () => false,
    );
  const copied = changed ? await read() : '';
  // THE PAGE'S OWN WORDS: every form shows G and its level.
  const own = /^[\sG\d]+$/u.test(copied) && /G\d+/u.test(copied);
  if (!own) throw new Error(changed ? `the copy put ${String(copied.length)} characters that are not this page’s words` : 'the copy put nothing on the clipboard');
  return { pressMs, copyMs: Date.now() - started, copied: copied.slice(0, 80) };
});

// THE ONE NOTE THIS PAGE OWES: its placements outnumber MAX_FORM_PLACEMENTS, so Edit text outlines what its bounded walk
// kept and says the rest is not outlined (`TEXT_EDIT_FORMS_MORE`), rather than refusing the page.
const FORMS_MORE = 'This page repeats its drawings more often than can be outlined at once, so some of its text is not outlined.';

await step('Edit text reads the page, outlines its blocks, and says only that some are not outlined', async () => {
  const started = Date.now();
  await section('Edit');
  await ensureEditText();
  const outlines = page.locator('[data-text-block]');
  await expect.poll(async () => (await outlines.count()) > 0 || (await said()).length > 0, { timeout: 120_000, intervals: [100] }).toBe(true);
  await expect.poll(said, { timeout: 10_000 }).toContain(FORMS_MORE);
  const sentences = await said();
  expect(sentences, JSON.stringify(sentences)).toStrictEqual([FORMS_MORE]);
  return { outlinesMs: Date.now() - started, outlines: await outlines.count() };
});

await step('a word typed in the first block is written, and nothing is refused', async () => {
  await page.locator('[data-text-block]').first().scrollIntoViewIfNeeded();
  const box = await page.locator('[data-text-block]').first().boundingBox();
  if (box === null) throw new Error('the first block has no box');
  await openAt(box.x + box.width - 1, box.y + box.height / 2);
  await page.keyboard.press('Control+End');
  await page.keyboard.type('x');
  expect(await problems()).toStrictEqual([]);
  const started = Date.now();
  const answer = await pressAway();
  expect(answer).toStrictEqual([]);
  await expect(editor()).toHaveCount(0);
  return { writeMs: Date.now() - started };
});

await finish();
