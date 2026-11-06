// @ts-check
/**
 * The new features' walk of 2026-11-03: the checks the merge order of 2026-11-02 asked for on the merged build, in the
 * running app on Windows with a real mouse and keyboard, each against a document the walk writes itself.
 *
 *   node scripts/research/newFeaturesWalk.mjs [--app-root <checkout>] [--only <part,part>]
 *
 * Parts: `layouts` (ADR-0284 and cloud-45: the four layouts and the cover page from Home › Display (Tools › Display until the owner moved them on 2026-11-05), the View menu and
 * Settings, a right-to-left book, and a search hit and a link landing on a right-hand page's pair); `caret` (cloud-41:
 * a press at the start, middle and end of letters in an untouched line puts the caret on the page's letter edge);
 * `properties` (ADR-0283: the title and dates edited, saved, reopened, read by Windows, undone, and removed by Sanitize);
 * `curves` (ADR-0282: the question's two warnings, the copy's letters, the report, Open the copy, the open file refused as
 * the target, a password-protected document); `placements` (cloud-50: Edit text's outlines on the 200-placement page).
 *
 * Every step asserts the effect a person would look for, never only that something answered.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { expect } from '@playwright/test';

import { appRootOption, root, startWalk } from './liveWalk.mjs';
import { editTextOpening, textSteps } from './textWalkSteps.mjs';

/** @type {typeof import('@cantoo/pdf-lib')} */
const pdfLib = createRequire(import.meta.url)('@cantoo/pdf-lib');
const { PDFDocument, PDFName, StandardFonts, rgb } = pdfLib;

const at = process.argv.indexOf('--only');
const ONLY = at === -1 ? undefined : new Set((process.argv[at + 1] ?? '').split(','));
const runs = (/** @type {string} */ part) => ONLY === undefined || ONLY.has(part);

const walk = await startWalk('new-features', appRootOption(process.argv));
const { app, page, output, open, saveTo, command, section, step, finish } = walk;
const text = textSteps(walk);

/** Every tab closed, answering "Don't save": each part starts with nothing open. */
async function closeAll() {
  for (let tab = 0; tab < 8 && (await page.locator('.m-tab-close').count()) > 0; tab += 1) {
    await page.locator('.m-tab-close').first().click();
    const dontSave = page.locator('.m-dialog:not(.m-palette)').last().getByRole('button', { name: 'Don’t save' });
    await dontSave.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
    if ((await dontSave.count()) > 0) await dontSave.click();
    await page.waitForTimeout(300);
  }
}

/** The open dialog: the box every dialog is drawn in, the palette apart. */
const dialog = () => page.locator('.m-dialog:not(.m-palette)').last();

// ————————————————————————————————————————————— layouts ——————————————————————————————————————————————

/**
 * Six pages, each with its own word; page 1 links to page 4, and page 4 carries a word found nowhere else.
 * @param {'L2R' | 'R2L'} direction
 */
async function layoutDocument(direction) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 6; index += 1) {
    const sheet = document.addPage([612, 792]);
    sheet.drawText(`Words of page ${String(index + 1)}`, { x: 72, y: 700, size: 18, font, color: rgb(0, 0, 0) });
    if (index === 3) sheet.drawText('Marmalade', { x: 72, y: 650, size: 18, font, color: rgb(0, 0, 0) });
  }
  const first = document.getPage(0);
  first.drawText('Go to page four', { x: 72, y: 600, size: 18, font, color: rgb(0, 0, 0.8) });
  const link = document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [70, 595, 240, 620],
    Border: [0, 0, 0],
    Dest: [document.getPage(3).ref, PDFName.of('Fit')],
  });
  first.node.set(PDFName.of('Annots'), document.context.obj([document.context.register(link)]));
  if (direction === 'R2L') document.catalog.set(PDFName.of('ViewerPreferences'), document.context.obj({ Direction: 'R2L' }));
  return document.save();
}

/** Each shown slot of the document on show: its zero-based page and where it stands. */
const slots = () =>
  page.locator('.m-page-list:visible').first().evaluate((list) =>
    [...list.querySelectorAll('.m-page-slot')]
      .filter((slot) => !(/** @type {{ hidden: boolean }} */ (/** @type {unknown} */ (slot)).hidden))
      .map((slot) => {
        const box = slot.getBoundingClientRect();
        return { page: Number(slot.getAttribute('data-page')), left: Math.round(box.left), top: Math.round(box.top) };
      }),
  );

/**
 * What a layout looks like, as a person sees it. Answers a sentence for the first thing that is not so, or `null`.
 * @param {'single' | 'continuous' | 'pair' | 'facing'} layout
 * @param {boolean} cover
 * @param {'L2R' | 'R2L'} direction
 */
async function arrangedAs(layout, cover, direction) {
  const shown = await slots();
  const [a, b, c] = shown;
  /** Whether `x` comes before `y` in the book's reading order. @param {{ left: number }} x @param {{ left: number }} y */
  const before = (x, y) => (direction === 'R2L' ? x.left > y.left : x.left < y.left);
  if (a === undefined) return 'no page is shown';
  switch (layout) {
    case 'single':
      return shown.length === 1 ? null : `${String(shown.length)} pages shown`;
    case 'continuous':
      return b !== undefined && a.left === b.left && b.top > a.top ? null : `not one column: ${JSON.stringify(shown.slice(0, 3))}`;
    case 'pair':
      if (cover) return shown.length === 1 && a.page === 0 ? null : `the cover is not alone: ${JSON.stringify(shown)}`;
      return shown.length === 2 && b !== undefined && a.top === b.top && before(a, b) ? null : `not one pair in reading order: ${JSON.stringify(shown)}`;
    case 'facing':
      if (b === undefined || c === undefined) return `fewer than three pages: ${JSON.stringify(shown)}`;
      if (cover) {
        // THE COVER ALONE IN THE COLUMN page 3 stands in, above pages 2 and 3, which face each other in reading order.
        return a.left === c.left && b.top === c.top && before(b, c) && a.top < b.top ? null : `the cover does not stand alone: ${JSON.stringify(shown.slice(0, 3))}`;
      }
      return a.top === b.top && before(a, b) && c.top > a.top && c.left === a.left ? null : `not pairs in reading order: ${JSON.stringify(shown.slice(0, 3))}`;
  }
}

/** @type {readonly { layout: 'single' | 'continuous' | 'pair' | 'facing', title: string }[]} */
const LAYOUTS = [
  { layout: 'single', title: 'Single page' },
  { layout: 'continuous', title: 'Continuous' },
  { layout: 'pair', title: 'Facing' },
  { layout: 'facing', title: 'Continuous facing' },
];

/** The ribbon's Home section, as a hand finds it (Home › Display since 2026-11-05). @param {string} name */
async function fromHomeDisplay(name) {
  await page.locator('[data-ribbon-section="home"]').click();
  await page.locator('.m-ribbon').getByRole('button', { name, exact: true }).first().click();
}

/** The View menu's item. @param {string} name */
async function fromViewMenu(name) {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
}

/**
 * The Settings window's Viewing page, the layout chosen there and the cover page set, then the window closed.
 * @param {string} layoutTitle
 * @param {boolean} cover
 */
async function fromSettings(layoutTitle, cover) {
  await command('Settings');
  await page.locator('.m-settings__page-choice', { hasText: 'View' }).first().click();
  const layout = page.locator('[data-setting="viewing.page-layout"]').first();
  if ((await layout.evaluate((element) => element.tagName)) === 'SELECT') await layout.selectOption({ label: layoutTitle });
  else await layout.getByRole('radio', { name: layoutTitle, exact: true }).click();
  const switched = page.locator('[data-setting="viewing.cover-page"]').first();
  // A NATIVE CHECKBOX in the switch's role, so its state is its `checked`, which no attribute carries.
  if ((await switched.isChecked()) !== cover) await switched.click();
  await expect(switched).toBeChecked({ checked: cover });
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
}

