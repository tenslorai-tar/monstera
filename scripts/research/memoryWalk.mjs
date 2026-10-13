// @ts-check
/**
 * The owner's Part 7 sequence, measured in the running application: seven documents open, scrolled and showing
 * thumbnails; one Edit text action; every tab visited; every document closed and a minute waited. Each step records
 * every process's private memory by role, through the one reader `appMemory.mjs` uses (`processMemory.mjs`).
 *
 * What the owner read in the installed 0.1.14.0, the figures this walk is to be compared with:
 *
 * | when | processes | private, in total |
 * |---|---|---|
 * | seven documents open | 6 | 953 MB |
 * | after one Edit text action | 8 (a PDFium host of 90 MB, a compose host of 960 MB) | 2,101 MB |
 * | every document closed, 60 s later | 8, both new hosts the same size | 1,939 MB; `main` 421 MB against 119 MB at start |
 *
 * What it asserts, and only that: after the edit every tab draws its page and none is left opening (Part 7 B); and
 * after the close no engine host is running (Part 7 A). Every figure is RECORDED in the step's facts for the report,
 * because what memory a process gives back to Windows is a reading, not something a walk can promise.
 *
 * Usage (Windows): node scripts/research/memoryWalk.mjs [<a .pdf to open seven copies of>]
 */

import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect as defaultExpect } from '@playwright/test';

import { byRole, processTreeMemory } from '../lib/processMemory.mjs';
import { root, startWalk } from './liveWalk.mjs';

// AN EDIT IS WRITTEN BEFORE ITS EDITOR CLOSES: textWalk measured 3 to 4.5 s on 2026-10-12 and this run's first
// attempt left the editor open past the default 5 s on an i5-3230M, so an expectation here waits 30 s, as textWalk's does.
const expect = defaultExpect.configure({ timeout: 30_000 });

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const { app, page, output, open, command, section, step, finish } = await startWalk('memory');
const launched = app.process().pid;
if (launched === undefined) throw new Error('the application has no process id to read memory under');
const mainPid = launched;

/** Seven copies with seven names, so each opens as its own tab. */
const copies = await Promise.all(
  Array.from({ length: 7 }, async (_, at) => {
    const path = join(output, `memory-${String(at + 1)}.pdf`);
    await copyFile(sample, path);
    return path;
  }),
);

const MB = 1024 * 1024;

/** Every process's private memory now, by role and in total, in whole MB, and which hosts are running. */
function reading() {
  const processes = processTreeMemory(mainPid);
  const roles = Object.fromEntries(Object.entries(byRole(processes)).map(([role, bytes]) => [role, Math.round(bytes / MB)]));
  const total = Math.round(processes.reduce((sum, each) => sum + each.privateBytes, 0) / MB);
  return { processes: processes.length, totalMB: total, rolesMB: roles, hosts: processes.filter((each) => each.role.startsWith('host ')).map((each) => each.role) };
}

/** @type {ReturnType<typeof reading> | null} */
let atStart = null;
await step('M1. the start screen: every process at rest, before any document', () => {
  atStart = reading();
  return Promise.resolve(atStart);
});

await step('M2. seven documents open, each scrolled to its end and back with its thumbnails shown', async () => {
  for (const path of copies) {
    await open(path);
    await expect(page.locator('[data-document-layer="active"] .m-page-list canvas.m-page').first()).toBeVisible({ timeout: 60_000 });
    // THE LIST ITSELF, not only a canvas inside it: for a moment after the third open the list was hidden while the new
    // layer took over (22:00 run, 'element is not visible' for 30 s), and a canvas seen visible in that moment was the old one's.
    const list = page.locator('[data-document-layer="active"] .m-page-list');
    await expect(list).toBeVisible();
    await list.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Home');
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(10_000);
  return reading();
});

await step('M3. ONE Edit text action: a paragraph clicked, a word typed, a click away', async () => {
  await section('Edit');
  const tool = page.getByRole('button', { name: 'Edit text', exact: true }).first();
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await command('Edit text on the page');
  const block = page.locator('[data-text-block]').nth(1);
  const box = await block.boundingBox();
  if (box === null) throw new Error('no second text block on the first page');
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(8, box.height / 2));
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.type(' walked');
  // A CLICK AWAY in the page's right margin, below the ribbon, as textWalk's step 3 makes it.
  const pageBox = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (pageBox === null) throw new Error('the page is not on screen');
  await page.mouse.click(pageBox.x + pageBox.width - 20, Math.max(pageBox.y, 230) + 20);
  await expect(page.locator('[data-text-editor]')).toHaveCount(0);
  // A WRITE TAKES 3 TO 5 S (textWalk's reading of 2026-10-12), then the hosts it started settle.
  await page.waitForTimeout(15_000);
  return reading();
});

await step('M4. every tab after the edit (Part 7 B): each draws its page, none is left opening, none failed', async () => {
  const tabs = page.locator('[data-tab-select]');
  const count = await tabs.count();
  /** @type {{ tab: number; drawn: boolean; opening: boolean; failed: boolean }[]} */
  const seen = [];
  for (let at = 0; at < count; at += 1) {
    await tabs.nth(at).click();
    const active = page.locator('[data-document-layer="active"]');
    const drawn = await active
      .locator('.m-page-list canvas.m-page')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true, () => false);
    seen.push({
      tab: at + 1,
      drawn,
      opening: (await active.locator('.m-page-opening').count()) > 0,
      failed: (await active.locator('canvas[data-failed]').count()) > 0,
    });
  }
  expect(seen).toHaveLength(7);
  expect(seen.filter((each) => !each.drawn || each.opening || each.failed)).toStrictEqual([]);
  return { tabs: seen };
});

await step('M5. every document closed, then 60 s (Part 7 A): no engine host is left, and every figure against M1', async () => {
  for (let left = await page.locator('[data-tab-select]').count(); left > 0; left -= 1) {
    await command('Close tab');
    const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' });
    // WAITED FOR, not asked once: the dialog of the edited document arrives after the command returns (22:02 run: asked
    // at once it was not yet there, and the close then waited 30 s behind it).
    const asked = await unsaved.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
    if (asked) await unsaved.getByRole('button', { name: 'Don’t save' }).click();
    await expect(page.locator('[data-tab-select]')).toHaveCount(left - 1, { timeout: 30_000 });
  }
  await page.waitForTimeout(60_000);
  const after = reading();
  expect(after.hosts).toStrictEqual([]);
  const before = /** @type {ReturnType<typeof reading> | null} */ (atStart);
  return { ...after, atStartMB: before?.rolesMB ?? null, atStartTotalMB: before?.totalMB ?? null };
});

await finish();
