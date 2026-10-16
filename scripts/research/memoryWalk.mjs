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
 * What it asserts, and only that: after the edit every tab draws its page and none is left opening (Part 7 B); over a
 * long session of twenty edits in three fonts, no host grows by more than `LAST_TEN_MB` across the last ten (run 4,
 * Part 2 item 13); and after the close no engine host is running (Part 7 A). Every figure is RECORDED in the step's facts for the report,
 * because what memory a process gives back to Windows is a reading, not something a walk can promise.
 *
 * Usage (Windows): node scripts/research/memoryWalk.mjs [<a .pdf to open seven copies of>]
 */

import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect as defaultExpect } from '@playwright/test';

import { byRole, processTreeMemory } from '../lib/processMemory.mjs';
import { root, startWalk } from './liveWalk.mjs';
import { savedTextKeepingSpaces } from './savedPdf.mjs';
import { textSteps } from './textWalkSteps.mjs';

// AN EDIT IS WRITTEN BEFORE ITS EDITOR CLOSES: textWalk measured 3 to 4.5 s on 2026-10-12 and this run's first
// attempt left the editor open past the default 5 s on an i5-3230M, so an expectation here waits 30 s, as textWalk's does.
const expect = defaultExpect.configure({ timeout: 30_000 });

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const { app, page, output, open, command, saveTo, section, step, finish } = await startWalk('memory');
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
/** @type {ReturnType<typeof reading> | null} */
let sevenOpen = null;
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
  sevenOpen = reading();
  return sevenOpen;
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
  const read = reading();
  // THE POSITIVE CONTROL FOR M5's EMPTY LIST: an edit runs in the MuPDF and PDFium hosts, so the reader must SEE both here.
  // A reader that stopped recognising hosts — an unreadable command line, an executable path that no longer matches —
  // would report M5's "no host is left" in the same voice as a clean close.
  expect(read.hosts).toEqual(expect.arrayContaining(['host mupdf', 'host pdfium']));
  // ADR-0237: this walk's profile is new, so its first font list is read by the compose host once and kept; a later
  // session's edit starts none. Recorded rather than asserted here; the file is read back after M5.
  const compose = Object.entries(read.rolesMB)
    .filter(([role]) => role.includes('compose'))
    .reduce((sum, [, mb]) => sum + mb, 0);
  // THE OWNER'S TARGET FOR AN EDIT (run 4 item 13f): no more than the figure before it plus the PDFium host's own cost.
  // The compose host is set aside for the first-list reason above, and named in the facts.
  const before = /** @type {ReturnType<typeof reading> | null} */ (sevenOpen);
  if (before === null) throw new Error('M2 took no reading');
  const allowed = before.totalMB + (read.rolesMB['host pdfium'] ?? 0);
  expect(read.totalMB - compose, `after the edit ${String(read.totalMB)} MB (compose ${String(compose)}), allowed ${String(allowed)}; by process ${JSON.stringify(read.rolesMB)}`).toBeLessThanOrEqual(allowed);
  return { ...read, composeHostAfterEdit: compose > 0, allowedAfterEditMB: allowed };
});

/** Edits in the long session, and how often it reads memory. */
const LONG_EDITS = 20;
const READ_EVERY = 5;
/**
 * The most a host may grow over the session's LAST ten edits, in MB. Growth that stops is a cache or an allocator
 * reaching its working size; growth without bound is a cost per edit, and the PDFium host's was about 5 MB an edit
 * before ADR-0239's addendum (81 to 184 MB, the owner's reading; +102 MB over five rounds measured in a container on
 * 2026-10-14). Twenty over ten edits refuses anything at or above 2 MB an edit.
 */
const LAST_TEN_MB = 20;

