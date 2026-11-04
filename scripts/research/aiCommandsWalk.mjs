// @ts-check
/**
 * The AI commands walk: every AI command used once, live, in the running app on Windows, on Claude Haiku 4.5, and each
 * read by what it answered or wrote. The full walk judges these rows by their opening only (`respondedWhy`), because it
 * holds no key; this is the walk that sends.
 *
 *   node scripts/research/aiCommandsWalk.mjs [--rehearse]
 *
 * ## The key is the owner's, typed by the owner
 *
 * `aiTranslateWalk.mjs`' arrangement, unchanged: the walk opens Settings › AI in its own fresh profile with the Anthropic
 * key field focused, prints WAITING FOR THE KEY, and waits until the row says a key is stored. Nothing here reads,
 * prints or stores the value: the field is a password field, so the screenshots show dots, and the walk never asks the
 * field for its value. At the end the key is removed in Settings and the walk's profile folder is deleted.
 *
 * ## Calls: eight, Haiku 4.5 only
 *
 * The model is chosen in Settings from the list Anthropic answers, and the walk stops before any call unless it reads
 * Haiku 4.5. One call each: a question in the assistant, Ask AI (its quote, then sent), Explain, Summarise, Translate on
 * selected words, Summarise comments, Draft a reply (and the reply posted, saved and read back), and Translate this page
 * (saved and read back). Nothing loops and nothing is measured.
 *
 * `--rehearse` walks every step's opening with no key and no call, so the owner is asked for the key once the rest is
 * known to work.
 */

import { rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';

import { readPdf } from './everyToolEffects.mjs';
import { startWalk } from './liveWalk.mjs';

const STORED = 'A key is stored. Type a new one to replace it.';
const NOTE = 'Please check the second figure before Friday.';
const WORDS = 'The river rises in the hills and runs to the sea in the east.';

/** A page of plain sentences and one note with words in it: what every AI command here is asked about. */
async function aiDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText('A short report', { x: 72, y: 720, size: 18, font });
  [WORDS, 'The town by the bridge holds a market each week.', 'Its old mill now makes bread for the valley.'].forEach((line, at) =>
    page.drawText(line, { x: 72, y: 680 - at * 18, size: 12, font }),
  );
  const note = document.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [500, 700, 520, 720],
    Contents: PDFString.of(NOTE),
    T: PDFString.of('Reviewer'),
  });
  page.node.set(PDFName.of('Annots'), document.context.obj([document.context.register(note)]));
  return document.save();
}

const rehearse = process.argv.includes('--rehearse');
const walk = await startWalk('ai-commands');
const { app, page, output, open, command, saveTo, step, finish } = walk;
const dialog = () => page.getByRole('dialog');
const documentPath = join(output, 'ai-document.pdf');
await writeFile(documentPath, await aiDocument());
const answers = page.locator('[data-assistant-role="assistant"]');

async function openAi() {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await expect(dialog()).toBeVisible({ timeout: 30_000 });
  await dialog().getByRole('tab', { name: 'AI', exact: true }).or(dialog().getByRole('button', { name: 'AI', exact: true })).first().click();
  await expect(dialog().getByLabel('AI provider', { exact: true })).toBeVisible();
}

/** The first sentence selected by a drag across its line, as a hand selects it. */
async function selectSentence() {
  const line = page.locator('[data-text-layer="0"]:visible [data-text-line]', { hasText: 'The river' }).first();
  await expect(line).toBeVisible({ timeout: 60_000 });
  const box = await line.boundingBox();
  if (box === null) throw new Error('the sentence has no box');
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  return box;
}

/** A right-click on the selected sentence and the menu item named. @param {string} item */
async function fromSelection(item) {
  const box = await selectSentence();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click({ timeout: 10_000 });
}

/**
 * The next answer in the assistant's conversation, waited for and read: one more answer than before, with words in it.
 * Its opening is kept, a few words of a reply about the walk's own sentences.
 * @param {number} before
 */
