// @ts-check
/**
 * The steps every text walk takes, ONE definition of each (B3a): how Edit text is turned on whatever state it was left in,
 * where a press away lands, how a font is chosen in the Properties panel and what the editor said while it was busy, and
 * how a copy is saved and found on disk. `textWalk.mjs` and `textRegressionWalk.mjs` both take them, so a fix to how a
 * walk presses is made once and reaches both.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PDFHexString, PDFString } from '@cantoo/pdf-lib';
import { expect as defaultExpect } from '@playwright/test';

// AN EDIT IS WRITTEN BEFORE ITS EDITOR CLOSES (3 to 4.5 s on the 13 KB sample, 2026-10-12), so a step waits 30 s.
const expect = defaultExpect.configure({ timeout: 30_000 });

/** One reading of the open editor while a font choice lands (W2). */
/** @typedef {{ ms: number, busy: boolean, problem: string | null }} EditorSample */

/**
 * The text steps over one walk.
 *
 * @param {{ page: import('playwright').Page, output: string, saveTo: (path: string) => Promise<void>, command: (title: string) => Promise<void> }} walk
 */
export function textSteps(walk) {
  const { page, output, saveTo, command } = walk;

  /** The open editor's words. */
  const editor = () => page.locator('[data-text-editor]');
  /** The Properties panel's text section, while an editor is open. */
  const panel = () => page.locator('[data-text-properties]');

  /**
   * Edit text ON, whichever way an earlier step left it: the tool is a toggle, so running its command when it is on turns
   * it off. Add text stays armed after its editor ends and its surface covers the page, so it is turned off first.
   */
  async function ensureEditText() {
    const add = page.getByRole('button', { name: 'Add text', exact: true }).first();
    if ((await add.count()) > 0 && (await add.getAttribute('aria-pressed')) === 'true') await add.click();
    const tool = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    if ((await tool.getAttribute('aria-pressed')) !== 'true') await command('Edit text on the page');
  }

  /**
   * A press on the page `x` in from its RIGHT edge and `y` below its top (lowered under the ribbon when the page is
   * scrolled beneath it): the floating tool strip lies over the left margin, and the text layer takes a press on the canvas.
   * @param {number} x
   * @param {number} y
   */
  async function clickPage(x, y) {
    const box = await page.locator('canvas.m-page:visible').first().boundingBox();
    if (box === null) throw new Error('the page is not on screen');
    await page.mouse.click(box.x + box.width - x, Math.max(box.y, 230) + y);
  }

  /** Every refusal or warning the open editor shows, worded. */
  const problems = () => page.locator('.m-text-editor-problem').allInnerTexts();

  /**
   * A press away, ENDED: {@link clickPage}, then settled — no write in flight, and the editor closed or saying why it
   * stayed — and what it says answered, `[]` for an editor that closed. THE ONE RULE for every walk (B3a). A fixed wait
   * for the editor to go read a slow write as a failure and a refusal as a timeout: the first edit that needs a face
   * took 7.4 s on 2026-10-18 (the PDFium host reading the installed fonts while the compose host read them too), and a
   * refusal arrives with the write's answer, after any check made straight after the press.
   * @param {number} [x]
   * @param {number} [y]
   */
  async function pressAway(x = 20, y = 20) {
    const outlines = page.locator('[data-text-block]');
    const before = await outlines.count();
    /** An outline of the version the press began at: the read after a write draws new ones in their place. */
    const old = before > 0 ? await outlines.first().elementHandle() : null;
    const written = () => page.locator('html').getAttribute('data-writes-done').then((count) => Number(count ?? '0'));
    const writesBefore = await written();
    await clickPage(x, y);
    await expect
      .poll(
        async () =>
          ((await page.locator('html').getAttribute('data-writes')) ?? '0') === '0' &&
          ((await editor().count()) === 0 || (await problems()).length > 0),
        // 120 S, the longest write a walk has measured: one that embeds a font stayed up past 30 s on 2026-10-13 on this
        // machine's i5-3230M (`textWalk.mjs`' step 18). Settling sooner returns sooner; this is the bound on a hang.
        { timeout: 120_000, intervals: [100] },
      )
      .toBe(true);
    // AND THE READ AFTER THE WRITE: a write that ran past its page REOPENS its editor in that read, saying so (the
    // owner's Q7), after the editor had closed. Answered before it, the press said nothing where the page said "This
    // text no longer fits on the page" (memory walk M3b, 2026-10-18), and the walk's next press on another block was
    // not taken. The read replaces the outlines of the version the press began at; a press that wrote nothing has no read.
    if ((await written()) > writesBefore && old !== null) {
      await expect
        .poll(async () => !(await old.evaluate((element) => element.isConnected)) && ((await outlines.count()) >= before || (await problems()).length > 0), {
          timeout: 120_000,
          intervals: [100],
        })
        .toBe(true);
    }
    await old?.dispose();
    return problems();
  }

  /**
   * Chooses `family` in the panel's picker by searching for it, then samples the editor every half second until it is not
   * busy, recording busy and any refusal sentence on screen (W2: an editor left open after a busy span is one whose
   * write was refused, and the sentence says which).
   * @param {string} family
   * @returns {Promise<EditorSample[]>}
   */
  async function chooseFont(family) {
    await panel().getByRole('button', { name: /^Font:/u }).click();
    const search = panel().getByRole('combobox', { name: 'Search fonts' });
    await search.fill(family);
    // THE FAMILY LISTED BEFORE IT IS CHOSEN, as a person sees it before pressing Enter: while the computer's list is
    // still read (8.2 s for the first in a new profile, 2026-10-18) Enter chooses nothing and the picker stays open
    // with the keys in its search box. The walk then typed and pressed End outside the editor; End in the page list
    // scrolls to the last page, and the next press on page 1's paragraph landed off screen (memory walk M3b).
    await expect(panel().locator(`[data-font-choice="${family}"]`).first()).toBeVisible({ timeout: 60_000 });
    await search.press('Enter');
    await expect(search).toHaveCount(0);
    /** @type {EditorSample[]} */
    const samples = [];
    const started = Date.now();
    for (;;) {
      const state = await page.evaluate(() => {
        // THE PAGE'S OWN DOCUMENT, by name: a walk's module may bind `document` to a path.
        const dom = /** @type {{ querySelector: (selector: string) => { getAttribute: (name: string) => string | null, textContent: string | null } | null }} */ (
          Reflect.get(globalThis, 'document')
        );
        const open = dom.querySelector('[data-text-editor]');
        const problem = dom.querySelector('.m-text-editor-problem');
        return { open: open !== null, busy: open?.getAttribute('aria-busy') === 'true', problem: problem?.textContent ?? null };
      });
      samples.push({ ms: Date.now() - started, busy: state.busy, problem: state.problem });
      if (!state.open || (!state.busy && Date.now() - started >= 1000)) break;
      if (Date.now() - started > 60_000) throw new Error(`the editor was still busy 60 s after the font choice: ${JSON.stringify(samples)}`);
      await page.waitForTimeout(500);
    }
    // THE KEYS BACK IN THE WORDS (the panel's own rule, `FontPicker`'s `choose`): what a walk types next goes to the editor.
    if ((await editor().count()) > 0) await expect(editor()).toBeFocused();
    return samples;
  }

  /**
   * A copy of the open document saved under `name` in the walk's output, once it is on disk.
   * @param {string} name
   */
  async function savedCopy(name) {
    const path = join(output, name);
    await saveTo(path);
    await command('Save a copy…');
    await expect.poll(() => existsSync(path), { timeout: 60_000 }).toBe(true);
    return path;
  }

  return { editor, panel, ensureEditText, clickPage, pressAway, problems, chooseFont, savedCopy };
}