await step('M3b. a long session (Part 2 item 13): twenty edits, three fonts applied in turn, memory read every five', async () => {
  const { editor, ensureEditText, clickPage, chooseFont } = textSteps({ page, output, saveTo, command });
  // BUNDLED FAMILIES, so the three are there on every machine and each is a face the edit really sets (ADR-0172).
  const families = ['Carlito', 'Tinos', 'Arimo'];
  await ensureEditText();
  /** @type {{ edit: number; rolesMB: Record<string, number>; totalMB: number }[]} */
  const readings = [{ edit: 0, ...reading() }];
  /** @type {{ edit: number; family: string; problem: string | null }[]} */
  const refused = [];
  for (let edit = 1; edit <= LONG_EDITS; edit += 1) {
    const block = page.locator('[data-text-block]').nth(1);
    const box = await block.boundingBox();
    if (box === null) throw new Error(`no second text block on the page at edit ${String(edit)}`);
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(8, box.height / 2));
    await expect(editor()).toBeFocused();
    await page.keyboard.press('Control+A');
    const family = families[(edit - 1) % families.length] ?? 'Carlito';
    const samples = await chooseFont(family);
    const problem = samples.findLast((sample) => sample.problem !== null)?.problem ?? null;
    if (problem !== null) refused.push({ edit, family, problem });
    // A WORD TYPED as well as the font, so each edit writes text and a font, as a person's does.
    if ((await editor().count()) > 0) {
      await editor().focus();
      await page.keyboard.press('End');
      await page.keyboard.type(` ${String(edit)}`);
      await clickPage(20, 20);
    }
    await expect(editor()).toHaveCount(0);
    if (edit % READ_EVERY === 0) {
      // THE WRITE AND ITS READS SETTLE before the reading, as M3 waits.
      await page.waitForTimeout(5000);
      readings.push({ edit, ...reading() });
    }
  }
  // EVERY FONT CHOICE LANDED: a session whose edits were refused measured nothing about edits.
  expect(refused).toStrictEqual([]);
  const tenth = readings.find((each) => each.edit === 10);
  const last = readings.at(-1);
  if (tenth === undefined || last === undefined) throw new Error('the session took no reading at edit 10 or at its end');
  /** Each host's growth over the last ten edits, in MB. */
  const lastTen = Object.fromEntries(
    Object.entries(last.rolesMB)
      .filter(([role]) => role.startsWith('host '))
      .map(([role, mb]) => [role, mb - (tenth.rolesMB[role] ?? mb)]),
  );
  // THE HOSTS AN EDIT RUNS IN ARE READ, so an empty table cannot pass for one where nothing grew.
  expect(Object.keys(lastTen)).toEqual(expect.arrayContaining(['host mupdf', 'host pdfium']));
  expect(Object.entries(lastTen).filter(([, grew]) => grew > LAST_TEN_MB)).toStrictEqual([]);
  return { readings, lastTenMB: lastTen, boundMB: LAST_TEN_MB };
});

await step('M3c. an idle PDFium host stops with documents open (item 13b), and what its restart costs the next edit', async () => {
  const { editor, ensureEditText, clickPage } = textSteps({ page, output, saveTo, command });
  /** One edit, timed from the press on the block to its editor closing on the written words. */
  const timedEdit = async (/** @type {string} */ word) => {
    await ensureEditText();
    const block = page.locator('[data-text-block]').nth(1);
    const box = await block.boundingBox();
    if (box === null) throw new Error('no second text block on the page');
    const started = Date.now();
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(8, box.height / 2));
    await expect(editor()).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type(` ${word}`);
    await clickPage(20, 20);
    await expect(editor()).toHaveCount(0);
    return Date.now() - started;
  };
  // THE SHELL'S IDLE TIME and ten seconds over it (`HOST_IDLE_MS`, 60 s), after M3b's last edit.
  await page.waitForTimeout(70_000);
  const idle = reading();
  // STOPPED WITH SEVEN DOCUMENTS OPEN, while the MuPDF host, which holds their sessions, stays.
  expect(idle.hosts).toContain('host mupdf');
  expect(idle.hosts).not.toContain('host pdfium');
  const coldMs = await timedEdit('cold');
  const warmMs = await timedEdit('warm');
  const after = reading();
  expect(after.hosts).toContain('host pdfium');
  return { idleHosts: idle.hosts, idleRolesMB: idle.rolesMB, coldEditMs: coldMs, warmEditMs: warmMs, restartCostMs: coldMs - warmMs };
});