async function nextAnswer(before) {
  await expect.poll(() => answers.count(), { timeout: 3 * 60_000, intervals: [500] }).toBeGreaterThan(before);
  const last = answers.last();
  await expect.poll(async () => (await last.innerText()).trim().length, { timeout: 3 * 60_000, intervals: [500] }).toBeGreaterThan(20);
  const text = (await last.innerText()).trim();
  return { characters: text.length, opening: text.slice(0, 80) };
}

if (rehearse) {
  await step('REHEARSAL: the document opens, the sentence selects, and its menu offers the four AI items; the note offers Draft a reply', async () => {
    await open(documentPath);
    const box = await selectSentence();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    for (const item of ['Ask AI', 'Explain', 'Summarise', 'Translate']) await expect(page.getByRole('menu').getByRole('menuitem', { name: item, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    // THE NOTE'S MENU, as the live step reaches it.
    await command('Select annotations');
    const canvas = await page.locator('canvas.m-page:visible').first().boundingBox();
    if (canvas === null) throw new Error('no page');
    const scale = canvas.width / 612;
    const at = { x: canvas.x + 510 * scale, y: canvas.y + (792 - 710) * scale };
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(500);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Draft a reply with AI', exact: true })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await command('Translate this page…');
    await expect(dialog()).toBeVisible({ timeout: 30_000 });
    const lists = await Promise.all((await dialog().locator('select').all()).map((list) => list.locator('option').allInnerTexts()));
    await page.keyboard.press('Escape');
    return { opened: true, lists: lists.length, spanish: lists.some((options) => options.some((name) => /Spanish/u.test(name))) };
  });
  await finish();
  process.exit();
}

/** Whether the key step stored a key and chose Haiku 4.5; nothing is asked unless it did. */
let keyed = false;
await step('the owner types the Anthropic key into Settings › AI, and Haiku 4.5 is chosen', async () => {
  await open(documentPath);
  await openAi();
  await dialog().getByLabel('AI provider', { exact: true }).selectOption({ label: 'Anthropic' });
  await dialog().getByLabel('Anthropic API key', { exact: true }).click();
  process.stdout.write('WAITING FOR THE KEY: type it into the focused field in the app; the walk goes on when it reads as stored.\n');
  await expect(dialog().getByText(STORED)).toHaveCount(1, { timeout: 15 * 60_000 });
  const model = dialog().getByLabel('AI model', { exact: true });
  await expect.poll(async () => (await model.locator('option').allInnerTexts()).some((name) => /Haiku 4\.5/u.test(name)), { timeout: 60_000 }).toBe(true);
  const haiku = (await model.locator('option').allInnerTexts()).find((name) => /Haiku 4\.5/u.test(name)) ?? '';
  await model.selectOption({ label: haiku });
  const chosen = await model.locator('option:checked').innerText();
  if (!/Haiku 4\.5/u.test(chosen)) throw new Error(`the model reads ${chosen}, not Haiku 4.5: nothing will be sent`);
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  keyed = true;
  return { model: chosen };
});

// NO KEY STORED, OR NOT HAIKU 4.5: nothing is asked. The first live run of 2026-11-04 went on to every step with no key,
// each failing as no answer, which reads as eight broken commands rather than one missing key.
if (!keyed) {
  await finish();
  await rm(join(output, 'app-data'), { recursive: true, force: true });
  process.stdout.write('no key was stored, so nothing was asked; the walk’s profile folder was deleted\n');
  process.exit(1);
}

await step('ai.open-assistant: a question typed in the assistant is answered', async () => {
  await command('Open the AI assistant');
  const draft = page.locator('[data-assistant-draft]');
  await expect(draft).toBeVisible({ timeout: 30_000 });
  const before = await answers.count();
  await draft.click();
  await page.keyboard.type('In one sentence, what is this page about?');
  await page.keyboard.press('Enter');
  return nextAnswer(before);
});

await step('ai.ask-selection: Ask AI quotes the selected words in the message, and the question sent is answered', async () => {
  await fromSelection('Ask AI');
  const draft = page.locator('[data-assistant-draft]');
  await expect(draft).toBeFocused({ timeout: 30_000 });
  const quoted = await draft.inputValue();
  if (!quoted.includes('The river rises')) throw new Error(`the message does not quote the selection: ${JSON.stringify(quoted.slice(0, 120))}`);
  const before = await answers.count();
  await page.keyboard.type(' Where does it run?');
  await page.keyboard.press('Enter');
  return { quoted: true, ...(await nextAnswer(before)) };
});

for (const item of ['Explain', 'Summarise', 'Translate']) {
  await step(`ai.${item.toLowerCase()}-selection: ${item} on the selected words is answered`, async () => {
    const before = await answers.count();
    await fromSelection(item);
    return nextAnswer(before);
  });
}

await step('ai.summarise-comments: Summarise comments is answered', async () => {
  const before = await answers.count();
  await command('Summarise comments');
  return nextAnswer(before);
});

await step('ai.draft-reply: a reply drafted for the note, posted, saved and read back as a reply to it', async () => {
  await command('Select annotations');
  const canvas = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (canvas === null) throw new Error('no page');
  const scale = canvas.width / 612;
  const at = { x: canvas.x + 510 * scale, y: canvas.y + (792 - 710) * scale };
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const before = await answers.count();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Draft a reply with AI', exact: true }).click({ timeout: 10_000 });
  const answer = await nextAnswer(before);
  await answers.last().getByRole('button', { name: 'Post as a reply' }).click({ timeout: 30_000 });
  const kept = join(output, 'kept-draft-reply.pdf');
  await saveTo(kept);
  await command('Save a copy…');
  await expect.poll(() => existsSync(kept) && readFileSync(kept).byteLength > 0, { timeout: 60_000 }).toBe(true);
  const reading = await readPdf(kept);
  // A REPLY IS A SECOND NOTE beside the one it answers.
  if ((reading?.marks['Text'] ?? 0) < 2) throw new Error(`the saved copy holds ${JSON.stringify(reading?.marks)}: no reply beside the note`);
  return { ...answer, notes: reading?.marks['Text'] ?? 0 };
});

await step('edit.translate-page: Translate this page into Spanish changes the page’s words, saved and read back', async () => {
  const beforeWords = (await readPdf(documentPath))?.texts[0] ?? '';
  await command('Translate this page…');
  await expect(dialog()).toBeVisible({ timeout: 30_000 });
  // THE LIST THAT OFFERS SPANISH, whichever of the dialog's lists it is: the first is the scope's.
  let chosen = false;
  for (const list of await dialog().locator('select').all()) {
    const spanish = (await list.locator('option').allInnerTexts()).find((name) => /Spanish/u.test(name));
    if (spanish !== undefined) {
      await list.selectOption({ label: spanish });
      chosen = true;
    }
  }
  if (!chosen) throw new Error('no list in the dialog offers Spanish');
  await dialog().locator('.m-button--primary:not([disabled])').last().click();
  await expect(dialog()).toHaveCount(0, { timeout: 30_000 });
  const kept = join(output, 'kept-translate-page.pdf');
  // THE TASK'S OWN PROGRESS is the sign it finished, never *Unsaved changes*: the reply posted a step earlier
  // already left the document unsaved, so that read was true before a word was translated. The progress is put up
  // once the dialog has answered, so it is waited for to appear and then to go; the saved copy's words are the check.
  const progress = page.getByText('Translating the page', { exact: false });
  await expect(progress.first()).toBeVisible({ timeout: 30_000 });
  await expect(progress).toHaveCount(0, { timeout: 5 * 60_000 });
  await saveTo(kept);
  await command('Save a copy…');
  await expect.poll(() => existsSync(kept) && readFileSync(kept).byteLength > 0, { timeout: 60_000 }).toBe(true);
  const after = (await readPdf(kept))?.texts[0] ?? '';
  if (after === beforeWords || after.includes('The river rises')) throw new Error(`page 1 still reads ${JSON.stringify(after.slice(0, 120))}`);
  return { before: beforeWords.slice(0, 60), after: after.slice(0, 60) };
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
void app;
