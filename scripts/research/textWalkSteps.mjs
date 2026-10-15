// @ts-check
/**
 * The steps every text walk takes, ONE definition of each (B3a): how Edit text is turned on whatever state it was left in,
 * where a press away lands, how a font is chosen in the Properties panel and what the editor said while it was busy, and
 * how a copy is saved and found on disk. `textWalk.mjs` and `textRegressionWalk.mjs` both take them, so a fix to how a
 * walk presses is made once and reaches both.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
    await search.press('Enter');
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

  return { editor, panel, ensureEditText, clickPage, chooseFont, savedCopy };
}

/** How many tabs a page's content marks (ADR-0228: one gap, `/ActualText` U+0009). @param {string} content */
export const tabMarks = (content) => (content.match(/\/ActualText <FEFF0009>/gu) ?? []).length;
