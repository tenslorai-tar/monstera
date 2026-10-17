// @ts-check
/**
 * What each lever gives back once every document is closed (the owner's addendum 2, item 3), measured before one is
 * built: the start screen, seven documents open, every document closed, then Chromium's memory-pressure signal, then a
 * reload of the renderer. Each reading is every process's private memory by role, through `processMemory.mjs`, the
 * reader `memoryWalk.mjs` uses, so the figures compare with its M1 and M5.
 *
 * The pressure signal is the DevTools protocol's `Memory.simulatePressureNotification`, sent from `main` through
 * `webContents.debugger`: Electron offers no other way to tell a renderer that memory is short.
 *
 * Usage (Windows): node scripts/research/idleMemoryProbe.mjs [<a .pdf to open seven copies of>]
 */

import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { byRole, processTreeMemory } from '../lib/processMemory.mjs';
import { root, startWalk } from './liveWalk.mjs';

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const { app, page, output, open, command, step, finish } = await startWalk('idle-memory');
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
    const path = join(output, `idle-${String(at + 1)}.pdf`);
    await copyFile(sample, path);
    return path;
  }),
);

await step('I1. the start screen at rest', async () => {
  await page.waitForTimeout(10_000);
  return reading();
});

await step('I2. seven documents open and scrolled', async () => {
  for (const path of copies) {
    await open(path);
    const list = page.locator('[data-document-layer="active"] .m-page-list');
    await expect(list.locator('canvas.m-page').first()).toBeVisible({ timeout: 60_000 });
    await list.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Home');
  }
  await page.waitForTimeout(10_000);
  return reading();
});

await step('I3. every document closed, then 30 s', async () => {
  for (let left = await page.locator('[data-tab-select]').count(); left > 0; left -= 1) {
    await command('Close tab');
    await expect(page.locator('[data-tab-select]')).toHaveCount(left - 1, { timeout: 30_000 });
  }
  await page.waitForTimeout(30_000);
  return reading();
});

await step('I4. the renderer told memory is critical, then 30 s', async () => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    if (contents === undefined) throw new Error('no window');
    contents.debugger.attach('1.3');
    try {
      await contents.debugger.sendCommand('Memory.simulatePressureNotification', { level: 'critical' });
    } finally {
      contents.debugger.detach();
    }
  });
  await page.waitForTimeout(30_000);
  return reading();
});

await step('I5. the renderer reloaded, then 30 s', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.reload();
  });
  await page.waitForTimeout(30_000);
  return reading();
});

await finish();