if (runs('layouts')) {
  const book = join(output, 'layouts.pdf');
  await writeFile(book, await layoutDocument('L2R'));
  const rtl = join(output, 'layouts-rtl.pdf');
  await writeFile(rtl, await layoutDocument('R2L'));

  await step('layouts: the document opens in Continuous, the default', async () => {
    await open(book);
    const wrong = await arrangedAs('continuous', false, 'L2R');
    if (wrong !== null) throw new Error(wrong);
  });

  for (const [surface, choose] of /** @type {const} */ ([
    ['Home › Display', fromHomeDisplay],
    ['the View menu', fromViewMenu],
  ])) {
    for (const { layout, title } of LAYOUTS) {
      await step(`layouts: ${title} from ${surface}`, async () => {
        await choose(title);
        await expect.poll(() => arrangedAs(layout, false, 'L2R'), { timeout: 10_000 }).toBeNull();
        return { shown: await slots() };
      }, { covers: [`view.page-layout-${layout}`] });
    }
    await step(`layouts: Show cover page from ${surface}, in Continuous facing`, async () => {
      await choose('Continuous facing');
      await choose('Show cover page');
      await expect.poll(() => arrangedAs('facing', true, 'L2R'), { timeout: 10_000 }).toBeNull();
      await choose('Show cover page');
      await expect.poll(() => arrangedAs('facing', false, 'L2R'), { timeout: 10_000 }).toBeNull();
      return { shown: await slots() };
    }, { covers: ['view.cover-page'] });
  }

  for (const { layout, title } of LAYOUTS) {
    await step(`layouts: ${title} from Settings`, async () => {
      await fromSettings(title, false);
      await expect.poll(() => arrangedAs(layout, false, 'L2R'), { timeout: 10_000 }).toBeNull();
    });
  }
  await step('layouts: Show cover page from Settings, in Continuous facing', async () => {
    await fromSettings('Continuous facing', true);
    await expect.poll(() => arrangedAs('facing', true, 'L2R'), { timeout: 10_000 }).toBeNull();
    await fromSettings('Continuous facing', false);
  });

  await step('layouts: in Facing, a search hit on page 4, a right-hand page, shows its pair, pages 3 and 4', async () => {
    await fromViewMenu('Facing');
    await page.keyboard.press('Control+F');
    await page.locator('[data-find-input]').fill('Marmalade');
    // ALL PAGES, as a hand asks: Enter searches the page on show, and page 1 holds no hit.
    await page.getByRole('button', { name: 'Search all pages', exact: true }).click();
    await expect.poll(async () => (await slots()).map((each) => each.page), { timeout: 15_000 }).toStrictEqual([2, 3]);
    await page.keyboard.press('Escape');
    return { shown: await slots() };
  });

  /** A press on page 1's link, at its middle, as a hand presses it. */
  const pressLink = async () => {
    const canvas = page.locator('.m-page-slot[data-page="0"] canvas.m-page:visible').first();
    const box = await canvas.boundingBox();
    if (box === null) throw new Error('page 1 is not drawn');
    const scale = box.width / 612;
    const x = box.x + 150 * scale;
    const y = box.y + (792 - 607) * scale;
    // WHAT THE PRESS LANDS ON, read at that point before it: a press that missed the link reads like a link that went
    // nowhere.
    const under = await page.evaluate(([px, py]) => {
      const hit = /** @type {{ document: { elementFromPoint: (x: number, y: number) => { className: string, getAttribute: (n: string) => string | null } | null } }} */ (
        /** @type {unknown} */ (globalThis)
      ).document.elementFromPoint(px ?? 0, py ?? 0);
      return hit === null ? 'nothing' : `${String(hit.className)} ${hit.getAttribute('aria-label') ?? ''}`;
    }, [x, y]);
    await page.mouse.click(x, y);
    return under;
  };

  await step('layouts: CONTROL, in Continuous the link on page 1 goes to page 4', async () => {
    await fromViewMenu('Continuous');
    await page.getByRole('button', { name: 'First page', exact: true }).first().click();
    // THE STATUS BAR'S PAGE FIELD, the page a person is told they are on.
    const shownPage = page.locator('[data-goto-input]').first();
    await expect(shownPage).toHaveValue('1', { timeout: 10_000 });
    await pressLink();
    await expect(shownPage).toHaveValue('4', { timeout: 10_000 });
    await fromViewMenu('Facing');
  });

  await step('layouts: in Facing, the link on page 1 to page 4 shows the pair of pages 3 and 4', async () => {
    // BACK TO THE FIRST PAIR by the status bar's button, as a hand goes back.
    await page.getByRole('button', { name: 'First page', exact: true }).first().click();
    await expect.poll(async () => (await slots()).map((each) => each.page), { timeout: 10_000 }).toStrictEqual([0, 1]);
    // HOW LONG PAGE 1'S LINK TAKES TO BE PRESSABLE after its page is on show: a link drawn on the page that a press
    // cannot reach yet is what a hand meets when it presses as soon as it sees the page.
    const shownAt = Date.now();
    const link = page.locator('.m-page-slot[data-page="0"] .m-page-link');
    await link.first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined);
    const linkMs = Date.now() - shownAt;
    const under = await pressLink();
    const went = await expect
      .poll(async () => (await slots()).map((each) => each.page), { timeout: 10_000 })
      .toStrictEqual([2, 3])
      .then(
        () => true,
        () => false,
      );
    const field = await page.locator('[data-goto-input]').first().inputValue();
    if (!went) throw new Error(`the press landed on “${under}” ${String(linkMs)} ms after the pages showed, and the window shows ${JSON.stringify(await slots())}, the page field ${field}`);
    return { linkMs, under, field, shown: await slots() };
  });

  await step('layouts: a right-to-left book in Continuous facing pairs from the right', async () => {
    await closeAll();
    await fromSettings('Continuous facing', false);
    await open(rtl);
    await expect.poll(() => arrangedAs('facing', false, 'R2L'), { timeout: 10_000 }).toBeNull();
    return { shown: await slots() };
  });

  await step('layouts: and with Show cover page its cover stands alone on the left', async () => {
    await fromViewMenu('Show cover page');
    await expect.poll(() => arrangedAs('facing', true, 'R2L'), { timeout: 10_000 }).toBeNull();
    const [cover, second, third] = await slots();
    // THE LEFT COLUMN in a right-to-left book: page 3 begins its row on the left, page 2 stands right of it.
    if (cover === undefined || second === undefined || third === undefined || !(second.left > cover.left)) {
      throw new Error(`the cover is not on the left: ${JSON.stringify(await slots())}`);
    }
    await fromViewMenu('Show cover page');
    await fromViewMenu('Continuous');
    return { shown: await slots() };
  });
  await closeAll();
}

// —————————————————————————————————————————————— caret ———————————————————————————————————————————————

/**
 * Zoom in by the status bar's button, as a hand does, until the status bar shows `percent` or more.
 * @param {number} percent
 */
async function zoomTo(percent) {
  const shown = page.locator('.m-status-zoom').first();
  const now = async () => Number.parseInt((await shown.innerText()).replaceAll(/\D/gu, ''), 10);
  for (let press = 0; press < 30; press += 1) {
    const before = await now();
    if (before >= percent) return before;
    await page.getByRole('button', { name: 'Zoom in', exact: true }).first().click();
    const moved = await expect.poll(now, { timeout: 10_000, intervals: [100] }).toBeGreaterThan(before).then(() => true, () => false);
    if (!moved) return before;
  }
  return now();
}

const CARET_TEXT = 'Waving illicit MOMWAW tilt';
const CARET_SIZE = 24;
const CARET_LEFT = 72;
const CARET_BASELINE = 650;