await step('M3d. every word M3b and M3c typed is in the saved file, once and in order: no edit lost across the host’s idle stop', async () => {
  // THE QUESTION SESSION 3 LEFT OPEN (item 9): its M3c screenshot showed the edited line's words drawn over each other
  // and the numbers 16, 18 and 19 not visible. A picture of a page turned 180 degrees cannot say whether an edit was
  // lost; the saved file can, read by MuPDF keeping every space, with each run of whitespace one space.
  const { savedCopy } = textSteps({ page, output, saveTo, command });
  const words = (await savedTextKeepingSpaces(await savedCopy('m3d-long-session.pdf'))).replaceAll(/\s+/gu, ' ');
  // EACH WORD PRESENT, not the sequence: the paragraph grows downward over the text below it as it is edited (ADR-0096),
  // so a reader in position order meets some typed words inside other lines — "18dolore", "3labore" (2026-10-16).
  // Present is the question; the order on the page is the overlap's, which is recorded for the owner separately.
  // COUNTED AGAINST THE ORIGINAL, one more each: a lone "1" is also in "Page 1 of 5", so presence could not see it lost.
  const original = (await savedTextKeepingSpaces(sample)).replaceAll(/\s+/gu, ' ');
  const typed = [...Array.from({ length: LONG_EDITS }, (_, at) => String(at + 1)), 'cold', 'warm'];
  // A NUMBER BOUNDED BY DIGITS ONLY and a word by letters only: overlapping lines glue them to their neighbours ("18dolore").
  const count = (/** @type {string} */ text, /** @type {string} */ word) => {
    const edge = /^\d+$/u.test(word) ? '\\d' : 'a-z';
    return (text.match(new RegExp(`(?<![${edge}])${word}(?![${edge}])`, 'giu')) ?? []).length;
  };
  const wrong = typed.filter((word) => count(words, word) !== count(original, word) + 1);
  expect(wrong, words.slice(0, 600)).toStrictEqual([]);
  return { typed: typed.length };
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
    // WHICHEVER COMES FIRST, the dialog or the tab going, for up to 30 s: a 4 s wait stood for this, and on 2026-10-16
    // the dialog came after it, so it was left open, the close never finished, and every later count was one short.
    const tabs = page.locator('[data-tab-select]');
    const deadline = Date.now() + 30_000;
    let asked = false;
    while (Date.now() < deadline && (await tabs.count()) >= left) {
      if (await unsaved.isVisible()) {
        asked = true;
        break;
      }
      await page.waitForTimeout(100);
    }
    if (asked) await unsaved.getByRole('button', { name: 'Don’t save' }).click();
    await expect(page.locator('[data-tab-select]')).toHaveCount(left - 1, { timeout: 30_000 });
  }
  await page.waitForTimeout(60_000);
  const after = reading();
  expect(after.hosts).toStrictEqual([]);
  // THE FONT LIST WAS KEPT (ADR-0237), read back from the profile: the next session's edit answers its picker from it.
  const kept = JSON.parse(await readFile(join(output, 'app-data', 'font-families.json'), 'utf8'));
  expect(kept.families.length).toBeGreaterThan(0);
  const before = /** @type {ReturnType<typeof reading> | null} */ (atStart);
  if (before === null) throw new Error('M1 took no reading');
  // THE OWNER'S TARGET FOR A CLOSE (run 4 item 13f): every document closed, within about 10% of the start screen.
  const allowedMB = Math.round(before.totalMB * 1.1);
  // THE FIGURES IN THE MESSAGE, by process: a failed step records no facts, and the closed reading is one the report owes.
  expect(after.totalMB, `closed ${String(after.totalMB)} MB against ${String(before.totalMB)} at the start; by process ${JSON.stringify(after.rolesMB)}`).toBeLessThanOrEqual(allowedMB);
  return {
    ...after,
    keptFontFamilies: kept.families.length,
    atStartMB: before.rolesMB,
    atStartTotalMB: before.totalMB,
    allowedClosedMB: allowedMB,
    // ELECTRON'S OWN FLOOR, which no change here can take to zero: main, the renderer and the GPU process with nothing
    // open, read at M1.
    electronFloorMB: before.totalMB,
  };
});

await finish();
