// @ts-check
/**
 * The exports and conversions walk (cloud run 3): exports and conversions done in the running app with a real mouse and
 * keyboard on Windows, each step screenshotted and recorded by `liveWalk.mjs`, and each one that writes a file READ BACK
 * from that file by a second reader.
 *
 *   node scripts/research/exportsWalk.mjs
 *
 * Its documents are built here, from the kernel's own fixtures in `packages/kernel/dist`, so the walk needs no file of
 * the owner's. What it walks:
 *
 * - O2: a printed scan of a ruled table (`scanTableFixture.ts`) exported to Excel with *Printed scan, read on this
 *   computer*, and the workbook read back for every word of the table (ADR-0233).
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect as defaultExpect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { root, startWalk } from './liveWalk.mjs';

// A RECOGNITION AND AN EXPORT take several seconds each on the walk's machine; a step gets thirty.
const expect = defaultExpect.configure({ timeout: 30_000 });

const { SCAN_TABLE_ROWS, buildScannedTablePdf } = await import(join(root, 'packages/kernel/dist/scanTableFixture.js'));

const walk = await startWalk('exports');
const { page, output, open, saveTo, command, step, finish } = walk;

/** Every part of a saved workbook as text, read by fflate rather than by the app that wrote it. @param {string} path */
async function workbookText(path) {
  return Object.values(unzipSync(new Uint8Array(await readFile(path))))
    .map((bytes) => strFromU8(bytes))
    .join('\n');
}

const scan = join(output, 'scanned-table.pdf');
await writeFile(scan, await buildScannedTablePdf());

await step('O2: a printed scan of a ruled table exported to Excel, read on this computer, and every word is in the workbook', async () => {
  await open(scan);
  await command('Export tables to Excel');
  const dialog = page.getByRole('dialog', { name: 'Export tables to Excel' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Printed scan, read on this computer').check();
  const saved = join(output, 'scanned-table.xlsx');
  await saveTo(saved);
  await dialog.getByRole('button', { name: 'Choose where to save…' }).click();
  // THE RECOGNITION DIALOG SAYS WHAT HAPPENED, and is closed so the export can report.
  const recognition = page.getByRole('dialog', { name: 'Recognition' });
  await expect(recognition.getByText(/was read and added to this document/u)).toBeVisible();
  await recognition.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => existsSync(saved), { timeout: 60_000 }).toBe(true);
  const text = await workbookText(saved);
  /** @type {readonly (readonly string[])[]} */
  const rows = SCAN_TABLE_ROWS;
  const words = rows.flat().filter((word) => !/^[\d.]+$/u.test(word));
  const missing = words.filter((word) => !text.includes(word));
  expect(missing).toStrictEqual([]);
  return { wordsInWorkbook: words.length - missing.length, noTablesDialog: await page.getByText(/No tables with ruled lines/u).count() };
});

await finish();
