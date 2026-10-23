// @ts-check
/**
 * The font list in Properties, scrolled by its own SCROLL BAR while a block is open in Edit text, in the live app (the
 * owner's T1, 2026-10-23). `fontListScroll.pw.ts` proves the press on the list against the browser shim, where headless
 * Chromium draws no scroll bar; this walk presses and drags the bar the app really draws, over this computer's fonts.
 *
 * Each step reads the effect, never a DOM signal standing for it: the list still open and the editor still there after
 * the bar is pressed and dragged, the list actually scrolled, and then the font chosen reaching the ONE write the editor
 * sends when the person presses away, read back from a saved copy; and the list never scrolling sideways over this
 * computer's own font names.
 *
 *   node scripts/research/fontListWalk.mjs [sample.pdf]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { root, startWalk, writesDone, writesLanded } from './liveWalk.mjs';
import { savedFonts } from './savedPdf.mjs';
import { textSteps } from './textWalkSteps.mjs';

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
if (!existsSync(sample)) throw new Error(`No document at ${sample}. Pass the path to sample5.pdf.`);

const walk = await startWalk('fontList');
const { page, copyOf, open, section, step, finish } = walk;
const { editor, panel, ensureEditText, pressAway, savedCopy } = textSteps(walk);

/** The open list, with the block's editor open and its words selected. */
async function openList() {
  await ensureEditText();
  if ((await editor().count()) === 0) await page.locator('[data-text-block]').nth(1).click();
  await expect(editor()).toBeFocused({ timeout: 15_000 });
  await page.keyboard.press('Control+A');
  await panel().getByRole('button', { name: /^Font:/u }).click();
  const list = panel().locator('.m-font-picker__list');
  await expect(list.getByRole('option').nth(20)).toBeAttached({ timeout: 30_000 });
  return list;
}

/** Where the list's own vertical bar is drawn, `down` of the way along it; `null` where the list draws none. */
async function barPoint(/** @type {import('playwright').Locator} */ list, /** @type {number} */ down) {
  const { x, y, width, height, client, scrolls } = await list.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, client: element.clientWidth, scrolls: element.scrollHeight > element.clientHeight };
  });
  const bar = width - client;
  return scrolls && bar > 4 ? { x: x + width - bar / 2, y: y + height * down, bar } : null;
}

await step('T1: a press on the font list’s own scroll bar, then a drag of it, leaves the list and the editor open', async () => {
  await open(await copyOf(sample));
  await section('Edit');
  const list = await openList();
  const press = await barPoint(list, 0.8);
  if (press === null) throw new Error('the list draws no scroll bar of its own here, so there is nothing to press');
  await page.mouse.click(press.x, press.y);
  await page.waitForTimeout(400);
  const afterPress = { listOpen: await list.isVisible(), editors: await editor().count(), scrolled: await list.evaluate((element) => element.scrollTop) };
  if (!afterPress.listOpen || afterPress.editors !== 1 || afterPress.scrolled === 0) throw new Error(`after the press: ${JSON.stringify(afterPress)}`);
  const top = await barPoint(list, 0.1);
  if (top === null) throw new Error('the bar is gone after the press');
  const before = afterPress.scrolled;
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  for (let at = 1; at <= 12; at += 1) {
    await page.mouse.move(top.x, top.y + at * 10);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterDrag = { listOpen: await list.isVisible(), editors: await editor().count(), scrolled: await list.evaluate((element) => element.scrollTop) };
  if (!afterDrag.listOpen || afterDrag.editors !== 1 || afterDrag.scrolled === before) throw new Error(`after the drag: ${JSON.stringify(afterDrag)}`);
  const sideways = await list.evaluate((element) => element.scrollWidth - element.clientWidth);
  if (sideways !== 0) throw new Error(`the list scrolls sideways by ${String(sideways)} px`);
  return { bar: press.bar, afterPress, afterDrag, sideways };
});

await step('T1: the font chosen after scrolling by the bar is in the ONE write, read back from a saved copy', async () => {
  const list = panel().locator('.m-font-picker__list');
  // THE OPTION UNDER THE LIST'S MIDDLE, wherever the drag left it: chosen by a press, as a person does.
  const box = await list.boundingBox();
  if (box === null) throw new Error('the list has no box');
  const option = list.getByRole('option').filter({ has: page.locator('.m-font-picker__option-name') });
  const visible = [];
  for (const each of await option.all()) {
    const at = await each.boundingBox();
    if (at !== null && at.y > box.y && at.y + at.height < box.y + box.height) visible.push(each);
  }
  const chosen = visible[Math.floor(visible.length / 2)];
  if (chosen === undefined) throw new Error('no option in view to choose');
  const family = (await chosen.getAttribute('data-font-choice')) ?? '';
  await chosen.click();
  await expect(editor()).toBeFocused();
  const writing = await writesDone(page);
  const said = await pressAway(20, 20);
  await writesLanded(page, writing);
  const saved = await savedCopy('font-list-chosen.pdf');
  const fonts = await savedFonts(saved);
  const carried = fonts.some((font) => font.replace(/^[A-Z]{6}\+/u, '').replaceAll(/[\s-]/gu, '').toLowerCase().startsWith(family.replaceAll(/[\s-]/gu, '').toLowerCase().slice(0, 6)));
  if (said.length > 0 || !carried) throw new Error(`chose ${family}; said ${JSON.stringify(said)}; the saved page names ${JSON.stringify(fonts)}`);
  return { family, said };
});

await finish();
