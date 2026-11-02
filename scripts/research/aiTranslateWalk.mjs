// @ts-check
/**
 * The long translation walk (cloud-31's B1): a selection longer than one translation ask is translated WHOLE and copied,
 * never its opening presented as all of it, in the running app on Windows, live on Claude Haiku 4.5.
 *
 *   node scripts/research/aiTranslateWalk.mjs
 *
 * ## The key is the owner's, typed by the owner
 *
 * The walk opens Settings › AI in its own fresh profile with the Anthropic key field focused, prints WAITING FOR THE
 * KEY, and waits until the row says a key is stored. Nothing here reads, prints or stores the value: the field is a
 * password field (`Input`'s `secret`), so the screenshots show dots, and the walk never asks the field for its value.
 * At the end the key is removed in Settings and the walk's profile folder is deleted.
 *
 * ## Calls
 *
 * Haiku 4.5 only, chosen in Settings from the list Anthropic answers; the walk stops before Translate unless the model
 * row reads Haiku 4.5. One Translate press: the selection is about 12,000 characters, so it crosses in two pieces of at
 * most `MAX_TRANSLATE_TEXT` (8,192), which is two calls. 1.1.2610.0 cut it to the first 8,192 and said nothing.
 */
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { startWalk } from './liveWalk.mjs';

const STORED = 'A key is stored. Type a new one to replace it.';
const SENTENCES = 270;
const sentence = (/** @type {number} */ n) => `S${String(n)}: the river is calm and the boats are slow.`;

/** One page of numbered sentences in small type, so one selection holds them all and its last number is known. */
async function longPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const words = Array.from({ length: SENTENCES }, (_, at) => sentence(at + 1));
  const lines = [];
  let line = '';
  for (const each of words) {
    const next = line === '' ? each : `${line} ${each}`;
    if (font.widthOfTextAtSize(next, 5) > 532) {
      lines.push(line);
      line = each;
    } else line = next;
  }
  lines.push(line);
  lines.forEach((text, at) => page.drawText(text, { x: 40, y: 760 - at * 9, size: 5, font }));
  return { bytes: await document.save(), characters: lines.join(' ').length, lines: lines.length };
}

const walk = await startWalk('ai-translate');
const { app, page, output, open, step, finish } = walk;
const dialog = () => page.getByRole('dialog');
const built = await longPage();
const documentPath = join(output, 'long-selection.pdf');
await writeFile(documentPath, built.bytes);

async function openAi() {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(dialog()).toBeVisible({ timeout: 30_000 });
  await dialog().getByRole('tab', { name: 'AI', exact: true }).or(dialog().getByRole('button', { name: 'AI', exact: true })).first().click();
  await expect(dialog().getByLabel('AI provider', { exact: true })).toBeVisible();
}

// `--rehearse` walks the selection and its copy only, with no key and no call, so the owner is asked for the key once the
// rest is known to work.
const rehearse = process.argv.includes('--rehearse');

/**
 * The whole page selected by a drag from the first line's start to the last line's end, as a hand selects, and the
 * selection READ BACK by a copy, so a selection that did not happen is said before anything is sent. On 2026-11-02 a
 * click and a Shift+click on 5 pt lines selected nothing that the menu could see, and the step met no Translate.
 */
async function selectAll() {
  if ((await page.locator('.m-status-name').count()) === 0) await open(documentPath);
  const lines = page.locator('[data-text-layer="0"]:visible [data-text-line]');
  await expect.poll(() => lines.count(), { timeout: 60_000 }).toBe(built.lines);
  const first = await lines.first().boundingBox();
  const last = await lines.last().boundingBox();
  if (first === null || last === null) throw new Error('the lines have no boxes');
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 20 });
  await page.mouse.up();
  const MARKER = 'monstera-ai-translate-walk-copy';
  await app.evaluate(({ clipboard }, marker) => clipboard.writeText(marker), MARKER);
  await page.keyboard.press('Control+C');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 }).not.toBe(MARKER);
  const selected = await app.evaluate(({ clipboard }) => clipboard.readText());
  if (!selected.startsWith('S1:') || !selected.includes(`S${String(SENTENCES)}:`)) {
    throw new Error(`the drag selected ${String(selected.length)} characters, not the page from S1 to S${String(SENTENCES)}: nothing will be sent`);
  }
  return { lines, selected: selected.length };
}

