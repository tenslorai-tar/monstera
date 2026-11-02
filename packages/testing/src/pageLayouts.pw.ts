import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { bridge } from './pageBridge.js';

/**
 * The page layouts in a real browser (ADR-0284): where the cover page stands, the View menu's control, selecting text and
 * typing in a form on a right-hand page, and what a switch costs a frame.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f4');
const PAGES = 6;

/** Six pages, each with one line of its own words, and on page 2 a text field. */
async function pages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let at = 0; at < PAGES; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Words of page ${String(at + 1)}`, { x: 72, y: 700, size: 18, font, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 200, y: 300, width: 200, height: 200, color: rgb(0, 0, 0) });
  }
  const field = document.getForm().createTextField('Name');
  field.setText('Ada');
  field.addToPage(document.getPage(1), { x: 72, y: 600, width: 300, height: 24, font });
  return document.save();
}

const FIELD: ShimFormField = { page: 1, index: 0, kind: 'text', name: 'Name', values: ['Ada'], on: null, options: [], readOnly: false, multiline: false, rect: { x0: 72, y0: 600, x1: 372, y1: 624 } };

async function opened(page: Page, settings: Readonly<Record<string, unknown>>, sent: { channel: string; params: unknown }[] = []): Promise<void> {
  const bytes = await pages();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Layouts.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      pageLines: Array.from({ length: PAGES }, (_, at) => [`Words of page ${String(at + 1)}`]),
      formFields: [[FIELD]],
      settings,
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  // THE PAGE'S OWN ERRORS, said in the run: a page that fails to start leaves only a timeout otherwise.
  page.on('pageerror', (error) => {
    console.log(`PAGEERROR ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`CONSOLE ${message.text().slice(0, 300)}`);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]')).toHaveCount(1, { timeout: 30_000 });
}

/** Each shown slot's page and its box on screen. */
async function slots(page: Page): Promise<{ page: number; left: number; top: number }[]> {
  return page.locator('.m-page-list').evaluate((list) =>
    [...list.querySelectorAll<HTMLElement>('.m-page-slot')]
      .filter((slot) => !slot.hidden)
      .map((slot) => {
        const box = slot.getBoundingClientRect();
        return { page: Number(slot.dataset['page']), left: Math.round(box.left), top: Math.round(box.top) };
      }),
  );
}