if (runs('caret')) {
  for (const face of /** @type {const} */ (['TimesRoman', 'Helvetica'])) {
    await step(`caret (41): a press at the start, middle and end of letters in an untouched ${face} line stands on the page's letter edge`, async () => {
      const document = await PDFDocument.create();
      const font = await document.embedFont(StandardFonts[face]);
      document.addPage([612, 792]).drawText(CARET_TEXT, { x: CARET_LEFT, y: CARET_BASELINE, size: CARET_SIZE, font });
      const path = join(output, `caret-${face}.pdf`);
      await writeFile(path, await document.save());
      // THE PAGE'S OWN PEN: each letter's advance summed, as `drawText` sets them.
      const pen = [CARET_LEFT];
      for (const letter of CARET_TEXT) pen.push((pen.at(-1) ?? CARET_LEFT) + font.widthOfTextAtSize(letter, CARET_SIZE));
      await closeAll();
      await open(path);
      // THE PAGE BY ITS SLOT, never its canvas: zoomed in, the page is drawn in tiles and no one canvas is the page. The
      // slot is checked against the canvas first, at the zoom where there is one, so the slot is shown to be the page.
      const slot = page.locator('.m-page-slot[data-page="0"]').first();
      const drawn = await page.locator('canvas.m-page:visible').first().boundingBox();
      const held = await slot.boundingBox();
      if (drawn === null || held === null) throw new Error('the page is not drawn');
      if (Math.abs(drawn.x - held.x) > 0.5 || Math.abs(drawn.width - held.width) > 0.5) throw new Error(`the slot is not the page: slot ${JSON.stringify(held)}, canvas ${JSON.stringify(drawn)}`);
      // ZOOMED IN as far as the app goes, BEFORE Edit text: at 100 % a pixel is a point and the allowance came to 1.25 pt,
      // which the code before the fix also met (1.25 pt off in Times, 0.44 in Helvetica, `editTextCaret.pw.ts`).
      const zoom = await zoomTo(800);
      await section('Edit');
      await text.ensureEditText();
      const block = page.locator('[data-text-block]').first();
      await expect(block).toBeAttached({ timeout: 60_000 });
      const first = await slot.boundingBox();
      if (first === null) throw new Error('the page is not laid out');
      const scale = first.width / 612;
      /**
       * A point of the page in the window, the page first scrolled so that it stands in the middle of the pane, as a hand
       * scrolls to the letter it means to press: zoomed in, the line is wider than the pane.
       * @param {number} xPt
       */
      const pointAt = async (xPt) => {
        const yPt = 792 - CARET_BASELINE - CARET_SIZE * 0.3;
        await slot.evaluate((held, wanted) => {
          for (let at = held.parentElement; at !== null; at = at.parentElement) {
            if (at.scrollWidth > at.clientWidth + 1 || at.scrollHeight > at.clientHeight + 1) {
              const box = at.getBoundingClientRect();
              const page = held.getBoundingClientRect();
              at.scrollLeft += page.left + wanted.x - (box.left + box.width / 2);
              at.scrollTop += page.top + wanted.y - (box.top + box.height / 2);
              return;
            }
          }
        }, { x: xPt * scale, y: yPt * scale });
        await page.waitForTimeout(150);
        const box = await slot.boundingBox();
        if (box === null) throw new Error('the page is not laid out');
        return { x: box.x + xPt * scale, origin: box.x, y: box.y + yPt * scale };
      };
      const opening = editTextOpening(page);
      /**
       * The editor closed by Escape, as the status bar says, with nothing typed in it: the walks' press away presses the
       * page's canvas, and zoomed in, the page is drawn in tiles with no canvas of its own.
       */
      const leaveEditor = async () => {
        await page.keyboard.press('Escape');
        await expect(opening.frame()).toHaveCount(0, { timeout: 10_000 }).catch(async () => {
          await page.keyboard.press('Escape');
          await expect(opening.frame()).toHaveCount(0, { timeout: 10_000 });
        });
      };
      /** @type {{ letter: string, where: string, pressedX: number, caretX: number, edgeX: number, offPt: number }[]} */
      const readings = [];
      // LETTERS IN EACH WORD, a narrow one and a wide one among them: the first W, the i of "illicit", the second M.
      for (const index of [0, 7, 9, 16, 20, 23]) {
        const from = pen[index] ?? CARET_LEFT;
        const to = pen[index + 1] ?? from;
        for (const [where, x, edge] of /** @type {const} */ ([
          ['start', from + (to - from) * 0.15, from],
          ['middle-left', from + (to - from) * 0.4, from],
          ['middle-right', from + (to - from) * 0.6, to],
          ['end', from + (to - from) * 0.85, to],
        ])) {
          if ((await opening.editor().count()) > 0) await leaveEditor();
          const point = await pointAt(x);
          await opening.openAt(point.x, point.y);
          // THE PAGE WHERE IT STANDS NOW: opening the editor must not have moved it, but the edge is read against it anyway.
          const now = await slot.boundingBox();
          const origin = now?.x ?? point.origin;
          const read = await opening.caretAgainst(point);
          if (read === null || !read.collapsed) throw new Error(`no caret after the press ${where} of “${CARET_TEXT[index] ?? ''}”`);
          const edgeX = origin + edge * scale;
          readings.push({ letter: CARET_TEXT[index] ?? '', where, pressedX: point.x, caretX: read.caretX, edgeX, offPt: Math.abs(read.caretX - edgeX) / scale });
        }
      }
      await leaveEditor();
      // 0.25 PT, the browser test's tolerance, plus half a pixel: a caret's box is read to a fraction of a pixel, and
      // half is the most rounding to the pixel grid can move an edge.
      const allowed = 0.25 + 0.5 / scale;
      // A RESOLUTION THAT CANNOT SEPARATE THE FIX FROM THE CODE BEFORE IT is no reading: Helvetica's was 0.44 pt off.
      if (allowed >= 0.44) throw new Error(`the zoom stopped where a pixel is ${(1 / scale).toFixed(2)} pt: the allowance ${allowed.toFixed(2)} pt cannot tell the fix from the code before it`);
      const worst = readings.reduce((most, each) => (each.offPt > most.offPt ? each : most));
      const off = readings.filter((each) => each.offPt > allowed).map((each) => `${each.where} of “${each.letter}”: ${each.offPt.toFixed(2)} pt`);
      if (off.length > 0) throw new Error(`${String(off.length)} of ${String(readings.length)} carets stood off the letter's edge (allowed ${allowed.toFixed(2)} pt): ${off.join('; ')}`);
      expect(await text.problems()).toStrictEqual([]);
      return { zoom, scale, allowedPt: allowed, worstPt: Number(worst.offPt.toFixed(3)), readings: readings.length };
    });
  }
  await closeAll();
}

// ———————————————————————————————————————————— properties ————————————————————————————————————————————

/**
 * What Windows' shell says the file's title is: the property Explorer's details pane shows. Read through the shell's own
 * property system in a PowerShell child, never parsed from the file, so it is Windows' reading and not a second opinion.
 * @param {string} path
 */
function windowsTitle(path) {
  const script = `$f = (New-Object -ComObject Shell.Application).Namespace('${dirname(path).replaceAll("'", "''")}').ParseName('${basename(path).replaceAll("'", "''")}'); [Console]::Out.Write([string]$f.ExtendedProperty('System.Title'))`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
}