if (rehearse) {
  await step('REHEARSAL: Settings opened and closed, then the drag selects the whole page, read back by a copy, and a right-click on it offers Translate', async () => {
    // THE LIVE RUN'S OWN ORDER: Settings first, then the Open press, which one live run of three met with nothing opened.
    await openAi();
    await page.keyboard.press('Escape');
    await expect(dialog()).toHaveCount(0);
    const { lines, selected } = await selectAll();
    const middle = await lines.nth(Math.floor(built.lines / 2)).boundingBox();
    if (middle === null) throw new Error('the middle line has no box');
    await page.mouse.click(middle.x + middle.width / 2, middle.y + middle.height / 2, { button: 'right' });
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Translate', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    return { selected };
  });
  await finish();
  process.exit();
}

await step('the owner types the Anthropic key into Settings › AI, and Haiku 4.5 is chosen', async () => {
  // THE DOCUMENT FIRST, then Settings over it: one live run of three met an Open press after Settings with nothing
  // opened, which three rehearsals of that order without a key did not (2026-11-02, not explained).
  await open(documentPath);
  await openAi();
  await dialog().getByLabel('AI provider', { exact: true }).selectOption({ label: 'Anthropic' });
  await dialog().getByLabel('Anthropic API key', { exact: true }).click();
  process.stdout.write('WAITING FOR THE KEY: type it into the focused field in the app; the walk goes on when it reads as stored.\n');
  await expect(dialog().getByText(STORED)).toHaveCount(1, { timeout: 15 * 60_000 });
  // THE MODEL LIST, answered by Anthropic once a key is stored: Haiku 4.5 is chosen from it, or nothing is sent.
  const model = dialog().getByLabel('AI model', { exact: true });
  await expect.poll(async () => (await model.locator('option').allInnerTexts()).some((name) => /Haiku 4\.5/u.test(name)), { timeout: 60_000 }).toBe(true);
  const haiku = (await model.locator('option').allInnerTexts()).find((name) => /Haiku 4\.5/u.test(name)) ?? '';
  await model.selectOption({ label: haiku });
  const chosen = await model.locator('option:checked').innerText();
  if (!/Haiku 4\.5/u.test(chosen)) throw new Error(`the model reads ${chosen}, not Haiku 4.5: nothing will be sent`);
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  return { model: chosen };
});

await step('the whole page selected by a drag, and Translate into Spanish copies all of it', async () => {
  const { lines } = await selectAll();
  const MARKER = 'monstera-ai-translate-walk';
  await app.evaluate(({ clipboard }, marker) => clipboard.writeText(marker), MARKER);
  const middle = await lines.nth(Math.floor(built.lines / 2)).boundingBox();
  if (middle === null) throw new Error('the middle line has no box');
  await page.mouse.click(middle.x + middle.width / 2, middle.y + middle.height / 2, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Translate', exact: true }).click();
  await expect(dialog()).toBeVisible();
  await dialog().getByLabel('Translate into', { exact: true }).selectOption({ label: 'Spanish' });
  await expect(dialog().getByLabel('Using', { exact: true }).locator('option:checked')).toHaveText('Anthropic');
  const pressed = Date.now();
  await dialog().getByRole('button', { name: 'Translate', exact: true }).click();
  const read = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await expect.poll(read, { timeout: 5 * 60_000, intervals: [500] }).not.toBe(MARKER);
  const copied = await read();
  // THE WHOLE, NOT ITS OPENING: the first sentence's number and the last's, and a length near the selection's.
  expect(copied.includes('S1:') || copied.includes('S1 '), copied.slice(0, 80)).toBe(true);
  expect(copied.includes(`S${String(SENTENCES)}`), `the last 80 characters: ${copied.slice(-80)}`).toBe(true);
  return { selected: built.characters, copied: copied.length, translateMs: Date.now() - pressed, opening: copied.slice(0, 60), end: copied.slice(-60) };
});

await step('the key removed in Settings, and nothing left stored', async () => {
  await openAi();
  await dialog().getByRole('button', { name: 'Remove the stored key' }).click();
  await page.getByRole('button', { name: 'Remove it' }).click();
  await expect(dialog().getByText(STORED)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

await finish();
// THE WALK'S PROFILE, which held the key sealed by Windows while the walk ran, goes with it.
await rm(join(output, 'app-data'), { recursive: true, force: true });
process.stdout.write('the walk’s profile folder was deleted\n');