test.describe('page layouts (ADR-0284)', () => {
  test('the COVER PAGE stands alone in the right column in Continuous facing, and pages 2 and 3 face each other', async ({ page }) => {
    await opened(page, { 'viewing.page-layout': 'facing', 'viewing.cover-page': true });
    const [cover, second, third] = await slots(page);
    if (cover === undefined || second === undefined || third === undefined) throw new Error('fewer than three pages shown');
    // PAGE 1 ON THE RIGHT: its left is the right column's, where page 3's is.
    expect(cover.left).toBe(third.left);
    expect(second.left).toBeLessThan(third.left);
    expect(second.top).toBe(third.top);
    expect(cover.top).toBeLessThan(second.top);
  });

  test('CONTROL: without the cover page, pages 1 and 2 face each other on the first row', async ({ page }) => {
    await opened(page, { 'viewing.page-layout': 'facing' });
    const [first, second] = await slots(page);
    expect(first?.top).toBe(second?.top);
    expect(first?.left ?? 0).toBeLessThan(second?.left ?? 0);
  });

  test('the View menu’s Facing shows one pair, and Next page moves to the next pair', async ({ page }) => {
    await opened(page, {});
    expect((await slots(page)).length).toBe(PAGES);
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Facing', exact: true }).click();
    await expect.poll(async () => (await slots(page)).map((each) => each.page)).toStrictEqual([0, 1]);
    await page.locator('.m-page-list').focus();
    await page.keyboard.press('PageDown');
    await expect.poll(async () => (await slots(page)).map((each) => each.page)).toStrictEqual([2, 3]);
  });

  test('selecting text on a RIGHT-HAND page in Facing selects that page’s letters', async ({ page }) => {
    await opened(page, { 'viewing.page-layout': 'pair' });
    const line = page.locator('.m-page-slot[data-page="1"] .m-text-layer span').first();
    await expect(line).toBeVisible({ timeout: 20_000 });
    await line.click({ clickCount: 3 });
    const selected = await page.evaluate(() => document.getSelection()?.toString().trim() ?? '');
    expect(selected).toBe('Words of page 2');
  });

  test('typing in a form field on a RIGHT-HAND page in Facing fills it, each keystroke painted within 50 ms', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await opened(page, { 'viewing.page-layout': 'pair' }, sent);
    const target = page.locator('[data-form-layer="1"] [data-form-field="0"]');
    await expect(target).toBeAttached({ timeout: 20_000 });
    await target.click();
    const editor = page.locator('[data-form-layer="1"] input[aria-label="Name"]');
    await expect(editor).toBeFocused();
    await page.keyboard.press('End');
    await page.evaluate(() => {
      const record = window as unknown as { strokes: number[] };
      record.strokes = [];
      window.addEventListener(
        'keydown',
        (event) => {
          const began = event.timeStamp;
          window.addEventListener('input', () => requestAnimationFrame(() => record.strokes.push(performance.now() - began)), { capture: true, once: true });
        },
        { capture: true },
      );
    });
    await page.keyboard.type(' Lovelace', { delay: 60 });
    await page.keyboard.press('Enter');
    const strokes = await page.evaluate(() => (window as unknown as { strokes: number[] }).strokes);
    console.log(`FORM strokes ${JSON.stringify(strokes.map(Math.round))}`);
    expect(strokes).toHaveLength(9);
    expect(Math.max(...strokes)).toBeLessThanOrEqual(50);
    const fills = sent.filter((call) => call.channel === 'document.execute').map((call) => JSON.stringify(call.params));
    expect(fills.some((each) => each.includes('Ada Lovelace'))).toBe(true);
  });

  test('SWITCHING LAYOUT, Continuous to Facing to Continuous facing: the frames it takes, when asked for (MONSTERA_LAYOUT_FRAMES=1)', async ({ page }) => {
    test.skip(process.env['MONSTERA_LAYOUT_FRAMES'] !== '1', 'a measurement, run by hand');
    await opened(page, {});
    await page.waitForTimeout(1000);
    // THE CONTROL FIRST: the layout already on, chosen again, which costs the menu's opening and closing and no switch.
    for (const name of ['Continuous', 'Facing', 'Continuous facing', 'Continuous']) {
      // ONE WATCH AT A TIME: each is a generation of its own, and stops when the next begins.
      await page.evaluate(() => {
        const record = window as unknown as { gaps: number[]; generation: number | undefined };
        record.generation = (record.generation ?? 0) + 1;
        const mine = record.generation;
        record.gaps = [];
        let last = performance.now();
        const tick = (now: number): void => {
          if (record.generation !== mine) return;
          record.gaps.push(now - last);
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
      // WHERE THE SWITCH'S TIME GOES, when asked for (`MONSTERA_LAYOUT_PROFILE=1`, against an unminified build).
      const session = process.env['MONSTERA_LAYOUT_PROFILE'] === '1' && name === 'Facing' ? await page.context().newCDPSession(page) : undefined;
      if (session !== undefined) {
        await session.send('Profiler.enable');
        await session.send('Profiler.setSamplingInterval', { interval: 100 });
        await session.send('Profiler.start');
      }
      await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
      await page.waitForTimeout(1500);
      if (session !== undefined) {
        const { profile } = await session.send('Profiler.stop');
        const self = new Map<string, number>();
        const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
        for (const [at, id] of (profile.samples ?? []).entries()) {
          const node = nodes.get(id);
          if (node === undefined) continue;
          const key = `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').at(-1) ?? ''}:${String(node.callFrame.lineNumber)}`;
          self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas?.[at] ?? 0) / 1000);
        }
        const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
        console.log(`SWITCH profile\n${top.map(([key, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${key}`).join('\n')}`);
      }
      const gaps = await page.evaluate(() => {
        const record = window as unknown as { gaps: number[]; generation: number };
        record.generation += 1;
        return record.gaps;
      });
      console.log(`SWITCH to ${name}: longest ${String(Math.round(Math.max(...gaps)))} ms, over 16.7 ms ${String(gaps.filter((gap) => gap > 17.5).length)} of ${String(gaps.length)}`);
    }
  });
});
