// @ts-check
/** Drives an isolated development app with Playwright's real mouse and keyboard. */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { developmentEnvironment } from '../lib/launchEnvironment.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { SHELL_LAUNCH, refuseStaleBuild } from '../lib/buildFreshness.mjs';

/** @typedef {import('../../packages/kernel/dist/annotationInterchange.js').InterchangeAnnotation} Comment */
/** @param {Comment} record @param {boolean} quantize */
function xfdfColours(record, quantize) {
  const { colour, interiorColour, ...rest } = record;
  /** @param {number} value */
  const rounded = (value) => Number((quantize ? Math.round(value * 255) / 255 : value).toFixed(6));
  return { ...rest, ...(colour === undefined ? {} : { colour: colour.map(rounded) }),
    ...(interiorColour === undefined || interiorColour.length === 0 ? {} : { interiorColour: interiorColour.map(rounded) }) };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
refuseStaleBuild(root, [
  ...SHELL_LAUNCH,
  ['packages/testing/src/settled.ts', 'packages/testing/dist/settled.js', 'tsc'],
  ['packages/testing/src/organizeFrames.ts', 'packages/testing/dist/organizeFrames.js', 'tsc'],
  ['packages/shared/src', 'apps/desktop/dist/renderer/index.html', 'bundler'],
  ['packages/contract/src', 'apps/desktop/dist/renderer/index.html', 'bundler'],
], 11);
const { popupPlaced } = await import('../../packages/testing/dist/settled.js');
const { ORGANIZE_FRAME_COUNT, readOrganizeFrames, recordOrganizeFrames } = await import('../../packages/testing/dist/organizeFrames.js');
const output = join(root, '_review/codex/run-1');
const run = process.argv[2] ?? 'baseline';
const runFile = promisify(execFile);
await mkdir(output, { recursive: true });
const sample = join(output, 'form-test-view-copy.pdf');
const form = join(output, 'form-test-copy.pdf');
await copyFile(join(root, '_review/test-files/form-test.pdf'), sample);
await copyFile(join(root, '_review/test-files/form-test.pdf'), form);
const generated = await PDFDocument.create();
const source = await PDFDocument.load(await readFile(form));
for (const index of [0, 1, 2, 0, 1]) {
  const [copied] = await generated.copyPages(source, [index]);
  if (copied === undefined) throw new Error('the source page could not be copied');
  generated.addPage(copied);
}
const five = join(output, 'generated-five-pages.pdf');
await writeFile(five, await generated.save());
/** @type {Record<string, string>} */
const environment = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) environment[key] = value;
}
Object.assign(environment, await developmentEnvironment(root));
const app = await _electron.launch({
  executablePath: electronBinaryPath(root),
  args: [join(root, 'apps/desktop'), `--user-data-dir=${join(output, `app-data-${Date.now()}`)}`],
  cwd: root,
  env: environment,
});
async function drive() {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, five);
  const page = await app.firstWindow();
  /** @param {string} name */
  const command = async (name) => {
    await page.keyboard.press('Control+K');
    await page.locator('.m-palette-query').fill(name);
    await page.getByRole('option').filter({ hasText: name }).first().click();
  };
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: join(output, `${run}-00-start.png`) });
  process.stdout.write(`${(await page.locator('body').innerText()).slice(0, 12000)}\n`);
  const skip = page.getByRole('button', { name: /later|skip|not now/iu });
  if (await skip.count() === 1 && await skip.isVisible()) await skip.click();
  const open = page.getByRole('button', { name: 'Open PDF…', exact: true });
  await open.waitFor({ state: 'visible' });
  await open.click();
  await page.locator('canvas.m-page').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: join(output, `${run}-01-open.png`) });
  if (run === 'protection-baseline' || run === 'protection' || run === 'protection-memory-baseline' || run === 'protection-memory') {
    const user = 'run-one-open';
    const owner = 'run-one-owner';
    /** @param {string} name */
    const shot = (name) => page.screenshot({ path: join(output, `${run}-${name}.png`), animations: 'disabled' });
    /** @param {'add' | 'permissions' | 'password' | 'remove'} change @param {string} tag */
    const protect = async (change, tag = change) => {
      await command('Password and permissions');
      const dialog = page.getByRole('dialog', { name: 'Password and permissions', exact: true });
      if (change === 'remove') {
        await dialog.locator('[data-protect-scheme]').click();
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
      } else {
        await dialog.getByLabel('Password to open (optional)', { exact: true }).fill(change === 'password' ? 'run-one-next-open' : user);
        await dialog.getByLabel('Password to change permissions (optional)', { exact: true }).fill(change === 'password' ? 'run-one-next-owner' : owner);
        if (change === 'permissions') await dialog.locator('[data-protect-permission="copy"]').uncheck();
      }
      await popupPlaced(page, dialog, 'protection dialog');
      await shot(`02-${tag}-dialog`);
      const button = dialog.getByRole('button', { name: change === 'remove' ? 'Remove protection' : 'Protect document', exact: true });
      const buttonBox = await button.boundingBox();
      if (buttonBox === null) throw new Error('the protection action has no box');
      const edge = run === 'protection' || run === 'protection-memory';
      await page.mouse.click(buttonBox.x + (edge ? buttonBox.width - 3 : buttonBox.width / 2), buttonBox.y + buttonBox.height / 2);
      await page.getByText('Password and permissions set. They are applied when you save.', { exact: true }).last().waitFor();
      await shot(`03-${tag}-applied`);
    };
    const save = async () => {
      const started = Date.now();
      await page.keyboard.press('Control+S');
      await expect.poll(async () => (await stat(five)).mtimeMs >= started).toBe(true);
      await expect(page.getByRole('status', { name: 'Document status', exact: true })).toContainText('Saved');
    };
    /** @param {number} pages */
    const facts = async (pages = 5) => {
      const bytes = await readFile(five);
      let withoutPassword = true;
      try { await PDFDocument.load(bytes, { updateMetadata: false }); } catch { withoutPassword = false; }
      const document = await PDFDocument.load(bytes, { password: user, updateMetadata: false });
      await PDFDocument.load(bytes, { password: owner, updateMetadata: false });
      let wrongPasswordOpens = true;
      try { await PDFDocument.load(bytes, { password: 'run-one-wrong', updateMetadata: false }); } catch { wrongPasswordOpens = false; }
      expect(wrongPasswordOpens).toBe(false);
      expect(document.getPageCount()).toBe(pages);
      // pdf-lib removes /Encrypt from its readable in-memory document. Read
      // the original file's permission integer with the independent qpdf CLI.
      const { stdout } = await runFile('qpdf', [`--password=${user}`, '--show-encryption', five]);
      const qpdfPermissions = /^P = (-?\d+)\s*$/mu.exec(stdout)?.[1];
      if (qpdfPermissions === undefined) throw new Error('qpdf did not report the permission integer');
      const permissions = Number(qpdfPermissions);
      expect(Number.isInteger(permissions)).toBe(true);
      return { withoutPassword, userOpens: true, ownerOpens: true, wrongPasswordOpens, permissions, pages: document.getPageCount() };
    };
    /** @param {string} name */
    const reopen = async (name) => {
      await page.keyboard.press('Control+W');
      await app.evaluate(({ dialog }, picked) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
      }, five);
      await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
      const asked = page.getByRole('dialog', { name: 'This document is protected', exact: true });
      await asked.waitFor();
      await shot(`05-${name}-asks-password`);
      await asked.getByLabel('Password', { exact: true }).fill(user);
      await asked.getByRole('button', { name: 'Open document', exact: true }).click();
      await page.locator('canvas.m-page').first().waitFor();
      await shot(`06-${name}-reopened`);
    };
    if (run === 'protection-memory-baseline' || run === 'protection-memory') {
      await protect('add');
      await protect('permissions');
      await page.keyboard.press('Control+Z');
      await shot('07-permissions-undone');
      await command('Watermark…');
      const watermark = page.getByRole('dialog', { name: 'Watermark', exact: true });
      await watermark.getByLabel('Text', { exact: true }).fill('Run one protected watermark');
      await popupPlaced(page, watermark, 'watermark dialog');
      await shot('10-watermark-dialog');
      await watermark.getByRole('button', { name: 'Add watermark', exact: true }).click();
      if (run === 'protection-memory-baseline') {
        const problem = page.getByRole('dialog', { name: 'That could not be done', exact: true });
        await problem.waitFor();
        await popupPlaced(page, problem, 'watermark refusal after undo');
        await shot('11-watermark-refused-after-undo');
        process.stdout.write('The built app refused Watermark after the in-session protection undo.\n');
        return;
      }
      await page.getByText('Run one protected watermark', { exact: true }).first().waitFor();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await shot('11-watermark-added-after-undo');
      await save();
      const restored = await facts();
      expect(restored.withoutPassword).toBe(false);
      process.stdout.write(`${run}, page command after protection undo: ${JSON.stringify(restored)}\n`);
      await shot('12-watermark-saved-protected');
      await reopen('page-command');
      return;
    }
    await protect('add');
    await page.keyboard.press('Control+Z');
    await shot('07-add-undone');
    await save();
    const plain = await PDFDocument.load(await readFile(five), { updateMetadata: false });
    expect(plain.getPageCount()).toBe(5);
    expect(plain.context.trailerInfo.Encrypt).toBeUndefined();
    expect((await runFile('qpdf', ['--show-encryption', five])).stdout.trim()).toBe('File is not encrypted');
    await shot('08-add-saved-plain');
    await page.keyboard.press('Control+W');
    await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
    await page.locator('canvas.m-page').first().waitFor();
    await expect(page.getByRole('dialog', { name: 'This document is protected', exact: true })).toHaveCount(0);
    await shot('09-add-reopened-plain');
    await protect('add', 'establish');
    await save();
    const original = await facts();
    expect(original.withoutPassword).toBe(false);
    await shot('04-protected-saved');
    for (const change of ['permissions', 'password', 'remove']) {
      await reopen(change);
      await protect(/** @type {'permissions' | 'password' | 'remove'} */ (change));
      await page.keyboard.press('Control+Z');
      await shot(`07-${change}-undone`);
      await save();
      const restored = await facts();
      expect(restored).toStrictEqual(original);
      process.stdout.write(`${change}: ${JSON.stringify(restored)}\n`);
      await shot(`08-${change}-saved`);
    }
    await reopen('final');
    return;
  }
  if (run === 'comments-catalogue') {
    const document = await PDFDocument.create();
    const [firstPage] = await document.copyPages(source, [0]);
    if (firstPage === undefined) throw new Error('The test source must have its first page');
    document.addPage(firstPage);
    const single = join(output, 'one-page-copy.pdf');
    await writeFile(single, await document.save());
    /** @param {string} file */
    const pick = async (file) => app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
    }, file);
    await pick(single);
    await page.getByRole('button', { name: 'Open another document' }).click();
    await page.getByRole('button', { name: 'one-page-copy.pdf', exact: true }).waitFor();
    await page.screenshot({ path: join(output, 'comments-catalogue-02-one-page.png') });
    /** @param {string} format @param {string} file @param {string} shot @param {boolean} edge */
    const report = async (format, file, shot, edge) => {
      await pick(file);
      await page.locator('[data-ribbon-section="review"]').first().click();
      const button = page.getByRole('button', { name: `Import ${format.toUpperCase()}`, exact: true });
      const bounds = await button.boundingBox();
      if (bounds === null) throw new Error('The comments import must have a box');
      await page.mouse.click(bounds.x + (edge ? bounds.width - 3 : bounds.width / 2), bounds.y + bounds.height / 2);
      const dialog = page.getByRole('dialog', { name: 'Comments import', exact: true });
      await dialog.waitFor();
      await popupPlaced(page, dialog, 'catalogue comments report');
      await page.screenshot({ path: join(output, `comments-catalogue-${shot}.png`), animations: 'disabled' });
      return dialog;
    };
    const dismiss = async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Comments import', exact: true }).waitFor({ state: 'hidden' });
      await page.keyboard.press('Control+Z');
    };
    for (const format of ['json', 'fdf', 'xfdf']) {
      const dialog = await report(format, join(output, `comments-roundtrip.${format}`), `03-one-page-${format}`, format === 'fdf');
      await expect(dialog).toContainText('Comment 2 was on page 5, which this document does not have (1 page).');
      await expect(dialog).toContainText('1 comment imported.');
      await dismiss();
    }
    const exported = /** @type {{ annotations: readonly Comment[] }} */ (JSON.parse(await readFile(join(output, 'comments-roundtrip.json'), 'utf8')));
    const first = exported.annotations[0];
    if (first === undefined) throw new Error('The earlier export must contain its first comment');
    const mixed = join(output, 'comments-catalogue-mixed.json');
    await writeFile(mixed, JSON.stringify({ ...exported, annotations: [first,
      { ...first, subtype: 'FutureNote' }, { ...first, rect: 'not a position' },
    ] }));
    const mixedDialog = await report('json', mixed, '04-kind-and-field', true);
    await expect(mixedDialog).toContainText('Comment 2: Monstera cannot import this kind of comment.');
    await expect(mixedDialog).toContainText('Comment 3 has an invalid position entry.');
    await dismiss();
    const long = join(output, 'comments-catalogue-long.json');
    await writeFile(long, JSON.stringify({ ...exported, annotations: [first,
      ...Array.from({ length: 101 }, () => ({ ...first, page: 4 })),
    ] }));
    const longDialog = await report('json', long, '05-long-report', false);
    await expect(longDialog.getByRole('listitem')).toHaveCount(100);
    await expect(longDialog).toContainText('1 more comment was skipped. The list above shows the first 100.');
    await expect(longDialog.getByRole('button', { name: 'OK', exact: true })).toBeInViewport();
    const longBounds = await longDialog.boundingBox();
    if (longBounds === null) throw new Error('The long report must have a box');
    await page.mouse.move(longBounds.x + longBounds.width / 2, longBounds.y + longBounds.height / 2);
    await page.mouse.wheel(0, 10_000);
    await expect(longDialog.getByText('1 more comment was skipped. The list above shows the first 100.', { exact: true })).toBeInViewport();
    await page.screenshot({ path: join(output, 'comments-catalogue-06-long-report-end.png'), animations: 'disabled' });
    process.stdout.write('Comments catalogue: all three one-page reports, kind and field labels, and the bounded long report passed.\n');
    return;
  }
  if (run === 'comments') {
    for (const format of ['json', 'fdf', 'xfdf']) {
      await app.evaluate(({ dialog }, picked) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: picked });
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
      }, join(output, `comments-empty.${format}`));
      await command(`Export comments as ${format.toUpperCase()}…`);
      await page.getByText('Comments saved', { exact: true }).last().waitFor();
      await command(`Import comments from ${format.toUpperCase()}…`);
      await page.getByText('This file contains no comments. Nothing was added.', { exact: true }).waitFor();
      await popupPlaced(page, page.getByRole('dialog', { name: 'Comments import', exact: true }), 'empty comments report');
      await page.screenshot({ path: join(output, `comments-01-empty-${format}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Comments import', exact: true }).waitFor({ state: 'hidden' });
    }
  }
  if (run === 'organize-baseline' || run === 'organize') await command('Hand — drag to move the pages');
  for (const section of ['Tools', 'Home', 'Organize']) {
    const tab = page.getByRole('tab', { name: section, exact: true });
    const button = page.getByRole('button', { name: section, exact: true });
    const control = await tab.count() > 0 ? tab : button;
    const box = await control.first().boundingBox();
    if (box === null) throw new Error(`${section} has no box`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    await page.screenshot({ path: join(output, `${run}-02-${section.toLowerCase()}.png`) });
    process.stdout.write(`${section}: grids=${await page.locator('.m-page-grid').count()} switches=${await page.getByRole('button', { name: 'Thumbnail', exact: true }).count()}\n`);
  }
  if (run === 'organize-baseline') {
    await page.screenshot({ path: join(output, 'organize-baseline-armed-tool.png') });
    return;
  }
  if (run === 'organize') {
    const grid = page.getByRole('region', { name: 'Pages to organize' });
    await expect(grid).toBeVisible();
    /** @param {string} name */
    const shot = (name) => page.screenshot({ path: join(output, `organize-${name}.png`), animations: 'disabled' });
    const sections = ['tools', 'home', 'comment', 'edit', 'organize', 'forms', 'review', 'protect'];
    /** @param {string} name @param {boolean} edge */
    const section = async (name, edge) => {
      const box = await page.locator(`[data-ribbon-section="${name}"]`).first().boundingBox();
      if (box === null) throw new Error(`${name}: the section has no box`);
      await page.mouse.click(box.x + (edge ? box.width - 3 : box.width / 2), box.y + box.height / 2);
    };
    for (const first of sections) {
      for (const second of sections) {
        await command('Hand — drag to move the pages');
        await section(first, false);
        await shot(`pair-${first}-${second}-1`);
        await section(second, true);
        await shot(`pair-${first}-${second}-2`);
        await section('organize', true);
        await expect(grid).toBeVisible();
        await expect(grid.getByRole('button', { name: 'Thumbnail', exact: true })).toBeVisible();
        await expect(grid.locator('[data-layer="shown"] canvas[data-drawn="true"]')).toHaveCount(5);
        await shot(`pair-${first}-${second}-3-grid`);
      }
    }
    await section('forms', false);
    await page.getByRole('button', { name: /^Text field/u }).first().dblclick();
    await expect(page.locator('[data-annotation-overlay]').first()).toBeVisible();
    await shot('03-kept-field');
    await section('organize', false);
    await expect(grid).toBeVisible();
    await shot('04-kept-tool-ended');
    await command('Rectangle');
    await expect(page.getByLabel('Draw on page 1')).toBeVisible();
    await shot('05-tool-started-inside');
    await section('organize', true);
    await expect(grid).toBeVisible();
    await shot('06-organize-rechosen');
    await grid.getByRole('button', { name: 'Full page', exact: true }).click();
    await expect(grid).toHaveAttribute('data-page-view', 'full-page');
    await expect(grid.locator('[data-layer="shown"] [data-thumb-page="0"] canvas')).toHaveAttribute('data-drawn', 'true');
    await shot('07-full-page');
    await recordOrganizeFrames(page);
    const frames = () => readOrganizeFrames(page);
    await expect.poll(async () => (await frames()).length).toBeGreaterThan(0);
    const thumbnail = await grid.getByRole('button', { name: 'Thumbnail', exact: true }).boundingBox();
    if (thumbnail === null) throw new Error('Thumbnail has no box');
    await page.mouse.click(thumbnail.x + thumbnail.width - 3, thumbnail.y + thumbnail.height / 2);
    await expect(grid).toHaveAttribute('data-page-view', 'thumbnail');
    await expect.poll(async () => (await frames()).length).toBe(ORGANIZE_FRAME_COUNT);
    const recorded = await frames();
    expect(recorded.flat().some((card) => card.width > 400)).toBe(true);
    expect(recorded.flat().some((card) => card.width < 200)).toBe(true);
    expect(recorded.findIndex((frame) => frame.length === 0 || frame.some((card) => card.drawn !== 'true'))).toBe(-1);
    await writeFile(join(output, 'organize-thumbnail-frames.json'), JSON.stringify(recorded));
    await shot('08-first-thumbnail');
    process.stdout.write('Organize: all 64 section pairs, kept and in-section tools, and 120 finished Thumbnail frames passed.\n');
    return;
  }
  process.stdout.write(`${(await page.locator('body').innerText()).slice(0, 15000)}\n`);
  await page.locator('[data-ribbon-section="home"]').first().click();
  await command('Rectangle');
  const drawing = page.getByLabel('Draw on page 1');
  await drawing.waitFor({ state: 'visible' });
  const box = await drawing.boundingBox();
  if (box === null) throw new Error('the rectangle surface has no box');
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 220, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: join(output, `${run}-03-rectangle.png`) });
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Go to page', exact: true }).fill('5');
  await page.keyboard.press('Enter');
  await command('Text box');
  const last = page.getByLabel('Draw on page 5');
  await last.waitFor({ state: 'visible' });
  const lastBox = await last.boundingBox();
  if (lastBox === null) throw new Error('the text box surface has no box');
  await page.mouse.move(lastBox.x + 80, lastBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(lastBox.x + 260, lastBox.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('textbox', { name: 'Text box', exact: true }).fill('Run 1 comment on page five');
  await page.mouse.click(lastBox.x + 400, lastBox.y + 220);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(output, `${run}-04-text-box-page-five.png`) });
  if (run === 'comments') {
    /** @param {string} name */
    const screenshot = async (name) => {
      const dialog = page.getByRole('dialog');
      if (await dialog.count() > 0) await popupPlaced(page, dialog, 'comments report');
      return page.screenshot({ path: join(output, `comments-${name}.png`), animations: 'disabled' });
    };
    /** @param {string} file */
    const pick = async (file) => app.evaluate(({ dialog }, picked) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: picked });
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
    }, file);
    const formats = ['json', 'fdf', 'xfdf'];
    for (const format of formats) {
      await pick(join(output, `comments-roundtrip.${format}`));
      await command(`Export comments as ${format.toUpperCase()}…`);
      await page.getByText('Comments saved', { exact: true }).last().waitFor();
      await screenshot(`05-export-${format}`);
    }
    await page.keyboard.press('Control+Z');
    await page.keyboard.press('Control+Z');
    await screenshot('06-deleted');
    for (const format of formats) {
      await pick(join(output, `comments-roundtrip.${format}`));
      await command(`Import comments from ${format.toUpperCase()}…`);
      await page.getByText('Comments imported.', { exact: true }).last().waitFor();
      await screenshot(`07-same-import-${format}`);
      await page.keyboard.press('Control+S');
      await screenshot(`08-saved-${format}`);
      await pick(join(output, `comments-reread-${format}.json`));
      await command('Export comments as JSON…');
      await page.getByText('Comments saved', { exact: true }).last().waitFor();
      /** @type {{ annotations: readonly Comment[] }} */
      let expected = JSON.parse(await readFile(join(output, 'comments-roundtrip.json'), 'utf8'));
      /** @type {{ annotations: readonly Comment[] }} */
      let actual = JSON.parse(await readFile(join(output, `comments-reread-${format}.json`), 'utf8'));
      if (format === 'xfdf') {
        // XFDF specifies 8-bit hex colours; an absent and an empty fill both
        // mean no fill. All other fields must still be identical.
        expected = { ...expected, annotations: expected.annotations.map((record) => xfdfColours(record, true)) };
        actual = { ...actual, annotations: actual.annotations.map((record) => xfdfColours(record, false)) };
      }
      expect(actual, `${format}: round-trip comments`).toStrictEqual(expected);
      await page.keyboard.press('Control+Z');
    }
    await page.keyboard.press('Control+S');
    await pick(form);
    await page.getByRole('button', { name: 'Open another document' }).click();
    await page.getByRole('button', { name: 'form-test-copy.pdf', exact: true }).waitFor();
    await screenshot('09-three-pages');
    for (const format of formats) {
      await pick(join(output, `comments-roundtrip.${format}`));
      await command(`Import comments from ${format.toUpperCase()}…`);
      await page.getByRole('dialog', { name: 'Comments import', exact: true }).waitFor();
      const report = await page.getByRole('dialog').innerText();
      if (!report.includes('1 comment imported.') || !report.includes('page 5')) throw new Error(`${format}: wrong partial import report: ${report}`);
      await screenshot(`10-partial-${format}`);
      process.stdout.write(`${format}: ${report}\n`);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Comments import', exact: true }).waitFor({ state: 'hidden' });
      await page.keyboard.press('Control+Z');
    }
    await page.locator('[data-ribbon-section="home"]').first().click();
    await command('Ellipse');
    const surface = page.getByLabel('Draw on page 1');
    const bounds = await surface.boundingBox();
    if (bounds === null) throw new Error('the three-page drawing surface has no box');
    await page.mouse.move(bounds.x + 110, bounds.y + 110);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 240, bounds.y + 230, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await screenshot('11-three-page-circle');
    for (const format of formats) {
      await pick(join(output, `comments-three-pages.${format}`));
      await command(`Export comments as ${format.toUpperCase()}…`);
      await page.getByText('Comments saved', { exact: true }).last().waitFor();
      await screenshot(`12-three-page-export-${format}`);
    }
    await page.keyboard.press('Control+Z');
    for (const format of formats) {
      await pick(join(output, `comments-three-pages.${format}`));
      await page.locator('[data-ribbon-section="review"]').first().click();
      await page.getByRole('button', { name: `Import ${format.toUpperCase()}`, exact: true }).click();
      await page.getByText('Comments imported.', { exact: true }).last().waitFor();
      await screenshot(`13-three-page-same-import-${format}`);
      await page.keyboard.press('Control+Z');
    }
    await page.getByRole('button', { name: 'generated-five-pages.pdf', exact: true }).click();
    for (const format of formats) {
      await pick(join(output, `comments-three-pages.${format}`));
      await page.locator('[data-ribbon-section="review"]').first().click();
      const button = page.getByRole('button', { name: `Import ${format.toUpperCase()}`, exact: true });
      const bounds = await button.boundingBox();
      if (bounds === null) throw new Error(`${format}: the Review import button has no box`);
      await page.mouse.click(bounds.x + bounds.width - 3, bounds.y + bounds.height / 2);
      await page.getByText('Comments imported.', { exact: true }).last().waitFor();
      await screenshot(`14-three-to-five-${format}`);
      await page.keyboard.press('Control+Z');
    }
    return;
  }
  for (const format of ['json', 'fdf', 'xfdf']) {
    const file = join(output, `baseline-comments.${format}`);
    await app.evaluate(({ dialog }, picked) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: picked });
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
    }, file);
    await command(`Export comments as ${format.toUpperCase()}…`);
    await page.getByText('Comments saved', { exact: true }).last().waitFor({ state: 'visible' });
    await page.screenshot({ path: join(output, `baseline-05-export-${format}.png`) });
    await command(`Import comments from ${format.toUpperCase()}…`);
    await page.locator('.m-toast__message, [role="dialog"]').last().waitFor({ state: 'visible' });
    await page.screenshot({ path: join(output, `baseline-06-same-import-${format}.png`) });
    process.stdout.write(`same ${format}: ${(await page.locator('body').innerText()).slice(-3000)}\n`);
    const ok = page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true });
    if (await ok.count() > 0) await ok.click();
  }
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, form);
  await page.getByRole('button', { name: 'Open another document' }).click();
  await page.getByRole('button', { name: 'form-test-copy.pdf', exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: join(output, 'baseline-07-other-document.png') });
  for (const format of ['json', 'fdf', 'xfdf']) {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
    }, join(output, `baseline-comments.${format}`));
    await command(`Import comments from ${format.toUpperCase()}…`);
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.screenshot({ path: join(output, `baseline-08-other-import-${format}.png`) });
    process.stdout.write(`other ${format}: ${await page.getByRole('dialog').innerText()}\n`);
    await page.keyboard.press('Escape');
  }
}
try {
  await drive();
} catch (error) {
  const page = app.windows()[0];
  if (page !== undefined) {
    await page.screenshot({ path: join(output, `${run}-failure.png`) });
    process.stdout.write(`${(await page.locator('body').innerText()).slice(-5000)}\n`);
  }
  throw error;
} finally {
  await app.close();
}