/**
 * How many tabs a page's content marks (ADR-0228: one gap, `/ActualText` U+0009), whichever writer wrote it.
 *
 * BY THE MARK'S DECODED VALUE, never by one spelling. The MuPDF writer spells it `<FEFF0009>` and PDFium's mark API
 * writes `(\t)`, a literal string holding byte 9 (measured 2026-10-16 in the text-regression walk's saved file), and the
 * format says both are the same text. Counting the first spelling alone reported "not saved" for every tab the PDFium
 * writer saved. A mark whose value cannot be read throws: an unread mark counted as no tab is the reassuring answer.
 *
 * @param {string} content a page's decoded content, latin1
 */
export const tabMarks = (content) => {
  const marks = [...content.matchAll(/\/ActualText\s*/gu)];
  let tabs = 0;
  for (const mark of marks) {
    const rest = content.slice((mark.index ?? 0) + mark[0].length);
    const literal = /^\(((?:\\[\s\S]|[^\\()])*)\)/u.exec(rest);
    const hex = /^<([0-9A-Fa-f\s]*)>/u.exec(rest);
    const value = literal !== null ? PDFString.of(literal[1] ?? '').decodeText() : hex !== null ? PDFHexString.of((hex[1] ?? '').replaceAll(/\s/gu, '')).decodeText() : null;
    if (value === null) throw new Error(`an /ActualText whose value this counter cannot read: ${JSON.stringify(rest.slice(0, 40))}`);
    if (value === '\t') tabs += 1;
  }
  return tabs;
};