if (runs('properties')) {
  const path = join(output, 'properties.pdf');
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('A document whose properties are edited', { x: 72, y: 700, size: 18, font });
  document.setTitle('The first title');
  document.setCreationDate(new Date('2020-01-02T03:04:00Z'));
  document.setModificationDate(new Date('2020-01-02T03:04:00Z'));
  await writeFile(path, await document.save());
  const born = statSync(path).birthtimeMs;

  /** The dialog's fields as they read now. */
  const fields = async () => ({
    title: await dialog().getByLabel('Title', { exact: true }).inputValue(),
    created: await dialog().getByLabel('Created', { exact: true }).inputValue(),
    modified: await dialog().getByLabel('Modified', { exact: true }).inputValue(),
  });

  await step('properties: the title and both dates edited and applied say so', async () => {
    await open(path);
    await command('Document properties…');
    await expect(dialog().getByLabel('Title', { exact: true })).toHaveValue('The first title');
    await dialog().getByLabel('Title', { exact: true }).fill('A walked title');
    await dialog().getByLabel('Created', { exact: true }).fill('2021-05-06 07:08');
    await dialog().getByLabel('Modified', { exact: true }).fill('2022-09-10 11:12');
    await dialog().getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('.m-toast', { hasText: 'Document properties changed' })).toBeVisible({ timeout: 10_000 });
    // THE STATUS BAR SAYS IT, in the first of the places that word it.
    await expect(page.getByText('Unsaved changes', { exact: true }).first()).toBeVisible();
  }, { covers: ['document.properties'] });

  await step('properties: Undo restores the old title and dates, and Redo brings the new ones back', async () => {
    await page.keyboard.press('Control+Z');
    await command('Document properties…');
    const undone = await fields();
    await page.keyboard.press('Escape');
    if (undone.title !== 'The first title') throw new Error(`after Undo the title reads “${undone.title}”`);
    if (!undone.created.startsWith('2020-01-02')) throw new Error(`after Undo the created date reads “${undone.created}”`);
    await page.keyboard.press('Control+Y');
    await command('Document properties…');
    const redone = await fields();
    await page.keyboard.press('Escape');
    if (redone.title !== 'A walked title') throw new Error(`after Redo the title reads “${redone.title}”`);
    return { undone, redone };
  });

  await step('properties: saved and opened again, the new title and dates are the file’s', async () => {
    const saving = Date.now();
    await page.keyboard.press('Control+S');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 30_000 });
    await closeAll();
    await open(path);
    await command('Document properties…');
    const reopened = await fields();
    await page.keyboard.press('Escape');
    if (reopened.title !== 'A walked title') throw new Error(`reopened, the title reads “${reopened.title}”`);
    if (!reopened.created.startsWith('2021-05-06 07:08') || !reopened.modified.startsWith('2022-09-10 11:12')) {
      throw new Error(`reopened, the dates read ${JSON.stringify(reopened)}`);
    }
    // WHAT A SECOND READER SAYS the file holds: pdf-lib, not the application.
    const read = await PDFDocument.load(readFileSync(path), { updateMetadata: false });
    if (read.getTitle() !== 'A walked title') throw new Error(`pdf-lib reads the title “${String(read.getTitle())}”`);
    const file = statSync(path);
    return {
      reopened,
      pdfLibCreated: read.getCreationDate()?.toISOString(),
      // WINDOWS' OWN DATES: the file's creation is the one it had; its modification is the save, never the PDF's date.
      windowsCreatedUnchanged: file.birthtimeMs === born,
      windowsModifiedIsTheSave: Math.abs(file.mtimeMs - saving) < 120_000,
    };
  });

  await step('properties: File Explorer’s details read the new title, and Windows’ dates are its own', async () => {
    const shown = windowsTitle(path);
    const file = statSync(path);
    // THE PDF'S DATES ARE NEVER WINDOWS' DATES, which is what the dialog's sentence can promise. Windows' creation date
    // is RECORDED, not asserted unchanged: a save writes a temporary file and renames it over the document
    // (`atomicWrite.ts`), and the renamed file carries the temporary file's creation date. Measured 2026-11-03, in
    // 1.1.2610.0 as on main; keeping it is a question for the owner, since it needs a Windows call where the save runs.
    if (file.birthtime.getUTCFullYear() === 2021) throw new Error('the file’s Windows creation date took the PDF’s date');
    if (file.mtime.getUTCFullYear() === 2022) throw new Error('the file’s Windows modification date took the PDF’s date');
    const createdMoved = file.birthtimeMs !== born;
    // AN EMPTY ANSWER IS NOT A PASS: it says no PDF property handler is installed, and the details pane then shows none.
    const dates = { createdBefore: new Date(born).toISOString(), created: file.birthtime.toISOString(), createdMoved, modified: file.mtime.toISOString() };
    if (shown === '') return { explorerTitle: '(none: Windows has no PDF property reader installed here)', ...dates };
    if (shown !== 'A walked title') throw new Error(`Explorer reads the title “${shown}”`);
    return { explorerTitle: shown, ...dates };
  });

  await step('properties: Sanitize with Document information ticked removes the title', async () => {
    await command('Sanitize document');
    const part = dialog().getByRole('checkbox', { name: /^Document information/u });
    if (!(await part.isChecked())) await part.check();
    await dialog().locator('.m-button--primary').last().click();
    await expect(dialog()).toHaveCount(0, { timeout: 60_000 });
    await command('Document properties…');
    const after = await fields();
    await page.keyboard.press('Escape');
    if (after.title !== '') throw new Error(`after Sanitize the title reads “${after.title}”`);
    const kept = join(output, 'properties-sanitized.pdf');
    await saveTo(kept);
    await command('Save a copy…');
    await expect.poll(() => statSync(kept, { throwIfNoEntry: false })?.size ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    const read = await PDFDocument.load(readFileSync(kept), { updateMetadata: false });
    if ((read.getTitle() ?? '') !== '') throw new Error(`the sanitized copy still holds the title “${String(read.getTitle())}”`);
  }, { covers: ['document.sanitize'] });
  await closeAll();
}

// —————————————————————————————————————————————— curves ——————————————————————————————————————————————

/** A form with two fields, tagged: its question owes both warnings. */
async function taggedForm() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  sheet.drawText('Name and colour, a tagged form', { x: 72, y: 700, size: 18, font });
  const form = document.getForm();
  form.createTextField('name').addToPage(sheet, { x: 72, y: 640, width: 200, height: 24 });
  form.createCheckBox('agree').addToPage(sheet, { x: 72, y: 600, width: 18, height: 18 });
  const paragraph = document.context.register(document.context.obj({ Type: 'StructElem', S: 'P' }));
  const top = document.context.register(document.context.obj({ Type: 'StructElem', S: 'Document', K: [paragraph] }));
  document.catalog.set(PDFName.of('StructTreeRoot'), document.context.obj({ Type: 'StructTreeRoot', K: [top] }));
  document.catalog.set(PDFName.of('MarkInfo'), document.context.obj({ Marked: true }));
  return document.save();
}

/** How many letters a second reader finds on a file's pages: pdf.js, through the application's own copy of it. */
async function lettersIn(/** @type {string} */ path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), password: 'open-me' });
  const loaded = await task.promise;
  let letters = 0;
  for (let number = 1; number <= loaded.numPages; number += 1) {
    const content = await (await loaded.getPage(number)).getTextContent();
    for (const item of content.items) if ('str' in item) letters += item.str.replaceAll(/\s/gu, '').length;
  }
  await task.destroy();
  return letters;
}

