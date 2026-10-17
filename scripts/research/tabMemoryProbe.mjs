// @ts-check
/**
 * What a background tab still holds after a minute in the background (the owner's addendum 2, item 4, step 1),
 * measured before anything is built: seven documents open, the first one shown for 60 s, then each background tab
 * closed in turn with 20 s to settle, and every process's private memory read before and after each close. What a
 * close gives back, by process, is what that tab held: in the renderer its parsed document, layout and any canvases
 * and thumbnails; in the engine host its session.
 *
 * Read by role through `processMemory.mjs`, `memoryWalk.mjs`' reader. The documents are copies of one file, so each
 * tab holds the same kind of thing and the deltas compare.
 *
 * Usage (Windows): node scripts/research/tabMemoryProbe.mjs [<a .pdf to open seven copies of>]
 */

import { copyFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { expect } from '@playwright/test';

import { byRole, processTreeMemory } from '../lib/processMemory.mjs';
import { root, startWalk } from './liveWalk.mjs';

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const { app, page, output, open, step, finish } = await startWalk('tab-memory');
const mainPid = app.process().pid;
if (mainPid === undefined) throw new Error('the application has no process id to read memory under');

const MB = 1024 * 1024;

/** Every process's private memory now, by role and in total, in whole MB. */
function reading() {
  const processes = processTreeMemory(mainPid ?? 0);
  const roles = Object.fromEntries(Object.entries(byRole(processes)).map(([role, bytes]) => [role, Math.round(bytes / MB)]));
  return { totalMB: Math.round(processes.reduce((sum, each) => sum + each.privateBytes, 0) / MB), rolesMB: roles };
}

const copies = await Promise.all(
  Array.from({ length: 7 }, async (_, at) => {
    const path = join(output, `tab-${String(at + 1)}.pdf`);
    await copyFile(sample, path);
    return path;
  }),
);

await step('T1. seven documents open, each scrolled once', async () => {
  for (const path of copies) {
    await open(path);
    const list = page.locator('[data-document-layer="active"] .m-page-list');
    await expect(list.locator('canvas.m-page').first()).toBeVisible({ timeout: 60_000 });
    await list.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Home');
    await page.waitForTimeout(500);
  }
  return reading();
});

await step('T2. the first document shown, then 60 s', async () => {
  await page.locator('[data-tab-select]').first().click();
  await page.waitForTimeout(60_000);
  return reading();
});

await step('T3. each background tab closed in turn: what each close gave back, by process', async () => {
  /** @type {{ tab: string, before: number, after: number, gaveMB: Record<string, number> }[]} */
  const closes = [];
  let before = reading();
  // THE LAST TAB IS A BACKGROUND ONE while the first stays shown; closed from the end so the shown tab never changes.
  for (let left = copies.length; left > 1; left -= 1) {
    const tab = page.locator('[data-tab-select]').nth(left - 1);
    const name = (await tab.textContent()) ?? '';
    await tab.hover();
    await page.locator('[data-tab-close]').nth(left - 1).click();
    await expect(page.locator('[data-tab-select]')).toHaveCount(left - 1, { timeout: 30_000 });
    await page.waitForTimeout(20_000);
    const after = reading();
    const gaveMB = Object.fromEntries(
      Object.keys({ ...before.rolesMB, ...after.rolesMB }).map((role) => [role, (before.rolesMB[role] ?? 0) - (after.rolesMB[role] ?? 0)]),
    );
    closes.push({ tab: name.includes(basename(copies[0] ?? '')) ? 'shown' : name, before: before.totalMB, after: after.totalMB, gaveMB });
    before = after;
  }
  return { closes, oneOpen: before };
});

await finish();