if (runs('curves')) {
  const form = join(output, 'curves-form.pdf');
  await writeFile(form, await taggedForm());

  await step('curves: on a tagged form, the question says both warnings', async () => {
    await open(form);
    await command('Convert text to curves…');
    await expect(dialog()).toContainText('Its form fields become part of the page', { timeout: 60_000 });
    await expect(dialog()).toContainText('Its reading order and tags are removed.');
  }, { covers: ['document.convert-text-to-curves'] });

  await step('curves: the open document picked as the copy is refused, and the document is unchanged', async () => {
    const before = readFileSync(form);
    await saveTo(form);
    await dialog().getByRole('button', { name: 'Save a copy…', exact: true }).click();
    // THE REFUSAL IS A QUESTION OF ITS OWN, the save problem; no result dialog follows.
    await expect(dialog()).toBeVisible({ timeout: 60_000 });
    const said = (await dialog().innerText()).replaceAll(/\s+/gu, ' ');
    if (said.includes('Open the copy')) throw new Error('the open document was written over as the copy');
    await page.keyboard.press('Escape');
    if (!readFileSync(form).equals(before)) throw new Error('the open document’s bytes changed');
    return { said: said.slice(0, 200) };
  });

  await step('curves: the copy has no selectable text, the report names the fields and the tags, and Open the copy opens it', async () => {
    const copy = join(output, 'curves-form-copy.pdf');
    await saveTo(copy);
    await command('Convert text to curves…');
    await dialog().getByRole('button', { name: 'Save a copy…', exact: true }).click();
    const report = dialog();
    await expect(report.getByRole('button', { name: 'Open the copy', exact: true })).toBeVisible({ timeout: 120_000 });
    const said = (await report.innerText()).replaceAll(/\s+/gu, ' ');
    if (!/field/iu.test(said)) throw new Error(`the report names no fields: ${said.slice(0, 300)}`);
    if (!/tag|reading order/iu.test(said)) throw new Error(`the report names no tags: ${said.slice(0, 300)}`);
    await report.getByRole('button', { name: 'Open the copy', exact: true }).click();
    await expect(page.locator('.m-status-name').first()).toHaveAttribute('title', basename(copy), { timeout: 30_000 });
    const letters = await lettersIn(copy);
    if (letters !== 0) throw new Error(`a second reader finds ${String(letters)} letters in the copy`);
    // THE CONTROL: the same reader finds the original's letters.
    const original = await lettersIn(form);
    if (original === 0) throw new Error('the second reader finds no letters in the original either, so it cannot see any');
    return { report: said.slice(0, 400), copyLetters: letters, originalLetters: original };
  });

  await step('curves: a password-protected document converts, and its report counts what was kept', async () => {
    await closeAll();
    const plain = await PDFDocument.create();
    const font = await plain.embedFont(StandardFonts.Helvetica);
    plain.addPage([612, 792]).drawText('A locked page, turned to shapes', { x: 72, y: 700, size: 18, font });
    plain.encrypt({ userPassword: 'open-me', ownerPassword: 'own-me', permissions: { printing: 'highResolution' } });
    const locked = join(output, 'curves-locked.pdf');
    await writeFile(locked, await plain.save());
    await app.evaluate(({ dialog: shell }, picked) => {
      shell.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
    }, locked);
    await page.keyboard.press('Control+O');
    await dialog().locator('input[type="password"]').fill('open-me', { timeout: 30_000 });
    await dialog().locator('.m-button--primary').last().click();
    await page.locator('canvas.m-page:visible').first().waitFor({ state: 'visible', timeout: 30_000 });
    const copy = join(output, 'curves-locked-copy.pdf');
    await saveTo(copy);
    await command('Convert text to curves…');
    await dialog().getByRole('button', { name: 'Save a copy…', exact: true }).click();
    const report = dialog();
    await expect(report.getByRole('button', { name: 'Open the copy', exact: true })).toBeVisible({ timeout: 120_000 });
    const said = (await report.innerText()).replaceAll(/\s+/gu, ' ');
    if (said.includes('could not count')) throw new Error(`the report could not count what was kept: ${said.slice(0, 300)}`);
    await page.keyboard.press('Escape');
    return { report: said.slice(0, 300), copyBytes: statSync(copy).size };
  });
  await closeAll();
}

// ——————————————————————————————————————————————— forms ————————————————————————————————————————————————

/** Thirty pages, each with three text fields, and on page 20 a button whose action is the viewer's own Print. */
async function longForm() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();
  for (let index = 0; index < 30; index += 1) {
    const sheet = document.addPage([612, 792]);
    sheet.drawText(`Page ${String(index + 1)} of the long form`, { x: 72, y: 720, size: 18, font });
    for (let field = 0; field < 3; field += 1) {
      form.createTextField(`p${String(index + 1)}f${String(field + 1)}`).addToPage(sheet, { x: 72, y: 640 - field * 60, width: 240, height: 24, font });
    }
  }
  const printing = document.getPage(19);
  const button = form.createButton('print-me');
  button.addToPage('Print', printing, { x: 72, y: 400, width: 120, height: 30, font });
  const widget = button.acroField.getWidgets()[0];
  widget?.dict.set(PDFName.of('A'), document.context.obj({ S: 'Named', N: 'Print' }));
  return document.save();
}

if (runs('forms')) {
  const path = join(output, 'long-form.pdf');
  await writeFile(path, await longForm());
  // PRINTING STOPPED AT THE WINDOW and counted: the walk asks whether the button reached Print, never a printer.
  await app.evaluate(({ webContents }) => {
    const g = /** @type {{ __walkPrinted?: number }} */ (/** @type {unknown} */ (globalThis));
    g.__walkPrinted = 0;
    for (const contents of webContents.getAllWebContents()) {
      /** @type {any} */ (contents).print = (/** @type {unknown} */ _options, /** @type {((ok: boolean, why: string) => void) | undefined} */ done) => {
        g.__walkPrinted = (g.__walkPrinted ?? 0) + 1;
        done?.(true, '');
      };
    }
  });
  const printed = () => app.evaluate(() => /** @type {{ __walkPrinted?: number }} */ (/** @type {unknown} */ (globalThis)).__walkPrinted ?? 0);
  /** The field holding the keyboard's focus, by its name, or `''`. */
  const focusedField = () => page.evaluate(() => /** @type {{ document: { activeElement: { getAttribute: (n: string) => string | null } | null } }} */ (/** @type {unknown} */ (globalThis)).document.activeElement?.getAttribute('aria-label') ?? '');

  await step('forms (42): on page 20, scrolled to, Tab moves from field to field on that page', async () => {
    await open(path);
    const goTo = page.locator('[data-goto-input]').first();
    await goTo.fill('20');
    await goTo.press('Enter');
    await expect(goTo).toHaveValue('20', { timeout: 10_000 });
    // THE FIELD'S OWN BOX, as a hand presses it: a text field is drawn as a button until it is pressed (`FormLayer.tsx`),
    // and both it and the input it becomes are named by the field's name.
    const first = page.locator('[data-form-layer="19"] [data-form-field="0"]').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await first.click();
    await expect.poll(focusedField).toContain('p20f1');
    await page.keyboard.type('one');
    await page.keyboard.press('Tab');
    await expect.poll(focusedField, { timeout: 5000 }).toContain('p20f2');
    await page.keyboard.type('two');
    await page.keyboard.press('Tab');
    await expect.poll(focusedField, { timeout: 5000 }).toContain('p20f3');
    // STILL ON PAGE 20: a Tab that scrolled the window to another page is the fault this checks.
    await expect(goTo).toHaveValue('20');
    return { focused: await focusedField() };
  });

  await step('forms (42): the form button on page 20 that prints reaches Print', async () => {
    const before = await printed();
    const button = page.locator('[data-form-layer="19"]').getByRole('button', { name: /print-me/u }).first();
    await expect(button).toBeVisible({ timeout: 10_000 });
    await button.click();
    // THE APPLICATION'S PRINT, which asks its own question first (`buttonPress.ts`: the button runs `document.print`).
    // The question is the effect asserted, and it is CANCELLED: answering it opens Windows' print dialog, which a walk
    // cannot answer and which held the run past its time limit on 2026-11-03.
    await expect(dialog()).toBeVisible({ timeout: 15_000 });
    const asked = (await dialog().innerText()).replaceAll(/\s+/gu, ' ').slice(0, 160);
    if (!/print/iu.test(asked)) throw new Error(`the button asked something other than Print: ${asked}`);
    await page.keyboard.press('Escape');
    await expect(dialog()).toHaveCount(0, { timeout: 5000 });
    if ((await printed()) !== before) throw new Error('something was printed with the question cancelled');
    return { asked };
  });

  await step('forms (42): the status bar drops facts when the window narrows, and nothing spills past it', async () => {
    /** The status bar's facts on show, and whether anything in it runs past its edge. */
    const bar = () =>
      page.locator('.m-status-bar').first().evaluate((footer) => {
        const shown = [...footer.querySelectorAll('*')].filter((element) => {
          const box = element.getBoundingClientRect();
          return element.children.length === 0 && box.width > 0 && box.height > 0 && (element.textContent ?? '').trim() !== '';
        });
        const edge = footer.getBoundingClientRect();
        return {
          facts: shown.length,
          spills: shown.filter((element) => element.getBoundingClientRect().right > edge.right + 1 || element.getBoundingClientRect().left < edge.left - 1).length,
          overflow: footer.scrollWidth > footer.clientWidth + 1,
        };
      });
    const wide = await bar();
    await walk.sizeWindow({ width: 900, height: 700 });
    await page.waitForTimeout(500);
    const narrow = await bar();
    await walk.sizeWindow({ width: 1400, height: 900 });
    if (narrow.spills > 0 || narrow.overflow) throw new Error(`at 900 px the status bar spills: ${JSON.stringify(narrow)}`);
    if (!(narrow.facts < wide.facts)) throw new Error(`the status bar dropped nothing: ${JSON.stringify({ wide, narrow })}`);
    return { wide, narrow };
  });
  await closeAll();
}

// ——————————————————————————————————————————————— corpus ———————————————————————————————————————————————

/**
 * The owner's corpus, read through its one reader (`corpus.mjs`), which names each document only by its number in sorted
 * order and an id from its bytes. A copy is written into the walk's own folder, which git ignores, and opened from
 * there: the owner's file is never opened, and its name is never printed.
 * @param {number} number one-based
 */
async function corpusCopy(number) {
  const { openCorpus } = await import('../lib/corpus.mjs');
  const corpus = openCorpus({ required: true });
  if (!corpus.available) throw new Error('MONSTERA_CORPUS names no corpus here');
  const document = corpus.documents[number - 1];
  if (document === undefined) throw new Error(`the corpus has no document ${String(number)}`);
  const path = join(output, `corpus-${String(number)}.pdf`);
  await writeFile(path, document.bytes);
  return { path, id: document.id };
}

/** The find bar's count for `words` across the document, as it says it: a number, or 0 for "Nothing … matches". */
async function matchesOf(/** @type {string} */ words) {
  await page.keyboard.press('Control+F');
  await page.locator('[data-find-input]').fill(words);
  await page.getByRole('button', { name: 'Search all pages', exact: true }).click();
  const said = page.locator('.m-find-bar').getByText(/in this document/u).first();
  await expect(said).toBeVisible({ timeout: 60_000 });
  const text = await said.innerText();
  await page.keyboard.press('Escape');
  return /Nothing/u.test(text) ? 0 : Number.parseInt(text.replaceAll(/\D/gu, ''), 10);
}

if (runs('corpus')) {
  await step('corpus (48): an Add text line on an owner’s document is saved, found as a phrase, and written as one run', async () => {
    const { path, id } = await corpusCopy(3);
    await open(path);
    const PHRASE = 'walked phrase seven four';
    if ((await matchesOf(PHRASE)) !== 0) throw new Error('the document already holds the phrase, so finding it proves nothing');
    await command('Add text');
    const surface = page.locator('[data-document-layer="active"] .m-page-slot').first().locator('[data-text-add-surface]');
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    if (box === null) throw new Error('no add surface');
    // A PLACE WITH NO WORDS, read from the page's own text layer: the band low on the page that no line crosses.
    const lines = await page.locator('[data-text-layer="0"]:visible [data-text-line]').evaluateAll((all) => all.map((line) => line.getBoundingClientRect()).map((rect) => [rect.top, rect.bottom]));
    let y = box.y + box.height * 0.9;
    for (let tries = 0; tries < 20 && lines.some(([top = 0, bottom = 0]) => y > top - 14 && y < bottom + 14); tries += 1) y -= box.height * 0.03;
    await page.mouse.click(box.x + box.width * 0.2, y);
    await expect(page.locator('[data-kit-surface]')).toBeFocused({ timeout: 10_000 });
    await page.keyboard.type(PHRASE);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-kit-surface]')).toHaveCount(0, { timeout: 60_000 });
    const kept = join(output, 'corpus-48-saved.pdf');
    await saveTo(kept);
    await command('Save a copy…');
    await expect.poll(() => statSync(kept, { throwIfNoEntry: false })?.size ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
    await closeAll();
    await open(kept);
    const found = await matchesOf(PHRASE);
    if (found !== 1) throw new Error(`reopened, the phrase is found ${String(found)} times`);
    // ONE RUN, as a second reader takes it: pdf.js gives the phrase in one text item.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(kept)), verbosity: 0 });
    const loaded = await task.promise;
    const content = await (await loaded.getPage(1)).getTextContent();
    const whole = content.items.some((item) => 'str' in item && item.str.includes(PHRASE));
    await task.destroy();
    if (!whole) throw new Error('a second reader does not find the phrase in one piece');
    return { document: 3, id, found, oneRun: whole };
  });
  await closeAll();

  await step('corpus (49): on the drawn-font document, every “ft” is still found after a colour change, saved and reopened', async () => {
    const { path, id } = await corpusCopy(4);
    await open(path);
    const before = await matchesOf('ft');
    if (before === 0) throw new Error('the document shows no “ft” to keep');
    // THE FIRST HIT'S PAGE, by the find bar's first match, and on it the text layer's first line holding the pair.
    await page.keyboard.press('Control+F');
    await page.locator('[data-find-input]').fill('ft');
    await page.getByRole('button', { name: 'Search all pages', exact: true }).click();
    await page.locator('.m-find-match').first().click({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    // THE HIT'S OWN PAGE, as the status bar names it: another page's line holding the pair may also be on screen.
    const hitPage = Number(await page.locator('[data-goto-input]').first().inputValue()) - 1;
    const line = page.locator(`[data-text-layer="${String(hitPage)}"] [data-text-line]`, { hasText: 'ft' }).first();
    await expect(line).toBeVisible({ timeout: 30_000 });
    await line.scrollIntoViewIfNeeded();
    const at = await line.boundingBox();
    if (at === null) throw new Error('the line holding the pair is not drawn');
    // THE KEYS BACK ON THE PAGE, then Edit text ON, confirmed by its button: run while the find bar held the focus, the
    // command left the tool off (2026-11-03).
    await page.locator('.m-page-list:visible').first().focus();
    await section('Edit');
    await text.ensureEditText();
    await expect(page.getByRole('button', { name: 'Edit text', exact: true }).first()).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    const blocks = page.locator(`[data-text-edit-layer="${String(hitPage)}"] [data-text-block]`);
    await expect(blocks.first()).toBeVisible({ timeout: 60_000 });
    // THE BLOCK HOLDING THE LINE'S START, by the outlines' own boxes, the line read again where Edit text left it.
    const again = await line.boundingBox();
    const where = again ?? at;
    const point = { x: where.x + Math.min(20, where.width / 2), y: where.y + where.height / 2 };
    const holding = await blocks.evaluateAll(
      (all, p) => all.findIndex((block) => {
        const box = block.getBoundingClientRect();
        return p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
      }),
      point,
    );
    if (holding === -1) throw new Error('no Edit text outline holds the line found');
    const opening = editTextOpening(page);
    await opening.openAt(point.x, point.y);
    await page.keyboard.press('Control+A');
    // A COLOUR OF THE PROPERTIES PANEL'S OWN, as a hand picks one.
    const swatch = text.panel().getByRole('group', { name: 'Text colour' }).getByRole('button', { name: 'Red', exact: true }).first();
    await swatch.click({ timeout: 10_000 });
    expect(await text.problems()).toStrictEqual([]);
    await text.pressAway();
    // THE CHANGE WAS WRITTEN: an edit that wrote nothing keeps every pair too, and would pass what follows.
    await expect(page.getByText('Unsaved changes', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const kept = join(output, 'corpus-49-saved.pdf');
    await saveTo(kept);
    await command('Save a copy…');
    await expect.poll(() => statSync(kept, { throwIfNoEntry: false })?.size ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
    await closeAll();
    await open(kept);
    const after = await matchesOf('ft');
    if (after !== before) throw new Error(`“ft” was found ${String(before)} times before and ${String(after)} after`);
    return { document: 4, id, before, after };
  });
  await closeAll();

  await step('corpus (40): on a page that fills a shape before its drawn-font lines, each line opens in its own font', async () => {
    const { path, id } = await corpusCopy(4);
    await open(path);
    await section('Edit');
    await text.ensureEditText();
    const blocks = page.locator('[data-text-edit-layer="0"] [data-text-block]');
    await expect(blocks.first()).toBeAttached({ timeout: 60_000 });
    const opening = editTextOpening(page);
    /** @type {string[]} */
    const fonts = [];
    const count = Math.min(await blocks.count(), 6);
    for (let at = 0; at < count; at += 1) {
      if ((await opening.editor().count()) > 0) {
        await page.keyboard.press('Escape');
        await expect(opening.frame()).toHaveCount(0, { timeout: 10_000 });
      }
      await opening.openBlock(blocks.nth(at));
      const font = await text.panel().getByRole('button', { name: /^Font:/u }).first().getAttribute('aria-label').catch(() => null);
      fonts.push((font ?? (await text.panel().getByRole('button', { name: /^Font:/u }).first().innerText())).replace(/^Font:\s*/u, ''));
    }
    await page.keyboard.press('Escape');
    if (fonts.some((font) => font.trim() === '')) throw new Error(`a block opened with no font named: ${String(fonts.length)} blocks`);
    const distinct = new Set(fonts).size;
    // THE NAMES ARE THE OWNER'S DOCUMENT'S, so only their count and agreement are recorded.
    if (distinct < 2) throw new Error(`${String(fonts.length)} blocks opened in ${String(distinct)} font: the lines do not each take their own`);
    return { document: 4, id, page: 1, blocks: fonts.length, distinctFonts: distinct };
  });
  await closeAll();
}

// ———————————————————————————————————————————— placements ————————————————————————————————————————————

if (runs('fit')) {
  /** Blank pages of one size, a file of the walk's own. */
  const sized = async (/** @type {string} */ name, /** @type {number} */ width, /** @type {number} */ height, /** @type {number} */ count) => {
    const document = await PDFDocument.create();
    for (let at = 0; at < count; at += 1) document.addPage([width, height]);
    const path = join(output, name);
    await writeFile(path, await document.save());
    return path;
  };
  /** The pages on screen against the room their scroller gives them, and how often anything moved in 800 ms. */
  const fitReading = () =>
    page.evaluate(async () => {
      const shown = () => [...Reflect.get(globalThis, 'document').querySelectorAll('canvas.m-page')].filter((each) => each.getBoundingClientRect().width > 0);
      /** @type {string[]} */
      const seen = [];
      for (let tick = 0; tick < 16; tick += 1) {
        seen.push(shown().map((each) => { const box = each.getBoundingClientRect(); return `${String(Math.round(box.width))}x${String(Math.round(box.height))}`; }).join());
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const [first] = shown();
      let scroller = first?.parentElement ?? null;
      while (scroller !== null && !['auto', 'scroll'].includes(Reflect.get(globalThis, 'getComputedStyle')(scroller).overflowY)) scroller = scroller.parentElement;
      if (first === undefined || scroller === null) return null;
      const top = first.getBoundingClientRect().top;
      const row = shown().filter((each) => Math.abs(each.getBoundingClientRect().top - top) < 2);
      const left = Math.min(...row.map((each) => each.getBoundingClientRect().left));
      const right = Math.max(...row.map((each) => each.getBoundingClientRect().right));
      return {
        moves: seen.filter((each, at) => at > 0 && each !== seen[at - 1]).length,
        width: right - left,
        height: first.getBoundingClientRect().height,
        roomWidth: scroller.clientWidth,
        roomHeight: scroller.clientHeight,
      };
    });
  await step('the fits stay still and fit: every layout, page count and paper, at the window heights the loop needed', async () => {
    const files = [await sized('fit-two-a4.pdf', 595.28, 841.89, 2), await sized('fit-one-a4.pdf', 595.28, 841.89, 1), await sized('fit-wide.pdf', 1276, 1650, 1)];
    const wrong = [];
    let readings = 0;
    for (const file of files) {
      await open(file);
      for (const layout of ['Single page', 'Continuous', 'Facing', 'Continuous facing']) {
        await command(layout);
        for (const height of [852, 868, 870, 874, 876]) {
          await walk.sizeWindow({ width: 1600, height });
          for (const [fit, fills] of /** @type {const} */ ([['Fit width', 'width'], ['Fit page', 'either']])) {
            await command(fit);
            await page.waitForTimeout(250);
            const read = await fitReading();
            readings += 1;
            const label = `${basename(file)} ${layout} ${String(height)} ${fit}`;
            if (read === null) {
              wrong.push(`${label}: no page on screen`);
              continue;
            }
            if (read.moves > 1) wrong.push(`${label}: moved ${String(read.moves)} times in 800 ms`);
            if (read.width > read.roomWidth + 1) wrong.push(`${label}: ${String(read.width)} wide in ${String(read.roomWidth)}`);
            if (fit === 'Fit page' && read.height > read.roomHeight + 1) wrong.push(`${label}: ${String(read.height)} high in ${String(read.roomHeight)}`);
            // THE ROOM IS USED, or a fit of nothing would pass: the owner's one page drawn at half the pane.
            const used = fills === 'width' ? read.width / read.roomWidth : Math.max(read.width / read.roomWidth, read.height / read.roomHeight);
            if (used < 0.85) wrong.push(`${label}: uses ${used.toFixed(2)} of the room`);
          }
        }
      }
      await closeAll();
    }
    await walk.sizeWindow({ width: 1600, height: 900 });
    if (wrong.length > 0) throw new Error(wrong.slice(0, 12).join('\n'));
    return { readings };
  }, { covers: ['view.fit-width', 'view.fit-page'] });
}

// ———————————————————————————————————�

if (runs('one-space')) {
  const LINES = Array.from({ length: 5 }, (_, at) => `Line ${String(at + 1)} of a paragraph that a person reads and never types in, ending here`);
  /**
   * One paragraph, drawn upright or turned the way a page under /Rotate 180 is, with or without a filled bar over part of it,
   * or (`gap`) with a bar standing in a jump its first line's words make round it, the shape the owner's page has.
   */
  const paragraph = async (/** @type {string} */ name, /** @type {{ turned: boolean; bar: boolean; gap?: boolean }} */ { turned, bar, gap = false }) => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const sheet = document.addPage([612, 792]);
    if (turned) sheet.setRotation(pdfLib.degrees(180));
    for (const [at, line] of LINES.entries()) {
      const y = 700 - at * 14;
      if (gap && at === 0) {
        const key = sheet.node.newFontDictionary(font.name, font.ref);
        const shown = document.context.obj([font.encodeText('Line 1 of a '), -6000, font.encodeText('paragraph that reads, ending here')]);
        sheet.pushOperators(pdfLib.beginText(), pdfLib.setFontAndSize(key, 11), pdfLib.moveText(72, y), pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.ShowTextAdjusted, [shown]), pdfLib.endText());
        sheet.drawRectangle({ x: 72 + font.widthOfTextAtSize('Line 1 of a ', 11) + 3, y: y - 3, width: 60, height: 12, color: rgb(0, 0, 0) });
        continue;
      }
      sheet.drawText(line, turned ? { x: 612 - 72, y: 792 - y, size: 11, font, rotate: pdfLib.degrees(180) } : { x: 72, y, size: 11, font });
    }
    if (bar) sheet.drawRectangle(turned ? { x: 612 - 72 - 200, y: 792 - 700 - 3, width: 100, height: 12, color: rgb(0, 0, 0) } : { x: 172, y: 697, width: 100, height: 12, color: rgb(0, 0, 0) });
    const path = join(output, name);
    await writeFile(path, await document.save());
    return path;
  };
  /** The page's pixels held, and how many have moved since. */
  const hold = () =>
    page.evaluate(() => {
      const canvas = [...Reflect.get(globalThis, 'document').querySelectorAll('canvas.m-page')].find((each) => each.getBoundingClientRect().width > 0);
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (!canvas || !context) throw new Error('no page on screen');
      Reflect.set(globalThis, 'walkHeld', context.getImageData(0, 0, canvas.width, canvas.height).data);
    });
  const moved = () =>
    page.evaluate(() => {
      const canvas = [...Reflect.get(globalThis, 'document').querySelectorAll('canvas.m-page')].find((each) => each.getBoundingClientRect().width > 0);
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (!canvas || !context) throw new Error('no page on screen');
      const now =context.getImageData(0, 0, canvas.width, canvas.height).data;
      const was = Reflect.get(globalThis, 'walkHeld');
      let count = 0;
      for (let at = 0; at < now.length; at += 4) {
        if (Math.abs(now[at] - was[at]) + Math.abs(now[at + 1] - was[at + 1]) + Math.abs(now[at + 2] - was[at + 2]) > 24) count += 1;
      }
      return count;
    });
  await step('one space changes nothing on the page: upright and turned, with and without a bar, at a wrap and at the paragraph’s end', async () => {
    /** @type {Record<string, number>} */
    const readings = {};
    for (const [name, shape] of /** @type {const} */ ([
      ['upright', { turned: false, bar: false }],
      ['turned', { turned: true, bar: false }],
      ['upright with a bar', { turned: false, bar: true }],
      ['turned with a bar', { turned: true, bar: true }],
      ['upright with a bar in a gap', { turned: false, bar: false, gap: true }],
    ])) {
      const path = await paragraph(`one-space-${name.replaceAll(' ', '-')}.pdf`, shape);
      // THE FIRST LINE'S END TOO, where the bar lies: the words past a bar stay where they are (the owner's ruling, 2026-11-06).
      // EACH PLACE FROM A FRESH OPEN: a write splits a line that has a jump in it into two blocks, and the block this row
      // presses is then another one than the place it names.
      for (const [where, keys] of /** @type {const} */ ([['first line', ['Control+Home', 'End']], ['wrap', ['Control+Home', 'ArrowDown', 'End']], ['end', ['Control+End']]])) {
        await open(path);
        await command('Fit page');
        await section('Edit');
        await text.ensureEditText();
        const block = page.locator('[data-text-block]').first();
        await block.waitFor({ state: 'attached', timeout: 30_000 });
        await page.waitForTimeout(600);
        await hold();
        await text.openBlock(block, 'middle');
        for (const key of keys) await page.keyboard.press(key);
        await page.keyboard.type(' ');
        await text.pressAway();
        const said = await text.problems();
        if (said.length > 0) throw new Error(`${name}, ${where}: the app said ${JSON.stringify(said)}`);
        const count = await moved();
        readings[`${name}, ${where}`] = count;
        if (count !== 0) throw new Error(`${name}, ${where}: ${String(count)} pixels moved for one space`);
        await closeAll();
      }
    }
    return { readings };
  }, { covers: ['text.edit'] });
  await step('a second edit: the part of a line past a bar, which the first edit made a block of its own, takes the caret and a word', async () => {
    await open(await paragraph('second-edit.pdf', { turned: false, bar: false, gap: true }));
    await command('Fit page');
    await section('Edit');
    await text.ensureEditText();
    const outlines = page.locator('[data-text-block]');
    await outlines.first().waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForTimeout(600);
    await text.openBlock(outlines.first(), 'middle');
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await text.pressAway();
    if ((await outlines.count()) !== 2) throw new Error(`the first edit left ${String(await outlines.count())} blocks, where this row needs the split it exists to test`);
    // THE SMALLER OF THE TWO: the press that places the caret is the one an outline over it took (the stack, `stackingOf`).
    const boxes = await outlines.evaluateAll((all) => all.map((each) => each.getBoundingClientRect().height));
    const inner = outlines.nth(boxes.indexOf(Math.min(...boxes)));
    await hold();
    await text.openBlock(inner, 'middle');
    if ((await text.editor().count()) !== 1) throw new Error('the second press closed the editor, so no caret came');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' again');
    const said = await text.pressAway();
    if (said.length > 0) throw new Error(`the app said ${JSON.stringify(said)}`);
    const count = await moved();
    if (count === 0) throw new Error('the word typed in the second edit moved no pixel');
    await closeAll();
    return { pixels: count };
  }, { covers: ['text.edit'] });
}

// ———————————————————————————————————�

if (runs('placements')) {
  await step('placements (50): 200 placements add under 500 ms to Edit text’s outlines of a page', async () => {
    const path = join(output, 'placements-200.pdf');
    const wrote = spawnSync(process.execPath, [join(root, 'scripts/research/formPlacementReads.mjs'), path], { encoding: 'utf8', cwd: root });
    if (wrote.status !== 0) throw new Error(`formPlacementReads.mjs exited ${String(wrote.status)}: ${wrote.stderr.slice(0, 300)}`);
    const outlines = page.locator('[data-text-block]');
    /** Three times Edit text turned on, each after turning it off: the first read of a page is also the host's first. */
    const timed = async () => {
      const readingsMs = [];
      for (let run = 0; run < 3; run += 1) {
        const tool = page.getByRole('button', { name: 'Edit text', exact: true }).first();
        if ((await tool.getAttribute('aria-pressed')) === 'true') await command('Edit text on the page');
        await expect(outlines).toHaveCount(0);
        // FROM THE PRESS OF THE TOOL'S BUTTON, as a hand turns it on: timed from before the palette opened, as until
        // 2026-11-04, every reading carried the palette's opening and typing too, about 300 ms of each.
        const started = Date.now();
        await tool.click();
        await expect.poll(() => outlines.count(), { timeout: 60_000, intervals: [20] }).toBeGreaterThan(0);
        readingsMs.push(Date.now() - started);
      }
      return readingsMs;
    };
    // THE CONTROL FIRST: a page of one line, so what every read costs is told apart from what 200 placements add.
    const plain = await PDFDocument.create();
    const font = await plain.embedFont(StandardFonts.Helvetica);
    plain.addPage([612, 792]).drawText('One line, read for the control', { x: 72, y: 700, size: 18, font });
    const control = join(output, 'placements-control.pdf');
    await writeFile(control, await plain.save());
    await open(control);
    await section('Edit');
    const controlMs = await timed();
    await closeAll();
    await open(path);
    await section('Edit');
    const readingsMs = await timed();
    // WHAT THE PLACEMENTS ADD, at every reading, the first among them: a person meets the first. Not the whole reading,
    // which held Edit text's own first start on ANY page: 1,443 ms on the one-line control, with no placement in it
    // (2026-11-04), so a whole-reading rule could not pass on a page of one line. The totals are kept beside it.
    const addedMs = readingsMs.map((ms, at) => ms - (controlMs[at] ?? 0));
    if (addedMs.some((ms) => ms >= 500)) throw new Error(`the placements added ${addedMs.join(', ')} ms: the outlines took ${readingsMs.join(', ')} ms, on a page of one line ${controlMs.join(', ')} ms`);
    return { addedMs, readingsMs, controlMs, outlines: await outlines.count(), script: wrote.stdout.trim().split('\n').slice(-4) };
  });
  await closeAll();
}

await finish();
